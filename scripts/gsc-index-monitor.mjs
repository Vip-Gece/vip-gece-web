"use strict";

import { createRequire } from "node:module";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || ".env" });

const require = createRequire(import.meta.url);
const {
  querySearchAnalytics,
  runDiscoverySync,
  searchConsoleStatus
} = require("../src/services/googleSearchConsoleService");
const {
  parseSitemapEntries,
  selectInspectionBatch,
  sitemapLastmodMap
} = require("../src/services/gscIndexSelectionService");

const args = process.argv.slice(2);
const DEFAULT_SITE = "https://vip-gece.site";
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_STATE = process.env.VIP_GECE_GSC_MONITOR_STATE_PATH ||
  "output/external-audits/gsc-index-monitor-state.json";
const DEFAULT_REPORT = process.env.VIP_GECE_GSC_MONITOR_REPORT_PATH ||
  "output/external-audits/gsc-index-monitor-latest.json";

function argValue(name, fallback = "") {
  const direct = args.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).trim();
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : fallback;
}

function hasArg(name) {
  return args.includes(name);
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeSite(value) {
  const parsed = new URL(String(value || DEFAULT_SITE));
  if (parsed.protocol !== "https:") throw new Error("site must use https");
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = "/";
  return parsed.origin;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "VIP-Gece-GSC-Index-Monitor/1.0" },
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return text;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file, payload) {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function summarizeInspections(rows) {
  const summary = { total: rows.length, pass: 0, neutral: 0, fail: 0, api_error: 0 };
  for (const row of rows) {
    if (row.ok === false) summary.api_error += 1;
    else if (row.verdict === "PASS") summary.pass += 1;
    else if (row.verdict === "NEUTRAL") summary.neutral += 1;
    else summary.fail += 1;
  }
  return summary;
}

async function main() {
  const site = normalizeSite(argValue("--site", process.env.SITE_URL || DEFAULT_SITE));
  const sitemap = `${site}/sitemap.xml`;
  const imageSitemap = `${site}/image-sitemap.xml`;
  const statePath = argValue("--state", DEFAULT_STATE);
  const reportPath = argValue("--report", DEFAULT_REPORT);
  const dryRun = hasArg("--dry-run");
  const inspectAll = hasArg("--all");
  const status = searchConsoleStatus();

  const [sitemapXml] = await Promise.all([fetchText(sitemap), fetchText(imageSitemap)]);
  const entries = parseSitemapEntries(sitemapXml, site);
  const urls = entries.map((entry) => entry.url);
  if (!entries.length) throw new Error("sitemap has no same-origin URLs");

  const previousState = await readJson(statePath);
  const requestedBatch = inspectAll
    ? urls.length
    : boundedInteger(argValue("--batch-size", DEFAULT_BATCH_SIZE), DEFAULT_BATCH_SIZE, 1, 50);
  const explicitOffset = argValue("--offset", "");
  const selection = selectInspectionBatch({
    entries,
    batchSize: requestedBatch,
    previousState,
    explicitOffset: explicitOffset === "" ? null : Number(explicitOffset),
    inspectAll
  });
  const selected = selection.selected.map((entry) => entry.url);
  const nextOffset = selection.nextOffset;

  const plan = {
    site,
    sitemap_url: sitemap,
    image_sitemap_url: imageSitemap,
    sitemap_url_count: urls.length,
    inspection_offset: selection.offset,
    inspection_batch_size: selected.length,
    priority_changed_count: selection.changed.length,
    rotation_count: selection.rotation.length,
    guaranteed_full_cycle_days: selection.guaranteedFullCycleDays,
    next_offset: nextOffset,
    inspection_urls: selected,
    policy: "Sitemaps API + URL Inspection + Search Analytics; no Indexing API request"
  };

  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      gsc_configured: status.configured,
      gsc_enabled: status.enabled,
      ...plan
    }, null, 2));
    return;
  }

  if (!status.configured || !status.enabled) {
    throw new Error("Google Search Console credential is not active");
  }

  const [discovery, analytics] = await Promise.all([
    runDiscoverySync({
      sitemaps: [sitemap, imageSitemap],
      urls: selected,
      allowExtendedInspectionLimit: inspectAll,
      inspectLimit: selected.length,
      inspectConcurrency: boundedInteger(argValue("--concurrency", 2), 2, 1, 4)
    }),
    querySearchAnalytics({
      startDate: argValue("--start-date", isoDateDaysAgo(32)),
      endDate: argValue("--end-date", isoDateDaysAgo(2)),
      dimensions: ["query", "page"],
      rowLimit: 25000,
      searchType: "web"
    })
  ]);

  const inspected = discovery.inspected_urls || [];
  const payload = {
    ok: discovery.ok,
    checked_at: new Date().toISOString(),
    ...plan,
    submitted_sitemaps: discovery.submitted_sitemaps,
    inspection_summary: summarizeInspections(inspected),
    inspections: inspected.map((row) => ({
      ok: row.ok,
      inspection_url: row.inspection_url,
      inspection_attempts: row.inspection_attempts || 1,
      verdict: row.verdict || "",
      coverage_state: row.coverage_state || "",
      indexing_state: row.indexing_state || "",
      page_fetch_state: row.page_fetch_state || "",
      robots_txt_state: row.robots_txt_state || "",
      last_crawl_time: row.last_crawl_time || "",
      user_canonical: row.user_canonical || "",
      google_canonical: row.google_canonical || "",
      error: row.error || "",
      google_status: row.google_status || 0
    })),
    search_analytics: {
      start_date: analytics.request.startDate,
      end_date: analytics.request.endDate,
      row_count: analytics.rows.length,
      rows: analytics.rows
    }
  };

  await writeJsonAtomic(reportPath, payload);
  if (discovery.ok) {
    await writeJsonAtomic(statePath, {
      version: 2,
      updated_at: payload.checked_at,
      last_successful_run: payload.checked_at,
      sitemap_url_count: urls.length,
      sitemap_lastmods: sitemapLastmodMap(entries),
      next_offset: nextOffset,
      last_report: path.resolve(reportPath)
    });
  }

  console.log(JSON.stringify({
    ok: payload.ok,
    sitemap_url_count: payload.sitemap_url_count,
    submitted_sitemaps: payload.submitted_sitemaps,
    inspection_summary: payload.inspection_summary,
    priority_changed_count: payload.priority_changed_count,
    rotation_count: payload.rotation_count,
    guaranteed_full_cycle_days: payload.guaranteed_full_cycle_days,
    search_analytics_rows: payload.search_analytics.row_count,
    next_offset: payload.next_offset,
    report: path.resolve(reportPath)
  }, null, 2));

  if (!payload.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
