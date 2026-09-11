"use strict";

const crypto = require("crypto");

const PROOF_VERSION = "v2";
const PROOF_TTL_SECONDS = 15 * 60;
const ALLOWED_EVENT_TYPES = new Set(["profile_view", "contact_click"]);
const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let localProofSecret;

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function proofSecret() {
  const configured = String(process.env.ANALYTICS_EVENT_PROOF_SECRET || "");
  const customerSessionSecret = String(process.env.CUSTOMER_ACCESS_SESSION_SECRET || "");
  if (configured.length >= 32) {
    if (customerSessionSecret && configured === customerSessionSecret) {
      throw new Error(
        "ANALYTICS_EVENT_PROOF_SECRET must be independent from CUSTOMER_ACCESS_SESSION_SECRET."
      );
    }
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("ANALYTICS_EVENT_PROOF_SECRET must contain at least 32 characters in production.");
  }
  if (!localProofSecret) localProofSecret = crypto.randomBytes(48).toString("base64url");
  return localProofSecret;
}

function normalizeProfileId(value) {
  const profileId = String(value || "").trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(profileId) ? profileId : "";
}

function normalizeEventId(value) {
  const eventId = String(value || "").trim().toLowerCase();
  return EVENT_ID_PATTERN.test(eventId) ? eventId : "";
}

function proofSignature(body) {
  return crypto
    .createHmac("sha256", proofSecret())
    .update(`vip-gece-analytics:${body}`)
    .digest("base64url");
}

function createAnalyticsEventProof(
  profileIdValue,
  eventTypeValue,
  eventIdValue,
  issuedAtValue = unixNow()
) {
  const profileId = normalizeProfileId(profileIdValue);
  const eventType = String(eventTypeValue || "").trim().toLowerCase();
  const eventId = normalizeEventId(eventIdValue);
  const issuedAt = Number.parseInt(issuedAtValue, 10);
  if (
    !profileId ||
    !ALLOWED_EVENT_TYPES.has(eventType) ||
    !eventId ||
    !Number.isSafeInteger(issuedAt) ||
    issuedAt <= 0
  ) {
    return "";
  }

  const expiresAt = issuedAt + PROOF_TTL_SECONDS;
  const body = `${PROOF_VERSION}.${profileId}.${eventType}.${eventId}.${issuedAt}.${expiresAt}`;
  return `${body}.${proofSignature(body)}`;
}

function mintAnalyticsEventProof(profileIdValue, eventTypeValue, issuedAtValue = unixNow()) {
  const eventId = crypto.randomUUID();
  const issuedAt = Number.parseInt(issuedAtValue, 10);
  const proof = createAnalyticsEventProof(
    profileIdValue,
    eventTypeValue,
    eventId,
    issuedAt
  );
  if (!proof) return null;

  return {
    event_id: eventId,
    proof,
    expires_at: issuedAt + PROOF_TTL_SECONDS
  };
}

function verifyAnalyticsEventProof(
  tokenValue,
  profileIdValue,
  eventTypeValue,
  eventIdValue,
  nowValue = unixNow()
) {
  try {
    const token = String(tokenValue || "").trim();
    const expectedProfileId = normalizeProfileId(profileIdValue);
    const expectedEventType = String(eventTypeValue || "").trim().toLowerCase();
    const expectedEventId = normalizeEventId(eventIdValue);
    const now = Number.parseInt(nowValue, 10);
    const parts = token.split(".");
    if (
      token.length > 320 ||
      parts.length !== 7 ||
      parts[0] !== PROOF_VERSION ||
      !expectedProfileId ||
      !ALLOWED_EVENT_TYPES.has(expectedEventType) ||
      !expectedEventId ||
      !Number.isSafeInteger(now)
    ) {
      return false;
    }

    const [, profileId, eventType, eventId, issuedAtRaw, expiresAtRaw, signature] = parts;
    const issuedAt = Number.parseInt(issuedAtRaw, 10);
    const expiresAt = Number.parseInt(expiresAtRaw, 10);
    if (
      profileId !== expectedProfileId ||
      eventType !== expectedEventType ||
      eventId !== expectedEventId ||
      !Number.isSafeInteger(issuedAt) ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt !== issuedAt + PROOF_TTL_SECONDS ||
      issuedAt > now + 30 ||
      expiresAt < now
    ) {
      return false;
    }

    const body = parts.slice(0, 6).join(".");
    const expected = Buffer.from(proofSignature(body), "utf8");
    const actual = Buffer.from(signature, "utf8");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

if (process.env.NODE_ENV === "production") proofSecret();

module.exports = {
  PROOF_TTL_SECONDS,
  createAnalyticsEventProof,
  mintAnalyticsEventProof,
  verifyAnalyticsEventProof
};
