"use strict";

const NO_STORE_CACHE_CONTROL = "no-store, no-cache, must-revalidate, private";
function withNoTransform(value) {
  const policy = String(value || "").trim();
  if (!policy) return "no-transform";
  return /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(policy)
    ? policy
    : `${policy}, no-transform`;
}

// Cloudflare JavaScript Detections modifies otherwise valid HTML responses by
// appending an inline challenge bootstrap. Apart from being unnecessary while
// Bot Fight Mode is disabled, that bootstrap violates the site's nonce-free
// CSP and delays the mobile LCP. Cloudflare documents `no-transform` as the
// origin-side opt-out for this injection, so keep it on every public HTML
// response even when the base browser cache policy is overridden by env.
const PUBLIC_HTML_CACHE_CONTROL = withNoTransform(
  process.env.PUBLIC_HTML_CACHE_CONTROL || "public, max-age=0, must-revalidate"
);
const PUBLIC_HTML_CDN_CACHE_CONTROL =
  process.env.PUBLIC_HTML_CDN_CACHE_CONTROL || "public, max-age=60, must-revalidate";
const PROOF_BOUND_HTML_CDN_CACHE_CONTROL = "public, max-age=300, must-revalidate";
const STATIC_ASSET_CACHE_CONTROL =
  process.env.STATIC_ASSET_CACHE_CONTROL || "public, max-age=2592000";

function setNoStore(res) {
  res.setHeader("Cache-Control", NO_STORE_CACHE_CONTROL);
  res.setHeader("Pragma", "no-cache");
  res.removeHeader("CDN-Cache-Control");
  res.removeHeader("Cloudflare-CDN-Cache-Control");
}

function setPublicHtmlCache(res) {
  res.setHeader("Cache-Control", PUBLIC_HTML_CACHE_CONTROL);
  res.setHeader("CDN-Cache-Control", PUBLIC_HTML_CDN_CACHE_CONTROL);
  res.setHeader("Cloudflare-CDN-Cache-Control", PUBLIC_HTML_CDN_CACHE_CONTROL);
  res.removeHeader("Pragma");
}

function setProofBoundHtmlCache(res) {
  res.setHeader("Cache-Control", PUBLIC_HTML_CACHE_CONTROL);
  res.setHeader("CDN-Cache-Control", PROOF_BOUND_HTML_CDN_CACHE_CONTROL);
  res.setHeader("Cloudflare-CDN-Cache-Control", PROOF_BOUND_HTML_CDN_CACHE_CONTROL);
  res.removeHeader("Pragma");
}

function setStaticAssetCache(res) {
  res.setHeader("Cache-Control", STATIC_ASSET_CACHE_CONTROL);
  res.removeHeader("Pragma");
}

module.exports = {
  NO_STORE_CACHE_CONTROL,
  PUBLIC_HTML_CACHE_CONTROL,
  PUBLIC_HTML_CDN_CACHE_CONTROL,
  PROOF_BOUND_HTML_CDN_CACHE_CONTROL,
  STATIC_ASSET_CACHE_CONTROL,
  setNoStore,
  setProofBoundHtmlCache,
  setPublicHtmlCache,
  setStaticAssetCache
};
