"use strict";

const express = require("express");
const { resolveSupabaseUser, requireAdmin, requireFullAdmin } = require("../middleware/auth");
const { getSupabaseClientForToken } = require("../data/supabaseClient");
const { hasDatabaseUrl } = require("../data/postgresClient");
const {
  createPostgresProfile,
  deletePostgresProfile,
  getPostgresProfileById,
  listAdminPostgresProfiles,
  updatePostgresProfile
} = require("../data/postgresProfilesRepo");
const {
  createPostgresAd,
  deletePostgresAd,
  listAdminPostgresAds,
  updatePostgresAd
} = require("../data/postgresAdsRepo");
const { categoryRows, districtRows, seoClusterRows } = require("../data/publicMetadata");
const { buildAnalyticsOverview, googleStatus } = require("./adminOpsRoutes");
const {
  getSiteSettings,
  updateSiteSettings
} = require("../services/siteSettingsService");
const { cleanText, sanitizeAdPayload, sanitizeProfilePayload } = require("../utils/input");
const { applyProfileSeoDefaults } = require("../utils/profileSeo");
const { adminPermissions } = require("../services/adminPermissions");
const {
  applyProfileCreateDefaults,
  applyProfileUpdateDefaults,
  assertProfileUpdatePublishable
} = require("../services/profileDefaults");

function allowSupabaseProfileData() {
  return process.env.VIP_GECE_ALLOW_SUPABASE_PROFILE_DATA === "true";
}

function setMobileHeaders(req, res, next) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return next();
}

function getAdminDb(req, res) {
  if (hasDatabaseUrl() || !allowSupabaseProfileData()) {
    res.status(503).json({ error: "VIP GECE profil verisi için DATABASE_URL gerekli." });
    return null;
  }

  const db = getSupabaseClientForToken(req.accessToken);

  if (!db) {
    res.status(503).json({ error: "Supabase staging ortamında hazır değil." });
    return null;
  }

  return db;
}

function sendDbError(res, error, fallback) {
  if (!error) return false;
  console.error("Mobile admin database error:", error);
  return res.status(400).json({ error: fallback });
}

function sendEmptyPayloadError(res) {
  return res.status(400).json({ error: "Geçerli profil alanı gönderilmedi." });
}

function requestId(req) {
  return cleanText(req.params.id, 140);
}

function summarizeProfile(profile) {
  const images = Array.isArray(profile.images) ? profile.images : [];
  return {
    id: profile.id,
    name: profile.name || "",
    slug: profile.slug || "",
    image: images[0] || "",
    images_count: images.length,
    age: profile.age || "",
    district: profile.district || "",
    type: profile.type || "normal",
    package_type: profile.package_type || "",
    priority_order: Number(profile.priority_order || profile.display_priority || 0),
    is_active: Boolean(profile.is_active),
    is_featured: Boolean(profile.is_featured),
    updated_at: profile.updated_at || null,
    expires_at: profile.expires_at || null,
    view_count: Number(profile.view_count || 0),
    click_count: Number(profile.click_count || 0),
    owner_user_id: profile.owner_user_id,
    owner_email: profile.owner_email,
    created_via: profile.created_via,
    can_edit: true,
    can_delete: true,
    owned_by_current_user: profile.owner_user_id === undefined ? undefined : profile.owner_user_id === profile.current_user_id
  };
}

function taxonomyBody() {
  return {
    districts: districtRows(),
    categories: categoryRows(),
    clusters: seoClusterRows()
  };
}

function auditBody(req) {
  return {
    ok: true,
    checked_at: new Date().toISOString(),
    user: userBody(req),
    routes: {
      profiles: "auth_gated",
      settings: "auth_gated",
      analytics: "auth_gated_read_only",
      google: "disabled_in_staging"
    }
  };
}

function userBody(req) {
  const permissions = adminPermissions(req.adminRole);
  return {
    id: req.authUser.id,
    email: req.authUser.email,
    role: permissions.role,
    permissions
  };
}

function mobileProfilePayload(req, { creating = false } = {}) {
  const payload = applyProfileUpdateDefaults(sanitizeProfilePayload(req.body));
  delete payload.owner_user_id;

  if (req.adminRole === "profile_admin") {
    delete payload.slug;
    delete payload.seo_title;
    delete payload.seo_description;
    delete payload.seo_keywords;
    delete payload.view_count;
    delete payload.click_count;
    delete payload.is_active;
  }

  return creating || req.adminRole === "full_admin"
    ? applyProfileSeoDefaults(payload)
    : payload;
}

async function supabaseCreatePayload(db, payload) {
  const { data, error } = await db
    .from("profiles")
    .select("type,vip_slot,normal_slot");
  if (error) throw error;
  return applyProfileCreateDefaults(payload, Array.isArray(data) ? data : []);
}

async function assertSupabaseProfileUpdate(db, profileId, payload) {
  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("id", profileId)
    .single();
  if (error) throw error;
  const normalized = applyProfileUpdateDefaults(payload, data);
  assertProfileUpdatePublishable(data, normalized);
  return normalized;
}

async function listProfiles(db) {
  if (hasDatabaseUrl()) {
    return { profiles: await listAdminPostgresProfiles() };
  }

  const { data, error } = await db
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return { error };
  return { profiles: Array.isArray(data) ? data : [] };
}

async function listAds(db) {
  if (hasDatabaseUrl()) {
    return { ads: await listAdminPostgresAds() };
  }

  const { data, error } = await db
    .from("ads")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return { error };
  return { ads: Array.isArray(data) ? data : [] };
}

function createAdminMobileRouter() {
  const router = express.Router();
  const adminAuth = [setMobileHeaders, resolveSupabaseUser, requireAdmin];
  const fullAdminAuth = [setMobileHeaders, resolveSupabaseUser, requireFullAdmin];

  router.get("/api/admin/mobile/health", adminAuth, (req, res) => {
    return res.json({
      ok: true,
      service: "vip-gece-admin-mobile",
      user: userBody(req),
      server_time: new Date().toISOString()
    });
  });

  router.get("/api/admin/mobile/bootstrap", adminAuth, async (req, res) => {
    const db = hasDatabaseUrl() ? null : getAdminDb(req, res);
    if (!hasDatabaseUrl() && !db) return;
    const permissions = adminPermissions(req.adminRole);

    const [result, adResult, settings] = await Promise.all([
      listProfiles(db),
      listAds(db),
      permissions.canViewSettings ? getSiteSettings() : Promise.resolve(null)
    ]);
    if (sendDbError(res, result.error || adResult.error, "Mobil başlangıç verisi alınamadı.")) return;

    const profiles = result.profiles || [];
    const ads = adResult.ads || [];
    const taxonomy = taxonomyBody();
    const activeProfiles = profiles.filter((profile) => profile.is_active).length;
    const vipProfiles = profiles.filter((profile) => profile.type === "vip" || profile.is_featured).length;

    return res.json({
      ok: true,
      user: userBody(req),
      permissions,
      server_time: new Date().toISOString(),
      settings: permissions.canViewSettings ? settings : null,
      google: permissions.canRunGoogleSync ? googleStatus() : null,
      sitemaps: permissions.canRunGoogleSync ? { configured: true } : null,
      counts: {
        profiles: profiles.length,
        active_profiles: activeProfiles,
        vip_profiles: vipProfiles,
        ads: ads.length,
        active_ads: ads.filter((ad) => ad.is_active).length,
        districts: taxonomy.districts.length,
        categories: taxonomy.categories.length,
        clusters: taxonomy.clusters.length
      },
      profiles: profiles.map(summarizeProfile),
      ads,
      taxonomy,
      audit: []
    });
  });

  router.get("/api/admin/mobile/analytics", adminAuth, async (req, res) => {
    const db = hasDatabaseUrl() ? null : getAdminDb(req, res);
    if (!hasDatabaseUrl() && !db) return;

    const result = await listProfiles(db);
    if (sendDbError(res, result.error, "Mobil analytics özeti alınamadı.")) return;
    return res.json({ ok: true, overview: buildAnalyticsOverview(result.profiles || []), server_time: new Date().toISOString() });
  });

  router.get("/api/admin/mobile/profiles", adminAuth, async (req, res) => {
    const db = hasDatabaseUrl() ? null : getAdminDb(req, res);
    if (!hasDatabaseUrl() && !db) return;

    const result = await listProfiles(db);
    if (sendDbError(res, result.error, "Mobil profiller alınamadı.")) return;
    return res.json({ profiles: result.profiles || [] });
  });

  router.get("/api/admin/mobile/profiles/:id", adminAuth, async (req, res) => {
    if (hasDatabaseUrl()) {
      try {
        return res.json({ profile: await getPostgresProfileById(requestId(req)) });
      } catch (err) {
        return sendDbError(res, err, "Mobil profil alınamadı.");
      }
    }

    const db = getAdminDb(req, res);
    if (!db) return;

    const { data, error } = await db
      .from("profiles")
      .select("*")
      .eq("id", requestId(req))
      .single();

    if (sendDbError(res, error, "Mobil profil alınamadı.")) return;
    return res.json({ profile: data });
  });

  router.post("/api/admin/mobile/profiles", adminAuth, async (req, res) => {
    const payload = mobileProfilePayload(req, { creating: true });
    if (!Object.keys(payload).length) return sendEmptyPayloadError(res);

    if (hasDatabaseUrl()) {
      try {
        const profile = await createPostgresProfile(payload);
        return res.status(201).json({ profile });
      } catch (err) {
        return sendDbError(res, err, "Mobil profil oluşturulamadı.");
      }
    }

    const db = getAdminDb(req, res);
    if (!db) return;

    let createPayload;
    try {
      createPayload = await supabaseCreatePayload(db, payload);
    } catch (error) {
      return sendDbError(res, error, "Mobil profil sırası hazırlanamadı.");
    }

    const { data, error } = await db
      .from("profiles")
      .insert(createPayload)
      .select("*")
      .single();

    if (sendDbError(res, error, "Mobil profil oluşturulamadı.")) return;
    return res.status(201).json({ profile: data });
  });

  async function updateProfileHandler(req, res) {
    const payload = mobileProfilePayload(req);
    if (!Object.keys(payload).length) return sendEmptyPayloadError(res);

    if (hasDatabaseUrl()) {
      try {
        const profile = await updatePostgresProfile(requestId(req), payload);
        return res.json({ profile });
      } catch (err) {
        return sendDbError(res, err, "Mobil profil güncellenemedi.");
      }
    }

    const db = getAdminDb(req, res);
    if (!db) return;

    let updatePayload;
    try {
      updatePayload = await assertSupabaseProfileUpdate(db, requestId(req), payload);
    } catch (error) {
      return sendDbError(res, error, "Mobil profil yayına uygun değil.");
    }

    const { data, error } = await db
      .from("profiles")
      .update(updatePayload)
      .eq("id", requestId(req))
      .select("*")
      .single();

    if (sendDbError(res, error, "Mobil profil güncellenemedi.")) return;
    return res.json({ profile: data });
  }

  router.patch("/api/admin/mobile/profiles/:id", adminAuth, updateProfileHandler);
  router.post("/api/admin/mobile/profiles/:id/update", adminAuth, updateProfileHandler);

  router.post("/api/admin/mobile/profiles/:id/status", fullAdminAuth, async (req, res) => {
    if (typeof req.body?.is_active !== "boolean") {
      return res.status(400).json({ error: "is_active boolean olmalıdır." });
    }
    const payload = { is_active: req.body.is_active };

    if (hasDatabaseUrl()) {
      try {
        const profile = await updatePostgresProfile(requestId(req), payload);
        return res.json({ profile });
      } catch (err) {
        return sendDbError(res, err, "Mobil profil durumu güncellenemedi.");
      }
    }

    const db = getAdminDb(req, res);
    if (!db) return;

    let updatePayload;
    try {
      updatePayload = await assertSupabaseProfileUpdate(db, requestId(req), payload);
    } catch (error) {
      return sendDbError(res, error, "Mobil profil yayına uygun değil.");
    }

    const { data, error } = await db
      .from("profiles")
      .update(updatePayload)
      .eq("id", requestId(req))
      .select("*")
      .single();

    if (sendDbError(res, error, "Mobil profil durumu güncellenemedi.")) return;
    return res.json({ profile: data });
  });

  async function deleteProfileHandler(req, res) {
    if (hasDatabaseUrl()) {
      try {
        await deletePostgresProfile(requestId(req));
        return res.json({ ok: true });
      } catch (err) {
        return sendDbError(res, err, "Mobil profil silinemedi.");
      }
    }

    const db = getAdminDb(req, res);
    if (!db) return;

    const { error } = await db
      .from("profiles")
      .delete()
      .eq("id", requestId(req));

    if (sendDbError(res, error, "Mobil profil silinemedi.")) return;
    return res.json({ ok: true });
  }

  router.delete("/api/admin/mobile/profiles/:id", adminAuth, deleteProfileHandler);
  router.post("/api/admin/mobile/profiles/:id/delete", adminAuth, deleteProfileHandler);

  router.get("/api/admin/mobile/settings", fullAdminAuth, async (req, res) => {
    try {
      return res.json({ settings: await getSiteSettings() });
    } catch (error) {
      return res.status(503).json({ error: "Kalıcı site ayarları alınamadı." });
    }
  });

  async function updateSettingsHandler(req, res) {
    try {
      return res.json({ settings: await updateSiteSettings(req.body || {}) });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      return res.status(status).json({
        error: status >= 500 ? "Kalıcı site ayarları kaydedilemedi." : error.message
      });
    }
  }

  router.patch("/api/admin/mobile/settings", fullAdminAuth, updateSettingsHandler);
  router.post("/api/admin/mobile/settings/update", fullAdminAuth, updateSettingsHandler);


  router.get("/api/admin/mobile/ads", adminAuth, async (req, res) => {
    const db = hasDatabaseUrl() ? null : getAdminDb(req, res);
    if (!hasDatabaseUrl() && !db) return;

    try {
      const result = await listAds(db);
      if (sendDbError(res, result.error, "Reklamlar alınamadı.")) return;
      return res.json({ ok: true, ads: result.ads || [] });
    } catch (error) {
      return sendDbError(res, error, "Reklamlar alınamadı.");
    }
  });

  router.post("/api/admin/mobile/ads", adminAuth, async (req, res) => {
    const payload = sanitizeAdPayload(req.body);
    if (!payload.title) return res.status(400).json({ error: "Reklam başlığı gerekli." });

    if (hasDatabaseUrl()) {
      try {
        return res.status(201).json({ ok: true, ad: await createPostgresAd(payload) });
      } catch (error) {
        return sendDbError(res, error, "Reklam oluşturulamadı.");
      }
    }

    const db = getAdminDb(req, res);
    if (!db) return;
    const { data, error } = await db.from("ads").insert(payload).select("*").single();
    if (sendDbError(res, error, "Reklam oluşturulamadı.")) return;
    return res.status(201).json({ ok: true, ad: data });
  });

  async function updateAdHandler(req, res) {
    const payload = sanitizeAdPayload(req.body);
    if (!Object.keys(payload).length) return res.status(400).json({ error: "Güncellenecek reklam alanı yok." });

    if (hasDatabaseUrl()) {
      try {
        const ad = await updatePostgresAd(requestId(req), payload);
        if (!ad) return res.status(404).json({ error: "Reklam bulunamadı." });
        return res.json({ ok: true, ad });
      } catch (error) {
        return sendDbError(res, error, error.code === "INVALID_AD_ID" ? error.message : "Reklam güncellenemedi.");
      }
    }

    const db = getAdminDb(req, res);
    if (!db) return;
    const { data, error } = await db.from("ads").update(payload).eq("id", requestId(req)).select("*").single();
    if (sendDbError(res, error, "Reklam güncellenemedi.")) return;
    return res.json({ ok: true, ad: data });
  }

  router.patch("/api/admin/mobile/ads/:id", adminAuth, updateAdHandler);
  router.post("/api/admin/mobile/ads/:id/update", adminAuth, updateAdHandler);

  async function deleteAdHandler(req, res) {
    if (hasDatabaseUrl()) {
      try {
        const deleted = await deletePostgresAd(requestId(req));
        if (!deleted) return res.status(404).json({ error: "Reklam bulunamadı." });
        return res.json({ ok: true, deleted });
      } catch (error) {
        return sendDbError(res, error, error.code === "INVALID_AD_ID" ? error.message : "Reklam silinemedi.");
      }
    }

    const db = getAdminDb(req, res);
    if (!db) return;
    const { error, count } = await db.from("ads").delete({ count: "exact" }).eq("id", requestId(req));
    if (sendDbError(res, error, "Reklam silinemedi.")) return;
    return res.json({ ok: true, deleted: Number(count || 0) });
  }

  router.delete("/api/admin/mobile/ads/:id", adminAuth, deleteAdHandler);
  router.post("/api/admin/mobile/ads/:id/delete", adminAuth, deleteAdHandler);

  router.get("/api/admin/mobile/taxonomy", fullAdminAuth, (req, res) => {
    return res.json({ ok: true, taxonomy: taxonomyBody() });
  });

  router.get("/api/admin/mobile/google/status", fullAdminAuth, (req, res) => {
    return res.json(googleStatus());
  });

  router.get("/api/admin/mobile/audit", fullAdminAuth, (req, res) => {
    return res.json(auditBody(req));
  });

  return router;
}

module.exports = {
  createAdminMobileRouter
};
