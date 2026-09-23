"use strict";

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const jsonOnly = args.has("--json");
const PRIMARY = "https://vip-gece.site";
const CANCELLED_MIGRATION = "vip-gece.com";
const FUTURE_SEPARATE_SITE = "vip-gece.online";
const EXPECTED_PROFILE_COUNT = 27;
const EXPECTED_SITEMAP_COUNT = 267;
const PANEL_PATHS = [
  "/vg-panel-91x.html",
  "/customer-panel.html",
  "/admin.js",
  "/admin.css",
  "/mobile-admin/"
];

async function request(url, { redirect = "follow", timeoutMs = 25_000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect,
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/json,application/xml,text/plain,*/*",
        "User-Agent": "VIP-Gece-Domain-Role-Audit/2026-08-06"
      }
    });
    return {
      status: response.status,
      url: response.url,
      location: response.headers.get("location") || "",
      xRobotsTag: response.headers.get("x-robots-tag") || "",
      text: await response.text()
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sitemapLocations(xml) {
  return Array.from(String(xml).matchAll(/<loc>([\s\S]*?)<\/loc>/gi), (match) =>
    match[1].replace(/&amp;/g, "&").trim()
  );
}

function add(checks, name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
}

async function main() {
  const checks = [];
  const ready = await request(`${PRIMARY}/api/ready`);
  add(checks, "primary readiness", ready.status === 200 && ready.text === '{"status":"ready"}', {
    status: ready.status,
    body: ready.text
  });

  const profilesResponse = await request(`${PRIMARY}/api/v1/public/profiles`);
  let profiles = [];
  try {
    const payload = JSON.parse(profilesResponse.text);
    profiles = Array.isArray(payload) ? payload : payload.profiles || [];
  } catch {
    profiles = [];
  }
  const slugs = profiles.map((profile) => String(profile.slug || "").trim()).filter(Boolean);
  add(
    checks,
    "primary public profile inventory",
    profilesResponse.status === 200 && profiles.length === EXPECTED_PROFILE_COUNT
      && new Set(slugs).size === EXPECTED_PROFILE_COUNT,
    { status: profilesResponse.status, profiles: profiles.length, uniqueSlugs: new Set(slugs).size }
  );

  const sitemapResponse = await request(`${PRIMARY}/sitemap.xml`);
  const locations = sitemapLocations(sitemapResponse.text);
  add(
    checks,
    "primary sitemap inventory",
    sitemapResponse.status === 200 && locations.length === EXPECTED_SITEMAP_COUNT
      && locations.every((url) => url.startsWith(`${PRIMARY}/`)),
    { status: sitemapResponse.status, locations: locations.length }
  );

  for (const panelPath of PANEL_PATHS) {
    const response = await request(`${PRIMARY}${panelPath}`, { redirect: "manual" });
    add(checks, `private panel ${panelPath}`, response.status === 404, { status: response.status });
  }

  const failures = checks.filter((check) => !check.ok);
  const report = {
    ok: failures.length === 0,
    checkedAt: new Date().toISOString(),
    primary: PRIMARY,
    cancelledMigration: CANCELLED_MIGRATION,
    futureSeparateSite: FUTURE_SEPARATE_SITE,
    expectedProfiles: EXPECTED_PROFILE_COUNT,
    expectedSitemapUrls: EXPECTED_SITEMAP_COUNT,
    notes: [
      "vip-gece.com migration to vip-gece.site is cancelled and is not audited as a redirect source.",
      "vip-gece.online is reserved for a future separate site and is not audited as a vip-gece.site standby."
    ],
    checks,
    failures
  };

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`ok=${report.ok}`);
    console.log(`primary=${report.primary}`);
    console.log(`cancelled_migration=${report.cancelledMigration}`);
    console.log(`future_separate_site=${report.futureSeparateSite}`);
    for (const check of checks) {
      console.log(`${check.ok ? "ok" : "fail"} ${check.name} ${JSON.stringify(check.detail)}`);
    }
  }
  if (strict && !report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
