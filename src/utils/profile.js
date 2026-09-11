"use strict";

const { safeSlug, titleCaseArea } = require("./text");
const { buildProfileSlug } = require("./profileSeo");

const CANONICAL_PROFILE_SLUG_OVERRIDES = new Map([
  ["istanbul-i-rem-7", "irem-vip-istanbul"],
  ["bahar-39bc3dbe", "bahar-istanbul"],
  ["betul-0a8e1b15", "betul-istanbul"]
]);

const VERIFIED_LEGACY_PROFILE_SLUG_TARGETS = new Map([
  ["aleyna-fatih", "aleyna-istanbul"],
  ["cansu-sisli", "cansu-istanbul"],
  ["gizem-sariyer", "gizem-istanbul"],
  ["irem-bahcelievler", "irem-vip-istanbul"],
  ["melike-beyoglu", "melike-istanbul"],
  ["melis-besiktas", "melis-istanbul"],
  ["merve-levent", "merve-istanbul"]
]);

function getProfileSlug(profile) {
  const storedSlug = safeSlug(profile?.slug || "");
  const canonicalOverride = CANONICAL_PROFILE_SLUG_OVERRIDES.get(storedSlug);
  if (canonicalOverride) return canonicalOverride;
  const isLegacyGeneratedSlug = /^istanbul-.+-\d+$/i.test(storedSlug);
  if (storedSlug && !isLegacyGeneratedSlug) return storedSlug;
  if (profile?.name || profile?.card_label) return buildProfileSlug(profile);
  return storedSlug || "profil";
}

function isGeneralArea(value) {
  return ["geneli", "istanbul-geneli", "istanbul"].includes(safeSlug(value));
}

function getProfileArea(profile) {
  const city = titleCaseArea(profile?.city || "İstanbul");
  const district = titleCaseArea(profile?.district || "");
  if (!district || isGeneralArea(district)) return `${city} Geneli`;
  return district;
}

function getProfileLocation(profile) {
  const district = profile?.district ? titleCaseArea(profile.district) : "";
  const city = titleCaseArea(profile?.city || "İstanbul");
  if (!district || isGeneralArea(district) || safeSlug(district) === safeSlug(city)) {
    return `${city} Geneli`;
  }
  return `${district}, ${city}`;
}

function findProfileBySlug(profiles, rawSlug) {
  const wanted = safeSlug(rawSlug);
  const rows = profiles || [];
  const exact = rows.find((profile) => {
    const publicSlug = getProfileSlug(profile);
    const dbSlug = safeSlug(profile.slug || "");
    return publicSlug === wanted || dbSlug === wanted;
  });

  if (exact) return exact;

  const verifiedLegacyTarget = VERIFIED_LEGACY_PROFILE_SLUG_TARGETS.get(wanted);
  if (verifiedLegacyTarget) {
    const verifiedLegacyProfile = rows.find((profile) => getProfileSlug(profile) === verifiedLegacyTarget);
    if (verifiedLegacyProfile) return verifiedLegacyProfile;
  }

  return rows.find((profile) => {
    const nameSlug = safeSlug(profile.name || "");
    const cityName = safeSlug(`${profile.city || "istanbul"}-${profile.name || ""}`);
    const nameCity = safeSlug(`${profile.name || ""}-${profile.city || "istanbul"}`);
    const nameDistrict = safeSlug(`${profile.name || ""}-${profile.district || ""}`);
    return [nameSlug, cityName, nameCity, nameDistrict].includes(wanted);
  });
}

module.exports = {
  getProfileSlug,
  getProfileArea,
  getProfileLocation,
  isGeneralArea,
  findProfileBySlug
};
