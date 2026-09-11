"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const { getSeoProfiles } = require("../data/profilesRepo");
const {
  recordProfileAnalyticsEvent
} = require("../services/profileAnalyticsService");
const {
  mintAnalyticsEventProof
} = require("../services/analyticsEventProofService");
const { setNoStore } = require("../utils/cacheHeaders");
const { findProfileBySlug } = require("../utils/profile");
const { safeSlug } = require("../utils/text");

const MINT_EVENT_TYPES = new Set(["profile_view", "contact_click"]);

function isBrowserEventRequest(req) {
  const userAgent = String(req.get("user-agent") || "");
  const origin = String(req.get("origin") || "");
  const host = String(req.get("host") || "");
  const fetchSite = String(req.get("sec-fetch-site") || "").toLowerCase();
  if (
    !userAgent ||
    /\b(?:bot|crawler|spider|slurp|headless|preview)\b/i.test(userAgent) ||
    fetchSite !== "same-origin"
  ) {
    return false;
  }
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function createAnalyticsRouter() {
  const router = express.Router();
  const eventLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false
  });
  const mintLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false
  });
  const noStore = (req, res, next) => {
    setNoStore(res);
    next();
  };

  router.post("/api/analytics/event-proof", noStore, mintLimiter, async (req, res) => {
    if (!isBrowserEventRequest(req)) {
      return res.status(403).json({
        ok: false,
        error: "Analiz kanıtı oluşturulamadı."
      });
    }

    const body = req.body || {};
    const keys = Object.keys(body);
    const profileSlug = safeSlug(body.profile_slug || "");
    const eventType = String(body.event_type || "").trim().toLowerCase();
    if (
      keys.some((key) => key !== "profile_slug" && key !== "event_type") ||
      !profileSlug ||
      !MINT_EVENT_TYPES.has(eventType)
    ) {
      return res.status(400).json({
        ok: false,
        error: "Analiz kanıtı isteği geçersiz."
      });
    }

    try {
      const profile = findProfileBySlug(await getSeoProfiles(), profileSlug);
      if (!profile) {
        return res.status(404).json({
          ok: false,
          error: "Profil bulunamadı."
        });
      }

      const minted = mintAnalyticsEventProof(profile.id, eventType);
      if (!minted) {
        return res.status(400).json({
          ok: false,
          error: "Analiz kanıtı isteği geçersiz."
        });
      }

      return res.status(201).json({
        ok: true,
        ...minted
      });
    } catch {
      return res.status(503).json({
        ok: false,
        error: "Analiz kanıtı geçici olarak kullanılamıyor."
      });
    }
  });

  router.post("/api/analytics/event", noStore, eventLimiter, async (req, res) => {
    if (!isBrowserEventRequest(req)) {
      return res.status(202).json({
        ok: true,
        accepted: false,
        tracked: false,
        reason: "untrusted_client_context"
      });
    }

    try {
      const result = await recordProfileAnalyticsEvent(req.body || {});
      return res.status(202).json({
        ok: true,
        accepted: result.tracked,
        tracked: result.tracked,
        event_type: result.event_type,
        received_at: new Date().toISOString()
      });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 503;
      return res.status(status).json({
        ok: false,
        accepted: false,
        tracked: false,
        error: status >= 500 ? "Analiz kaydı geçici olarak kullanılamıyor." : error.message,
        code: status < 500 ? error.code : undefined
      });
    }
  });

  return router;
}

module.exports = {
  createAnalyticsRouter,
  isBrowserEventRequest
};
