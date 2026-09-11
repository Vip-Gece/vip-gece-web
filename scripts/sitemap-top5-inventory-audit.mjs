"use strict";

import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { resolveLandingTarget } = require("../src/services/landingContextService");

const args = process.argv.slice(2);
const DEFAULT_SITE = "https://vip-gece.site";
const DEFAULT_OUT_DIR = "output/external-audits";

function argValue(name, fallback = "") {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).trim();
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : fallback;
}

function hasArg(name) {
  return args.includes(name);
}

function numberArg(name, fallback, min, max) {
  const raw = argValue(name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeQuery(value) {
  return normalizeText(value).toLocaleLowerCase("tr-TR");
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

function stripTags(value) {
  return normalizeText(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

function firstMatch(value, pattern) {
  const match = String(value || "").match(pattern);
  return normalizeText(match?.[1] || "");
}

function attributeValue(tag, name) {
  const match = String(tag || "").match(new RegExp(`${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return normalizeText(match?.[2] || "");
}

function metaContent(html, attribute, value) {
  const wanted = String(value || "").toLowerCase();
  for (const tag of String(html || "").match(/<meta\b[^>]*>/gi) || []) {
    if (attributeValue(tag, attribute).toLowerCase() === wanted) return attributeValue(tag, "content");
  }
  return "";
}

function canonicalHref(html) {
  for (const tag of String(html || "").match(/<link\b[^>]*>/gi) || []) {
    if (attributeValue(tag, "rel").toLowerCase() === "canonical") return attributeValue(tag, "href");
  }
  return "";
}

function parseSitemap(xml) {
  return [...String(xml || "").matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
    .map((match) => normalizeText(match[1]).replace(/&amp;/g, "&"))
    .filter(Boolean);
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

async function fetchResult(url, accept = "text/html") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: accept, "User-Agent": "VIP-Gece-267-URL-Audit/2026-08-06" }
    });
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get("content-type") || "",
      xRobotsTag: response.headers.get("x-robots-tag") || "",
      body: await response.text()
    };
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit(items, limit, mapper, label) {
  const results = new Array(items.length);
  let next = 0;
  let completed = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
      completed += 1;
      if (completed % 25 === 0 || completed === items.length) {
        console.error(`${label} ${completed}/${items.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function staticTarget(pathname) {
  return new Map([
    ["/", { pageType: "home", query: "vip gece" }],
    ["/ilanlar", { pageType: "static", query: "istanbul escort ilanları" }],
    ["/kategoriler", { pageType: "static", query: "istanbul escort kategorileri" }],
    ["/iletisim", { pageType: "static", query: "vip gece iletişim" }],
    ["/guven-ve-politikalar", { pageType: "static", query: "vip gece güven ve politikalar" }]
  ]).get(pathname) || { pageType: "static", query: `vip gece ${pathname.replace(/[\/-]+/g, " ").trim()}` };
}

function plannedTarget(url, profilesByPath) {
  const pathname = new URL(url).pathname.replace(/\/+$/, "") || "/";
  if (pathname.startsWith("/profil/")) {
    const profile = profilesByPath.get(pathname) || {};
    const name = normalizeText(profile.name || pathname.split("/").pop().replace(/-/g, " "));
    return { pageType: "profile", query: `${name.toLocaleLowerCase("tr-TR")} vip gece` };
  }

  if (pathname.endsWith("-escort")) {
    const slug = pathname.slice(1);
    const target = resolveLandingTarget(slug);
    const name = normalizeText(
      target?.district?.name ||
      target?.category?.name ||
      slug.replace(/-escort$/i, "").replace(/-/g, " ")
    );
    const pageType = target?.type === "city"
      ? "city"
      : (target?.district?.is_alias ? "semt" : (target?.type === "category" ? "category" : "district"));
    const query = /escort$/i.test(name) ? name : `${name} escort`;
    return { pageType, query: query.toLocaleLowerCase("tr-TR") };
  }

  return staticTarget(pathname);
}

function aggregateGsc(rows) {
  const byPage = new Map();
  const byQuery = new Map();
  for (const row of rows || []) {
    const query = normalizeQuery(row.keys?.[0]);
    const page = normalizeUrl(row.keys?.[1]);
    if (!query || !page) continue;
    const item = {
      query,
      page,
      clicks: Number(row.clicks || 0),
      impressions: Number(row.impressions || 0),
      ctr: Number(row.ctr || 0),
      position: Number(row.position || 0)
    };
    if (!byPage.has(page)) byPage.set(page, []);
    if (!byQuery.has(query)) byQuery.set(query, []);
    byPage.get(page).push(item);
    byQuery.get(query).push(item);
  }
  for (const list of [...byPage.values(), ...byQuery.values()]) {
    list.sort((a, b) => (b.impressions - a.impressions) || (b.clicks - a.clicks) || (a.position - b.position));
  }
  return { byPage, byQuery };
}

function technicalAudit(url, result) {
  const title = stripTags(firstMatch(result.body, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = metaContent(result.body, "name", "description");
  const robots = metaContent(result.body, "name", "robots");
  const canonical = canonicalHref(result.body);
  const h1 = stripTags(firstMatch(result.body, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i));
  const findings = [];
  if (result.status !== 200) findings.push(`HTTP ${result.status}`);
  if (normalizeUrl(result.finalUrl) !== normalizeUrl(url)) findings.push(`redirect ${result.finalUrl}`);
  if (!title) findings.push("missing title");
  if (!description) findings.push("missing description");
  if (!canonical || normalizeUrl(canonical) !== normalizeUrl(url)) findings.push(`canonical ${canonical || "missing"}`);
  if (/noindex/i.test(`${robots} ${result.xRobotsTag}`)) findings.push("noindex");
  if (!h1) findings.push("missing h1");
  return { title, description, robots, canonical, h1, findings };
}

function goalStatus({ technicalOk, inspection, targetRow, targetTopPage, url, minimumImpressions, targetPosition }) {
  if (!technicalOk) return "technical_failure";
  if (inspection && (inspection.ok === false || inspection.verdict === "ERROR")) return "inspection_error";
  if (inspection && inspection.verdict !== "PASS") return "not_indexed";
  if (!targetRow && targetTopPage && targetTopPage.page !== normalizeUrl(url)) return "cannibalized";
  if (!targetRow) return "no_query_data";
  if (targetTopPage && targetTopPage.page !== normalizeUrl(url)) return "cannibalized";
  if (targetRow.position > targetPosition) return "outside_top5";
  if (targetRow.impressions < minimumImpressions) return "top5_low_sample";
  return "top5_validated";
}

function summarize(rows) {
  const statuses = {};
  const pageTypes = {};
  for (const row of rows) {
    statuses[row.goal_status] = (statuses[row.goal_status] || 0) + 1;
    pageTypes[row.page_type] = (pageTypes[row.page_type] || 0) + 1;
  }
  return {
    total: rows.length,
    technical_ok: rows.filter((row) => row.technical_ok).length,
    indexed: rows.filter((row) => row.inspection_verdict === "PASS").length,
    with_gsc_page_data: rows.filter((row) => row.best_query).length,
    top5_validated: statuses.top5_validated || 0,
    statuses,
    page_types: pageTypes
  };
}

async function writeOutputs(base, payload) {
  await mkdir(path.dirname(base), { recursive: true });
  const jsonPath = `${base}.json`;
  const csvPath = `${base}.csv`;
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  const fields = [
    "url", "page_type", "target_query", "goal_status", "technical_ok", "status", "canonical",
    "title", "h1", "inspection_verdict", "inspection_attempts", "coverage_state", "last_crawl_time",
    "page_fetch_state", "robots_txt_state", "indexing_state", "google_canonical", "inspection_user_canonical", "best_query",
    "best_query_position", "best_query_impressions", "target_position", "target_impressions",
    "target_query_top_page", "findings"
  ];
  const lines = [fields.join(",")];
  for (const row of payload.rows) lines.push(fields.map((field) => csvEscape(row[field])).join(","));
  await writeFile(csvPath, `${lines.join("\n")}\n`);
  return { jsonPath, csvPath };
}

async function inspectWithRetry(inspectUrl, url, attempts) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return { ...(await inspectUrl(url)), inspection_attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 750 * (2 ** (attempt - 1)))));
      }
    }
  }
  return {
    ok: false,
    inspection_url: url,
    verdict: "ERROR",
    inspection_attempts: attempts,
    coverage_state: lastError?.message || "inspection failed"
  };
}

async function main() {
  const site = argValue("--site", process.env.SITE_URL || DEFAULT_SITE).replace(/\/+$/, "");
  const inspect = hasArg("--inspect");
  const inspectionAttempts = numberArg("--inspection-attempts", 3, 1, 5);
  const targetPosition = numberArg("--target-position", 5, 1, 100);
  const minimumImpressions = numberArg("--minimum-impressions", 10, 1, 1000000);
  const startDate = argValue("--start-date", "2026-07-04");
  const endDate = argValue("--end-date", "2026-08-03");
  const sitemapResult = await fetchResult(`${site}/sitemap.xml`, "application/xml,text/xml");
  const urls = parseSitemap(sitemapResult.body).map(normalizeUrl);
  if (!urls.length) throw new Error("Sitemap URL listesi bos");

  const profileResult = await fetchResult(`${site}/api/v1/public/profiles`, "application/json");
  const profilePayload = JSON.parse(profileResult.body);
  const profilesByPath = new Map((profilePayload.profiles || []).map((profile) => [
    `/profil/${String(profile.slug || "").replace(/^\/+/, "")}`,
    profile
  ]));

  const { querySearchAnalytics, inspectUrl, searchConsoleStatus } = require("../src/services/googleSearchConsoleService");
  const gscStatus = searchConsoleStatus();
  if (!gscStatus.configured || !gscStatus.enabled) throw new Error("Google Search Console aktif degil");
  const analytics = await querySearchAnalytics({
    startDate,
    endDate,
    dimensions: ["query", "page"],
    rowLimit: 25000,
    searchType: "web"
  });
  const gsc = aggregateGsc(analytics.rows);

  const technical = await mapLimit(urls, numberArg("--concurrency", 8, 1, 16), async (url) => {
    try {
      const result = await fetchResult(url);
      return { url, result, audit: technicalAudit(url, result) };
    } catch (error) {
      return {
        url,
        result: { status: 0, finalUrl: url },
        audit: { title: "", description: "", robots: "", canonical: "", h1: "", findings: [error.message || "fetch failed"] }
      };
    }
  }, "technical");

  const inspections = inspect
    ? await mapLimit(urls, numberArg("--inspection-concurrency", 4, 1, 8), async (url) => {
      return inspectWithRetry(inspectUrl, url, inspectionAttempts);
    }, "inspection")
    : [];
  const inspectionByUrl = new Map(inspections.map((row) => [normalizeUrl(row.inspection_url), row]));

  const rows = technical.map(({ url, result, audit }) => {
    const planned = plannedTarget(url, profilesByPath);
    const pageRows = gsc.byPage.get(url) || [];
    const best = pageRows[0] || {};
    const targetQuery = planned.pageType === "profile" && best.query ? best.query : normalizeQuery(planned.query);
    const targetRows = gsc.byQuery.get(targetQuery) || [];
    const targetRow = targetRows.find((row) => row.page === url) || null;
    const targetTopPage = targetRows[0] || null;
    const inspection = inspectionByUrl.get(url) || null;
    const technicalOk = audit.findings.length === 0;
    return {
      url,
      page_type: planned.pageType,
      target_query: targetQuery,
      goal_status: goalStatus({ technicalOk, inspection, targetRow, targetTopPage, url, minimumImpressions, targetPosition }),
      technical_ok: technicalOk,
      status: result.status,
      final_url: result.finalUrl,
      canonical: audit.canonical,
      robots: audit.robots,
      title: audit.title,
      h1: audit.h1,
      inspection_verdict: inspection?.verdict || "",
      inspection_attempts: inspection?.inspection_attempts || "",
      coverage_state: inspection?.coverage_state || "",
      last_crawl_time: inspection?.last_crawl_time || "",
      page_fetch_state: inspection?.page_fetch_state || "",
      robots_txt_state: inspection?.robots_txt_state || "",
      indexing_state: inspection?.indexing_state || "",
      google_canonical: inspection?.google_canonical || "",
      inspection_user_canonical: inspection?.user_canonical || "",
      best_query: best.query || "",
      best_query_position: best.position || "",
      best_query_impressions: best.impressions || 0,
      target_position: targetRow?.position || "",
      target_impressions: targetRow?.impressions || 0,
      target_query_top_page: targetTopPage?.page || "",
      findings: audit.findings
    };
  });

  const date = new Date().toISOString().slice(0, 10);
  const outDir = argValue("--out-dir", DEFAULT_OUT_DIR);
  const outBase = path.join(outDir, argValue("--out", `sitemap-top5-inventory-${date}`));
  const payload = {
    meta: {
      generated_at: new Date().toISOString(),
      site,
      sitemap_url_count: urls.length,
      gsc_start_date: startDate,
      gsc_end_date: endDate,
      gsc_raw_rows: analytics.rows.length,
      url_inspection_enabled: inspect,
      inspection_attempts: inspectionAttempts,
      target_position: targetPosition,
      minimum_impressions: minimumImpressions,
      note: "A URL succeeds only when it is technically clean, indexed when inspection is enabled, owns its target query, has average position <= 5 and at least the minimum impressions."
    },
    summary: summarize(rows),
    rows
  };
  const outputs = await writeOutputs(outBase, payload);
  console.log(JSON.stringify({ ...payload.meta, ...payload.summary, ...outputs }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
