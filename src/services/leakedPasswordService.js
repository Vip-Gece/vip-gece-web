"use strict";

const crypto = require("crypto");

const PWNED_PASSWORDS_RANGE_URL = "https://api.pwnedpasswords.com/range/";
const RANGE_CACHE_TTL_MS = Number(process.env.PWNED_PASSWORD_RANGE_CACHE_TTL_MS || 60 * 60 * 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.PWNED_PASSWORD_TIMEOUT_MS || 5000);
const RANGE_CACHE_MAX_ENTRIES = Math.min(
  2048,
  Math.max(32, Number.parseInt(process.env.PWNED_PASSWORD_RANGE_CACHE_ENTRIES || "256", 10) || 256)
);
const rangeCache = new Map();

function sha1UpperHex(password) {
  return crypto.createHash("sha1").update(String(password), "utf8").digest("hex").toUpperCase();
}

function parsePwnedRangeResponse(rangeText, suffix) {
  const needle = String(suffix || "").toUpperCase();

  for (const line of String(rangeText || "").split(/\r?\n/)) {
    const [hashSuffix, rawCount] = line.trim().split(":");
    if (!hashSuffix || hashSuffix.toUpperCase() !== needle) continue;

    const count = Number.parseInt(rawCount || "0", 10);
    return Number.isFinite(count) && count > 0 ? count : 0;
  }

  return 0;
}

async function fetchRange(prefix, options = {}) {
  const now = Date.now();
  const cached = rangeCache.get(prefix);

  if (cached && cached.expiresAt > now) {
    rangeCache.delete(prefix);
    rangeCache.set(prefix, cached);
    return cached.body;
  }
  if (cached) rangeCache.delete(prefix);

  const fetchFn = options.fetchFn || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchFn(`${PWNED_PASSWORDS_RANGE_URL}${prefix}`, {
      headers: {
        "Add-Padding": "true",
        "User-Agent": "vip-gece-password-guard"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error("Pwned Passwords range API yanıt vermedi.");
    }

    const body = await response.text();
    rangeCache.set(prefix, {
      body,
      expiresAt: now + RANGE_CACHE_TTL_MS
    });
    while (rangeCache.size > RANGE_CACHE_MAX_ENTRIES) {
      rangeCache.delete(rangeCache.keys().next().value);
    }

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkLeakedPassword(password, options = {}) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Şifre gerekli.");
  }

  const hash = sha1UpperHex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const body = await fetchRange(prefix, options);
  const count = parsePwnedRangeResponse(body, suffix);

  return {
    leaked: count > 0,
    count
  };
}

module.exports = {
  checkLeakedPassword,
  parsePwnedRangeResponse,
  sha1UpperHex
};
