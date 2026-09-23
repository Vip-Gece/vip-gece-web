"use strict";

const { safeSlug } = require("./text");

const MAX_META_KEYWORDS_LENGTH = 500;

const PUBLIC_CORE_TERMS = Object.freeze([
  "escort",
  "eskort",
  "escort ilanı",
  "eskort ilanı",
  "escort ilanları",
  "eskort ilanları",
  "escort ilan sitesi",
  "eskort ilan sitesi",
  "vip escort",
  "vip eskort",
  "vip escort ilanı",
  "vip eskort ilanı",
  "vip escort ilan sitesi",
  "vip eskort ilan sitesi",
  "elit escort",
  "premium escort",
  "seçkin escort",
  "güncel escort ilanları",
  "gerçek fotoğraflı escort"
]);

const PUBLIC_FORMAL_TERMS = Object.freeze([
  "yetişkin ilan rehberi",
  "yetişkin profil rehberi",
  "özel arkadaşlık ilanları",
  "refakatçi ilan rehberi",
  "güvenli profil inceleme"
]);

const TRACKING_ONLY_TERMS = Object.freeze([
  "call girl",
  "callgirl",
  "companion",
  "female companion",
  "fahişe",
  "fahise",
  "hayat kadını",
  "hayat kadini",
  "telekız",
  "tele kiz",
  "çağrı kızı",
  "cagri kizi",
  "orospu",
  "orosbu",
  "orospo",
  "escört",
  "eskord",
  "escord",
  "escot",
  "escor",
  "escortt",
  "eskorrt",
  "eskot",
  "eskört"
]);

function clean(value, maxLength = 120) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function unique(values) {
  const seen = new Set();
  return values
    .map((value) => clean(value))
    .filter(Boolean)
    .filter((value) => {
      const key = safeSlug(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function trimReadable(value, maxLength) {
  const text = clean(value, maxLength + 40);
  if (text.length <= maxLength) return text;

  const sliced = text.slice(0, maxLength + 1);
  const lastSpace = sliced.lastIndexOf(" ");
  return (lastSpace > Math.floor(maxLength * 0.6) ? sliced.slice(0, lastSpace) : sliced.slice(0, maxLength))
    .replace(/[,\s;:.|-]+$/g, "")
    .trim();
}

function areaPhrases(area) {
  const local = clean(area || "İstanbul", 80);
  return [
    `${local} escort`,
    `${local} eskort`,
    `${local} vip escort`,
    `${local} vip eskort`,
    `${local} escort ilanları`,
    `${local} eskort ilanları`,
    `${local} escort ilan sitesi`,
    `${local} eskort ilan sitesi`,
    `${local} güncel escort`,
    `${local} elit escort`,
    `${local} premium escort`,
    `${local} yetişkin profil rehberi`
  ];
}

function categoryPhrases(categoryName, area) {
  const category = clean(categoryName, 80);
  if (!category) return [];
  const local = clean(area || "İstanbul", 80);
  const categoryBare = category.replace(/\s+escort$/i, "");
  return unique([
    category,
    `${category} ilanları`,
    `${category} ilan sitesi`,
    `${category} profilleri`,
    `${local} ${category}`,
    `${local} ${category} ilanları`,
    `${local} ${categoryBare} escort`,
    `${local} ${categoryBare} eskort`
  ]);
}

function profilePhrases(profileName, area) {
  const name = clean(profileName, 80);
  if (!name) return [];
  const local = clean(area || "İstanbul", 80);
  return [
    `${name} escort`,
    `${name} eskort`,
    `${name} ${local} escort`,
    `${name} ${local} eskort`,
    `${name} vip escort`,
    `${name} vip eskort`,
    `${name} escort ilanı`,
    `${name} profil ilanı`
  ];
}

function buildPublicSeoTerms({
  area = "İstanbul",
  categoryName = "",
  profileName = "",
  extra = [],
  includeFormal = true
} = {}) {
  return unique([
    ...profilePhrases(profileName, area),
    ...categoryPhrases(categoryName, area),
    ...areaPhrases(area),
    ...PUBLIC_CORE_TERMS,
    ...(includeFormal ? PUBLIC_FORMAL_TERMS : []),
    ...extra
  ]);
}

function buildMetaKeywords(options = {}) {
  const terms = buildPublicSeoTerms(options);
  const output = [];
  for (const term of terms) {
    const candidate = [...output, term].join(", ");
    if (candidate.length > MAX_META_KEYWORDS_LENGTH) break;
    output.push(term);
  }
  return output.join(", ");
}

function buildSeoVariationText(options = {}) {
  const terms = buildPublicSeoTerms(options).slice(0, 8);
  if (!terms.length) return "";

  const area = clean(options.area || "İstanbul", 80);
  const subject = clean(options.categoryName || options.profileName || area, 80);
  return trimReadable(
    `${subject} sayfası; ${terms.join(", ")} gibi normal yazım, halk dili, ilan sitesi ve resmi rehber aramalarını doğal içerik, başlık, bağlantı ve profil bağlamıyla kapsayacak şekilde hazırlanır.`,
    320
  );
}

module.exports = {
  PUBLIC_CORE_TERMS,
  PUBLIC_FORMAL_TERMS,
  TRACKING_ONLY_TERMS,
  buildMetaKeywords,
  buildPublicSeoTerms,
  buildSeoVariationText
};
