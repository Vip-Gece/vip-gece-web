"use strict";

const DEFAULT_SITE_URL = "https://vip-gece.site";
const DEFAULT_PUBLIC_PATHS = ["/", "/kategoriler", "/istanbul-escort"];
const DEFAULT_PRIVATE_PATHS = ["/config.js", "/admin.js"];
const EDGE_READY_STATUSES = new Set(["HIT", "REVALIDATED", "STALE", "UPDATING"]);
const AUDIT_USER_AGENT = process.env.LIVE_AUDIT_USER_AGENT || "VIP-Gece-Cloudflare-Cache-Check/2026-06-27";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const jsonOnly = args.includes("--json");
const siteArg = args.find((item) => item.startsWith("--site="));
const publicArg = args.find((item) => item.startsWith("--public-paths="));
const privateArg = args.find((item) => item.startsWith("--private-paths="));
const attemptsArg = args.find((item) => item.startsWith("--attempts="));
const waitArg = args.find((item) => item.startsWith("--wait-ms="));

function normalizeSiteUrl(raw) {
  const parsed = new URL(String(raw || DEFAULT_SITE_URL).trim());
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("site url must use http or https");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function parsePathList(arg, defaults) {
  if (!arg) return defaults;
  return arg
    .slice(arg.indexOf("=") + 1)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.startsWith("/") ? item : `/${item}`);
}

function parsePositiveInt(arg, fallback) {
  if (!arg) return fallback;
  const value = Number.parseInt(arg.slice(arg.indexOf("=") + 1), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headerObject(headers) {
  return {
    "cache-control": headers.get("cache-control") || "",
    "cdn-cache-control": headers.get("cdn-cache-control") || "",
    "cloudflare-cdn-cache-control": headers.get("cloudflare-cdn-cache-control") || "",
    "cf-cache-status": headers.get("cf-cache-status") || "",
    age: headers.get("age") || "",
    etag: headers.get("etag") || "",
    "last-modified": headers.get("last-modified") || "",
    "set-cookie": headers.get("set-cookie") ? "[present]" : ""
  };
}

function absoluteUrl(siteUrl, pathName) {
  return `${siteUrl}${pathName.startsWith("/") ? pathName : `/${pathName}`}`;
}

async function fetchProbe(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/javascript,text/plain;q=0.9,*/*;q=0.8",
      "User-Agent": AUDIT_USER_AGENT
    }
  });
  await response.arrayBuffer();
  return {
    status: response.status,
    ok: response.ok,
    final_url: response.url,
    headers: headerObject(response.headers)
  };
}

async function probePath(siteUrl, pathName, attempts, waitMs) {
  const url = absoluteUrl(siteUrl, pathName);
  const results = [];
  for (let index = 0; index < attempts; index += 1) {
    if (index > 0 && waitMs > 0) await sleep(waitMs);
    try {
      results.push(await fetchProbe(url));
    } catch (error) {
      results.push({
        status: 0,
        ok: false,
        final_url: url,
        error: error.message || "fetch failed",
        headers: {}
      });
    }
  }
  return {
    path: pathName,
    url,
    attempts: results
  };
}

function containsAny(value, needles) {
  const haystack = String(value || "").toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

function publicSummary(pathReport) {
  const statuses = pathReport.attempts.map((item) => String(item.headers["cf-cache-status"] || "").toUpperCase());
  const last = pathReport.attempts[pathReport.attempts.length - 1] || { headers: {} };
  const cacheControl = last.headers["cache-control"] || "";
  const cdnCacheControl = last.headers["cdn-cache-control"] || "";
  const cloudflareCacheControl = last.headers["cloudflare-cdn-cache-control"] || "";
  const findings = [];
  const originReady = containsAny(cacheControl, ["public"]) &&
    containsAny(`${cdnCacheControl} ${cloudflareCacheControl}`, ["max-age="]) &&
    !containsAny(`${cacheControl} ${cdnCacheControl} ${cloudflareCacheControl}`, ["no-store", "private"]);
  const edgeReady = statuses.some((status) => EDGE_READY_STATUSES.has(status));

  if (!pathReport.attempts.some((item) => item.status > 0)) findings.push("no HTTP response");
  if (!originReady) findings.push("origin cache headers are not ready for shared cache");
  if (last.headers["set-cookie"]) findings.push("public HTML response exposes Set-Cookie");
  if (!edgeReady) findings.push(`Cloudflare edge HTML cache not proven yet; statuses=${statuses.filter(Boolean).join(",") || "missing"}`);

  return {
    path: pathReport.path,
    ok: originReady && edgeReady && findings.length === 0,
    origin_ready: originReady,
    edge_cache_ready: edgeReady,
    cf_cache_statuses: statuses,
    final_headers: last.headers,
    findings
  };
}

function privateSummary(pathReport) {
  const statuses = pathReport.attempts.map((item) => String(item.headers["cf-cache-status"] || "").toUpperCase());
  const last = pathReport.attempts[pathReport.attempts.length - 1] || { headers: {} };
  const cacheControl = last.headers["cache-control"] || "";
  const privateSafe = containsAny(cacheControl, ["no-store", "private", "no-cache"]) &&
    !statuses.some((status) => EDGE_READY_STATUSES.has(status));
  const findings = [];

  if (!pathReport.attempts.some((item) => item.status > 0)) findings.push("no HTTP response");
  if (!containsAny(cacheControl, ["no-store", "private", "no-cache"])) findings.push("private path lacks defensive cache-control");
  if (statuses.some((status) => EDGE_READY_STATUSES.has(status))) findings.push(`private path appears edge-cached; statuses=${statuses.join(",")}`);

  return {
    path: pathReport.path,
    ok: privateSafe && findings.length === 0,
    private_cache_safe: privateSafe,
    cf_cache_statuses: statuses,
    final_headers: last.headers,
    findings
  };
}

async function main() {
  const siteUrl = normalizeSiteUrl(siteArg ? siteArg.slice("--site=".length) : process.env.LIVE_SITE_URL);
  const publicPaths = parsePathList(publicArg, DEFAULT_PUBLIC_PATHS);
  const privatePaths = parsePathList(privateArg, DEFAULT_PRIVATE_PATHS);
  const attempts = parsePositiveInt(attemptsArg, 3);
  const waitMs = parsePositiveInt(waitArg, 600);

  const publicReports = [];
  for (const pathName of publicPaths) {
    publicReports.push(publicSummary(await probePath(siteUrl, pathName, attempts, waitMs)));
  }

  const privateReports = [];
  for (const pathName of privatePaths) {
    privateReports.push(privateSummary(await probePath(siteUrl, pathName, 1, waitMs)));
  }

  const publicOriginReady = publicReports.every((item) => item.origin_ready);
  const cloudflareHtmlCacheReady = publicReports.every((item) => item.edge_cache_ready);
  const privateCacheSafe = privateReports.every((item) => item.ok);
  const ok = publicOriginReady && cloudflareHtmlCacheReady && privateCacheSafe;
  const report = {
    ok,
    strict,
    site_url: siteUrl,
    checked_at: new Date().toISOString(),
    public_origin_ready: publicOriginReady,
    cloudflare_html_cache_ready: cloudflareHtmlCacheReady,
    cloudflare_cache_rule_needed: publicOriginReady && !cloudflareHtmlCacheReady,
    private_cache_safe: privateCacheSafe,
    attempts,
    wait_ms: waitMs,
    public: publicReports,
    private: privateReports
  };

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`site=${report.site_url}`);
    console.log(`public_origin_ready=${report.public_origin_ready}`);
    console.log(`cloudflare_html_cache_ready=${report.cloudflare_html_cache_ready}`);
    console.log(`cloudflare_cache_rule_needed=${report.cloudflare_cache_rule_needed}`);
    console.log(`private_cache_safe=${report.private_cache_safe}`);
    for (const item of report.public) {
      console.log(`public ${item.path}: origin_ready=${item.origin_ready} edge_cache_ready=${item.edge_cache_ready} cf=${item.cf_cache_statuses.join(",") || "missing"}`);
      for (const finding of item.findings) console.log(`  - ${finding}`);
    }
    for (const item of report.private) {
      console.log(`private ${item.path}: private_cache_safe=${item.private_cache_safe} cf=${item.cf_cache_statuses.join(",") || "missing"}`);
      for (const finding of item.findings) console.log(`  - ${finding}`);
    }
  }

  if (strict && !ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
