"use strict";

const express = require("express");
const path = require("path");
const rateLimit = require("express-rate-limit");
const { ROOT_DIR } = require("../config/env");
const { resolveSupabaseUser, requireFullAdmin } = require("../middleware/auth");
const { sanitizeCustomerProfilePayload } = require("../utils/input");
const { setNoStore } = require("../utils/cacheHeaders");
const {
  authenticateCustomer,
  findCustomerAccessByToken,
  getCustomerAccessForProfile,
  getProfileById,
  requireCustomerSession,
  updateCustomerProfile,
  upsertCustomerAccess,
  visibleCustomerProfile
} = require("../services/customerAccessService");
const {
  getCustomerProfileAnalytics
} = require("../services/profileAnalyticsService");

function sendCustomerError(res, error, fallback = "İşlem tamamlanamadı.") {
  if (error?.cause) {
    console.error("Customer access database error:", error.cause);
  } else if (error && error.status >= 500) {
    console.error("Customer access error:", error);
  }

  const status = Number.isFinite(error?.status) ? error.status : 500;
  return res.status(status).json({
    ok: false,
    error: status >= 500 ? fallback : (error?.message || fallback)
  });
}

function createCustomerAccessRouter() {
  const router = express.Router();
  const adminAuth = [resolveSupabaseUser, requireFullAdmin];
  const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false
  });

  router.use((req, res, next) => {
    const requestPath = req.path;
    if (
      requestPath.startsWith("/m-panel/") ||
      requestPath.startsWith("/api/customer/access/") ||
      /^\/api\/v1\/admin\/profiles\/[^/]+\/customer-access(?:\/|$)/.test(requestPath)
    ) {
      setNoStore(res);
    }
    return next();
  });

  router.get("/m-panel/:token", async (req, res) => {
    try {
      const access = await findCustomerAccessByToken(req.params.token);
      if (!access) {
        return res.status(404).type("text/plain; charset=utf-8").send("Not found");
      }

      return res.sendFile(path.join(ROOT_DIR, "customer-panel.html"));
    } catch (error) {
      return sendCustomerError(res, error, "Müşteri paneli geçici olarak kullanılamıyor.");
    }
  });

  router.get("/api/v1/admin/profiles/:id/customer-access", adminAuth, async (req, res) => {
    const access = await getCustomerAccessForProfile(req.params.id, req);
    return res.json({ ok: true, access });
  });

  router.post("/api/v1/admin/profiles/:id/customer-access", adminAuth, async (req, res) => {
    try {
      const profile = await getProfileById(req.params.id);
      if (!profile) return res.status(404).json({ ok: false, error: "Profil bulunamadı." });

      const access = await upsertCustomerAccess(req.params.id, req.body || {}, req);
      return res.status(201).json({ ok: true, access });
    } catch (error) {
      return sendCustomerError(res, error, "Müşteri erişimi kaydedilemedi.");
    }
  });

  router.post("/api/customer/access/:token/login", loginLimiter, async (req, res) => {
    const session = await authenticateCustomer(req.params.token, req.body?.email, req.body?.password);
    if (!session) {
      return res.status(401).json({ ok: false, error: "Giriş bilgileri geçersiz." });
    }

    return res.json({ ok: true, session });
  });

  router.get("/api/customer/access/:token/profile", async (req, res) => {
    const session = await requireCustomerSession(req.params.token, req.get("authorization"));
    if (!session) return res.status(401).json({ ok: false, error: "Müşteri oturumu gerekli." });

    const profile = await getProfileById(session.profile_id);
    if (!profile) return res.status(404).json({ ok: false, error: "Profil bulunamadı." });

    return res.json({ ok: true, profile: visibleCustomerProfile(profile) });
  });

  router.get("/api/customer/access/:token/profile/analytics", async (req, res) => {
    try {
      const session = await requireCustomerSession(req.params.token, req.get("authorization"));
      if (!session) return res.status(401).json({ ok: false, error: "Müşteri oturumu gerekli." });

      const profile = await getProfileById(session.profile_id);
      if (!profile) return res.status(404).json({ ok: false, error: "Analiz profili bulunamadı." });

      const analytics = await getCustomerProfileAnalytics({
        days: req.query.days,
        ownerUserId: profile.owner_user_id,
        profileId: session.profile_id
      });
      return res.json(analytics);
    } catch (error) {
      return sendCustomerError(res, error, "Site etkileşimi alınamadı.");
    }
  });

  router.put("/api/customer/access/:token/profile", async (req, res) => {
    try {
      const session = await requireCustomerSession(req.params.token, req.get("authorization"));
      if (!session) return res.status(401).json({ ok: false, error: "Müşteri oturumu gerekli." });

      const payload = sanitizeCustomerProfilePayload(req.body || {});
      if (!Object.keys(payload).length) {
        return res.status(400).json({ ok: false, error: "Kaydedilecek müşteri alanı yok." });
      }

      const updated = await updateCustomerProfile(session.profile_id, payload);
      return res.json({ ok: true, profile: visibleCustomerProfile(updated) });
    } catch (error) {
      return sendCustomerError(res, error, "Profil güncellenemedi.");
    }
  });

  return router;
}

module.exports = {
  createCustomerAccessRouter
};
