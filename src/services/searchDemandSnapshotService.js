"use strict";

const fs = require("fs");
const path = require("path");
const { safeSlug } = require("../utils/text");

const DEFAULT_SNAPSHOT_PATH = "/var/lib/vip-gece/gsc-search-demand.json";
const MAX_SNAPSHOT_AGE_MS = 72 * 60 * 60 * 1000;

let cache = {
  file: "",
  mtimeMs: -1,
  payload: null
};

function snapshotFile() {
  const configured = String(process.env.VIP_GECE_SEARCH_DEMAND_PATH || "").trim();
  return path.resolve(configured || DEFAULT_SNAPSHOT_PATH);
}

function normalizedLandingSlug(value) {
  const base = safeSlug(String(value || "").replace(/-escort$/i, ""));
  return base ? `${base}-escort` : "";
}

function validPayload(payload) {
  return Boolean(
    payload &&
    payload.version === 1 &&
    ["search_provider", "google_search_console"].includes(payload.source) &&
    Number.isFinite(Date.parse(payload.generated_at)) &&
    payload.landings &&
    typeof payload.landings === "object" &&
    !Array.isArray(payload.landings)
  );
}

function freshPayload(payload) {
  const ageMs = Date.now() - Date.parse(payload?.generated_at);
  return Boolean(payload && ageMs >= 0 && ageMs <= MAX_SNAPSHOT_AGE_MS);
}

function readSnapshot() {
  const file = snapshotFile();

  try {
    const stat = fs.statSync(file);
    if (cache.file === file && cache.mtimeMs === stat.mtimeMs) {
      return cache.payload;
    }

    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    cache = {
      file,
      mtimeMs: stat.mtimeMs,
      payload: validPayload(payload) ? payload : null
    };
  } catch {
    cache = { file, mtimeMs: -1, payload: null };
  }

  return cache.payload;
}

function observedDemandKeys(slug) {
  const safeLandingSlug = normalizedLandingSlug(slug);
  if (!safeLandingSlug) return [];

  const payload = readSnapshot();
  const rows = freshPayload(payload) ? payload.landings[safeLandingSlug] : undefined;
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => String(row?.key || "").trim())
    .filter(Boolean);
}

function searchDemandSnapshotStatus() {
  const payload = readSnapshot();
  return {
    configured: Boolean(payload && freshPayload(payload)),
    stale: Boolean(payload && !freshPayload(payload)),
    source: payload?.source || "",
    generated_at: payload?.generated_at || "",
    landing_count: payload ? Object.keys(payload.landings).length : 0
  };
}

module.exports = {
  observedDemandKeys,
  searchDemandSnapshotStatus
};
