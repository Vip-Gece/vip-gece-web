"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const { ROOT_DIR, SITE_URL } = require("../config/env");
const { buildImageSitemapXml, buildSitemapXml } = require("../services/sitemapService");
const { indexNowRuntimeConfig } = require("../services/indexNowService");
const { setNoStore } = require("../utils/cacheHeaders");

const ROBOTS_TEMPLATE = fs.readFileSync(path.join(ROOT_DIR, "robots.txt"), "utf8");
const TEXT_FILE_ROUTES = Object.freeze({
  "/ads.txt": "ads.txt",
  "/app-ads.txt": "app-ads.txt",
  "/security.txt": ".well-known/security.txt",
  "/.well-known/security.txt": ".well-known/security.txt",
  "/sitemap.txt": "sitemap.txt"
});

function getProfilesRepo() {
  const { getSeoProfiles } = require("../data/profilesRepo");
  return { getSeoProfiles };
}

function buildRobotsTxt() {
  const origin = SITE_URL.replace(/\/+$/, "");
  return ROBOTS_TEMPLATE.replace(
    /^Sitemap:\s+\S+\/(sitemap\.xml|image-sitemap\.xml)\s*$/gm,
    (_, filename) => `Sitemap: ${origin}/${filename}`
  );
}

function sendSitemapUnavailable(res, message) {
  setNoStore(res);
  res.setHeader("Retry-After", "60");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  return res.status(503).type("text/plain; charset=utf-8").send(message);
}

function setPublicCrawlerCache(res, maxAge) {
  res.setHeader("Cache-Control", `public, max-age=${maxAge}, must-revalidate`);
  res.removeHeader("Pragma");
}

function sendRootTextFile(res, fileName) {
  res.type("text/plain; charset=utf-8");
  setPublicCrawlerCache(res, 3600);
  res.sendFile(path.join(ROOT_DIR, fileName), { dotfiles: "allow" });
}

function createSitemapRouter() {
  const router = express.Router();
  const indexNow = indexNowRuntimeConfig();

  Object.entries(TEXT_FILE_ROUTES).forEach(([route, fileName]) => {
    router.get(route, (req, res) => sendRootTextFile(res, fileName));
  });

  router.get("/robots.txt", (req, res) => {
    res.type("text/plain; charset=utf-8");
    setPublicCrawlerCache(res, 3600);
    res.send(buildRobotsTxt());
  });

  router.get("/sitemap.xml", async (req, res) => {
    try {
      const { getSeoProfiles } = getProfilesRepo();
      const profiles = await getSeoProfiles();
      if (!profiles.length) {
        return sendSitemapUnavailable(res, "Sitemap geçici olarak kullanılamıyor.");
      }
      setPublicCrawlerCache(res, 300);
      res.type("application/xml").send(buildSitemapXml(profiles));
    } catch (err) {
      console.error("Sitemap error:", err);
      return sendSitemapUnavailable(res, "Sitemap geçici olarak kullanılamıyor.");
    }
  });

  router.get("/image-sitemap.xml", async (req, res) => {
    try {
      const { getSeoProfiles } = getProfilesRepo();
      const profiles = await getSeoProfiles();
      if (!profiles.length) {
        return sendSitemapUnavailable(res, "Image sitemap geçici olarak kullanılamıyor.");
      }
      setPublicCrawlerCache(res, 300);
      res.type("application/xml").send(buildImageSitemapXml(profiles));
    } catch (err) {
      console.error("Image sitemap error:", err);
      return sendSitemapUnavailable(res, "Image sitemap geçici olarak kullanılamıyor.");
    }
  });

  router.get("/llms.txt", (req, res) => {
    res.type("text/plain; charset=utf-8");
    setPublicCrawlerCache(res, 3600);
    res.sendFile(path.join(ROOT_DIR, "llms.txt"));
  });

  if (indexNow.enabled) {
    router.get(indexNow.keyPath, (req, res) => {
      res.type("text/plain; charset=utf-8");
      setPublicCrawlerCache(res, 3600);
      res.send(`${indexNow.key}\n`);
    });
  }

  return router;
}

module.exports = {
  createSitemapRouter
};
