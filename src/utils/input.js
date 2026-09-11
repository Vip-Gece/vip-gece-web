"use strict";

const { safeSlug } = require("./text");

const PROFILE_TEXT_LIMITS = {
  name: 120,
  slug: 140,
  card_label: 120,
  age: 8,
  height: 16,
  weight: 16,
  city: 80,
  district: 80,
  description: 3000,
  seo_title: 180,
  seo_description: 320,
  seo_keywords: 500,
  phone: 40,
  whatsapp: 40,
  telegram: 80,
  type: 24,
  package_type: 40,
  vip_level: 40,
  owner_user_id: 140
};

const CUSTOMER_REQUEST_LIMITS = {
  description_request: 3000,
  phone_request: 40,
  whatsapp_request: 40,
  telegram_request: 80,
  customer_note: 1000
};

const CUSTOMER_PROFILE_LIMITS = {
  name: 120,
  card_label: 120,
  age: 8,
  height: 16,
  weight: 16,
  city: 80,
  district: 80,
  description: 3000,
  phone: 40,
  whatsapp: 40,
  telegram: 80
};

const DRAFT_TEXT_LIMITS = {
  mode: 40,
  name: 120,
  city: 80,
  district: 80,
  age: 8,
  height: 16,
  weight: 16,
  style: 40,
  scene: 80,
  description: 3000,
  prompt: 3000,
  brief: 3000,
  tone: 120,
  provider: 80,
  type: 24,
  package_type: 40,
  card_label: 120,
  reference_image_note: 500,
  phone: 40,
  whatsapp: 40,
  telegram: 80,
  contact_number: 40
};

const AD_TEXT_LIMITS = {
  title: 180,
  position: 80
};

function cleanText(value, maxLength = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanPhone(value) {
  return cleanText(value, 40).replace(/[^\d+]/g, "").slice(0, 40);
}

function cleanTelegram(value) {
  return cleanText(value, 80).replace(/^@+/, "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 80);
}

function cleanUrl(value) {
  const raw = cleanText(value, 600);
  if (!raw) return "";
  if (raw.startsWith("/")) return raw;

  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.href.slice(0, 600);
  } catch {
    return "";
  }
}

function cleanImageUrl(value) {
  const url = cleanUrl(value);
  if (!url) return "";
  if (url.startsWith("/")) return /^\/[^/\\]/.test(url) ? url : "";
  return url.startsWith("https://") ? url : "";
}

function cleanStringArray(value, { maxItems = 20, maxLength = 120, url = false } = {}) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => url ? cleanUrl(item) : cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function cleanImageArray(value, maxItems = 12) {
  return Array.isArray(value)
    ? value.map(cleanImageUrl).filter(Boolean).slice(0, maxItems)
    : [];
}

function cleanCustomerImageUrl(value) {
  const url = cleanImageUrl(value);
  if (!url || url.startsWith("/")) return "";

  try {
    const parsed = new URL(url);
    const configuredOrigin = new URL(String(process.env.SUPABASE_URL || "")).origin;
    const allowedPath = [
      "/storage/v1/object/public/images/profiles/",
      "/storage/v1/object/public/images/vip-gece/profiles/"
    ].some((prefix) => parsed.pathname.startsWith(prefix));
    return parsed.origin === configuredOrigin && allowedPath && !parsed.hash
      ? parsed.href.slice(0, 600)
      : "";
  } catch {
    return "";
  }
}

function cleanCustomerImageArray(value, maxItems = 12) {
  return Array.isArray(value)
    ? value.map(cleanCustomerImageUrl).filter(Boolean).slice(0, maxItems)
    : [];
}

function cleanBoolean(value) {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function cleanInteger(value, { min = 0, max = 999999 } = {}) {
  if (value === "" || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function cleanDate(value) {
  if (value === null) return null;
  const raw = cleanText(value, 80);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function pickLimitedText(body, limits) {
  const output = {};

  for (const [key, limit] of Object.entries(limits)) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    output[key] = cleanText(body[key], limit);
  }

  return output;
}

function sanitizeProfilePayload(body = {}) {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const output = pickLimitedText(input, PROFILE_TEXT_LIMITS);

  if (Object.prototype.hasOwnProperty.call(output, "slug")) {
    output.slug = safeSlug(output.slug).slice(0, PROFILE_TEXT_LIMITS.slug);
  }

  if (
    Object.prototype.hasOwnProperty.call(input, "owner_user_id") &&
    input.owner_user_id === null
  ) {
    output.owner_user_id = null;
  }

  if (Object.prototype.hasOwnProperty.call(output, "phone")) {
    output.phone = cleanPhone(output.phone);
  }

  if (Object.prototype.hasOwnProperty.call(output, "whatsapp")) {
    output.whatsapp = cleanPhone(output.whatsapp);
  }

  if (Object.prototype.hasOwnProperty.call(output, "telegram")) {
    output.telegram = cleanTelegram(output.telegram);
  }

  if (Object.prototype.hasOwnProperty.call(input, "images")) {
    output.images = cleanImageArray(input.images);
  }

  if (Object.prototype.hasOwnProperty.call(input, "tags")) {
    output.tags = cleanStringArray(input.tags, { maxItems: 24, maxLength: 80 });
  }

  for (const key of ["is_featured", "is_active", "is_sponsored", "is_lifetime"]) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const cleaned = cleanBoolean(input[key]);
    if (cleaned !== undefined) output[key] = cleaned;
  }

  for (const key of ["priority_order", "display_priority", "vip_slot", "normal_slot", "duration_days", "view_count", "click_count"]) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const cleaned = cleanInteger(input[key], { min: 0, max: 1000000 });
    if (cleaned !== undefined) output[key] = cleaned;
  }

  if (Object.prototype.hasOwnProperty.call(input, "expires_at")) {
    const cleaned = cleanDate(input.expires_at);
    if (cleaned !== undefined) output.expires_at = cleaned;
  }

  return output;
}

function sanitizeAdPayload(body = {}) {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const output = pickLimitedText(input, AD_TEXT_LIMITS);

  for (const key of ["image_url", "target_url"]) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    output[key] = cleanUrl(input[key]);
  }

  if (Object.prototype.hasOwnProperty.call(input, "is_active")) {
    const cleaned = cleanBoolean(input.is_active);
    if (cleaned !== undefined) output.is_active = cleaned;
  }

  for (const key of ["starts_at", "ends_at"]) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const raw = cleanText(input[key], 80);
    if (!raw || input[key] === null) {
      output[key] = null;
      continue;
    }
    const cleaned = cleanDate(raw);
    if (cleaned !== undefined) output[key] = cleaned;
  }

  return output;
}

function sanitizeCustomerRequestPayload(body = {}, userId = "") {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  return {
    ...pickLimitedText(input, CUSTOMER_REQUEST_LIMITS),
    requested_at: new Date().toISOString(),
    requested_by: cleanText(userId, 140)
  };
}

function sanitizeCustomerProfilePayload(body = {}) {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const output = pickLimitedText(input, CUSTOMER_PROFILE_LIMITS);

  if (Object.prototype.hasOwnProperty.call(output, "phone")) {
    output.phone = cleanPhone(output.phone);
  }

  if (Object.prototype.hasOwnProperty.call(output, "whatsapp")) {
    output.whatsapp = cleanPhone(output.whatsapp);
  }

  if (Object.prototype.hasOwnProperty.call(output, "telegram")) {
    output.telegram = cleanTelegram(output.telegram);
  }

  if (Object.prototype.hasOwnProperty.call(input, "images")) {
    output.images = cleanCustomerImageArray(input.images);
  }

  if (Object.prototype.hasOwnProperty.call(input, "is_active")) {
    const cleaned = cleanBoolean(input.is_active);
    if (cleaned !== undefined) output.is_active = cleaned;
  }

  return output;
}

function sanitizeDraftPayload(body = {}) {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const output = pickLimitedText(input, DRAFT_TEXT_LIMITS);

  for (const key of ["phone", "whatsapp", "contact_number"]) {
    if (Object.prototype.hasOwnProperty.call(output, key)) {
      output[key] = cleanPhone(output[key]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(output, "telegram")) {
    output.telegram = cleanTelegram(output.telegram);
  }

  const count = cleanInteger(input.count ?? input.images_required, { min: 1, max: 8 });
  if (count !== undefined) output.count = count;

  if (Object.prototype.hasOwnProperty.call(input, "images")) {
    output.images = cleanStringArray(input.images, { maxItems: 8, maxLength: 600, url: true });
  }

  if (Object.prototype.hasOwnProperty.call(input, "tags")) {
    output.tags = cleanStringArray(input.tags, { maxItems: 12, maxLength: 80 });
  }

  return output;
}

module.exports = {
  cleanImageUrl,
  cleanCustomerImageUrl,
  cleanPhone,
  cleanTelegram,
  cleanText,
  cleanUrl,
  sanitizeAdPayload,
  sanitizeDraftPayload,
  sanitizeCustomerProfilePayload,
  sanitizeCustomerRequestPayload,
  sanitizeProfilePayload
};
