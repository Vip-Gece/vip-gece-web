"use strict";

const path = require("path");
const express = require("express");
const { ROOT_DIR } = require("../config/env");
const { safeSlug } = require("../utils/text");
const { getProfileSlug } = require("../utils/profile");
const { resolveLandingTarget } = require("../services/landingContextService");
const {
  renderCategoriesHubHtml,
  renderCategoryHtml,
  renderContactHtml,
  renderHomeHtml,
  renderListingsHubHtml,
  renderProfileDetailHtml,
  renderStaticPublicHtml
} = require("../services/renderService");
const { setNoStore, setPublicHtmlCache } = require("../utils/cacheHeaders");
const { requirePrivatePanel } = require("../middleware/privatePanels");

const RECOVERABLE_PROFILE_SLUGS = new Set([
  "istanbul-irem-2",
  "istanbul-kardelen",
  "istanbul-lara",
  "istanbul-sofia",
  "istanbul-umay"
]);

function getProfilesRepo() {
  const { getProfiles, getSeoProfiles, findPublicProfileBySlug } = require("../data/profilesRepo");
  return { getProfiles, getSeoProfiles, findPublicProfileBySlug };
}

async function findProfileBySlug(profiles, slug) {
  return getProfilesRepo().findPublicProfileBySlug(profiles, slug);
}

async function getRequiredProfiles() {
  const { getProfiles } = getProfilesRepo();
  const profiles = await getProfiles();
  if (profiles.length) return profiles;

  const error = new Error("Public profile inventory is unavailable.");
  error.status = 503;
  throw error;
}

async function getRequiredSeoProfiles() {
  const { getSeoProfiles } = getProfilesRepo();
  const profiles = await getSeoProfiles();
  if (profiles.length) return profiles;

  const error = new Error("Indexable profile inventory is unavailable.");
  error.status = 503;
  throw error;
}

function sendPublicUnavailable(res) {
  setNoStore(res);
  res.setHeader("Retry-After", "60");
  return res.status(503).type("text/plain; charset=utf-8").send("VIP Gece geçici olarak hazırlanıyor. Lütfen kısa süre sonra tekrar deneyin.");
}

function file(name) {
  return path.join(ROOT_DIR, name);
}

function recoverableProfileTarget(value) {
  const slug = safeSlug(value);
  if (!slug) return "";
  if (RECOVERABLE_PROFILE_SLUGS.has(slug)) return "/istanbul-escort";
  if (RECOVERABLE_PROFILE_SLUGS.has(`istanbul-${slug}`)) return "/istanbul-escort";
  return "";
}

function redirectWithQuery(req, res, target, omittedQueryKeys = []) {
  const originalUrl = String(req.originalUrl || "");
  const queryIndex = originalUrl.indexOf("?");
  let query = queryIndex >= 0 ? originalUrl.slice(queryIndex) : "";

  if (query && omittedQueryKeys.length) {
    const params = new URLSearchParams(query.slice(1));
    omittedQueryKeys.forEach((key) => params.delete(key));
    query = params.size ? `?${params}` : "";
  }

  return res.redirect(301, `${target}${query}`);
}

function createPublicRouter() {
  const router = express.Router();
  const htmlAliasRedirects = new Map([
    ["/index.html", "/"],
    ["/iletisim.html", "/iletisim"],
    ["/guven-ve-politikalar.html", "/guven-ve-politikalar"],
    ["/ilanlar.html", "/ilanlar"],
    ["/kategori.html", "/kategoriler"],
    ["/istanbul.html", "/istanbul-escort"],
    ["/bolge.html", "/istanbul-escort"],
    ["/kategori-landing.html", "/kategoriler"]
  ]);

  // Soft SEO redirects: common legacy/short paths that previously 404'd and wasted crawl budget.
  const softSeoRedirects = new Map([
    ["/istanbul", "/istanbul-escort"],
    ["/bolge", "/istanbul-escort"],
    ["/bolgeler", "/istanbul-escort"],
    ["/escort", "/istanbul-escort"],
    ["/escortlar", "/ilanlar"],
    ["/profiller", "/ilanlar"],
    ["/profil", "/ilanlar"],
    ["/contact", "/iletisim"],
    ["/iletisim-bilgileri", "/iletisim"],
    ["/kategori", "/kategoriler"]
  ]);

  const canonicalPages = new Set(["/", "/ilanlar", "/iletisim", "/guven-ve-politikalar", "/kategoriler"]);
  router.use((req, res, next) => {
    if (!["GET", "HEAD"].includes(req.method)) return next();
    let pathname;
    try {
      pathname = decodeURIComponent(req.path).toLowerCase().replace(/\/+$/, "") || "/";
    } catch {
      return next();
    }
    const target = htmlAliasRedirects.get(pathname) || softSeoRedirects.get(pathname) ||
      (["/anasayfa", "/home"].includes(pathname) ? "/" : null) ||
      (canonicalPages.has(pathname) ? pathname : null);
    if (target && req.path !== pathname) return redirectWithQuery(req, res, target);
    return next();
  });

  htmlAliasRedirects.forEach((target, source) => {
    router.get(source, (req, res) => redirectWithQuery(req, res, target));
  });

  softSeoRedirects.forEach((target, source) => {
    router.get(source, (req, res) => redirectWithQuery(req, res, target));
  });

  async function sendHome(req, res) {
    try {
      const profiles = await getRequiredProfiles();
      setPublicHtmlCache(res);
      return res.send(renderHomeHtml(profiles));
    } catch (err) {
      console.error("Home route error:", err);
      return sendPublicUnavailable(res);
    }
  }

  router.get("/", sendHome);

  router.get(["/anasayfa", "/home"], (req, res) => redirectWithQuery(req, res, "/"));

  router.get("/iletisim", async (req, res) => {
    try {
      const profiles = await getRequiredProfiles();
      setPublicHtmlCache(res);
      return res.send(renderContactHtml(profiles));
    } catch (err) {
      console.error("Contact route error:", err);
      setPublicHtmlCache(res);
      return res.send(renderStaticPublicHtml("iletisim.html", "contact"));
    }
  });

  router.get("/guven-ve-politikalar", (req, res) => {
    setPublicHtmlCache(res);
    res.send(renderStaticPublicHtml("guven-ve-politikalar.html"));
  });

  router.get("/kategoriler", async (req, res) => {
    try {
      const profiles = await getRequiredProfiles();
      setPublicHtmlCache(res);
      return res.send(renderCategoriesHubHtml(profiles));
    } catch (err) {
      console.error("Categories hub route error:", err);
      return sendPublicUnavailable(res);
    }
  });

  router.get("/ilanlar", async (req, res) => {
    try {
      const profiles = await getRequiredProfiles();
      setPublicHtmlCache(res);
      return res.send(renderListingsHubHtml(profiles));
    } catch (err) {
      console.error("Listings hub route error:", err);
      return sendPublicUnavailable(res);
    }
  });

  router.get("/detay.html", async (req, res) => {
    const requestedSlug = safeSlug(req.query.slug);

    if (!requestedSlug) {
      return redirectWithQuery(req, res, "/ilanlar", ["slug"]);
    }

    try {
      const profile = await findProfileBySlug(await getRequiredSeoProfiles(), requestedSlug);
      const target = profile
        ? `/profil/${getProfileSlug(profile)}`
        : recoverableProfileTarget(requestedSlug) || "/ilanlar";
      return redirectWithQuery(req, res, target, ["slug"]);
    } catch (err) {
      console.error("Legacy detail redirect error:", err);
      return sendPublicUnavailable(res);
    }
  });

  router.get("/vg-panel-91x", requirePrivatePanel, (req, res) => {
    setNoStore(res);
    res.sendFile(file("vg-panel-91x.html"));
  });

  router.get("/profil/:slug", async (req, res) => {
    try {
      const profiles = await getRequiredSeoProfiles();
      const profile = await findProfileBySlug(profiles, req.params.slug);

      if (!profile) {
        const recoveryTarget = recoverableProfileTarget(req.params.slug);
        if (recoveryTarget) {
          return redirectWithQuery(req, res, recoveryTarget);
        }

        setNoStore(res);
        return res.status(404).send(renderStaticPublicHtml("404.html", "profiles"));
      }

      const canonicalSlug = getProfileSlug(profile);

      if (req.path !== `/profil/${canonicalSlug}`) {
        return redirectWithQuery(req, res, `/profil/${canonicalSlug}`);
      }

      setPublicHtmlCache(res);
      return res.send(renderProfileDetailHtml(profile, profiles));
    } catch (err) {
      console.error("Profile route error:", err);
      return sendPublicUnavailable(res);
    }
  });

  router.get("/:slug", async (req, res, next) => {
    const slug = safeSlug(req.params.slug);

    if (slug.endsWith("-escort")) {
      if (!resolveLandingTarget(slug)) {
        return next();
      }
      if (req.path !== `/${slug}`) return redirectWithQuery(req, res, `/${slug}`);

      try {
        const profiles = await getRequiredProfiles();
        setPublicHtmlCache(res);
        const html = renderCategoryHtml(slug, profiles);
        if (!html) return next();
        return res.send(html);
      } catch (err) {
        console.error("Landing route error:", err);
        return sendPublicUnavailable(res);
      }
    }

    return next();
  });

  router.get([
    "/istanbul-:slug",
    "/:district-escort/:slug",
    "/escort-:slug"
  ], async (req, res) => {
    try {
      const profiles = await getRequiredSeoProfiles();
      const found = await findProfileBySlug(profiles, req.params.slug);

      if (!found) {
        const recoveryTarget = recoverableProfileTarget(req.params.slug);
        if (recoveryTarget) {
          return redirectWithQuery(req, res, recoveryTarget);
        }

        setNoStore(res);
        return res.status(404).send(renderStaticPublicHtml("404.html", "profiles"));
      }

      return redirectWithQuery(req, res, `/profil/${getProfileSlug(found)}`);
    } catch (err) {
      console.error("Legacy redirect error:", err);
      return sendPublicUnavailable(res);
    }
  });

  return router;
}

module.exports = {
  createPublicRouter,
  recoverableProfileTarget,
  redirectWithQuery
};
