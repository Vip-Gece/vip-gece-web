"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { GOOGLE_SITE_VERIFICATION_CODE, ROOT_DIR } = require("../config/env");
const { districtRows } = require("../data/publicMetadata");
const { checkLeakedPassword } = require("../services/leakedPasswordService");
const { adminAndroidReleaseManifest } = require("../services/mobileReleaseService");
const { customerMobileConfig } = require("../services/customerMobileConfigService");
const { customerMobileUpdateManifest } = require("../services/customerMobileUpdateService");
const {
  readSiteSettingsSync,
  siteConfigOverlay
} = require("../services/siteSettingsService");
const { setNoStore } = require("../utils/cacheHeaders");
const { requirePrivatePanel } = require("../middleware/privatePanels");

const SUPPORTED_LANGUAGES = [
  { code: "tr", label: "Türkçe", default: true }
];

function jsString(value) {
  return JSON.stringify(String(value || ""));
}

function replaceConfigString(source, key, value) {
  const pattern = new RegExp(`(${key}\\s*:\\s*)(["'])(?:\\\\.|(?!\\2)[^\\\\])*\\2\\s*,`, "m");
  const replacement = `${key}: ${jsString(value)},`;

  if (pattern.test(source)) {
    return source.replace(pattern, replacement);
  }

  return source.replace(/(\n\s*};\s*)$/, `\n${replacement}$1`);
}

function buildRuntimeConfigSource(env = process.env) {
  const configPath = path.join(ROOT_DIR, "config.js");
  let source = fs.readFileSync(configPath, "utf8");

  source = replaceConfigString(source, "supabaseUrl", env.SUPABASE_URL);
  source = replaceConfigString(source, "supabaseAnonKey", env.SUPABASE_ANON_KEY);

  try {
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: "config.js" });
    const config = sandbox.window.SITE_CONFIG && typeof sandbox.window.SITE_CONFIG === "object"
      ? sandbox.window.SITE_CONFIG
      : {};
    return `window.SITE_CONFIG=${JSON.stringify({
      ...config,
      ...siteConfigOverlay(readSiteSettingsSync(config)),
      googleVerificationCode: String(config.googleVerificationCode || "").trim() || GOOGLE_SITE_VERIFICATION_CODE
    })};\n`;
  } catch {
    return source;
  }
}

function createSystemRouter() {
  const router = express.Router();
  const passwordLeakLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false
  });

  router.get("/config.js", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.type("application/javascript; charset=utf-8");
    return res.send(buildRuntimeConfigSource());
  });

  router.get("/admin.webmanifest", requirePrivatePanel, (req, res) => {
    setNoStore(res);
    res.type("application/manifest+json; charset=utf-8");
    return res.sendFile(path.join(ROOT_DIR, "admin.webmanifest"));
  });

  router.get("/admin-sw.js", requirePrivatePanel, (req, res) => {
    setNoStore(res);
    res.type("application/javascript; charset=utf-8");
    return res.sendFile(path.join(ROOT_DIR, "admin-sw.js"));
  });

  router.get("/vip-gece-yonetim.mobileconfig", requirePrivatePanel, (req, res) => {
    setNoStore(res);
    res.type("application/x-apple-aspen-config; charset=utf-8");
    return res.sendFile(path.join(ROOT_DIR, "vip-gece-yonetim.mobileconfig"));
  });

  router.get("/api/system/districts", (req, res) => {
    return res.json({ districts: districtRows() });
  });

  router.get("/api/system/languages", (req, res) => {
    return res.json({ languages: SUPPORTED_LANGUAGES });
  });

  router.get("/api/mobile/admin/update", (req, res) => {
    setNoStore(res);
    try {
      return res.json(adminAndroidReleaseManifest());
    } catch (error) {
      console.error("Mobile release manifest error:", error.message);
      return res.status(503).json({ ok: false, error: "Mobil guncelleme manifesti gecici olarak kullanilamiyor." });
    }
  });

  router.get("/api/mobile/customer/config", (req, res) => {
    setNoStore(res);
    try {
      return res.json(customerMobileConfig());
    } catch (error) {
      console.error("Customer mobile config error:", error.message);
      return res.status(503).json({
        ok: false,
        error: "Müşteri uygulaması yapılandırması geçici olarak kullanılamıyor."
      });
    }
  });

  router.get("/api/mobile/customer/update", (req, res) => {
    setNoStore(res);
    try {
      const manifest = customerMobileUpdateManifest();
      if (!manifest) {
        return res.status(404).json({
          ok: false,
          error: "Yayınlanmış native müşteri APK sürümü henüz yok."
        });
      }
      return res.json(manifest);
    } catch (error) {
      console.error("Customer mobile update error:", error.message);
      return res.status(503).json({
        ok: false,
        error: "Müşteri uygulaması güncellemesi geçici olarak kullanılamıyor."
      });
    }
  });

  router.post("/api/system/password-leak-check", passwordLeakLimiter, async (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    res.setHeader("Cache-Control", "no-store");

    if (!password) {
      return res.status(400).json({ error: "Şifre gerekli." });
    }

    if (password.length > 1024) {
      return res.status(400).json({ error: "Şifre çok uzun." });
    }

    try {
      const result = await checkLeakedPassword(password);

      if (result.leaked) {
        return res.status(422).json({
          error: "Bu şifre sızıntı listelerinde görünüyor. Lütfen farklı bir şifre kullan.",
          leaked: true
        });
      }

      return res.json({ leaked: false });
    } catch {
      return res.status(503).json({
        error: "Şifre güvenlik kontrolü geçici olarak yapılamadı.",
        leaked: null
      });
    }
  });

  return router;
}

module.exports = {
  buildRuntimeConfigSource,
  createSystemRouter
};
