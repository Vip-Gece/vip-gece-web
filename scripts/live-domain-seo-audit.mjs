"use strict";

const DEFAULT_SITE_URL = "https://vip-gece.site";
const AUDIT_USER_AGENT = process.env.LIVE_AUDIT_USER_AGENT || "VIP-Gece-SEO-Audit/2026-06-26";
const DEFAULT_ROUTES = [
  "/",
  "/anasayfa",
  "/ilanlar",
  "/kategoriler",
  "/istanbul-escort",
  "/sisli-escort",
  "/vip-escort",
  "/esmer-escort",
  "/sarisin-escort",
  "/genc-escort",
  "/iletisim",
  "/profil/irem-istanbul",
  "/profil/istanbul-kardelen",
  "/profil/istanbul-lara",
  "/profil/istanbul-sofia",
  "/profil/istanbul-umay"
];
const REQUIRED_DIRECT_PROFILE_SLUGS = Object.freeze([
  "irem-istanbul",
  "istanbul-kardelen",
  "istanbul-lara",
  "istanbul-sofia",
  "istanbul-umay"
]);
const SEO_ONLY_PROFILE_SLUGS = Object.freeze([]);
const DIRECT_PROFILE_ROUTES = new Set(
  REQUIRED_DIRECT_PROFILE_SLUGS.map((slug) => `/profil/${slug}`)
);

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const jsonOnly = args.includes("--json");
const urlArg = args.find((item) => item.startsWith("--site="));
const routeArg = args.find((item) => item.startsWith("--routes="));
const FETCH_TIMEOUT_MS = Number(process.env.LIVE_SEO_FETCH_TIMEOUT_MS || 30000);
const FETCH_RETRIES = Number(process.env.LIVE_SEO_FETCH_RETRIES || 2);
const EXPECTED_PUBLIC_PROFILE_COUNT = process.env.VIP_GECE_EXPECTED_PUBLIC_PROFILE_COUNT;
const EXPECTED_INDEXABLE_PROFILE_COUNT = process.env.VIP_GECE_EXPECTED_INDEXABLE_PROFILE_COUNT;
const EXPECTED_SITEMAP_URL_COUNT = process.env.VIP_GECE_EXPECTED_SITEMAP_URL_COUNT;

function normalizeSiteUrl(raw) {
  const value = String(raw || DEFAULT_SITE_URL).trim().replace(/\/+$/, "");
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("site url must use http or https");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function routeList() {
  if (!routeArg) return DEFAULT_ROUTES;
  return routeArg
    .slice("--routes=".length)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.startsWith("/") ? item : `/${item}`);
}

function absoluteUrl(siteUrl, pathName) {
  return `${siteUrl}${pathName.startsWith("/") ? pathName : `/${pathName}`}`;
}

async function fetchText(url, timeoutMs = FETCH_TIMEOUT_MS, redirect = "follow") {
  let lastError;

  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        redirect,
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8",
          Connection: "close",
          "User-Agent": AUDIT_USER_AGENT
        }
      });
      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        final_url: response.url,
        content_type: response.headers.get("content-type") || "",
        x_robots_tag: response.headers.get("x-robots-tag") || "",
        text
      };
    } catch (error) {
      lastError = error;
      if (attempt >= FETCH_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

function firstMatch(html, pattern) {
  const match = html.match(pattern);
  return match ? String(match[1] || "").trim() : "";
}

function attributeValue(tag, attributeName) {
  const pattern = new RegExp(`${attributeName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i");
  const match = tag.match(pattern);
  return match ? String(match[2] || "").trim() : "";
}

function metaContent(html, attributeName, attributeValueTarget) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  const target = String(attributeValueTarget || "").toLowerCase();
  for (const tag of tags) {
    const value = attributeValue(tag, attributeName).toLowerCase();
    if (value === target) return attributeValue(tag, "content");
  }
  return "";
}

function allMatches(html, pattern) {
  return Array.from(html.matchAll(pattern)).map((match) => String(match[1] || "").trim());
}

function countMatches(html, pattern) {
  return Array.from(html.matchAll(pattern)).length;
}

function routeSeoSummary(route, result) {
  const html = result.text || "";
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i).replace(/\s+/g, " ");
  const description = metaContent(html, "name", "description");
  const canonical = firstMatch(html, /<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i);
  const ogTitle = metaContent(html, "property", "og:title");
  const ogDescription = metaContent(html, "property", "og:description");
  const twitterTitle = metaContent(html, "name", "twitter:title");
  const h1 = allMatches(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)
    .map((item) => item.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const jsonLdCount = countMatches(html, /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>/gi);
  const noindex = /<meta\s+[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);

  const findings = [];
  const requestedUrl = new URL(route, DEFAULT_SITE_URL);
  const finalUrl = new URL(result.final_url);
  const directProfileRoute = DIRECT_PROFILE_ROUTES.has(requestedUrl.pathname);
  if (!result.ok) findings.push(`HTTP ${result.status}`);
  if (directProfileRoute && result.status !== 200) {
    findings.push(`expected direct HTTP 200, received ${result.status}`);
  }
  if (directProfileRoute && `${requestedUrl.pathname}${requestedUrl.search}` !== `${finalUrl.pathname}${finalUrl.search}`) {
    findings.push(`route redirected to ${result.final_url}`);
  }
  if (!title) findings.push("missing title");
  if (!description) findings.push("missing description");
  if (description && (description.length < 80 || description.length > 180)) findings.push(`description length ${description.length}`);
  if (!canonical) findings.push("missing canonical");
  if (!ogTitle || !ogDescription) findings.push("missing Open Graph title/description");
  if (!twitterTitle) findings.push("missing Twitter title");
  if (h1.length !== 1) findings.push(`h1 count ${h1.length}`);
  if (jsonLdCount < 1) findings.push("missing JSON-LD");
  if (noindex) findings.push("noindex present");
  if (/noindex/i.test(result.x_robots_tag || "")) findings.push("X-Robots-Tag noindex present");

  return {
    route,
    ok: result.ok && findings.length === 0,
    status: result.status,
    final_url: result.final_url,
    content_type: result.content_type,
    title,
    description_length: description.length,
    canonical,
    h1,
    json_ld_count: jsonLdCount,
    findings
  };
}

function robotsSummary(text) {
  return {
    has_user_agent: /user-agent\s*:/i.test(text),
    has_sitemap: /sitemap\s*:/i.test(text),
    has_public_allow: /^allow\s*:\s*\/\s*$/im.test(text),
    blocks_all: /^disallow\s*:\s*\/\s*$/im.test(text),
    search_crawlers_open: !/^user-agent\s*:\s*(googlebot|google-inspectiontool|bingbot)\s*\r?\n\s*disallow\s*:\s*\/\s*$/im.test(text),
    sitemap_lines: allMatches(text, /^sitemap\s*:\s*(.+)$/gim)
  };
}

function robotsVariantUrls(siteUrl) {
  const parsed = new URL(siteUrl);
  const hostname = parsed.hostname;
  if (hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return [absoluteUrl(siteUrl, "/robots.txt")];
  }

  const bareHost = hostname.replace(/^www\./i, "");
  return Array.from(new Set([
    `https://${bareHost}/robots.txt`,
    `https://www.${bareHost}/robots.txt`,
    `http://${bareHost}/robots.txt`,
    `http://www.${bareHost}/robots.txt`
  ]));
}

function sitemapSummary(text) {
  return {
    url_count: countMatches(text, /<url>/gi),
    has_lastmod: /<lastmod>/i.test(text),
    has_home: /<loc>https?:\/\/[^<]*\/(?:<\/loc>|$)/i.test(text),
    has_istanbul: /istanbul-escort/i.test(text)
  };
}

function expectedCount(raw, label, fallback) {
  if (raw !== undefined) {
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative integer`);
    }
    return value;
  }
  return fallback;
}

function expectedPublicProfileCount(siteUrl) {
  return expectedCount(
    EXPECTED_PUBLIC_PROFILE_COUNT,
    "VIP_GECE_EXPECTED_PUBLIC_PROFILE_COUNT",
    0
  );
}

function expectedIndexableProfileCount(siteUrl) {
  return expectedCount(
    EXPECTED_INDEXABLE_PROFILE_COUNT,
    "VIP_GECE_EXPECTED_INDEXABLE_PROFILE_COUNT",
    0
  );
}

function expectedSitemapUrlCount(siteUrl) {
  return expectedCount(
    EXPECTED_SITEMAP_URL_COUNT,
    "VIP_GECE_EXPECTED_SITEMAP_URL_COUNT",
    0
  );
}

function publicProfilesFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.profiles)) return payload.profiles;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function profileSlugsFromHome(html, siteUrl) {
  const siteOrigin = new URL(siteUrl).origin;
  const slugs = new Set();

  for (const href of allMatches(html, /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    try {
      const url = new URL(href, siteUrl);
      if (url.origin !== siteOrigin || !url.pathname.startsWith("/profil/")) continue;
      const slug = decodeURIComponent(url.pathname.slice("/profil/".length)).trim();
      if (slug && !slug.includes("/")) slugs.add(slug);
    } catch {
      // Invalid links are handled by the regular route checks.
    }
  }

  return [...slugs].sort();
}

function profileSlugsFromSitemap(xml, siteUrl) {
  const siteOrigin = new URL(siteUrl).origin;
  const slugs = new Set();

  for (const loc of allMatches(xml, /<loc>([\s\S]*?)<\/loc>/gi)) {
    try {
      const url = new URL(loc.replace(/&amp;/g, "&"));
      if (url.origin !== siteOrigin || !url.pathname.startsWith("/profil/")) continue;
      const slug = decodeURIComponent(url.pathname.slice("/profil/".length)).trim();
      if (slug && !slug.includes("/")) slugs.add(slug);
    } catch {
      // Malformed sitemap URLs are handled by the full sitemap audit.
    }
  }

  return [...slugs].sort();
}

async function publicProfileSurfaceSummary(siteUrl, sitemapXml) {
  const expectedPublicCount = expectedPublicProfileCount(siteUrl);
  const expectedIndexableCount = expectedIndexableProfileCount(siteUrl);
  const findings = [];

  try {
    const [apiResult, homeResult] = await Promise.all([
      fetchText(absoluteUrl(siteUrl, "/api/v1/public/profiles")),
      fetchText(absoluteUrl(siteUrl, "/"))
    ]);
    if (!apiResult.ok) findings.push(`profiles API HTTP ${apiResult.status}`);
    if (!homeResult.ok) findings.push(`home HTTP ${homeResult.status}`);

    let payload;
    try {
      payload = JSON.parse(apiResult.text);
    } catch {
      findings.push("profiles API returned invalid JSON");
    }

    const profiles = publicProfilesFromPayload(payload);
    const apiSlugs = [...new Set(profiles
      .map((profile) => String(profile?.slug || "").trim())
      .filter(Boolean))].sort();
    const homeSlugs = profileSlugsFromHome(homeResult.text, siteUrl);
    const sitemapSlugs = profileSlugsFromSitemap(sitemapXml, siteUrl);
    const missingFromHome = apiSlugs.filter((slug) => !homeSlugs.includes(slug));
    const unexpectedHomeLinks = homeSlugs.filter((slug) => !apiSlugs.includes(slug));
    const publicMissingFromSitemap = apiSlugs.filter((slug) => !sitemapSlugs.includes(slug));
    const seoOnlySlugs = sitemapSlugs.filter((slug) => !apiSlugs.includes(slug));
    const missingSeoOnlySlugs = SEO_ONLY_PROFILE_SLUGS.filter((slug) => !seoOnlySlugs.includes(slug));
    const unexpectedSeoOnlySlugs = seoOnlySlugs.filter((slug) => !SEO_ONLY_PROFILE_SLUGS.includes(slug));

    if (apiSlugs.length !== profiles.length) findings.push("profiles API has missing or duplicate slugs");
    if (expectedPublicCount > 0 && apiSlugs.length !== expectedPublicCount) {
      findings.push(`public profile count ${apiSlugs.length}, expected ${expectedPublicCount}`);
    }
    if (expectedIndexableCount > 0 && sitemapSlugs.length !== expectedIndexableCount) {
      findings.push(`indexable profile count ${sitemapSlugs.length}, expected ${expectedIndexableCount}`);
    }
    if (missingFromHome.length) findings.push(`home missing ${missingFromHome.length} public profile links`);
    if (unexpectedHomeLinks.length) findings.push(`home has ${unexpectedHomeLinks.length} unknown profile links`);
    if (publicMissingFromSitemap.length) {
      findings.push(`sitemap missing ${publicMissingFromSitemap.length} public profile URLs`);
    }
    if (missingSeoOnlySlugs.length) {
      findings.push(`sitemap missing exact SEO-only profiles: ${missingSeoOnlySlugs.join(", ")}`);
    }
    if (unexpectedSeoOnlySlugs.length) {
      findings.push(`sitemap has unexpected SEO-only profiles: ${unexpectedSeoOnlySlugs.join(", ")}`);
    }

    return {
      ok: apiResult.ok && homeResult.ok && findings.length === 0,
      expected_public_count: expectedPublicCount,
      expected_indexable_count: expectedIndexableCount,
      public_api_count: apiSlugs.length,
      home_link_count: homeSlugs.length,
      sitemap_profile_count: sitemapSlugs.length,
      seo_only_count: seoOnlySlugs.length,
      seo_only_slugs: seoOnlySlugs,
      missing_seo_only_slugs: missingSeoOnlySlugs,
      unexpected_seo_only_slugs: unexpectedSeoOnlySlugs,
      missing_from_home: missingFromHome,
      unexpected_home_links: unexpectedHomeLinks,
      public_missing_from_sitemap: publicMissingFromSitemap,
      findings
    };
  } catch (error) {
    return {
      ok: false,
      expected_public_count: expectedPublicCount,
      expected_indexable_count: expectedIndexableCount,
      public_api_count: 0,
      home_link_count: 0,
      sitemap_profile_count: 0,
      seo_only_count: 0,
      seo_only_slugs: [],
      missing_seo_only_slugs: [...SEO_ONLY_PROFILE_SLUGS],
      unexpected_seo_only_slugs: [],
      missing_from_home: [],
      unexpected_home_links: [],
      public_missing_from_sitemap: [],
      findings: [error.message || "public profile surface fetch failed"]
    };
  }
}

async function main() {
  const siteUrl = normalizeSiteUrl(urlArg ? urlArg.slice("--site=".length) : process.env.LIVE_SITE_URL);
  const routes = routeList();
  const routeReports = [];

  for (const route of routes) {
    try {
      const redirect = DIRECT_PROFILE_ROUTES.has(route) ? "manual" : "follow";
      routeReports.push(routeSeoSummary(route, await fetchText(absoluteUrl(siteUrl, route), FETCH_TIMEOUT_MS, redirect)));
    } catch (error) {
      routeReports.push({
        route,
        ok: false,
        status: 0,
        final_url: absoluteUrl(siteUrl, route),
        findings: [error.message || "fetch failed"]
      });
    }
  }

  let robots = { ok: false, findings: ["not checked"] };
  const robotsVariants = [];
  try {
    const result = await fetchText(absoluteUrl(siteUrl, "/robots.txt"));
    const summary = robotsSummary(result.text);
    const findings = [];
    if (!result.ok) findings.push(`HTTP ${result.status}`);
    if (!summary.has_user_agent) findings.push("missing User-agent");
    if (!summary.has_sitemap) findings.push("missing Sitemap");
    if (!summary.has_public_allow) findings.push("missing public Allow rule");
    if (summary.blocks_all) findings.push("all crawlers blocked");
    if (!summary.search_crawlers_open) findings.push("search crawler blocked");
    robots = { ok: result.ok && findings.length === 0, status: result.status, final_url: result.final_url, ...summary, findings };
  } catch (error) {
    robots = { ok: false, status: 0, findings: [error.message || "robots fetch failed"] };
  }

  for (const url of robotsVariantUrls(siteUrl)) {
    try {
      const result = await fetchText(url);
      const summary = robotsSummary(result.text);
      const findings = [];
      if (!result.ok) findings.push(`HTTP ${result.status}`);
      if (!summary.has_user_agent) findings.push("missing User-agent");
      if (!summary.has_sitemap) findings.push("missing Sitemap");
      if (!summary.has_public_allow) findings.push("missing public Allow rule");
      if (summary.blocks_all) findings.push("all crawlers blocked");
      if (!summary.search_crawlers_open) findings.push("search crawler blocked");
      robotsVariants.push({
        url,
        ok: result.ok && findings.length === 0,
        status: result.status,
        final_url: result.final_url,
        has_public_allow: summary.has_public_allow,
        findings
      });
    } catch (error) {
      robotsVariants.push({
        url,
        ok: false,
        status: 0,
        final_url: url,
        has_public_allow: false,
        findings: [error.message || "robots variant fetch failed"]
      });
    }
  }

  let sitemap = { ok: false, findings: ["not checked"] };
  let sitemapXml = "";
  try {
    const result = await fetchText(absoluteUrl(siteUrl, "/sitemap.xml"));
    sitemapXml = result.text;
    const summary = sitemapSummary(result.text);
    const findings = [];
    const expectedUrlCount = expectedSitemapUrlCount(siteUrl);
    if (!result.ok) findings.push(`HTTP ${result.status}`);
    if (!summary.url_count) findings.push("empty sitemap");
    if (!summary.has_lastmod) findings.push("missing lastmod");
    if (!summary.has_istanbul) findings.push("missing istanbul landing");
    if (expectedUrlCount > 0 && summary.url_count !== expectedUrlCount) {
      findings.push(`sitemap URL count ${summary.url_count}, expected ${expectedUrlCount}`);
    }
    sitemap = {
      ok: result.ok && findings.length === 0,
      status: result.status,
      final_url: result.final_url,
      expected_url_count: expectedUrlCount,
      ...summary,
      findings
    };
  } catch (error) {
    sitemap = { ok: false, status: 0, findings: [error.message || "sitemap fetch failed"] };
  }

  const publicProfileSurface = await publicProfileSurfaceSummary(siteUrl, sitemapXml);
  const failingRoutes = routeReports.filter((item) => !item.ok);
  const failingRobotsVariants = robotsVariants.filter((item) => !item.ok);
  const ok = failingRoutes.length === 0
    && robots.ok
    && failingRobotsVariants.length === 0
    && sitemap.ok
    && publicProfileSurface.ok;
  const report = {
    ok,
    strict,
    site_url: siteUrl,
    checked_at: new Date().toISOString(),
    routes_checked: routeReports.length,
    failing_routes: failingRoutes.map((item) => ({ route: item.route, findings: item.findings })),
    robots,
    robots_variants: robotsVariants,
    sitemap,
    public_profile_surface: publicProfileSurface,
    routes: routeReports
  };

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`site=${report.site_url}`);
    console.log(`ok=${report.ok}`);
    console.log(`routes_checked=${report.routes_checked}`);
    for (const route of report.routes) {
      const suffix = route.findings?.length ? ` findings=${route.findings.join("; ")}` : "";
      console.log(`${route.ok ? "ok" : "warn"} ${route.route} status=${route.status} title=${route.title || "(none)"}${suffix}`);
    }
    console.log(`${report.robots.ok ? "ok" : "warn"} robots status=${report.robots.status} findings=${(report.robots.findings || []).join("; ") || "none"}`);
    for (const item of report.robots_variants) {
      const suffix = item.findings?.length ? ` findings=${item.findings.join("; ")}` : "";
      console.log(`${item.ok ? "ok" : "warn"} robots-variant ${item.url} status=${item.status} final=${item.final_url}${suffix}`);
    }
    console.log(`${report.sitemap.ok ? "ok" : "warn"} sitemap status=${report.sitemap.status} urls=${report.sitemap.url_count || 0} findings=${(report.sitemap.findings || []).join("; ") || "none"}`);
    console.log(
      `${report.public_profile_surface.ok ? "ok" : "warn"} profiles `
      + `public=${report.public_profile_surface.public_api_count} `
      + `home=${report.public_profile_surface.home_link_count} `
      + `indexable=${report.public_profile_surface.sitemap_profile_count} `
      + `seo_only=${report.public_profile_surface.seo_only_count} `
      + `expected_public=${report.public_profile_surface.expected_public_count || "local"} `
      + `expected_indexable=${report.public_profile_surface.expected_indexable_count || "local"} `
      + `findings=${report.public_profile_surface.findings.join("; ") || "none"}`
    );
  }

  if (strict && !ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
