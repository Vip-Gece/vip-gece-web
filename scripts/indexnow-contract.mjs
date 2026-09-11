"use strict";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const express = require("express");
const {
  buildIndexNowPayload,
  indexNowRuntimeConfig,
  normalizeIndexNowKey,
  selectIndexNowUrls,
  submitIndexNowBatch,
  verifyIndexNowKey
} = require("../src/services/indexNowService");

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`ok ${message}`);
}

const site = "https://vip-gece.site";
const key = "A1b2C3d4-indexnow-contract-key";

assert(normalizeIndexNowKey(key) === key, "IndexNow accepts the protocol key shape");
assert(normalizeIndexNowKey("short") === "", "IndexNow rejects short keys");
assert(normalizeIndexNowKey("invalid/key-value") === "", "IndexNow rejects path characters in keys");
assert(indexNowRuntimeConfig({ INDEXNOW_ENABLED: "false", INDEXNOW_KEY: "" }).enabled === false,
  "IndexNow stays disabled unless explicitly enabled");

let invalidConfigRejected = false;
try {
  indexNowRuntimeConfig({ INDEXNOW_ENABLED: "true", INDEXNOW_KEY: "bad" });
} catch {
  invalidConfigRejected = true;
}
assert(invalidConfigRejected, "IndexNow fails closed when an enabled key is invalid");

const entries = [
  { url: `${site}/`, lastmod: "2026-08-13" },
  { url: `${site}/istanbul-escort`, lastmod: "2026-08-13" },
  { url: `${site}/profil/test`, lastmod: "2026-08-13" },
  { url: "https://example.com/not-ours", lastmod: "2026-08-13" }
];
const previousState = {
  sitemap_lastmods: {
    [`${site}/`]: "2026-08-13",
    [`${site}/istanbul-escort`]: "2026-08-12",
    [`${site}/removed-page`]: "2026-08-12",
    "https://example.com/old": "2026-08-12"
  }
};
const selected = selectIndexNowUrls({ entries, previousState, site });
assert(selected.urls.length === 3, "IndexNow selects one changed, one new and one removed same-origin URL");
assert(selected.urls.includes(`${site}/istanbul-escort`), "IndexNow includes changed URLs");
assert(selected.urls.includes(`${site}/profil/test`), "IndexNow includes new URLs");
assert(selected.urls.includes(`${site}/removed-page`), "IndexNow includes removed URLs for recrawl");
assert(!selected.urls.some((url) => url.includes("example.com")), "IndexNow excludes foreign-origin URLs");

const initial = selectIndexNowUrls({ entries, previousState: null, site });
assert(initial.urls.length === 3, "IndexNow first run selects the complete same-origin sitemap");
const unchanged = selectIndexNowUrls({
  entries,
  previousState: { sitemap_lastmods: initial.currentMap },
  site
});
assert(unchanged.urls.length === 0, "IndexNow repeat run is a no-op when the sitemap is unchanged");

const payload = buildIndexNowPayload({ site, key, urls: initial.urls });
assert(payload.host === "vip-gece.site", "IndexNow payload uses the canonical host");
assert(payload.keyLocation === `${site}/${key}.txt`, "IndexNow payload uses the root verification file");
assert(payload.urlList.length === 3, "IndexNow payload preserves the selected URL inventory");

let submittedRequest = null;
const accepted = await submitIndexNowBatch({
  site,
  key,
  urls: initial.urls,
  fetchImpl: async (url, options) => {
    submittedRequest = { url, options };
    return { status: 202, text: async () => "accepted" };
  }
});
assert(accepted.status === 202, "IndexNow accepts HTTP 202 as protocol acknowledgement");
assert(submittedRequest?.options?.method === "POST", "IndexNow submission uses POST");
assert(JSON.parse(submittedRequest.options.body).urlList.length === 3,
  "IndexNow submission sends the intended URL list");

const verification = await verifyIndexNowKey({
  site,
  key,
  fetchImpl: async () => ({ status: 200, ok: true, text: async () => `${key}\n` })
});
assert(verification.status === 200, "IndexNow verifies the live key body before submission");

process.env.INDEXNOW_ENABLED = "true";
process.env.INDEXNOW_KEY = key;
process.env.SITE_URL = site;
const { createSitemapRouter } = require("../src/routes/sitemapRoutes");
const app = express();
app.use(createSitemapRouter());
app.use((req, res) => res.status(404).type("text/plain").send("not found"));
const server = await new Promise((resolve) => {
  const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
});

try {
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${base}/${key}.txt`);
  assert(response.status === 200, "IndexNow verification route is public only when enabled");
  assert((await response.text()).trim() === key, "IndexNow verification route returns the exact key");
  assert(/^public,\s*max-age=\d+,\s*must-revalidate$/i.test(response.headers.get("cache-control") || ""),
    "IndexNow verification route has crawler-safe cache headers");
  const missing = await fetch(`${base}/not-the-configured-key.txt`);
  assert(missing.status === 404, "IndexNow does not expose an arbitrary verification route");
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

console.log("ok IndexNow change-only submission contract");
