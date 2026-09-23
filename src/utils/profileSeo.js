"use strict";

const { safeSlug } = require("./text");
const { buildMetaKeywords } = require("./seoLanguage");

const MAX_TITLE_LENGTH = 65;
const MAX_DESCRIPTION_LENGTH = 160;
const MAX_KEYWORDS_LENGTH = 500;
const MAX_SLUG_LENGTH = 140;

function cleanText(value, maxLength = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function displayCity(value) {
  const city = cleanText(value, 80);
  if (!city || safeSlug(city) === "istanbul") return "İstanbul";
  return city;
}

function displayDistrict(profile = {}) {
  const district = cleanText(profile.district, 80);
  if (district && !["geneli", "istanbul-geneli", "istanbul"].includes(safeSlug(district))) {
    return district;
  }

  const city = cleanText(profile.city, 80);
  if (city && safeSlug(city) !== "istanbul") return city;
  return "";
}

function trimReadable(value, maxLength) {
  const text = cleanText(value, maxLength + 40);
  if (text.length <= maxLength) return text;

  const sliced = text.slice(0, maxLength + 1);
  const lastSpace = sliced.lastIndexOf(" ");
  const trimmed = (lastSpace > Math.floor(maxLength * 0.65) ? sliced.slice(0, lastSpace) : sliced.slice(0, maxLength))
    .replace(/[,\s;:.|-]+$/g, "")
    .trim();

  return trimmed || text.slice(0, maxLength).trim();
}

function unique(values) {
  const seen = new Set();
  return values
    .map((value) => cleanText(value, 80))
    .filter(Boolean)
    .filter((value) => {
      const key = safeSlug(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildProfileSlug(profile = {}) {
  const name = cleanText(profile.name || profile.card_label || profile.slug || "profil", 80);
  const area = displayDistrict(profile) || displayCity(profile.city);
  return safeSlug(`${name} ${area}`).slice(0, MAX_SLUG_LENGTH) || "profil";
}

function profileTitleParts(profile = {}) {
  const name = cleanText(profile.name || profile.card_label || "Profil", 80);
  const city = displayCity(profile.city);
  const district = displayDistrict(profile);
  const area = district || city;
  return { name, city, district, area };
}

function legacyGeneratedProfileTitles(profile = {}) {
  const { name, city, area } = profileTitleParts(profile);
  return [
    `${name} ${area} Escort | VIP GECE`,
    `${name} ${area} Escort`,
    `${name} VIP Escort`,
    `${name} VIP Escort İstanbul | Gerçek Fotoğraflı ${city} VIP Profil`
  ].map((value) => cleanText(value, 180));
}

function isLegacyGeneratedProfileTitle(profile = {}, value = profile.seo_title) {
  const stored = cleanText(value, 180);
  if (!stored) return false;
  if (/profil\s+ilan[ıi]/i.test(stored) && /VIP\s+GECE/i.test(stored)) return true;
  return legacyGeneratedProfileTitles(profile).some((candidate) => candidate === stored);
}

function legacyGeneratedProfileDescriptions(profile = {}) {
  const { name, city, area } = profileTitleParts(profile);
  return [
    `${name} için ${area} escort profil sayfası; güncel görseller, kısa bilgiler ve doğrudan iletişim seçenekleri VIP GECE üzerinde.`,
    `${name} VIP Escort İstanbul ilanı. Gerçek fotoğraflı, bakımlı ve gizliliğe önem veren ${city} VIP profil detayları.`
  ].map((value) => cleanText(value, 240));
}

function isLegacyGeneratedProfileDescription(profile = {}, value = profile.seo_description) {
  const stored = cleanText(value, 240);
  if (!stored) return false;
  if (/profilinin\s+güncel\s+görsellerini/i.test(stored)) return true;
  if (/profil\s+sayfas[ıi]/i.test(stored) && /VIP\s+GECE/i.test(stored)) return true;
  return legacyGeneratedProfileDescriptions(profile).some((candidate) => candidate === stored);
}

function buildProfileSeoDefaults(profile = {}) {
  const { name, city, district, area } = profileTitleParts(profile);
  const packageType = cleanText(profile.package_type || profile.vip_level || "", 40);
  const type = cleanText(profile.type || "", 24);
  const tags = Array.isArray(profile.tags) ? profile.tags : [];

  const titleCandidates = [
    `${name} | ${area} Escort İlanı | VIP GECE`,
    `${name} | İstanbul Escort İlanı | VIP GECE`,
    `${name} | VIP GECE Escort İlanı`
  ];
  const seoTitle = titleCandidates.find((candidate) => candidate.length <= MAX_TITLE_LENGTH) || titleCandidates.at(-1);

  const seoDescription = trimReadable(
    `${name} ${area} escort ilanı için güncel görselleri, temel bilgileri ve iletişim seçeneklerini VIP GECE üzerinde inceleyin.`,
    MAX_DESCRIPTION_LENGTH
  );

  const keywords = buildMetaKeywords({
    area,
    categoryName: packageType || type,
    profileName: name,
    extra: unique([
      district,
      city,
      "VIP GECE",
      packageType,
      type,
      ...tags
    ])
  });

  return {
    slug: buildProfileSlug(profile),
    seo_title: trimReadable(seoTitle, MAX_TITLE_LENGTH),
    seo_description: seoDescription,
    seo_keywords: trimReadable(keywords, MAX_KEYWORDS_LENGTH)
  };
}

function buildProfilePageTitle(profile = {}) {
  const stored = cleanText(profile.seo_title, MAX_TITLE_LENGTH);
  if (stored.length >= 20 && !isLegacyGeneratedProfileTitle(profile, profile.seo_title)) {
    return trimReadable(stored, MAX_TITLE_LENGTH);
  }
  return buildProfileSeoDefaults(profile).seo_title;
}

function buildProfilePageDescription(profile = {}) {
  const stored = cleanText(profile.seo_description, MAX_DESCRIPTION_LENGTH);
  if (stored.length >= 40 && !isLegacyGeneratedProfileDescription(profile, profile.seo_description)) {
    return trimReadable(stored, MAX_DESCRIPTION_LENGTH);
  }
  return buildProfileSeoDefaults(profile).seo_description;
}

function applyProfileSeoDefaults(payload = {}) {
  const output = { ...payload };
  const hasProfileIdentity = Boolean(cleanText(output.name || output.card_label, 120));
  if (!hasProfileIdentity) return output;

  const defaults = buildProfileSeoDefaults(output);
  if (!cleanText(output.slug)) output.slug = defaults.slug;
  if (!cleanText(output.seo_title) || isLegacyGeneratedProfileTitle(output, output.seo_title)) {
    output.seo_title = defaults.seo_title;
  }
  if (!cleanText(output.seo_description) || isLegacyGeneratedProfileDescription(output, output.seo_description)) {
    output.seo_description = defaults.seo_description;
  }
  if (!cleanText(output.seo_keywords)) output.seo_keywords = defaults.seo_keywords;
  return output;
}

module.exports = {
  applyProfileSeoDefaults,
  buildProfilePageDescription,
  buildProfilePageTitle,
  buildProfileSeoDefaults,
  buildProfileSlug,
  isLegacyGeneratedProfileDescription,
  isLegacyGeneratedProfileTitle,
  trimReadable
};
