"use strict";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  parseSitemapEntries,
  selectInspectionBatch,
  sitemapLastmodMap
} = require("../src/services/gscIndexSelectionService");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const origin = "https://vip-gece.site";
const xml = `<?xml version="1.0"?>
<urlset>
  <url><loc>${origin}/</loc><lastmod>2026-08-07</lastmod></url>
  <url><loc>${origin}/istanbul-escort</loc><lastmod>2026-08-08</lastmod></url>
  <url><loc>${origin}/istanbul-escort</loc><lastmod>2026-08-08</lastmod></url>
  <url><loc>https://example.com/foreign</loc><lastmod>2026-08-08</lastmod></url>
</urlset>`;
const parsed = parseSitemapEntries(xml, origin);
assert(parsed.length === 2, "sitemap selection must deduplicate and reject foreign origins");
assert(parsed[1].lastmod === "2026-08-08", "sitemap lastmod must be preserved");

const entries = Array.from({ length: 267 }, (_, index) => ({
  url: `${origin}/page-${index + 1}`,
  lastmod: "2026-08-07"
}));
const initial = selectInspectionBatch({ entries, batchSize: 50 });
assert(initial.selected.length === 50, "initial daily batch must contain 50 URLs");
assert(initial.changed.length === 0, "first run must not mark the entire sitemap changed");
assert(initial.rotation.length === 50, "first run must preserve full rotation capacity");
assert(initial.nextOffset === 50, "rotation offset must advance by the inspected inventory");
assert(initial.guaranteedFullCycleDays === 7, "267 URLs must have a seven-day worst-case rotation");

const previousState = {
  next_offset: 50,
  sitemap_lastmods: sitemapLastmodMap(entries)
};
const updated = entries.map((entry, index) => index >= 257
  ? { ...entry, lastmod: "2026-08-08" }
  : entry);
const prioritized = selectInspectionBatch({
  entries: updated,
  batchSize: 50,
  previousState
});
assert(prioritized.selected.length === 50, "prioritized batch must stay within the API budget");
assert(prioritized.changed.length === 10, "changed URL priority must be capped at twenty percent");
assert(prioritized.rotation.length === 40, "changed priority must reserve forty rotation slots");
assert(prioritized.selected[0].url === `${origin}/page-258`, "changed URLs must be inspected first");
assert(new Set(prioritized.selected.map((entry) => entry.url)).size === 50, "inspection batch must not duplicate URLs");

const all = selectInspectionBatch({ entries, batchSize: entries.length, inspectAll: true });
assert(all.selected.length === 267 && all.nextOffset === 0, "explicit full inspection must preserve all sitemap URLs");

console.log("ok GSC selection rotates 267 URLs and prioritizes sitemap changes within a 50 URL daily budget");
