"use strict";

const crypto = require("crypto");
const { setNoStore } = require("../utils/cacheHeaders");

const PRIVATE_PANEL_MODE_LOOPBACK_SECRET = "loopback-secret";
const PRIVATE_PANEL_SECRET_HEADER = "x-vip-gece-private-panel-secret";

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function requestHostname(req) {
  const hostname = String(req.hostname || req.get?.("host") || "")
    .trim()
    .toLowerCase();
  if (hostname.startsWith("[")) {
    return hostname.slice(1, hostname.indexOf("]"));
  }
  return hostname.replace(/:\d+$/, "");
}

function allowedAdminEmails(env = process.env) {
  return new Set(parseList(env.ADMIN_EMAILS));
}

function secretsMatch(left, right) {
  const provided = Buffer.from(String(left || ""));
  const expected = Buffer.from(String(right || ""));
  return provided.length === expected.length &&
    provided.length >= 32 &&
    crypto.timingSafeEqual(provided, expected);
}

function privatePanelRequestAllowed(req, env = process.env) {
  if (env.VIP_GECE_PRIVATE_PANELS_ENABLED !== "true") return false;

  const allowedHosts = new Set(parseList(env.VIP_GECE_PRIVATE_PANEL_HOSTS));
  if (!allowedHosts.size || !allowedHosts.has(requestHostname(req))) return false;

  const mode = String(env.VIP_GECE_PRIVATE_PANEL_MODE || "").trim().toLowerCase();
  if (env.NODE_ENV !== "production" && mode !== PRIVATE_PANEL_MODE_LOOPBACK_SECRET) {
    return true;
  }
  if (mode !== PRIVATE_PANEL_MODE_LOOPBACK_SECRET) return false;

  return secretsMatch(
    req.get?.(PRIVATE_PANEL_SECRET_HEADER),
    env.VIP_GECE_PRIVATE_PANEL_SECRET
  );
}

function privatePanelEdgeGateEnabled(env = process.env) {
  return env.NODE_ENV === "production" || env.VIP_GECE_PRIVATE_PANELS_ENABLED === "true";
}

function requirePrivatePanel(req, res, next) {
  if (privatePanelRequestAllowed(req)) return next();

  setNoStore(res);
  return res.status(404).type("text/plain; charset=utf-8").send("Not found");
}

function requirePrivatePanelApi(req, res, next) {
  if (!privatePanelEdgeGateEnabled()) return next();
  if (privatePanelRequestAllowed(req)) return next();

  setNoStore(res);
  return res.status(404).json({ error: "API endpoint bulunamadı." });
}

const PRIVATE_PANEL_ASSET_PATHS = new Set([
  "/admin.css",
  "/admin.js",
  "/config.js"
]);

function requirePrivatePanelAsset(req, res, next) {
  const pathname = String(req.path || "").toLowerCase();
  const isPrivateAsset =
    PRIVATE_PANEL_ASSET_PATHS.has(pathname) ||
    pathname.startsWith("/public/js/admin/");

  if (!isPrivateAsset || !privatePanelEdgeGateEnabled()) return next();
  return requirePrivatePanel(req, res, next);
}

module.exports = {
  PRIVATE_PANEL_MODE_LOOPBACK_SECRET,
  PRIVATE_PANEL_SECRET_HEADER,
  allowedAdminEmails,
  parseList,
  privatePanelEdgeGateEnabled,
  privatePanelRequestAllowed,
  requestHostname,
  secretsMatch,
  requirePrivatePanel,
  requirePrivatePanelApi,
  requirePrivatePanelAsset
};
