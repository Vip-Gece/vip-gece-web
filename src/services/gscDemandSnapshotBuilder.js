"use strict";

const { districtRows, landingAliasRows } = require("../data/publicMetadata");
const { safeSlug } = require("../utils/text");
const { SEARCH_DEMAND_INTENTS } = require("./landingContextService");

const LANDING_SLUGS = new Set([
  "istanbul-escort",
  ...districtRows().map((row) => row.slug),
  ...landingAliasRows().map((row) => row.slug)
]);
const LOCATION_TERMS = [...districtRows(), ...landingAliasRows()]
  .map((row) => ({ slug: row.slug, term: safeSlug(row.name) }))
  .sort((left, right) => right.term.length - left.term.length);

function measurementIntent(query, field) {
  const unit = field === "height" ? "(?:cm|santim|boy)" : "(?:kg|kilo)";
  const before = query.match(new RegExp(`(?:^|-)(\\d{2,3})-${unit}(?:-|$)`));
  const after = query.match(new RegExp(`(?:^|-)${unit}-(\\d{2,3})(?:-|$)`));
  const value = Number(before?.[1] || after?.[1]);

  if (field === "height") {
    if (value >= 180 && value <= 220) return "boy180";
    if (value >= 170) return "boy170";
    if (value >= 160) return "boy160";
    if (value >= 120) return "boyKisa";
  } else {
    if (value >= 80 && value <= 250) return "kilo80";
    if (value >= 70) return "kilo70";
    if (value >= 60) return "kilo60";
    if (value >= 50) return "kilo50";
    if (value >= 30) return "kiloHafif";
  }

  return "";
}

function queryIntentKeys(query) {
  const withoutBrand = safeSlug(query).replace(/(^|-)vip-gece(?=-|$)/g, "$1");
  const normalized = `-${withoutBrand.replace(/^-|-$/g, "")}-`;
  if (normalized === "--") return [];

  const keys = Object.entries(SEARCH_DEMAND_INTENTS)
    .filter(([, intent]) => Array.isArray(intent.keywords))
    .filter(([, intent]) => intent.keywords.some((keyword) => {
      const phrase = safeSlug(keyword);
      return phrase && normalized.includes(`-${phrase}-`);
    }))
    .map(([key]) => key);

  for (const field of ["height", "weight"]) {
    const key = measurementIntent(normalized.slice(1, -1), field);
    if (key) keys.push(key);
  }

  return [...new Set(keys)];
}

function queryLandingSlug(query) {
  const normalized = `-${safeSlug(query)}-`;
  const matches = LOCATION_TERMS.filter(({ term }) => normalized.includes(`-${term}-`));
  return matches.length === 1 ? matches[0].slug : "";
}

function isOwnedPage(page) {
  try {
    const url = new URL(page);
    return ["vip-gece.site", "www.vip-gece.site"].includes(url.hostname);
  } catch {
    return false;
  }
}

function landingSlugFromPage(page) {
  if (!isOwnedPage(page)) return "";
  const slug = new URL(page).pathname.replace(/^\/+|\/+$/g, "");
  return LANDING_SLUGS.has(slug) ? slug : "";
}

function buildGscDemandSnapshot(rows, { startDate, endDate, generatedAt = new Date().toISOString() }) {
  const byLanding = new Map();
  let matchedRows = 0;

  for (const row of rows) {
    const [page, query] = Array.isArray(row?.keys) ? row.keys : [];
    if (!isOwnedPage(page)) continue;
    const slug = queryLandingSlug(query) || landingSlugFromPage(page);
    const impressions = Number(row?.impressions);
    if (!slug || !query || !Number.isFinite(impressions) || impressions <= 0) continue;

    const keys = queryIntentKeys(query);
    if (!keys.length) continue;
    matchedRows += 1;

    const demand = byLanding.get(slug) || new Map();
    for (const key of keys) {
      const previous = demand.get(key) || { key, impressions: 0, clicks: 0, query_count: 0 };
      demand.set(key, {
        key,
        impressions: previous.impressions + impressions,
        clicks: previous.clicks + Math.max(0, Number(row.clicks) || 0),
        query_count: previous.query_count + 1
      });
    }
    byLanding.set(slug, demand);
  }

  const landings = Object.fromEntries(
    [...byLanding.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([slug, demand]) => [slug, [...demand.values()].sort((left, right) => (
        right.impressions - left.impressions || right.clicks - left.clicks || left.key.localeCompare(right.key)
      ))])
  );

  return {
    version: 1,
    source: "google_search_console",
    generated_at: generatedAt,
    start_date: startDate,
    end_date: endDate,
    raw_row_count: rows.length,
    matched_row_count: matchedRows,
    landings
  };
}

module.exports = { buildGscDemandSnapshot, queryIntentKeys, landingSlugFromPage, queryLandingSlug };
