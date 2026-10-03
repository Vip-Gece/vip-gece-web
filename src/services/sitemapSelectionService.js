"use strict";

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function normalizeSameOriginUrl(value, siteOrigin) {
  try {
    const parsed = new URL(decodeXml(value).trim());
    if (parsed.origin !== siteOrigin) return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function parseSitemapEntries(xml, site) {
  const siteOrigin = new URL(site).origin;
  const blocks = [...String(xml || "").matchAll(/<url\b[\s\S]*?<\/url>/gi)]
    .map((match) => match[0]);
  const source = blocks.length
    ? blocks
    : [...String(xml || "").matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
      .map((match) => `<url><loc>${match[1]}</loc></url>`);
  const seen = new Set();
  const entries = [];

  for (const block of source) {
    const locMatch = block.match(/<loc>([\s\S]*?)<\/loc>/i);
    const lastmodMatch = block.match(/<lastmod>([\s\S]*?)<\/lastmod>/i);
    const url = normalizeSameOriginUrl(locMatch?.[1] || "", siteOrigin);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    entries.push({
      url,
      lastmod: decodeXml(lastmodMatch?.[1] || "").trim()
    });
  }

  return entries;
}

function sitemapLastmodMap(entries) {
  return Object.fromEntries(entries.map((entry) => [entry.url, entry.lastmod || ""]));
}

function boundedOffset(value, total) {
  if (!total) return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return 0;
  return ((parsed % total) + total) % total;
}

function validTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function changedEntries(entries, previousState) {
  const previousLastmods = previousState?.sitemap_lastmods;
  if (previousLastmods && typeof previousLastmods === "object" && !Array.isArray(previousLastmods)) {
    return entries.filter((entry) =>
      !Object.prototype.hasOwnProperty.call(previousLastmods, entry.url) ||
      String(previousLastmods[entry.url] || "") !== String(entry.lastmod || ""));
  }

  const previousRun = validTimestamp(previousState?.last_successful_run || previousState?.updated_at);
  if (previousRun === null) return [];
  return entries.filter((entry) => {
    const modified = validTimestamp(entry.lastmod);
    return modified !== null && modified > previousRun;
  });
}

function sortChanged(entries) {
  return [...entries].sort((left, right) => {
    const leftTime = validTimestamp(left.lastmod) ?? 0;
    const rightTime = validTimestamp(right.lastmod) ?? 0;
    return rightTime - leftTime || left.url.localeCompare(right.url, "tr");
  });
}

function selectInspectionBatch({
  entries,
  batchSize,
  previousState = null,
  explicitOffset = null,
  inspectAll = false,
  changedShare = 0.2
}) {
  const total = entries.length;
  if (!total) throw new Error("sitemap entries are required");
  const requested = Math.max(1, Math.min(total, Number(batchSize) || 1));
  const offset = inspectAll
    ? 0
    : boundedOffset(explicitOffset ?? previousState?.next_offset ?? 0, total);

  if (inspectAll) {
    return {
      offset,
      nextOffset: 0,
      selected: [...entries],
      changed: [],
      rotation: [...entries],
      changedLimit: 0,
      guaranteedFullCycleDays: 1
    };
  }

  const changedLimit = requested > 1
    ? Math.min(requested - 1, Math.max(1, Math.floor(requested * changedShare)))
    : 0;
  const changed = sortChanged(changedEntries(entries, previousState)).slice(0, changedLimit);
  const selectedUrls = new Set(changed.map((entry) => entry.url));
  const rotation = [];
  let traversed = 0;

  while (changed.length + rotation.length < requested && traversed < total) {
    const entry = entries[(offset + traversed) % total];
    traversed += 1;
    if (selectedUrls.has(entry.url)) continue;
    selectedUrls.add(entry.url);
    rotation.push(entry);
  }

  const selected = [...changed, ...rotation];
  const nextOffset = (offset + Math.max(1, traversed)) % total;
  const guaranteedRotationPerRun = Math.max(1, requested - changedLimit);

  return {
    offset,
    nextOffset,
    selected,
    changed,
    rotation,
    changedLimit,
    guaranteedFullCycleDays: Math.ceil(total / guaranteedRotationPerRun)
  };
}

module.exports = {
  parseSitemapEntries,
  selectInspectionBatch,
  sitemapLastmodMap
};
