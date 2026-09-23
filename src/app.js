"use strict";

const path = require("path");
const express = require("express");
const { ROOT_DIR } = require("./config/env");
const { handleUnhandledError, installBaseMiddleware } = require("./middleware/security");
const {
  requirePrivatePanelApi,
  requirePrivatePanelAsset
} = require("./middleware/privatePanels");
const { createAdminRouter } = require("./routes/adminRoutes");
const { createAdminOpsRouter } = require("./routes/adminOpsRoutes");
const { createAnalyticsRouter } = require("./routes/analyticsRoutes");
const { createAdminMobileRouter } = require("./routes/adminMobileRoutes");
const { createCustomerAccessRouter } = require("./routes/customerAccessRoutes");
const { createCustomerMobileRouter } = require("./routes/customerMobileRoutes");
const { requireCustomerGateway } = require("./middleware/customerGateway");
const { createHealthRouter } = require("./routes/healthRoutes");
const { createPublicApiRouter } = require("./routes/publicApiRoutes");
const { createProfileMediaRouter } = require("./routes/profileMediaRoutes");
const { createPublicRouter } = require("./routes/publicRoutes");
const { createSitemapRouter } = require("./routes/sitemapRoutes");
const { createSystemRouter } = require("./routes/systemRoutes");
const { renderStaticPublicHtml } = require("./services/renderService");
const { setNoStore, setStaticAssetCache } = require("./utils/cacheHeaders");

const NO_STORE_STATIC_FILES = new Set([
  "admin.css",
  "admin.js",
  "admin-sw.js",
  "admin.webmanifest",
  "config.js",
  "customer-panel.css",
  "customer-panel.html",
  "vip-gece-customer-clean-latest.json",
  "vip-gece-customer-latest.apk"
]);
const NO_STORE_STATIC_PREFIXES = [
  "public/js/admin/",
  "public/js/customer-panel.js"
];
const CACHEABLE_STATIC_EXTENSIONS = new Set([
  ".avif",
  ".css",
  ".gif",
  ".ico",
  ".jpg",
  ".jpeg",
  ".js",
  ".png",
  ".svg",
  ".webp",
  ".woff",
  ".woff2"
]);

function createApp() {
  const app = express();

  installBaseMiddleware(app);
  app.use("/api/customer/mobile", requireCustomerGateway);

  app.use(createHealthRouter());
  app.use(createPublicApiRouter());
  app.use(createProfileMediaRouter());
  app.use([
    "/api/admin",
    "/api/mobile/admin",
    "/api/v1/admin"
  ], requirePrivatePanelApi);
  app.use(createSystemRouter());
  app.use(createAnalyticsRouter());
  app.use(createAdminRouter());
  app.use(createAdminOpsRouter());
  app.use(createAdminMobileRouter());
  app.use(createCustomerAccessRouter());
  app.use(createCustomerMobileRouter());
  app.use(createSitemapRouter());
  app.use("/api", (req, res) => {
    return res.status(404).json({ error: "API endpoint bulunamadı." });
  });
  app.use(createPublicRouter());
  app.use(requirePrivatePanelAsset);
  app.use(
    express.static(ROOT_DIR, {
      maxAge: "30d",
      etag: true,
      dotfiles: "deny",
      index: "index.html",
      setHeaders(res, filePath) {
        const extension = path.extname(filePath);
        const filename = path.basename(filePath);
        const normalizedStaticPath = filePath.split(path.sep).join("/");
        const relativeStaticPath = path.relative(ROOT_DIR, filePath).split(path.sep).join("/");

        if (
          extension === ".html" ||
          NO_STORE_STATIC_FILES.has(filename) ||
          NO_STORE_STATIC_PREFIXES.some((prefix) => normalizedStaticPath.includes(prefix) || relativeStaticPath.startsWith(prefix))
        ) {
          setNoStore(res);
          return;
        }

        if (CACHEABLE_STATIC_EXTENSIONS.has(extension)) {
          setStaticAssetCache(res);
        }
      }
    })
  );
  app.use((req, res) => {
    setNoStore(res);
    res.status(404).send(renderStaticPublicHtml("404.html"));
  });
  app.use(handleUnhandledError);

  return app;
}

module.exports = {
  createApp
};
