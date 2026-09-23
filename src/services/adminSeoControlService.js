"use strict";

const fs = require("fs");

const { SITE_URL } = require("../config/env");
const { listAdminPostgresProfiles } = require("../data/postgresProfilesRepo");
const { customerProfileImageExists } = require("./customerProfileImageService");
const { searchConsoleStatus } = require("./googleSearchConsoleService");
const { getProfileSlug } = require("../utils/profile");
const { buildProfilePageDescription, buildProfilePageTitle } = require("../utils/profileSeo");
const { safeSlug } = require("../utils/text");

const OLD_SUPABASE_HOSTS = new Set([
  "hofblpqaxzhybozavtaz.supabase.co"
]);

function siteOrigin() {
  try {
    return new URL(SITE_URL).origin;
  } catch {
    return "https://vip-gece.site";
  }
}

function configuredSupabaseHost() {
  try {
    return new URL(String(process.env.SUPABASE_URL || "")).hostname;
  } catch {
    return "";
  }
}

function configuredProfileImageHosts() {
  return new Set(
    String(process.env.PROFILE_IMAGE_ALLOWED_HOSTS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function hasReadableFile(value) {
  try {
    return Boolean(value && fs.statSync(value).isFile());
  } catch {
    return false;
  }
}

function cloudflareStatus() {
  const tokenFile = process.env.CLOUDFLARE_API_TOKEN_FILE ||
    process.env.CF_API_TOKEN_FILE ||
    "/etc/vip-gece-domain-gateway/cloudflare.token";
  const tokenPresent = Boolean(process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN) ||
    hasReadableFile(tokenFile);
  const zoneConfigured = Boolean(
    process.env.CLOUDFLARE_ZONE_ID ||
      process.env.CF_ZONE_ID ||
      process.env.CLOUDFLARE_ZONE_NAME ||
      process.env.CLOUDFLARE_EXPECTED_ZONE_NAME
  );

  return {
    provider: "cloudflare",
    configured: tokenPresent || zoneConfigured,
    token_present: tokenPresent,
    zone_configured: zoneConfigured,
    mode: tokenPresent ? "ready_for_api_check" : "read_only_header_check",
    next_action: tokenPresent
      ? "Cloudflare token mevcut; cache temizleme ve ayar doğrulama komutları güvenli şekilde çalıştırılabilir."
      : "Cloudflare token dosyası veya ortam değişkeni yok; panel şimdilik sadece site başlıklarından durum okuyabilir."
  };
}

function targetArea(profile = {}) {
  const district = String(profile.district || "").trim();
  if (district && !["istanbul", "istanbul-geneli", "geneli"].includes(safeSlug(district))) {
    return district;
  }
  return String(profile.city || "İstanbul").trim() || "İstanbul";
}

function canonicalProfileUrl(profile = {}) {
  return `${siteOrigin()}/profil/${encodeURIComponent(getProfileSlug(profile))}`;
}

function targetQueries(profile = {}) {
  const area = targetArea(profile);
  const name = String(profile.name || "").trim();
  const type = String(profile.type || "").toLowerCase() === "vip" || profile.is_featured === true
    ? "VIP"
    : "Escort";
  return [
    `${area} escort`,
    `${area} ${type.toLowerCase()} escort`,
    name ? `${name} ${area} escort` : ""
  ].filter(Boolean);
}

function classifyImage(value, context) {
  const image = String(value || "").trim();
  if (!image) return { usable: false, status: "empty" };

  if (image.startsWith("/media/customer-profile/")) {
    return customerProfileImageExists(image)
      ? { usable: true, status: "local_ok" }
      : { usable: false, status: "local_missing" };
  }

  if (image.startsWith("/media/profile-image/")) {
    return { usable: true, status: "proxied_profile_image" };
  }

  if (image.startsWith("/")) {
    return { usable: true, status: "same_origin" };
  }

  try {
    const parsed = new URL(image);
    const host = parsed.hostname.toLowerCase();
    if (OLD_SUPABASE_HOSTS.has(host)) {
      return { usable: false, status: "old_supabase_dead", host };
    }
    if (host === context.supabaseHost) {
      return { usable: true, status: "current_supabase", host };
    }
    if (context.allowedHosts.has(host)) {
      return { usable: true, status: "allowed_remote", host };
    }
    return { usable: false, status: "foreign_remote", host };
  } catch {
    return { usable: false, status: "invalid_url" };
  }
}

function seoReady(profile = {}) {
  return Boolean(
    profile.is_active !== false &&
      getProfileSlug(profile) &&
      buildProfilePageTitle(profile).length >= 20 &&
      buildProfilePageDescription(profile).length >= 70
  );
}

function profileSeoRow(profile = {}, context) {
  const imageResults = (Array.isArray(profile.images) ? profile.images : [])
    .map((image) => classifyImage(image, context));
  const brokenImages = imageResults.filter((item) => !item.usable);
  const oldSupabaseImages = imageResults.filter((item) => item.status === "old_supabase_dead");
  const usableImages = imageResults.filter((item) => item.usable);
  const queries = targetQueries(profile);
  const title = buildProfilePageTitle(profile);
  const description = buildProfilePageDescription(profile);
  const ready = seoReady(profile) && usableImages.length > 0;

  return {
    id: profile.id,
    name: profile.name || "",
    slug: getProfileSlug(profile),
    active: profile.is_active === true,
    type: profile.type || "",
    area: targetArea(profile),
    canonical_url: canonicalProfileUrl(profile),
    target_queries: queries,
    primary_target_query: queries[0] || "",
    seo_title: title,
    seo_description: description,
    seo_ready: ready,
    title_length: title.length,
    description_length: description.length,
    image_count: imageResults.length,
    usable_image_count: usableImages.length,
    broken_image_count: brokenImages.length,
    old_supabase_image_count: oldSupabaseImages.length,
    top5_goal: {
      target: "Google ilk 5",
      current_status: "Search Console profil filtresiyle izlenmeli",
      priority: ready ? "normal" : "yüksek"
    }
  };
}

async function buildSeoControlOverview() {
  const profiles = await listAdminPostgresProfiles();
  const context = {
    supabaseHost: configuredSupabaseHost(),
    allowedHosts: configuredProfileImageHosts()
  };
  const rows = profiles.map((profile) => profileSeoRow(profile, context));
  const activeRows = rows.filter((row) => row.active);
  const brokenRows = activeRows.filter((row) => row.broken_image_count > 0 || row.usable_image_count === 0);
  const seoMissingRows = activeRows.filter((row) => !row.seo_ready);

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    site: siteOrigin(),
    google: searchConsoleStatus(),
    cloudflare: cloudflareStatus(),
    supabase: {
      host: context.supabaseHost,
      allowed_profile_image_hosts: [...context.allowedHosts]
    },
    totals: {
      profiles: rows.length,
      active_profiles: activeRows.length,
      seo_ready_profiles: activeRows.length - seoMissingRows.length,
      seo_missing_profiles: seoMissingRows.length,
      profiles_with_broken_images: brokenRows.length,
      broken_images: activeRows.reduce((sum, row) => sum + row.broken_image_count, 0),
      old_supabase_images: activeRows.reduce((sum, row) => sum + row.old_supabase_image_count, 0)
    },
    first5_plan: {
      goal: "Google ilk 5",
      focus: [
        "Profil sayfalarında güçlü title, açıklama, canonical, görsel ve iç bağlantı",
        "İstanbul, ilçe ve kategori sayfalarında düzenli sitemap/Search Console takibi",
        "Bozuk görsel ve eski Supabase bağlantısı sıfır",
        "Search Console sorgu ve sayfa verisini profil profil izleme"
      ]
    },
    profiles: rows
  };
}

module.exports = {
  buildSeoControlOverview,
  cloudflareStatus,
  profileSeoRow
};
