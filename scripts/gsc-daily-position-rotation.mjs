"use strict";

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  categoryRows,
  districtRows,
  districtSide,
  landingAliasRows
} = require("../src/data/publicMetadata");

const DEFAULT_OUT_DIR = "output/external-audits";
const DEFAULT_STATE_FILE = path.join(DEFAULT_OUT_DIR, "gsc-daily-position-rotation-state.json");
const DEFAULT_BATCH_SIZE = 40;
const DEFAULT_SITE_URL = "sc-domain:vip-gece.site";
const DEFAULT_ADC_PATH = path.join(os.homedir(), ".config/gcloud/application_default_credentials.json");

const args = process.argv.slice(2);

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const direct = args.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length).trim();
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : fallback;
}

function hasArg(name) {
  return args.includes(name);
}

function numberArg(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const raw = argValue(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function normalizeQuery(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
}

function safeSlug(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(file, payload) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function rowMatchesSide(row, side, includeCity) {
  if (!side || side === "all") return true;
  if (row.group === "istanbul") return includeCity;
  return row.side === side;
}

function allQueryRows({ side, includeCity, includeCategories, primaryOnly }) {
  const rows = [
    { group: "istanbul", name: "İstanbul", slug: "istanbul-escort", query: "istanbul escort" },
    ...districtRows().map((row) => ({
      group: "district",
      name: row.name,
      slug: row.slug,
      side: row.side || districtSide(row.name),
      query: `${String(row.name).toLocaleLowerCase("tr-TR")} escort`
    }))
  ];

  if (!primaryOnly) {
    rows.push(...landingAliasRows().map((row) => ({
      group: "semt",
      name: row.name,
      slug: row.slug,
      parent_district: row.parent_district,
      side: row.side || districtSide(row.parent_district),
      query: `${String(row.name).toLocaleLowerCase("tr-TR")} escort`
    })));
  }

  const filtered = rows.filter((row) => rowMatchesSide(row, side, includeCity));

  if (includeCategories) {
    filtered.push(...categoryRows().map((row) => ({
      group: "category",
      name: row.name,
      slug: row.slug,
      query: `${String(row.name).toLocaleLowerCase("tr-TR")}`
    })));
  }

  return filtered;
}

function configureFreeGscCredentialFallback() {
  if (!process.env.GOOGLE_SEARCH_CONSOLE_ENABLED && !process.env.GSC_ENABLED) {
    process.env.GOOGLE_SEARCH_CONSOLE_ENABLED = "true";
  }
  if (!process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL && !process.env.GSC_SITE_URL) {
    process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL = argValue("--site-url", DEFAULT_SITE_URL);
  }
  const hasCredential =
    process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIAL_JSON ||
    process.env.GSC_CREDENTIAL_JSON ||
    process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIAL_JSON_PATH ||
    process.env.GSC_CREDENTIAL_JSON_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!hasCredential && existsSync(DEFAULT_ADC_PATH)) {
    process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIAL_JSON_PATH = DEFAULT_ADC_PATH;
  }
}

function stateFingerprint(input) {
  return [
    "gsc",
    input.side,
    input.includeCity ? "city" : "no-city",
    input.includeCategories ? "categories" : "no-categories",
    input.primaryOnly ? "primary" : "all-local",
    String(input.batchSize),
    input.startDate,
    input.endDate
  ].join("|");
}

function rowsByQuery(gscRows = []) {
  const map = new Map();
  for (const row of gscRows) {
    const keys = Array.isArray(row.keys) ? row.keys : [];
    const query = normalizeQuery(keys[0]);
    const page = String(keys[1] || "");
    if (!query) continue;
    const current = map.get(query) || {
      query,
      pages: [],
      clicks: 0,
      impressions: 0,
      ctrWeighted: 0,
      positionWeighted: 0
    };
    const impressions = Number(row.impressions || 0);
    const clicks = Number(row.clicks || 0);
    current.clicks += clicks;
    current.impressions += impressions;
    current.ctrWeighted += Number(row.ctr || 0) * impressions;
    current.positionWeighted += Number(row.position || 0) * impressions;
    current.pages.push({
      page,
      clicks,
      impressions,
      ctr: Number(row.ctr || 0),
      position: Number(row.position || 0)
    });
    map.set(query, current);
  }

  for (const value of map.values()) {
    value.ctr = value.impressions ? value.ctrWeighted / value.impressions : 0;
    value.position = value.impressions ? value.positionWeighted / value.impressions : "";
    value.pages.sort((a, b) => (b.impressions - a.impressions) || (b.clicks - a.clicks));
  }

  return map;
}

async function writeOutputs(outBase, payload) {
  await mkdir(path.dirname(outBase), { recursive: true });
  const jsonPath = `${outBase}.json`;
  const csvPath = `${outBase}.csv`;
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  const header = [
    "checked_at",
    "source",
    "group",
    "name",
    "slug",
    "side",
    "parent_district",
    "query",
    "status",
    "avg_position",
    "clicks",
    "impressions",
    "ctr",
    "top_page",
    "top_page_position",
    "top_page_impressions"
  ];
  const lines = [header.join(",")];
  for (const row of payload.rows) {
    lines.push(header.map((field) => csvEscape(row[field])).join(","));
  }
  await writeFile(csvPath, `${lines.join("\n")}\n`);
}

async function main() {
  configureFreeGscCredentialFallback();
  const { querySearchAnalytics, searchConsoleStatus } = require("../src/services/googleSearchConsoleService");

  const side = argValue("--side", "all").toLowerCase();
  const includeCity = hasArg("--include-city") || side === "all";
  const includeCategories = hasArg("--include-categories");
  const primaryOnly = hasArg("--primary-only");
  const batchSize = numberArg("--batch-size", DEFAULT_BATCH_SIZE, 1, 1000);
  const date = argValue("--date", todayIsoDate());
  const endDate = argValue("--end-date", isoDateDaysAgo(2));
  const startDate = argValue("--start-date", isoDateDaysAgo(32));
  const outDir = argValue("--out-dir", DEFAULT_OUT_DIR);
  const stateFile = argValue("--state-file", DEFAULT_STATE_FILE);
  const force = hasArg("--force");
  const dryRun = hasArg("--dry-run");
  const explicitOffset = argValue("--offset", "");

  const scope = { side, includeCity, includeCategories, primaryOnly, batchSize, startDate, endDate };
  const fingerprint = stateFingerprint(scope);
  const queries = allQueryRows(scope);
  const totalQueries = queries.length;
  const totalBatches = Math.max(1, Math.ceil(totalQueries / batchSize));
  const existingState = await readJsonIfExists(stateFile);
  const sameScope = existingState?.fingerprint === fingerprint;
  const alreadyRanToday = sameScope && existingState?.last_run?.date === date && existingState?.last_run?.status === "success";

  if (alreadyRanToday && !force) {
    console.log(`already_ran_today date=${date} next_offset=${existingState.next_offset}`);
    console.log(`state=${stateFile}`);
    return;
  }

  let offset = explicitOffset ? numberArg("--offset", 0, 0) : (sameScope ? Math.max(0, Number(existingState?.next_offset || 0)) : 0);
  if (offset >= totalQueries) offset = 0;
  const limit = Math.min(batchSize, Math.max(0, totalQueries - offset));
  const selectedQueries = queries.slice(offset, offset + limit);
  const batchIndex = Math.floor(offset / batchSize) + 1;
  const outName = [
    "gsc-daily",
    date,
    `batch-${String(batchIndex).padStart(2, "0")}-of-${String(totalBatches).padStart(2, "0")}`,
    safeSlug(side || "all")
  ].join("-");
  const outBase = path.join(outDir, outName);
  const status = searchConsoleStatus();

  const plan = {
    date,
    source: "google_search_console",
    side,
    include_city: includeCity,
    include_categories: includeCategories,
    primary_only: primaryOnly,
    total_queries: totalQueries,
    batch_size: batchSize,
    batch_index: batchIndex,
    total_batches: totalBatches,
    offset,
    limit,
    next_offset_on_success: offset + limit >= totalQueries ? 0 : offset + limit,
    start_date: startDate,
    end_date: endDate,
    output_json: `${outBase}.json`,
    output_csv: `${outBase}.csv`,
    first_query: selectedQueries[0]?.query || "",
    last_query: selectedQueries.at(-1)?.query || "",
    gsc_mode: status.mode,
    gsc_configured: status.configured,
    gsc_enabled: status.enabled,
    credential_source: status.credential?.source || ""
  };

  console.log(JSON.stringify(plan, null, 2));
  if (dryRun) return;

  if (!status.configured || !status.enabled || !status.actions.search_analytics) {
    await writeJson(stateFile, {
      version: 1,
      updated_at: new Date().toISOString(),
      fingerprint,
      next_offset: offset,
      last_run: {
        ...plan,
        status: "blocked_gsc_not_active"
      }
    });
    throw new Error("Google Search Console credential is not active for Search Analytics");
  }

  const analytics = await querySearchAnalytics({
    startDate,
    endDate,
    dimensions: ["query", "page"],
    rowLimit: numberArg("--row-limit", 25000, 1, 25000),
    searchType: "web"
  });
  const byQuery = rowsByQuery(analytics.rows);
  const checkedAt = new Date().toISOString();
  const rows = selectedQueries.map((target) => {
    const found = byQuery.get(normalizeQuery(target.query));
    const topPage = found?.pages?.[0] || {};
    return {
      checked_at: checkedAt,
      source: "google_search_console",
      group: target.group,
      name: target.name,
      slug: target.slug,
      side: target.side || "",
      parent_district: target.parent_district || "",
      query: target.query,
      status: found ? "has_gsc_data" : "no_gsc_data",
      avg_position: found?.position || "",
      clicks: found?.clicks || 0,
      impressions: found?.impressions || 0,
      ctr: found?.ctr || 0,
      top_page: topPage.page || "",
      top_page_position: topPage.position || "",
      top_page_impressions: topPage.impressions || 0,
      page_rows: found?.pages || []
    };
  });

  const payload = {
    meta: {
      ...plan,
      checked_at: checkedAt,
      raw_gsc_rows: analytics.rows.length,
      note: "GSC average position is Google Search Console performance data, not a live neutral SERP scrape."
    },
    rows
  };

  await writeOutputs(outBase, payload);
  await writeJson(stateFile, {
    version: 1,
    updated_at: new Date().toISOString(),
    fingerprint,
    next_offset: plan.next_offset_on_success,
    last_run: {
      ...plan,
      status: "success",
      rows_with_data: rows.filter((row) => row.status === "has_gsc_data").length,
      rows_without_data: rows.filter((row) => row.status === "no_gsc_data").length
    }
  });

  const foundCount = rows.filter((row) => row.status === "has_gsc_data").length;
  console.log(`gsc_rows=${analytics.rows.length} matched_targets=${foundCount}/${rows.length}`);
  console.log(`json=${payload.meta.output_json}`);
  console.log(`csv=${payload.meta.output_csv}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
