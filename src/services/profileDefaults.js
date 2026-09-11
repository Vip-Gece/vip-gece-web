"use strict";

const { cleanImageUrl } = require("../utils/input");
const { safeSlug } = require("../utils/text");

const DEFAULT_PROFILE_WHATSAPP = String(process.env.DEFAULT_PROFILE_WHATSAPP || "")
  .replace(/[^\d+]/g, "")
  .slice(0, 40);
const DEFAULT_PROFILE_TYPE = "vip";
const DEFAULT_PROFILE_PACKAGE = "vip";
const PROFILE_PUBLICATION_REQUIRED_FIELDS = ["name", "slug", "description"];

function profilePublicationMissingFields(profile = {}) {
  const missing = PROFILE_PUBLICATION_REQUIRED_FIELDS.filter(
    (field) => typeof profile[field] !== "string" || !profile[field].trim()
  );
  const hasImage = Array.isArray(profile.images) &&
    profile.images.some((image) => cleanImageUrl(image));

  if (!hasImage) missing.push("images");
  return missing;
}

function isProfilePublishable(profile = {}) {
  return profilePublicationMissingFields(profile).length === 0;
}

function assertActiveProfilePublishable(profile = {}) {
  if (profile.is_active !== true) return profile;

  const missing = profilePublicationMissingFields(profile);
  if (!missing.length) return profile;

  const error = new Error(`Profil yayına alınamaz. Eksik alanlar: ${missing.join(", ")}.`);
  error.code = "PROFILE_NOT_PUBLISHABLE";
  error.status = 400;
  error.missing_fields = missing;
  throw error;
}

function assertProfileUpdatePublishable(currentProfile = {}, payload = {}) {
  return assertActiveProfilePublishable({ ...currentProfile, ...payload });
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function firstFreeSlot(profiles = [], type = DEFAULT_PROFILE_TYPE) {
  const occupied = new Set(
    (Array.isArray(profiles) ? profiles : [])
      .filter((profile) => profile?.is_active !== false)
      .flatMap((profile) => [
        positiveInteger(profile?.vip_slot),
        positiveInteger(profile?.normal_slot)
      ])
      .filter(Boolean)
  );

  let slot = 1;
  while (occupied.has(slot)) slot += 1;
  return slot;
}

function normalizeIstanbulGeneralArea(profile = {}) {
  const output = { ...profile };
  const city = String(output.city || "").trim();

  // Public discovery is intentionally Istanbul-wide. A profile may keep
  // descriptive neighborhood/location metadata elsewhere, but the canonical
  // city/district scope must not restrict it to a single district landing.
  if (!city || safeSlug(city) === "istanbul") {
    output.city = "İstanbul";
    output.district = "İstanbul Geneli";
  }

  return output;
}

function applyProfileCreateDefaults(payload = {}, existingProfiles = []) {
  const output = normalizeIstanbulGeneralArea(payload);
  const requestedType = String(output.type || "").trim().toLowerCase();
  const type = requestedType === "normal" ? "normal" : DEFAULT_PROFILE_TYPE;
  const packageType = String(output.package_type || output.vip_level || "").trim() ||
    (type === "vip" ? DEFAULT_PROFILE_PACKAGE : "normal");
  const slotField = type === "vip" ? "vip_slot" : "normal_slot";
  const otherSlotField = type === "vip" ? "normal_slot" : "vip_slot";
  const occupied = new Set(
    (Array.isArray(existingProfiles) ? existingProfiles : [])
      .filter((profile) => profile?.is_active !== false)
      .flatMap((profile) => [
        positiveInteger(profile?.vip_slot),
        positiveInteger(profile?.normal_slot)
      ])
      .filter(Boolean)
  );
  const requestedSlot = positiveInteger(output[slotField]);
  const slot = requestedSlot && !occupied.has(requestedSlot)
    ? requestedSlot
    : firstFreeSlot(existingProfiles, type);
  const priority = positiveInteger(output.priority_order);
  const displayPriority = positiveInteger(output.display_priority);

  if (!String(output.whatsapp || "").trim() && DEFAULT_PROFILE_WHATSAPP) {
    output.whatsapp = DEFAULT_PROFILE_WHATSAPP;
  }
  output.type = type;
  output.package_type = packageType;
  output.vip_level = packageType;
  output.is_featured = type === "vip";
  if (!Object.prototype.hasOwnProperty.call(output, "is_active")) output.is_active = false;
  output[slotField] = slot;
  output[otherSlotField] = null;
  output.priority_order = priority && priority !== 999 ? priority : slot;
  output.display_priority = displayPriority || slot;

  return assertActiveProfilePublishable(output);
}

function applyProfileUpdateDefaults(payload = {}, currentProfile = null) {
  if (!currentProfile) return { ...payload };

  const output = { ...payload };
  const explicitlyChangedCity = Object.prototype.hasOwnProperty.call(payload, "city");
  const explicitlyChangedDistrict = Object.prototype.hasOwnProperty.call(payload, "district");
  const requestedCity = String(payload.city || "").trim();
  if (
    explicitlyChangedCity &&
    requestedCity &&
    safeSlug(requestedCity) !== "istanbul" &&
    !explicitlyChangedDistrict
  ) {
    output.district = "";
    return output;
  }

  const normalized = normalizeIstanbulGeneralArea({
    ...currentProfile,
    ...payload
  });

  if (
    normalized.city === "İstanbul" &&
    normalized.district === "İstanbul Geneli"
  ) {
    output.city = normalized.city;
    output.district = normalized.district;
  }

  return output;
}

module.exports = {
  DEFAULT_PROFILE_PACKAGE,
  DEFAULT_PROFILE_TYPE,
  DEFAULT_PROFILE_WHATSAPP,
  applyProfileCreateDefaults,
  applyProfileUpdateDefaults,
  assertActiveProfilePublishable,
  assertProfileUpdatePublishable,
  isProfilePublishable,
  normalizeIstanbulGeneralArea,
  profilePublicationMissingFields,
  firstFreeSlot
};
