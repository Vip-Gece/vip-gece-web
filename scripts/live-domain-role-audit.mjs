"use strict";

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const jsonOnly = args.has("--json");
const PRIMARY = "https://vip-gece.site";
const REDIRECT_VARIANTS = [
  "https://vip-gece.com",
  "https://www.vip-gece.com",
  "http://vip-gece.com",
  "http://www.vip-gece.com"
];
const STANDBY = "https://vip-gece.online";
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

async function mapLimit(items, limit, iteratee) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await iteratee(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
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

  const redirectTargets = locations.map((location, index) => {
    const parsed = new URL(location);
    parsed.search = `?__vip_gece_redirect_audit=${index}&preserve=%2Ffoo%3Fbar`;
    return { pathAndQuery: `${parsed.pathname}${parsed.search}`, expected: parsed.toString() };
  });
  const redirectCases = REDIRECT_VARIANTS.flatMap((source) =>
    redirectTargets.map((target) => ({ source, ...target }))
  );
  const redirectResults = await mapLimit(redirectCases, 10, async (entry) => {
    try {
      const response = await request(`${entry.source}${entry.pathAndQuery}`, {
        redirect: "manual",
        timeoutMs: 30_000
      });
      return {
        ok: response.status === 301 && response.location === entry.expected,
        source: `${entry.source}${entry.pathAndQuery}`,
        status: response.status,
        location: response.location,
        expected: entry.expected
      };
    } catch (error) {
      return {
        ok: false,
        source: `${entry.source}${entry.pathAndQuery}`,
        status: 0,
        location: "",
        expected: entry.expected,
        error: error.message
      };
    }
  });
  const redirectFailures = redirectResults.filter((result) => !result.ok);
  add(
    checks,
    "old-domain path/query redirect matrix",
    redirectFailures.length === 0 && redirectResults.length === EXPECTED_SITEMAP_COUNT * 4,
    {
      checked: redirectResults.length,
      failed: redirectFailures.length,
      examples: redirectFailures.slice(0, 5)
    }
  );

  const standbyHome = await request(`${STANDBY}/`, { redirect: "manual" });
  const standbyNoindex = /\bnoindex\b/i.test(standbyHome.xRobotsTag)
    || /<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(standbyHome.text);
  const standbyCanonical = standbyHome.text.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] || "";
  add(checks, "standby root", standbyHome.status === 200 && !standbyNoindex && standbyCanonical === `${PRIMARY}/`, {
    status: standbyHome.status,
    xRobotsTag: standbyHome.xRobotsTag,
    canonical: standbyCanonical
  });

  const standbyWww = await request(`https://www.vip-gece.online/`, { redirect: "manual" });
  add(
    checks,
    "standby www redirect",
    standbyWww.status === 301 && standbyWww.location === `${STANDBY}/`,
    { status: standbyWww.status, location: standbyWww.location }
  );

  const standbyReady = await request(`${STANDBY}/api/ready`);
  add(
    checks,
    "standby readiness",
    standbyReady.status === 200 && standbyReady.text === '{"status":"ready"}'
      && /\bnoindex\b/i.test(standbyReady.xRobotsTag),
    { status: standbyReady.status, body: standbyReady.text, xRobotsTag: standbyReady.xRobotsTag }
  );

  const standbySitemap = await request(`${STANDBY}/sitemap.xml`);
  const standbyLocations = sitemapLocations(standbySitemap.text);
  add(
    checks,
    "standby canonical sitemap",
    standbySitemap.status === 200 && standbyLocations.length === EXPECTED_SITEMAP_COUNT
      && standbyLocations.every((url) => url.startsWith(`${PRIMARY}/`))
      && !/\bnoindex\b/i.test(standbySitemap.xRobotsTag),
    {
      status: standbySitemap.status,
      locations: standbyLocations.length,
      xRobotsTag: standbySitemap.xRobotsTag
    }
  );

  const failures = checks.filter((check) => !check.ok);
  const report = {
    ok: failures.length === 0,
    checkedAt: new Date().toISOString(),
    expectedProfiles: EXPECTED_PROFILE_COUNT,
    expectedSitemapUrls: EXPECTED_SITEMAP_COUNT,
    redirectChecks: redirectResults.length,
    checks,
    failures
  };

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`ok=${report.ok}`);
    console.log(`redirect_checks=${report.redirectChecks}`);
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
