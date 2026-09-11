"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  resolveSupabaseUser,
  requireAdmin,
  requireFullAdmin,
  resolveAdminRole
} = require("../middleware/auth");
const { getSupabaseAuthClient, getSupabaseClientForToken } = require("../data/supabaseClient");
const { hasDatabaseUrl } = require("../data/postgresClient");
const {
  createPostgresProfile,
  deletePostgresProfile,
  listAdminPostgresProfiles,
  updatePostgresProfile
} = require("../data/postgresProfilesRepo");
const { cleanText, sanitizeProfilePayload } = require("../utils/input");
const { applyProfileSeoDefaults } = require("../utils/profileSeo");
const { adminPermissions } = require("../services/adminPermissions");
const {
  buildCustomerProfilePreviewImageUrl,
  storeCustomerProfileImage
} = require("../services/customerProfileImageService");
const {
  getSiteSettings,
  updateSiteSettings
} = require("../services/siteSettingsService");
const {
  getCustomerMobileAccount
} = require("../services/customerMobileAccountService");
const {
  applyProfileCreateDefaults,
  applyProfileUpdateDefaults,
  assertProfileUpdatePublishable
} = require("../services/profileDefaults");

function allowSupabaseProfileData() {
  return process.env.VIP_GECE_ALLOW_SUPABASE_PROFILE_DATA === "true";
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
  const status = Number.isInteger(error.status) ? error.status : 400;
  if (status >= 500) console.error("Admin database error:", error);
  const safeMessages = {
    PROFILE_IMAGE_LIMIT_REACHED: "Profil görsel sınırı dolu.",
    PROFILE_IMAGE_NOT_FOUND: "Profil görseli bulunamadı.",
    PROFILE_LIMIT_REACHED: "Müşteri profil kotası dolu.",
    PROFILE_NOT_PUBLISHABLE: "Profil yayın için gerekli alanları tamamlamalı.",
    HOMEPAGE_SLOT_OCCUPIED: "Seçilen ana sayfa sırası başka bir yayındaki profile ait. Önce o profili farklı sıraya taşı."
  };
  return res.status(status).json({
    error: safeMessages[error.code] || fallback,
    ...(error.code ? { code: error.code } : {})
  });
}

function sendEmptyPayloadError(res) {
  return res.status(400).json({ error: "Geçerli profil alanı gönderilmedi." });
}

function requestId(req) {
  return cleanText(req.params.id, 140);
}

function adminProfileView(profile) {
  const images = Array.isArray(profile?.images) ? profile.images : [];
  return {
    ...profile,
    cover_preview_url: images[0]
      ? buildCustomerProfilePreviewImageUrl(images[0], 320)
      : "",
    image_preview_urls: images.map((image) =>
      buildCustomerProfilePreviewImageUrl(image, 960)
    )
  };
}

function adminProfilesView(profiles) {
  return (Array.isArray(profiles) ? profiles : []).map(adminProfileView);
}

function profilePayload(req, { creating = false } = {}) {
  const payload = applyProfileUpdateDefaults(sanitizeProfilePayload(req.body));

  if (req.adminRole === "profile_admin") {
    delete payload.slug;
    delete payload.seo_title;
    delete payload.seo_description;
    delete payload.seo_keywords;
    delete payload.owner_user_id;
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

async function validateProfileOwner(payload, profileId = "") {
  if (!Object.prototype.hasOwnProperty.call(payload, "owner_user_id")) return null;
  if (payload.owner_user_id === null || payload.owner_user_id === "") {
    payload.owner_user_id = null;
    return null;
  }

  const match = String(payload.owner_user_id).match(/^customer:([a-zA-Z0-9-]{1,80})$/);
  const account = match ? await getCustomerMobileAccount(match[1]) : null;
  if (!account) {
    const error = new Error("Seçilen müşteri hesabı bulunamadı.");
    error.status = 400;
    throw error;
  }

  if (!hasDatabaseUrl()) {
    const error = new Error("Müşteri profil sahipliği için PostgreSQL gerekli.");
    error.status = 503;
    throw error;
  }

  payload.owner_user_id = account.owner_user_id;
  return account;
}

function createAdminRouter() {
  const router = express.Router();
  const adminAuth = [resolveSupabaseUser, requireAdmin];
  const fullAdminAuth = [resolveSupabaseUser, requireFullAdmin];
  const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false
  });
  const imageLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false
  });

  router.use("/api/v1/admin", (req, res, next) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.set("Pragma", "no-cache");
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    return next();
  });

  router.post("/api/v1/admin/login", loginLimiter, async (req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    const email = cleanText(req.body?.email, 320).toLowerCase();
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!email || !password || password.length > 1024) {
      return res.status(400).json({ error: "Email ve şifre gerekli." });
    }

    const supabase = getSupabaseAuthClient();
    if (!supabase) {
      return res.status(503).json({ error: "Giriş servisi hazır değil." });
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      const role = resolveAdminRole(data?.user?.email);

      if (error || !data?.session?.access_token || !role) {
        return res.status(401).json({ error: "Giriş bilgileri geçersiz." });
      }

      return res.json({
        ok: true,
        access_token: data.session.access_token,
        expires_at: data.session.expires_at || null,
        role
      });
    } catch (error) {
      console.error("Admin login proxy error:", error?.message || error);
      return res.status(502).json({ error: "Giriş servisine ulaşılamadı." });
    }
  });

  router.get("/api/v1/admin/status", adminAuth, (req, res) => {
    const permissions = adminPermissions(req.adminRole);
    return res.json({
      ok: true,
      user: {
        id: req.authUser.id,
        email: req.authUser.email,
        role: req.adminRole
      },
      permissions
    });
  });

  router.get("/api/v1/admin/site-settings", fullAdminAuth, async (req, res) => {
    try {
      return res.json({ ok: true, settings: await getSiteSettings() });
    } catch (error) {
      console.error("Admin site settings read error:", error.message);
      return res.status(error.status || 503).json({ error: "Canlı site ayarları alınamadı." });
    }
  });

  router.put("/api/v1/admin/site-settings", fullAdminAuth, async (req, res) => {
    try {
      const settings = await updateSiteSettings(req.body || {});
      return res.json({ ok: true, settings });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      if (status >= 500) {
        console.error("Admin site settings update error:", error.message);
      }
      return res.status(status).json({
        error: status >= 500 ? "Canlı site ayarları kaydedilemedi." : error.message
      });
    }
  });

  router.post(
    "/api/v1/admin/profile-images",
    adminAuth,
    imageLimiter,
    express.raw({
      type: ["image/jpeg", "image/png", "image/webp"],
      limit: 8 * 1024 * 1024
    }),
    async (req, res) => {
      try {
        const contentType = String(req.get("content-type") || "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
          return res.status(415).json({ error: "Yalnız JPEG, PNG veya WebP görsel yüklenebilir." });
        }
        const requestedProfileId = cleanText(req.query.profile_id, 80)
          .replace(/[^a-zA-Z0-9_-]/g, "");
        const stored = await storeCustomerProfileImage({
          accountScope: "admin",
          profileId: requestedProfileId || `draft-${Date.now()}`,
          body: req.body
        });
        return res.status(201).json({
          ok: true,
          image_url: stored.publicPath,
          width: stored.width,
          height: stored.height,
          size: stored.size
        });
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 500;
        if (status >= 500) {
          console.error("Admin profile image upload error:", error.message);
        }
        return res.status(status).json({
          error: status >= 500 ? "Profil görseli yüklenemedi." : error.message
        });
      }
    }
  );

  router.get("/api/v1/admin/profiles", adminAuth, async (req, res) => {
    if (hasDatabaseUrl()) {
      try {
        return res.json({ profiles: adminProfilesView(await listAdminPostgresProfiles()) });
      } catch (err) {
        return sendDbError(res, err, "Profiller alınamadı.");
      }
    }

    const db = getAdminDb(req, res);
    if (!db) return;

    const { data, error } = await db
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (sendDbError(res, error, "Profiller alınamadı.")) return;
    return res.json({ profiles: adminProfilesView(data) });
  });

  router.post("/api/v1/admin/profiles", adminAuth, async (req, res) => {
    const payload = profilePayload(req, { creating: true });
    if (!Object.keys(payload).length) return sendEmptyPayloadError(res);
    let ownerAccount = null;
    try {
      ownerAccount = await validateProfileOwner(payload);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message });
    }

    if (hasDatabaseUrl()) {
      try {
        const profile = await createPostgresProfile(payload, {
          ownerProfileLimit: ownerAccount?.max_profiles
        });
        return res.status(201).json({ profile: adminProfileView(profile) });
      } catch (err) {
        return sendDbError(res, err, "Profil oluşturulamadı.");
      }
    }

    const db = getAdminDb(req, res);
    if (!db) return;

    let createPayload;
    try {
      createPayload = await supabaseCreatePayload(db, payload);
    } catch (error) {
      return sendDbError(res, error, "Profil sırası hazırlanamadı.");
    }

    const { data, error } = await db
      .from("profiles")
      .insert(createPayload)
      .select("*")
      .single();

    if (sendDbError(res, error, "Profil oluşturulamadı.")) return;
    return res.status(201).json({ profile: adminProfileView(data) });
  });

  router.put("/api/v1/admin/profiles/:id", adminAuth, async (req, res) => {
    const payload = profilePayload(req);
    if (!Object.keys(payload).length) return sendEmptyPayloadError(res);
    let ownerAccount = null;
    try {
      ownerAccount = await validateProfileOwner(payload, requestId(req));
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message });
    }

    if (hasDatabaseUrl()) {
      try {
        const profile = await updatePostgresProfile(requestId(req), payload, {
          ownerProfileLimit: ownerAccount?.max_profiles
        });
        return res.json({ profile: adminProfileView(profile) });
      } catch (err) {
        return sendDbError(res, err, "Profil güncellenemedi.");
      }
    }

    const db = getAdminDb(req, res);
    if (!db) return;

    let updatePayload;
    try {
      updatePayload = await assertSupabaseProfileUpdate(db, requestId(req), payload);
    } catch (error) {
      return sendDbError(res, error, "Profil yayına uygun değil.");
    }

    const query = db.from("profiles");
    const { data, error } = await query
      .update(updatePayload)
      .eq("id", requestId(req))
      .select("*")
      .single();

    if (sendDbError(res, error, "Profil güncellenemedi.")) return;
    return res.json({ profile: adminProfileView(data) });
  });

  router.delete("/api/v1/admin/profiles/:id", adminAuth, async (req, res) => {
    if (hasDatabaseUrl()) {
      try {
        await deletePostgresProfile(requestId(req));
        return res.status(204).end();
      } catch (err) {
        return sendDbError(res, err, "Profil silinemedi.");
      }
    }

    const db = getAdminDb(req, res);
    if (!db) return;

    const { error } = await db
      .from("profiles")
      .delete()
      .eq("id", requestId(req));

    if (sendDbError(res, error, "Profil silinemedi.")) return;
    return res.status(204).end();
  });

  return router;
}

module.exports = {
  adminProfileView,
  adminProfilesView,
  createAdminRouter
};
