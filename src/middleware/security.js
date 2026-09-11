"use strict";

const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const express = require("express");
const path = require("path");
const { SITE_URL } = require("../config/env");
const DEFAULT_RATE_LIMIT = process.env.NODE_ENV === "production" ? 150 : 2000;
const REQUEST_BODY_LIMIT = process.env.REQUEST_BODY_LIMIT || "256kb";
const CSP_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' https://cdn.jsdelivr.net https://static.cloudflareinsights.com https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https:"
].join("; ");

const ALLOWED_ROOT_FILES = new Set([
  "/.well-known/security.txt",
  "/admin.css",
  "/admin.js",
  "/admin-sw.js",
  "/admin.webmanifest",
  "/ads.txt",
  "/app-ads.txt",
  "/apple-touch-icon.png",
  "/config.js",
  "/customer-panel.css",
  "/detay.html",
  "/favicon.ico",
  "/favicon.png",
  "/favicon.png.webp",
  "/guven-ve-politikalar.html",
  "/bolge.html",
  "/ilanlar.html",
  "/iletisim.html",
  "/index.html",
  "/istanbul.html",
  "/kategori.html",
  "/kategori-landing.html",
  "/llms.txt",
  "/logo.png",
  "/logo.png.webp",
  "/robots.txt",
  "/security.txt",
  "/sitemap.txt",
  "/style.css",
  "/vip-gece-yonetim.mobileconfig",
  "/vg-panel-91x",
  "/whatsapp-logo.png"
]);

const ALLOWED_PREFIXES = [
  "/public/",
  "/media/",
  "/m-panel/",
  "/profil/",
  "/api/",
  "/sitemap",
  "/image-sitemap"
];
const BLOCKED_PUBLIC_PATHS = new Set([
  "/cname"
]);
const BLOCKED_PUBLIC_PREFIXES = [
  "/.git/",
  "/docs/",
  "/mobile-admin/",
  "/node_modules/",
  "/ops/",
  "/scripts/",
  "/server/",
  "/src/",
  "/views/"
];

function getRequestPath(req) {
  try {
    return decodeURIComponent(new URL(req.originalUrl || req.url, "http://local").pathname);
  } catch {
    return String(req.path || req.url || "/").split("?")[0];
  }
}

function isAllowedStaticPath(pathname) {
  if (pathname === "/") return true;
  if (ALLOWED_ROOT_FILES.has(pathname)) return true;
  return ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function blockPrivateArtifacts(req, res, next) {
  const url = String(req.url || "").toLowerCase();
  const blocked = [
    ".bak",
    "backup",
    "final-master-plan",
    "final-rebuild-roadmap",
    "sql-final-upgrade",
    ".tar.gz",
    ".env"
  ];

  if (blocked.some((item) => url.includes(item))) {
    return res.status(404).send("Not found");
  }

  return next();
}

function allowOnlyRuntimeStatic(req, res, next) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return next();
  }

  const pathname = getRequestPath(req);

  if (BLOCKED_PUBLIC_PATHS.has(pathname.toLowerCase())) {
    return res.status(404).send("Not found");
  }

  const normalizedPathname = pathname.toLowerCase();
  if (BLOCKED_PUBLIC_PREFIXES.some((prefix) => normalizedPathname.startsWith(prefix))) {
    return res.status(404).send("Not found");
  }

  if (isAllowedStaticPath(pathname)) {
    return next();
  }

  if (/^\/([A-Za-z0-9-]{8,128})\.txt$/.test(pathname)) {
    return next();
  }

  if (
    /^\/google[A-Za-z0-9_-]{8,128}\.html$/.test(pathname) ||
    /^\/BingSiteAuth\.xml$/.test(pathname) ||
    /^\/yandex[_-]?[A-Za-z0-9_-]{8,128}\.html$/i.test(pathname)
  ) {
    return next();
  }

  if (path.extname(pathname)) {
    return res.status(404).send("Not found");
  }

  return next();
}

function contentSecurityPolicy(req, res, next) {
  res.setHeader("Content-Security-Policy", CSP_POLICY);
  return next();
}

function markNonIndexableSurfaces(req, res, next) {
  const pathname = getRequestPath(req).toLowerCase();
  const noindexPrefixes = [
    "/api/",
    "/public/downloads/",
    "/vg-panel-91x",
    "/m-panel/",
    "/customer-panel.html"
  ];

  if (
    pathname === "/health" ||
    noindexPrefixes.some((prefix) => pathname.startsWith(prefix))
  ) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  }

  return next();
}

function handleBodyParserError(err, req, res, next) {
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "İstek gövdesi çok büyük." });
  }

  if (err && (err.type === "entity.parse.failed" || err.status === 400)) {
    return res.status(400).json({ error: "Geçersiz JSON gövdesi." });
  }

  return next(err);
}

function handleUnhandledError(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600
    ? err.status
    : 500;
  const requestPath = getRequestPath(req);

  console.error("Unhandled request error", {
    name: String(err?.name || "Error").slice(0, 80),
    method: String(req.method || "").slice(0, 16),
    path: requestPath.slice(0, 300),
    status
  });

  res.setHeader("Cache-Control", "no-store");
  if (requestPath.startsWith("/api/")) {
    return res.status(status).json({ error: "İstek tamamlanamadı." });
  }

  return res.status(status).type("text/plain").send("İstek tamamlanamadı.");
}

function installBaseMiddleware(app) {
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(compression());
  app.use(contentSecurityPolicy);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })
  );
  app.use(
    cors({
      origin: SITE_URL,
      credentials: true
    })
  );
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: Number(process.env.RATE_LIMIT_MAX || DEFAULT_RATE_LIMIT),
      skip(req) {
        if (req.method !== "GET" && req.method !== "HEAD") {
          return false;
        }

        const pathname = getRequestPath(req);
        return !pathname.startsWith("/api/") && !pathname.startsWith("/vg-panel-91x");
      },
      standardHeaders: true,
      legacyHeaders: false
    })
  );
  app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
  app.use(
    express.urlencoded({
      extended: true,
      limit: REQUEST_BODY_LIMIT,
      parameterLimit: 200,
      depth: 8
    })
  );
  app.use(handleBodyParserError);
  app.use(markNonIndexableSurfaces);
  app.use(blockPrivateArtifacts);
  app.use(allowOnlyRuntimeStatic);
}

module.exports = {
  installBaseMiddleware,
  blockPrivateArtifacts,
  contentSecurityPolicy,
  handleBodyParserError,
  handleUnhandledError,
  allowOnlyRuntimeStatic,
  isAllowedStaticPath,
  markNonIndexableSurfaces
};
