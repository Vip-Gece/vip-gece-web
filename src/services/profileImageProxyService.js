"use strict";

const crypto = require("crypto");

function boundedInteger(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

const MAX_CACHE_ENTRIES = boundedInteger("PROFILE_IMAGE_CACHE_ENTRIES", 128, 16, 512);
const MAX_CACHE_BYTES = boundedInteger("PROFILE_IMAGE_CACHE_MAX_BYTES", 64 * 1024 * 1024, 8 * 1024 * 1024, 256 * 1024 * 1024);
const MAX_IMAGE_BYTES = boundedInteger("PROFILE_IMAGE_MAX_BYTES", 8 * 1024 * 1024, 1024 * 1024, 16 * 1024 * 1024);
const FETCH_TIMEOUT_MS = boundedInteger("PROFILE_IMAGE_FETCH_TIMEOUT_MS", 10_000, 2000, 30_000);
const ALLOWED_IMAGE_WIDTHS = new Set([
  160,
  180,
  220,
  240,
  280,
  320,
  360,
  420,
  480,
  512,
  640,
  720,
  960,
  1024,
  1200,
  1280,
  1600
]);
const ALLOWED_IMAGE_QUALITIES = new Set([68, 72, 76, 80]);
const ALLOWED_RESIZE_MODES = new Set(["contain", "cover", "fill"]);
const ALLOWED_IMAGE_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const PROFILE_IMAGE_PATH_PREFIXES = [
  "/storage/v1/object/public/images/profiles/",
  "/storage/v1/object/public/images/vip-gece/profiles/"
];
const imageCache = new Map();
let imageCacheBytes = 0;

function clean(value) {
  return String(value || "").trim();
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeImageOptions(options = {}) {
  const resize = clean(options.resize || "cover").toLowerCase();
  return {
    width: clampNumber(options.width, 720, 96, 1600),
    quality: clampNumber(options.quality, 72, 45, 85),
    resize: ALLOWED_RESIZE_MODES.has(resize) ? resize : "cover"
  };
}

function parseImageOptionsQuery(query) {
  const keys = Object.keys(query || {}).sort();
  if (keys.join(",") !== "quality,resize,width") return null;
  if (
    typeof query.width !== "string" ||
    typeof query.quality !== "string" ||
    typeof query.resize !== "string" ||
    !/^\d+$/.test(query.width) ||
    !/^\d+$/.test(query.quality)
  ) {
    return null;
  }

  const width = Number(query.width);
  const quality = Number(query.quality);
  if (
    String(width) !== query.width ||
    String(quality) !== query.quality ||
    !ALLOWED_IMAGE_WIDTHS.has(width) ||
    !ALLOWED_IMAGE_QUALITIES.has(quality) ||
    !ALLOWED_RESIZE_MODES.has(query.resize)
  ) {
    return null;
  }

  return { width, quality, resize: query.resize };
}

function configuredSupabaseHosts() {
  const values = [
    process.env.SUPABASE_URL,
    ...String(process.env.PROFILE_IMAGE_ALLOWED_HOSTS || "").split(",")
  ];

  return new Set(values.flatMap((value) => {
    const raw = clean(value);
    if (!raw) return [];
    try {
      const parsed = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
      return parsed.protocol === "https:" && parsed.hostname.toLowerCase().endsWith(".supabase.co")
        ? [parsed.hostname.toLowerCase()]
        : [];
    } catch {
      return [];
    }
  }));
}

function parseAllowedProfileImageUrl(value) {
  try {
    const parsed = new URL(clean(value));
    const hostname = parsed.hostname.toLowerCase();
    const configuredHosts = configuredSupabaseHosts();
    const isConfiguredHost = configuredHosts.has(hostname) ||
      (process.env.NODE_ENV !== "production" && configuredHosts.size === 0);
    const isAllowedHost = parsed.protocol === "https:" && hostname.endsWith(".supabase.co") && isConfiguredHost;
    const isProfileObject = PROFILE_IMAGE_PATH_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix));
    if (!isAllowedHost || !isProfileObject || parsed.username || parsed.password || parsed.port || parsed.hash || parsed.href.length > 600) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function imageTokenSecret() {
  const secret = clean(process.env.PROFILE_IMAGE_PROXY_SECRET || process.env.CUSTOMER_ACCESS_SESSION_SECRET);
  if (secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("PROFILE_IMAGE_PROXY_SECRET must contain at least 32 characters in production.");
  }
  return "vip-gece-local-profile-image-token-secret";
}

function tokenSignature(body) {
  return crypto
    .createHmac("sha256", imageTokenSecret())
    .update(`profile-image:${body}`)
    .digest("base64url");
}

function encodeProfileImageUrl(value) {
  const parsed = parseAllowedProfileImageUrl(value);
  if (!parsed) return "";
  const body = Buffer.from(parsed.toString(), "utf8").toString("base64url");
  return `${body}.${tokenSignature(body)}`;
}

function decodeProfileImageToken(token) {
  try {
    const raw = clean(token);
    if (!raw || raw.length > 1200) return "";
    const [body, signature, extra] = raw.split(".");
    if (!body || !signature || extra) return "";

    const expected = Buffer.from(tokenSignature(body));
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return "";

    const value = Buffer.from(body, "base64url").toString("utf8");
    const parsed = parseAllowedProfileImageUrl(value);
    return parsed ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function buildProfileImageProxyUrl(value, options = {}) {
  const token = encodeProfileImageUrl(value);
  if (!token) return clean(value);
  const normalized = normalizeImageOptions(options);
  const params = new URLSearchParams({
    width: String(normalized.width),
    quality: String(normalized.quality),
    resize: normalized.resize
  });
  return `/media/profile-image/${token}?${params.toString()}`;
}

function buildSupabaseRenderUrl(value, options = {}) {
  const parsed = parseAllowedProfileImageUrl(value);
  if (!parsed) return "";
  const normalized = normalizeImageOptions(options);
  parsed.pathname = parsed.pathname.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
  parsed.search = "";
  parsed.searchParams.set("width", String(normalized.width));
  parsed.searchParams.set("quality", String(normalized.quality));
  parsed.searchParams.set("resize", normalized.resize);
  return parsed.toString();
}

function remember(key, value) {
  const previous = imageCache.get(key);
  if (previous) {
    imageCacheBytes -= previous.body.length;
    imageCache.delete(key);
  }

  if (value.body.length > MAX_CACHE_BYTES) return;
  imageCache.set(key, value);
  imageCacheBytes += value.body.length;

  while (imageCache.size > MAX_CACHE_ENTRIES || imageCacheBytes > MAX_CACHE_BYTES) {
    const oldestKey = imageCache.keys().next().value;
    const oldest = imageCache.get(oldestKey);
    if (oldest) imageCacheBytes -= oldest.body.length;
    imageCache.delete(oldestKey);
  }
}

async function readLimitedImageBody(response) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length || body.length > MAX_IMAGE_BYTES) {
      throw new Error("Profil görseli boyutu kabul edilmedi.");
    }
    return body;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("Profil görseli boyutu kabul edilmedi.");
    }
    chunks.push(Buffer.from(value));
  }

  if (!total) throw new Error("Profil görseli boş döndü.");
  return Buffer.concat(chunks, total);
}

async function loadProfileImage(sourceUrl, options = {}) {
  const normalized = normalizeImageOptions(options);
  const renderUrl = buildSupabaseRenderUrl(sourceUrl, normalized);
  if (!renderUrl) {
    const error = new Error("Geçersiz profil görseli kaynağı.");
    error.statusCode = 400;
    throw error;
  }

  const cacheKey = renderUrl;
  const cached = imageCache.get(cacheKey);
  if (cached) {
    imageCache.delete(cacheKey);
    imageCache.set(cacheKey, cached);
    return { ...cached, cacheStatus: "HIT" };
  }

  const response = await fetch(renderUrl, {
    headers: { Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) {
    const error = new Error(`Profil görseli kaynağı ${response.status} döndürdü.`);
    error.statusCode = 502;
    throw error;
  }

  const contentType = clean(response.headers.get("content-type")).split(";")[0].toLowerCase();
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (!ALLOWED_IMAGE_TYPES.has(contentType) || contentLength > MAX_IMAGE_BYTES) {
    const error = new Error("Profil görseli yanıtı kabul edilmedi.");
    error.statusCode = 502;
    throw error;
  }

  let buffer;
  try {
    buffer = await readLimitedImageBody(response);
  } catch (cause) {
    const error = new Error(cause.message || "Profil görseli boyutu kabul edilmedi.");
    error.statusCode = 502;
    throw error;
  }

  const value = {
    body: buffer,
    contentType,
    sourceEtag: clean(response.headers.get("etag"))
  };
  remember(cacheKey, value);
  return { ...value, cacheStatus: "MISS" };
}

module.exports = {
  buildProfileImageProxyUrl,
  buildSupabaseRenderUrl,
  decodeProfileImageToken,
  encodeProfileImageUrl,
  loadProfileImage,
  normalizeImageOptions,
  parseImageOptionsQuery,
  parseAllowedProfileImageUrl
};
