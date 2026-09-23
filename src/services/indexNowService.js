"use strict";

const DEFAULT_INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;
const MAX_INDEXNOW_URLS = 10_000;

function envEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function normalizeIndexNowKey(value) {
  const key = String(value || "").trim();
  return INDEXNOW_KEY_PATTERN.test(key) ? key : "";
}

function indexNowRuntimeConfig(env = process.env) {
  const enabled = envEnabled(env.INDEXNOW_ENABLED);
  const key = normalizeIndexNowKey(env.INDEXNOW_KEY);

  if (enabled && !key) {
    throw new Error("INDEXNOW_ENABLED requires an 8-128 character alphanumeric/dash INDEXNOW_KEY");
  }

  return {
    enabled,
    key,
    keyPath: key ? `/${key}.txt` : ""
  };
}

function normalizeSiteOrigin(value) {
  const parsed = new URL(String(value || "").trim());
  if (parsed.protocol !== "https:") throw new Error("IndexNow site must use https");
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = "/";
  return parsed.origin;
}

function normalizeSameOriginUrl(value, siteOrigin) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.protocol !== "https:" || parsed.origin !== siteOrigin) return "";
    if (parsed.username || parsed.password || parsed.search ||
        /^\/(?:api|admin|vg-panel|m-panel|customer|login|register|downloads|media)(?:[-/.]|$)/i.test(parsed.pathname)) return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function lastmodMap(entries, siteOrigin) {
  const result = {};
  for (const entry of entries || []) {
    const url = normalizeSameOriginUrl(entry?.url, siteOrigin);
    if (!url || Object.prototype.hasOwnProperty.call(result, url)) continue;
    result[url] = String(entry?.lastmod || "").trim();
  }
  return result;
}

function previousLastmodMap(previousState) {
  const value = previousState?.sitemap_lastmods;
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function selectIndexNowUrls({ entries, previousState = null, site, forceAll = false }) {
  const siteOrigin = normalizeSiteOrigin(site);
  const currentMap = lastmodMap(entries, siteOrigin);
  const currentUrls = Object.keys(currentMap);
  if (!currentUrls.length) throw new Error("IndexNow requires at least one same-origin sitemap URL");

  const previousMap = previousLastmodMap(previousState);
  const changedUrls = forceAll || !previousMap
    ? [...currentUrls]
    : currentUrls.filter((url) => (
      !Object.prototype.hasOwnProperty.call(previousMap, url) ||
      String(previousMap[url] || "") !== currentMap[url]
    ));

  const removedUrls = previousMap
    ? Object.keys(previousMap)
      .map((url) => normalizeSameOriginUrl(url, siteOrigin))
      .filter((url) => url && !Object.prototype.hasOwnProperty.call(currentMap, url))
    : [];

  const urls = [...new Set([...changedUrls, ...removedUrls])];
  return {
    siteOrigin,
    currentMap,
    urls,
    changedUrls,
    removedUrls
  };
}

function buildIndexNowPayload({ site, key, urls }) {
  const siteOrigin = normalizeSiteOrigin(site);
  const normalizedKey = normalizeIndexNowKey(key);
  if (!normalizedKey) throw new Error("IndexNow key is invalid");

  const normalizedUrls = [...new Set((urls || [])
    .map((url) => normalizeSameOriginUrl(url, siteOrigin))
    .filter(Boolean))];
  if (!normalizedUrls.length) throw new Error("IndexNow URL list is empty");
  if (normalizedUrls.length > MAX_INDEXNOW_URLS) {
    throw new Error(`IndexNow accepts at most ${MAX_INDEXNOW_URLS} URLs per request`);
  }

  const parsedSite = new URL(siteOrigin);
  return {
    host: parsedSite.hostname,
    key: normalizedKey,
    keyLocation: `${siteOrigin}/${normalizedKey}.txt`,
    urlList: normalizedUrls
  };
}

async function responseText(response) {
  try {
    return String(await response.text()).slice(0, 1000);
  } catch {
    return "";
  }
}

async function verifyIndexNowKey({ site, key, fetchImpl = fetch }) {
  const payload = buildIndexNowPayload({ site, key, urls: [normalizeSiteOrigin(site)] });
  const response = await fetchImpl(payload.keyLocation, {
    headers: { "User-Agent": "VIP-Gece-IndexNow/1.0" },
    signal: AbortSignal.timeout(30_000), redirect: "error"
  });
  const body = await responseText(response);
  if (!response.ok || body.trim() !== payload.key) {
    throw new Error(`IndexNow key verification failed with HTTP ${response.status}`);
  }
  return { status: response.status, keyLocation: payload.keyLocation };
}

async function submitIndexNowBatch({
  site,
  key,
  urls,
  endpoint = DEFAULT_INDEXNOW_ENDPOINT,
  fetchImpl = fetch
}) {
  const parsedEndpoint = new URL(endpoint);
  if (parsedEndpoint.protocol !== "https:") throw new Error("IndexNow endpoint must use https");
  const payload = buildIndexNowPayload({ site, key, urls });
  const response = await fetchImpl(parsedEndpoint.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "VIP-Gece-IndexNow/1.0"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000), redirect: "error"
  });
  const body = await responseText(response);
  if (![200, 202].includes(response.status)) {
    throw new Error(`IndexNow returned HTTP ${response.status}${body ? `: ${body}` : ""}`);
  }
  return { status: response.status, body };
}

module.exports = {
  DEFAULT_INDEXNOW_ENDPOINT,
  MAX_INDEXNOW_URLS,
  buildIndexNowPayload,
  indexNowRuntimeConfig,
  normalizeIndexNowKey,
  normalizeSiteOrigin,
  selectIndexNowUrls,
  submitIndexNowBatch,
  verifyIndexNowKey
};
