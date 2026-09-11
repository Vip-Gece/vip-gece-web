"use strict";

const fs = require("fs");
const path = require("path");
const { SITE_URL } = require("../config/env");
const { districtRows } = require("../data/publicMetadata");
const { listIndexableLandingSlugs, profilesSupportingLanding } = require("./landingContextService");
const { esc } = require("../utils/text");
const { getProfileSlug } = require("../utils/profile");

function today() {
  return new Date().toISOString().split("T")[0];
}

function isoDate(value, fallback = "") {
  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) || parsed.getTime() <= 0
    ? fallback
    : parsed.toISOString().split("T")[0];
}

function latestFileLastmod(paths, fallback = "") {
  const timestamps = (paths || [])
    .map((filePath) => {
      try {
        return fs.statSync(filePath).mtimeMs;
      } catch {
        return 0;
      }
    })
    .filter((value) => Number.isFinite(value) && value > 0);

  return timestamps.length ? isoDate(Math.max(...timestamps), fallback) : fallback;
}

function maxLastmod(...values) {
  const timestamps = values
    .map((value) => new Date(value || 0).getTime())
    .filter((value) => Number.isFinite(value) && value > 0);
  return timestamps.length ? isoDate(Math.max(...timestamps), today()) : today();
}

const LANDING_CONTENT_LASTMOD = latestFileLastmod([
  path.resolve(__dirname, "../../config.js"),
  path.resolve(__dirname, "../data/publicMetadata.js"),
  path.resolve(__dirname, "landingContextService.js"),
  path.resolve(__dirname, "render/landingRenderer.js"),
  path.resolve(__dirname, "../../istanbul.html"),
  path.resolve(__dirname, "../../bolge.html"),
  path.resolve(__dirname, "../../kategori-landing.html")
], today());

function staticPageLastmod(fileName) {
  return latestFileLastmod([
    path.resolve(__dirname, "../../", fileName)
  ], LANDING_CONTENT_LASTMOD);
}

function profileLastmod(profile) {
  const raw = profile?.updated_at || profile?.created_at || "";
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) return today();
  return value.toISOString().split("T")[0];
}

function rowsLastmod(rows, fallback = "") {
  const timestamps = (rows || [])
    .map((row) => new Date(row?.updated_at || row?.created_at || 0).getTime())
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!timestamps.length) return fallback || today();
  return new Date(Math.max(...timestamps)).toISOString().split("T")[0];
}

function activeProfiles(profiles) {
  return (profiles || []).filter((profile) => profile?.is_active === true);
}

function absoluteImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${SITE_URL}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

function isSitemapImage(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;

  // Legacy customer-upload files are not part of the current release storage.
  // Keep known 404 assets out of Google's image sitemap until they are restored.
  return !/^\/media\/customer-upload\//i.test(raw);
}

function landingPriority(slug) {
  if (slug === "istanbul-escort") return "0.95";
  const districtSet = new Set(districtRows().map((district) => district.slug));
  return districtSet.has(slug) ? "0.90" : "0.85";
}

function buildSitemapXml(profiles) {
  const active = activeProfiles(profiles);
  const indexable = activeProfiles(profiles);
  const profileHubLastmod = rowsLastmod(active, LANDING_CONTENT_LASTMOD);
  const hubLastmod = maxLastmod(profileHubLastmod, LANDING_CONTENT_LASTMOD);
  const staticUrls = [
    { loc: `${SITE_URL}/`, priority: "1.00", lastmod: hubLastmod },
    { loc: `${SITE_URL}/ilanlar`, priority: "0.92", lastmod: hubLastmod },
    { loc: `${SITE_URL}/iletisim`, priority: "0.70", lastmod: staticPageLastmod("iletisim.html") },
    { loc: `${SITE_URL}/guven-ve-politikalar`, priority: "0.65", lastmod: staticPageLastmod("guven-ve-politikalar.html") },
    { loc: `${SITE_URL}/kategoriler`, priority: "0.85", lastmod: hubLastmod }
  ];

  const landingUrls = listIndexableLandingSlugs(active).map((slug) => ({
    loc: `${SITE_URL}/${slug}`,
    priority: landingPriority(slug),
    lastmod: maxLastmod(rowsLastmod(profilesSupportingLanding(slug, active), LANDING_CONTENT_LASTMOD), LANDING_CONTENT_LASTMOD)
  }));

  const profileUrls = indexable.map((profile) => ({
    loc: `${SITE_URL}/profil/${getProfileSlug(profile)}`,
    priority: "0.95",
    lastmod: profileLastmod(profile)
  }));

  const urls = [...staticUrls, ...landingUrls, ...profileUrls]
    .filter((row, index, items) => items.findIndex((item) => item.loc === row.loc) === index);

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `  <url>
    <loc>${esc(url.loc)}</loc>
    <lastmod>${url.lastmod || today()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>${url.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;
}

function buildImageSitemapXml(profiles) {
  const rows = activeProfiles(profiles)
    .filter((profile) => Array.isArray(profile.images) && profile.images.length)
    .flatMap((profile) => {
      const loc = `${SITE_URL}/profil/${getProfileSlug(profile)}`;
      const images = profile.images
        .filter(isSitemapImage)
        .map(absoluteImageUrl)
        .filter(Boolean)
        .map(
          (image) => `    <image:image>
      <image:loc>${esc(image)}</image:loc>
      <image:title>${esc(profile.name || "Profil")}</image:title>
    </image:image>`
        )
        .join("\n");

      if (!images) return [];

      return [`  <url>
    <loc>${esc(loc)}</loc>
${images}
  </url>`];
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${rows}
</urlset>`;
}

module.exports = {
  buildSitemapXml,
  buildImageSitemapXml
};
