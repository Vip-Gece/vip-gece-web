"use strict";

const express = require("express");
const { resolveSupabaseUser, requireAdmin, requireFullAdmin } = require("../middleware/auth");
const { categoryRows, districtRows, seoClusterRows } = require("../data/publicMetadata");
const {
  inspectUrl,
  listSitemaps,
  publicFastDiscoveryPlan,
  querySearchAnalytics,
  runDiscoverySync,
  searchConsoleStatus,
  submitSitemaps
} = require("../services/googleSearchConsoleService");
const {
  getAdminAnalyticsOverview
} = require("../services/profileAnalyticsService");
const {
  getCustomerMobileAccount
} = require("../services/customerMobileAccountService");

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function imageCount(profile) {
  return Array.isArray(profile.images) ? profile.images.filter(Boolean).length : 0;
}

function seoReady(profile) {
  return Boolean(profile.slug && profile.seo_title && profile.seo_description);
}

function googleStatus() {
  return searchConsoleStatus();
}

function buildAnalyticsOverview(profiles = []) {
  const active = profiles.filter((profile) => profile.is_active !== false);
  const vip = active.filter((profile) => profile.type === "vip" || profile.is_featured === true);
  const noImage = active.filter((profile) => imageCount(profile) < 1);
  const lowImage = active.filter((profile) => imageCount(profile) > 0 && imageCount(profile) < 3);
  const seoMissing = active.filter((profile) => !seoReady(profile));

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    persistence: "read_only_staging_summary",
    totals: {
      profiles: profiles.length,
      active_profiles: active.length,
      vip_profiles: vip.length,
      normal_profiles: Math.max(0, active.length - vip.length),
      total_views: profiles.reduce((sum, profile) => sum + number(profile.view_count), 0),
      total_clicks: profiles.reduce((sum, profile) => sum + number(profile.click_count), 0)
    },
    quality: {
      no_image: noImage.length,
      low_image: lowImage.length,
      seo_missing: seoMissing.length,
      image_coverage_percent: active.length ? Math.round(((active.length - noImage.length) / active.length) * 100) : 100,
      seo_ready_percent: active.length ? Math.round(((active.length - seoMissing.length) / active.length) * 100) : 100
    },
    top_profiles: active.slice(0, 8).map((profile) => ({
      id: profile.id,
      name: profile.name || "",
      slug: profile.slug || "",
      views: number(profile.view_count),
      clicks: number(profile.click_count),
      images: imageCount(profile),
      seo_ready: seoReady(profile)
    })),
    taxonomy: {
      districts: districtRows().length,
      categories: categoryRows().length,
      clusters: seoClusterRows().length
    },
    google: googleStatus()
  };
}

function disabledAction(action) {
  return {
    ok: false,
    action,
    disabled: true,
    mode: "not_configured_or_disabled",
    google: googleStatus()
  };
}

function sendGoogleError(res, err, action) {
  const statusCode = Number(err.statusCode || 502);
  return res.status(statusCode).json({
    ok: false,
    action,
    error: err.message || "Google Search Console isteği tamamlanamadı.",
    google_status: err.googleStatus || 0,
    google: err.status || googleStatus()
  });
}

function createAdminOpsRouter() {
  const router = express.Router();
  const adminAuth = [resolveSupabaseUser, requireAdmin];
  const fullAdminAuth = [resolveSupabaseUser, requireFullAdmin];

  router.use("/api/admin", (req, res, next) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.set("Pragma", "no-cache");
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    return next();
  });

  async function sendAnalytics(req, res) {
    try {
      const input = {
        ...(req.query || {}),
        ...(req.body || {})
      };
      const profileId = String(input.profile_id ?? input.profileId ?? "").trim();
      const customerId = String(input.customer_id ?? input.customerId ?? "").trim();
      if (profileId && customerId) {
        return res.status(400).json({ error: "Tek seferde profil veya müşteri kapsamından biri seçilebilir." });
      }

      let customer = null;
      if (customerId) {
        if (req.adminRole !== "full_admin") {
          return res.status(403).json({ error: "Müşteri analizi için tam yönetici yetkisi gerekli." });
        }
        customer = await getCustomerMobileAccount(customerId);
        if (!customer) {
          return res.status(404).json({ error: "Analiz müşterisi bulunamadı." });
        }
      }

      const overview = await getAdminAnalyticsOverview({
        days: input.days,
        profileId,
        ownerUserId: customer?.owner_user_id || ""
      });
      return res.json({
        ...overview,
        selected_customer: customer ? {
          id: customer.id,
          label: customer.label || customer.username || "Müşteri hesabı"
        } : null
      });
    } catch (err) {
      console.error("Admin analytics overview error:", {
        name: String(err?.name || "Error").slice(0, 80),
        code: String(err?.code || "").slice(0, 80)
      });
      const status = Number.isInteger(err?.status) ? err.status : 500;
      return res.status(status).json({
        error: status >= 500 ? "Analytics özeti hazırlanamadı." : err.message
      });
    }
  }

  router.get("/api/admin/analytics/overview", adminAuth, sendAnalytics);
  router.post("/api/admin/analytics/overview", adminAuth, sendAnalytics);

  router.get("/api/admin/google/status", fullAdminAuth, (req, res) => res.json({
    ...googleStatus(),
    fast_discovery_plan: publicFastDiscoveryPlan()
  }));

  router.get("/api/admin/google/sitemaps", fullAdminAuth, async (req, res) => {
    try {
      return res.json(await listSitemaps());
    } catch (err) {
      if (err.statusCode === 503) return res.json({ ok: true, configured: false, sitemaps: [], google: googleStatus() });
      return sendGoogleError(res, err, "sitemaps");
    }
  });

  router.post("/api/admin/google/sync", fullAdminAuth, async (req, res) => {
    try {
      return res.json(await runDiscoverySync(req.body || {}));
    } catch (err) {
      if (err.statusCode === 503) return res.json(disabledAction("sync"));
      return sendGoogleError(res, err, "sync");
    }
  });

  router.post("/api/admin/google/sitemaps", fullAdminAuth, async (req, res) => {
    try {
      return res.json(await submitSitemaps(req.body?.sitemaps || req.body?.sitemap));
    } catch (err) {
      if (err.statusCode === 503) return res.json(disabledAction("submit_sitemaps"));
      return sendGoogleError(res, err, "submit_sitemaps");
    }
  });

  router.post("/api/admin/google/inspect", fullAdminAuth, async (req, res) => {
    try {
      const target = req.body?.url || req.body?.inspectionUrl || req.body?.inspection_url;
      if (!target) return res.status(400).json({ ok: false, error: "url zorunlu." });
      return res.json(await inspectUrl(target, req.body || {}));
    } catch (err) {
      if (err.statusCode === 503) return res.json(disabledAction("inspect"));
      return sendGoogleError(res, err, "inspect");
    }
  });

  router.post("/api/admin/google/search-analytics", fullAdminAuth, async (req, res) => {
    try {
      return res.json(await querySearchAnalytics(req.body || {}));
    } catch (err) {
      if (err.statusCode === 503) return res.json({ ...disabledAction("search_analytics"), rows: [] });
      return sendGoogleError(res, err, "search_analytics");
    }
  });
  router.post("/api/admin/google/serp-audit", fullAdminAuth, (req, res) => res.json({ ...disabledAction("serp_audit"), findings: [] }));

  return router;
}

module.exports = {
  buildAnalyticsOverview,
  createAdminOpsRouter,
  googleStatus
};
