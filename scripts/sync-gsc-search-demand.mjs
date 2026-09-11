"use strict";

import { createRequire } from "node:module";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || ".env" });

const require = createRequire(import.meta.url);
const { safeSlug } = require("../src/utils/text");
const { districtRows, landingAliasRows } = require("../src/data/publicMetadata");
const { SEARCH_DEMAND_INTENTS } = require("../src/services/landingContextService");
const { querySearchAnalytics, searchConsoleStatus } = require("../src/services/googleSearchConsoleService");

const DEFAULT_OUTPUT = "/var/lib/vip-gece/gsc-search-demand.json";
const args = process.argv.slice(2);

function argValue(name, fallback = "") {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).trim();
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : fallback;
}

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function hasSlugToken(querySlug, token) {
  return querySlug === token || querySlug.startsWith(`${token}-`) || querySlug.endsWith(`-${token}`) || querySlug.includes(`-${token}-`);
}

function locationTargets() {
  return [
    ...landingAliasRows().map((row) => ({ slug: row.slug, token: row.slug.replace(/-escort$/i, "") })),
    ...districtRows().map((row) => ({ slug: row.slug, token: row.slug.replace(/-escort$/i, "") })),
    { slug: "istanbul-escort", token: "istanbul" }
  ].sort((left, right) => right.token.length - left.token.length);
}

function intentTargets() {
  return Object.entries(SEARCH_DEMAND_INTENTS).map(([key, intent]) => ({
    key,
    tokens: [...new Set((intent.keywords || []).map((keyword) => safeSlug(keyword)).filter(Boolean))]
  }));
}

function aggregateRows(rows) {
  const locations = locationTargets();
  const intents = intentTargets();
  const totals = new Map();

  for (const row of rows || []) {
    const querySlug = safeSlug(row?.keys?.[0] || "");
    if (!querySlug) continue;

    const location = locations.find((candidate) => hasSlugToken(querySlug, candidate.token));
    if (!location) continue;

    const matchedIntents = intents.filter((intent) => intent.tokens.some((token) => hasSlugToken(querySlug, token)));
    if (!matchedIntents.length) continue;

    const impressions = Number(row.impressions || 0);
    const clicks = Number(row.clicks || 0);

    for (const intent of matchedIntents) {
      const id = `${location.slug}:${intent.key}`;
      const current = totals.get(id) || {
        slug: location.slug,
        key: intent.key,
        impressions: 0,
        clicks: 0
      };
      current.impressions += impressions;
      current.clicks += clicks;
      totals.set(id, current);
    }
  }

  const landings = {};
  for (const row of totals.values()) {
    if (row.impressions < 3 && row.clicks < 1) continue;
    row.score = row.impressions + (row.clicks * 25);
    landings[row.slug] ||= [];
    landings[row.slug].push(row);
  }

  for (const rowsForLanding of Object.values(landings)) {
    rowsForLanding.sort((left, right) => (right.score - left.score) || left.key.localeCompare(right.key, "tr"));
  }

  return landings;
}

async function writeAtomically(file, payload) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

async function main() {
  const output = path.resolve(argValue("--output", process.env.VIP_GECE_SEARCH_DEMAND_PATH || DEFAULT_OUTPUT));
  const startDate = argValue("--start-date", isoDateDaysAgo(92));
  const endDate = argValue("--end-date", isoDateDaysAgo(2));
  const status = searchConsoleStatus();

  if (!status.enabled || !status.configured || !status.actions.search_analytics) {
    throw new Error("Google Search Console Search Analytics is not active");
  }

  const analytics = await querySearchAnalytics({
    startDate,
    endDate,
    dimensions: ["query", "page"],
    rowLimit: 25000,
    searchType: "web"
  });
  const landings = aggregateRows(analytics.rows);
  const payload = {
    version: 1,
    source: "google_search_console",
    generated_at: new Date().toISOString(),
    start_date: startDate,
    end_date: endDate,
    raw_row_count: analytics.rows.length,
    landings
  };

  await writeAtomically(output, payload);
  console.log(`ok raw_rows=${analytics.rows.length} landing_count=${Object.keys(landings).length}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
