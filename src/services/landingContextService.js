"use strict";

const { safeSlug, titleCaseArea } = require("../utils/text");
const { getProfileArea } = require("../utils/profile");
const { observedDemandKeys } = require("./searchDemandSnapshotService");
const {
  categoryRows,
  districtRows,
  districtSideLabel,
  getCategoryBySlug,
  getDistrictAliases,
  getDistrictBySlug,
  getNearbyDistricts,
  landingAliasRows,
  sideGroups
} = require("../data/publicMetadata");

const QUICK_CATEGORY_SLUGS = [
  "istanbul-escort",
  "vip-escort",
  "anal-escort",
  "otel-escort",
  "yabanci-escort",
  "turbanli-escort",
  "gfe-escort",
  "esmer-escort",
  "sarisin-escort",
  "kumral-escort",
  "zayif-escort",
  "balik-etli-escort",
  "kapali-escort",
  "genc-escort"
];

const SEARCH_DEMAND_INTENTS = {
  vip: { weight: 34, label: "VIP", keywords: ["vip", "premium", "ultra vip", "diamond", "elit"] },
  sarisan: { weight: 32, label: "sarışın", keywords: ["sarışın", "sarisin", "sarı saç", "sari sac", "blonde", "blond"] },
  esmer: { weight: 30, label: "esmer", keywords: ["esmer", "brunette", "koyu saç", "koyu sac"] },
  kumral: { weight: 29, label: "kumral", keywords: ["kumral", "kahverengi saç", "kahverengi sac", "brown hair"] },
  zayif: { weight: 27, label: "zayıf", keywords: ["zayıf", "zayif", "slim", "fit", "ince"] },
  balikEtli: { weight: 25, label: "balık etli", keywords: ["balık etli", "balik etli", "curvy", "dolgun", "plus size"] },
  kapali: { weight: 21, label: "kapalı", keywords: ["kapalı", "kapali", "türbanlı", "turbanli", "tesettür", "tesettur"] },
  genc: { weight: 28, label: "genç", keywords: ["genç", "genc", "young"] },
  yabanci: { weight: 26, label: "yabancı", keywords: ["yabancı", "yabanci", "foreign", "rus", "ukrayna", "latin"] },
  otel: { weight: 24, label: "otel", keywords: ["otel", "hotel", "rezidans", "residence"] },
  gfe: { weight: 22, label: "GFE", keywords: ["gfe", "girlfriend", "samimi"] },
  turbanli: { weight: 20, label: "türbanlı", keywords: ["türbanlı", "turbanli", "tesettür", "tesettur"] },
  masaj: { weight: 18, label: "masaj", keywords: ["masaj", "massage", "spa"] }
};

const DEFAULT_SEARCH_DEMAND_KEYS = ["vip", "sarisan", "esmer", "kumral", "zayif", "balikEtli", "genc", "yabanci", "otel", "gfe", "turbanli", "kapali", "masaj"];

const DISTRICT_SEARCH_DEMANDS = {
  "fatih-escort": ["sarisan", "vip", "genc", "yabanci", "otel"],
  "sisli-escort": ["vip", "sarisan", "gfe", "otel", "yabanci"],
  "besiktas-escort": ["vip", "sarisan", "gfe", "yabanci", "otel"],
  "kadikoy-escort": ["genc", "esmer", "gfe", "sarisan", "vip"],
  "avcilar-escort": ["genc", "sarisan", "esmer", "vip", "otel"],
  "beylikduzu-escort": ["sarisan", "genc", "vip", "otel", "esmer"],
  "bakirkoy-escort": ["vip", "sarisan", "otel", "gfe", "yabanci"],
  "taksim-escort": ["yabanci", "vip", "otel", "sarisan", "gfe"],
  // GSC-proven opportunity landings (clicks/impressions leaders)
  "laleli-escort": ["yabanci", "otel", "vip", "sarisan", "genc"],
  "kavacik-escort": ["vip", "esmer", "gfe", "otel", "sarisan"],
  "madenler-escort": ["esmer", "genc", "vip", "otel", "sarisan"],
  "cihangir-escort": ["yabanci", "vip", "gfe", "otel", "sarisan"],
  "esenyurt-escort": ["genc", "sarisan", "esmer", "otel", "vip"],
  "sultangazi-escort": ["genc", "esmer", "sarisan", "balikEtli", "vip"],
  "hadimkoy-escort": ["sarisan", "genc", "vip", "otel", "esmer"],
  "cakmak-escort": ["esmer", "genc", "vip", "sarisan", "gfe"],
  "ihlamurkuyu-escort": ["esmer", "vip", "genc", "sarisan", "otel"],
  "kucukkoy-escort": ["genc", "esmer", "sarisan", "vip", "otel"],
  "pendik-escort": ["esmer", "genc", "vip", "sarisan", "otel"]
};

const LOCAL_INTENT_GROUPS = [
  {
    slugs: ["sisli-escort", "besiktas-escort", "beyoglu-escort", "sariyer-escort", "bakirkoy-escort", "kagithane-escort"],
    keys: ["vip", "sarisan", "yabanci", "gfe", "otel", "esmer"]
  },
  {
    slugs: ["kadikoy-escort", "atasehir-escort", "uskudar-escort", "umraniye-escort", "maltepe-escort"],
    keys: ["genc", "esmer", "vip", "sarisan", "gfe", "yabanci"]
  },
  {
    slugs: ["avcilar-escort", "esenyurt-escort", "beylikduzu-escort", "buyukcekmece-escort", "kucukcekmece-escort", "basaksehir-escort"],
    keys: ["sarisan", "genc", "esmer", "balikEtli", "otel", "vip"]
  },
  {
    slugs: ["fatih-escort", "zeytinburnu-escort", "bayrampasa-escort", "eyupsultan-escort"],
    keys: ["yabanci", "vip", "otel", "sarisan", "genc", "esmer"]
  },
  {
    slugs: ["pendik-escort", "kartal-escort", "tuzla-escort", "sancaktepe-escort", "cekmekoy-escort", "beykoz-escort"],
    keys: ["esmer", "genc", "vip", "sarisan", "otel", "gfe"]
  },
  {
    slugs: ["bagcilar-escort", "bahcelievler-escort", "gungoren-escort", "esenler-escort", "gaziosmanpasa-escort", "sultangazi-escort"],
    keys: ["genc", "esmer", "sarisan", "balikEtli", "vip", "otel"]
  },
  {
    slugs: ["arnavutkoy-escort", "catalca-escort", "silivri-escort", "sile-escort", "adalar-escort", "sultanbeyli-escort"],
    keys: ["vip", "esmer", "sarisan", "genc", "otel", "gfe"]
  }
];

const ALIAS_INTENT_OVERRIDES = [
  {
    slugs: ["laleli-escort", "aksaray-escort", "yenikapi-escort", "sehzadebasi-escort"],
    keys: ["yabanci", "otel", "vip", "sarisan", "genc", "esmer"]
  },
  {
    slugs: ["kavacik-escort", "cubuklu-escort", "anadoluhisari-escort"],
    keys: ["vip", "esmer", "gfe", "otel", "sarisan", "genc"]
  },
  {
    slugs: ["madenler-escort", "dudullu-escort", "yamanevler-escort"],
    keys: ["esmer", "genc", "vip", "otel", "sarisan", "gfe"]
  },
  {
    slugs: ["taksim-escort", "galata-escort", "karakoy-escort", "cihangir-escort", "asmalimescit-escort", "istiklal-escort"],
    keys: ["yabanci", "vip", "otel", "gfe", "sarisan", "esmer"]
  },
  {
    slugs: ["nisantasi-escort", "etiler-escort", "levent-escort", "bebek-escort", "maslak-escort", "akaretler-escort", "harbiye-escort", "osmanbey-escort"],
    keys: ["vip", "sarisan", "gfe", "yabanci", "otel", "esmer"]
  },
  {
    slugs: ["florya-escort", "atakoy-escort", "yesilkoy-escort", "yesilyurt-escort", "sahrayicedit-escort", "suadiye-escort", "caddebostan-escort", "feneryolu-escort", "fenerbahce-escort"],
    keys: ["vip", "sarisan", "esmer", "gfe", "otel", "yabanci"]
  },
  {
    slugs: ["beykent-escort", "bahcesehir-escort", "kayaşehir-escort", "kayasehir-escort", "gunesli-escort", "mahmutbey-escort", "sefakoy-escort", "halkali-escort"],
    keys: ["sarisan", "genc", "esmer", "vip", "otel", "balikEtli"]
  }
];

function clean(value) {
  return String(value || "").trim();
}

function activeProfiles(profiles) {
  return (profiles || []).filter((profile) => profile && profile.is_active !== false);
}

function isVipProfile(profile) {
  return profile?.type === "vip" || profile?.is_featured === true;
}

function sortProfiles(profiles) {
  return [...activeProfiles(profiles)].sort((left, right) => {
    const leftOrder = Number(left.vip_slot ?? left.normal_slot ?? left.priority_order ?? left.display_priority ?? 999);
    const rightOrder = Number(right.vip_slot ?? right.normal_slot ?? right.priority_order ?? right.display_priority ?? 999);

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    const leftVip = isVipProfile(left) ? 0 : 1;
    const rightVip = isVipProfile(right) ? 0 : 1;
    if (leftVip !== rightVip) {
      return leftVip - rightVip;
    }

    const leftCreated = new Date(left.created_at || 0).getTime();
    const rightCreated = new Date(right.created_at || 0).getTime();
    if (leftCreated !== rightCreated) {
      return rightCreated - leftCreated;
    }

    return clean(left.name).localeCompare(clean(right.name), "tr");
  });
}

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || "");

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function profileStableKey(profile, index) {
  return [
    profile?.id,
    profile?.slug,
    profile?.name,
    profile?.created_at,
    index
  ].map(clean).filter(Boolean).join(":");
}

function shuffleProfilesForLanding(profiles, seed) {
  const ranked = profiles
    .map((profile, index) => ({
      profile,
      index,
      score: stableHash(`${seed}:${profileStableKey(profile, index)}`)
    }))
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      return left.index - right.index;
    })
    .map((item) => item.profile);

  if (ranked.length < 2) return ranked;

  const offset = stableHash(`${seed}:rotate`) % ranked.length;
  return [...ranked.slice(offset), ...ranked.slice(0, offset)];
}

function uniqueKeys(keys) {
  const seen = new Set();
  return (keys || []).filter((key) => {
    if (!key || seen.has(key) || !SEARCH_DEMAND_INTENTS[key]) return false;
    seen.add(key);
    return true;
  });
}

function rotateKeys(keys, seed) {
  const rows = uniqueKeys(keys);
  if (rows.length < 4) return rows;
  const fixed = rows.slice(0, 2);
  const rest = rows.slice(2);
  const offset = stableHash(`${seed}:intent-rotate`) % rest.length;
  return fixed.concat(rest.slice(offset), rest.slice(0, offset));
}

function fallbackIntentKeysForSlug(safeLandingSlug) {
  const target = getDistrictBySlug(safeLandingSlug);
  const parentSlug = target?.is_alias && target.parent_district
    ? `${safeSlug(target.parent_district)}-escort`
    : "";

  const exact = DISTRICT_SEARCH_DEMANDS[safeLandingSlug];
  if (exact?.length) return rotateKeys(exact, safeLandingSlug);

  const aliasOverride = ALIAS_INTENT_OVERRIDES.find((group) => group.slugs.includes(safeLandingSlug));
  if (aliasOverride) return rotateKeys(aliasOverride.keys, safeLandingSlug);

  if (parentSlug && DISTRICT_SEARCH_DEMANDS[parentSlug]?.length) {
    return rotateKeys(DISTRICT_SEARCH_DEMANDS[parentSlug], safeLandingSlug);
  }

  const group = LOCAL_INTENT_GROUPS.find((item) => item.slugs.includes(safeLandingSlug) || (parentSlug && item.slugs.includes(parentSlug)));
  if (group) return rotateKeys(group.keys, safeLandingSlug);

  return DEFAULT_SEARCH_DEMAND_KEYS
    .map((key, index) => ({
      key,
      score: stableHash(`${safeLandingSlug}:${key}:${index}`)
    }))
    .sort((left, right) => left.score - right.score)
    .map((item) => item.key);
}

function groupIntentKeysForSlug(slug) {
  const safeLandingSlug = `${safeSlug(String(slug || "").replace(/-escort$/i, ""))}-escort`;
  const target = getDistrictBySlug(safeLandingSlug);
  const parentSlug = target?.is_alias && target.parent_district
    ? `${safeSlug(target.parent_district)}-escort`
    : "";
  const observed = observedDemandKeys(safeLandingSlug);
  const inherited = observed.length || !parentSlug ? [] : observedDemandKeys(parentSlug);
  const fallback = fallbackIntentKeysForSlug(safeLandingSlug);

  return rotateKeys(uniqueKeys([...observed, ...inherited, ...fallback]), safeLandingSlug);
}

function demandRowsForDistrict(slug) {
  const safeLandingSlug = `${safeSlug(String(slug || "").replace(/-escort$/i, ""))}-escort`;
  const keys = groupIntentKeysForSlug(safeLandingSlug);

  return keys
    .map((key, index) => {
      const intent = SEARCH_DEMAND_INTENTS[key];
      if (!intent) return null;
      return {
        key,
        weight: ((keys.length - index) * 100) + Number(intent.weight || 1),
        keywords: intent.keywords || []
      };
    })
    .filter(Boolean);
}

function demandLabelsForLanding(slug, limit = 3) {
  return demandRowsForDistrict(slug)
    .slice(0, limit)
    .map((row) => SEARCH_DEMAND_INTENTS[row.key]?.label)
    .filter(Boolean);
}

function profileDemandScore(profile, demandRows) {
  const haystack = profileTextHaystack(profile);
  if (!haystack) return 0;

  return demandRows.reduce((score, demand) => {
    const matched = demand.keywords
      .map((keyword) => safeSlug(keyword))
      .filter(Boolean)
      .some((keyword) => haystack.includes(keyword));

    return matched ? score + demand.weight : score;
  }, 0);
}

function profileLocalityScore(profile, slug) {
  const safeLandingSlug = `${safeSlug(String(slug || "").replace(/-escort$/i, ""))}-escort`;
  const target = getDistrictBySlug(safeLandingSlug);
  const landingNameSlug = safeSlug(target?.name || safeLandingSlug.replace(/-escort$/i, ""));
  const parentSlug = target?.is_alias && target.parent_district
    ? safeSlug(target.parent_district)
    : landingNameSlug;
  const profileDistrictSlug = safeSlug(profile?.district || "");
  const profileNeighborhoodSlug = safeSlug(profile?.neighborhood || profile?.location || "");
  const haystack = profileTextHaystack(profile);
  let score = 0;

  if (profileNeighborhoodSlug && profileNeighborhoodSlug === landingNameSlug) score += 900;
  if (profileDistrictSlug && profileDistrictSlug === parentSlug) score += 650;
  if (landingNameSlug && haystack.includes(landingNameSlug)) score += 180;
  if (parentSlug && parentSlug !== landingNameSlug && haystack.includes(parentSlug)) score += 120;

  return score;
}

function rankProfilesForDistrictDemand(profiles, slug) {
  const demandRows = demandRowsForDistrict(slug);
  if (!demandRows.length) return shuffleProfilesForLanding(profiles, slug);

  return profiles
    .map((profile, index) => ({
      profile,
      index,
      score: profileLocalityScore(profile, slug) + profileDemandScore(profile, demandRows)
    }))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.index - right.index;
    })
    .map((item) => item.profile);
}

function rankProfilesForLocalIntent(profiles, slug) {
  return rankProfilesForDistrictDemand(shuffleProfilesForLanding(sortProfiles(profiles), slug), slug);
}

/**
 * Full Istanbul pool stays visible on every category URL.
 * Profiles that match the category intent (tags/copy) and demand keywords rise first.
 */
function rankProfilesForCategoryIntent(profiles, category, slug) {
  const demandRows = demandRowsForDistrict(slug);
  const ordered = shuffleProfilesForLanding(sortProfiles(profiles), slug);

  return ordered
    .map((profile, index) => ({
      profile,
      index,
      score:
        (categoryMatches(profile, category) ? 1200 : 0) +
        (isVipProfile(profile) ? 80 : 0) +
        profileDemandScore(profile, demandRows) +
        (isCitywideProfile(profile) ? 20 : 0)
    }))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.index - right.index;
    })
    .map((item) => item.profile);
}

function latestProfiles(profiles) {
  return [...activeProfiles(profiles)].sort((left, right) => {
    const leftCreated = new Date(left.created_at || 0).getTime();
    const rightCreated = new Date(right.created_at || 0).getTime();
    return rightCreated - leftCreated;
  });
}

function profileDistrict(profile) {
  const district = clean(profile?.district);
  const normalized = safeSlug(district);
  if (!district || ["geneli", "istanbul-geneli", "istanbul"].includes(normalized)) {
    return "";
  }
  return clean(getProfileArea(profile));
}

function profileTextHaystack(profile) {
  return [
    profile?.type,
    profile?.city,
    profile?.district,
    profile?.neighborhood,
    profile?.location,
    profile?.slug,
    profile?.name,
    profile?.card_label,
    profile?.description,
    Array.isArray(profile?.tags) ? profile.tags.join(" ") : profile?.tags
  ]
    .map((value) => safeSlug(clean(value)))
    .filter(Boolean)
    .join(" ");
}

function profileLocationValues(profile) {
  return [
    profile?.district,
    profile?.neighborhood,
    profile?.location
  ]
    .flatMap((value) => String(value || "").split(/[,/|]/))
    .map((value) => safeSlug(clean(value)))
    .filter((value) => value && !["geneli", "istanbul-geneli", "istanbul"].includes(value));
}

function isIstanbulProfile(profile) {
  return safeSlug(clean(profile?.city || "İstanbul")) === "istanbul";
}

function districtProfileMatches(profile, district) {
  if (!district || !isIstanbulProfile(profile)) return false;

  const values = new Set(profileLocationValues(profile));
  const target = safeSlug(district.name);
  if (!target || !values.size) return false;
  if (district.is_alias) return values.has(target);

  const accepted = new Set([
    target,
    ...getDistrictAliases(district.name).map((alias) => safeSlug(alias.name))
  ]);
  return [...values].some((value) => accepted.has(value));
}

function localProfilesForDistrict(district, profiles) {
  return sortProfiles(profiles).filter((profile) => districtProfileMatches(profile, district));
}

function isCitywideProfile(profile) {
  if (!isIstanbulProfile(profile)) return false;

  const localValues = [
    profile?.district,
    profile?.neighborhood,
    profile?.location
  ]
    .map((value) => safeSlug(clean(value)))
    .filter(Boolean);

  if (!localValues.length) {
    return safeSlug(clean(profile?.city || "İstanbul")) === "istanbul";
  }

  return localValues.some((value) => ["geneli", "istanbul-geneli", "istanbul"].includes(value));
}

function districtLandingCoverage(district, profiles, slug, options = {}) {
  const sorted = sortProfiles(profiles);
  const exactProfiles = sorted.filter((profile) => districtProfileMatches(profile, district));
  const exactSet = new Set(exactProfiles);
  const parentDistrict = district?.is_alias && district.parent_district
    ? districtRows().find((row) => row.name === district.parent_district)
    : null;
  const parentProfiles = parentDistrict
    ? sorted.filter((profile) => !exactSet.has(profile) && districtProfileMatches(profile, parentDistrict))
    : [];
  const supportedSet = new Set([...exactProfiles, ...parentProfiles]);
  const citywideProfiles = sorted.filter((profile) => (
    !supportedSet.has(profile) && isCitywideProfile(profile)
  ));
  const supportedProfiles = [...exactProfiles, ...parentProfiles, ...citywideProfiles];

  return {
    exactProfiles,
    parentProfiles,
    citywideProfiles,
    profiles: options.rank === false
      ? supportedProfiles
      : rankProfilesForLocalIntent(supportedProfiles, slug)
  };
}

function categoryMatches(profile, category) {
  if (!category) return false;
  if (category.is_city_hub) return true;
  if (category.key === "vip") return isVipProfile(profile);

  const haystack = profileTextHaystack(profile);
  const needles = [
    category.key,
    category.slug.replace(/-escort$/i, ""),
    category.name.replace(/ escort$/i, ""),
    ...(Array.isArray(category.keywords) ? category.keywords : [])
  ]
    .map((value) => safeSlug(value))
    .filter(Boolean);

  return needles.some((needle) => haystack.includes(needle));
}

function uniqueLinks(links) {
  const seen = new Set();
  return links.filter((link) => {
    if (!link || !link.href || !link.title) return false;
    const key = `${link.href}::${link.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueTexts(values) {
  const seen = new Set();
  return (values || []).map(clean).filter(Boolean).filter((value) => {
    const key = safeSlug(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function districtBuckets(profiles) {
  const buckets = new Map();

  activeProfiles(profiles).forEach((profile) => {
    const name = profileDistrict(profile);
    if (!name) return;
    const current = buckets.get(name) || [];
    current.push(profile);
    buckets.set(name, current);
  });

  return [...buckets.entries()]
    .map(([name, items]) => ({
      name,
      slug: `${safeSlug(name)}-escort`,
      count: items.length
    }))
    .sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count;
      return left.name.localeCompare(right.name, "tr");
    });
}

function resolveLandingTarget(slug) {
  const safeLandingSlug = safeSlug(slug);
  const district = getDistrictBySlug(safeLandingSlug);
  if (district) {
    return {
      slug: safeLandingSlug,
      type: "district",
      district,
      category: null
    };
  }

  if (safeLandingSlug === "istanbul-escort") {
    return {
      slug: safeLandingSlug,
      type: "city",
      district: null,
      category: getCategoryBySlug(safeLandingSlug)
    };
  }

  const category = getCategoryBySlug(safeLandingSlug);
  if (category) {
    return {
      slug: safeLandingSlug,
      type: "category",
      district: null,
      category
    };
  }

  return null;
}

function formatList(names) {
  const rows = names.filter(Boolean);
  if (!rows.length) return "";
  if (rows.length === 1) return rows[0];
  if (rows.length === 2) return `${rows[0]} ve ${rows[1]}`;
  return `${rows.slice(0, -1).join(", ")} ve ${rows.at(-1)}`;
}

function trimSentence(value, maxLength = 170) {
  const text = clean(value).replace(/\s+/g, " ");
  if (text.length <= maxLength) return text;
  const sliced = text.slice(0, maxLength).trim();
  const sentenceEnds = [...sliced.matchAll(/[.!?](?=\s|$)/g)];
  const lastSentenceEnd = sentenceEnds.at(-1)?.index;
  if (Number.isInteger(lastSentenceEnd) && lastSentenceEnd >= Math.min(80, Math.floor(maxLength * 0.6))) {
    return sliced.slice(0, lastSentenceEnd + 1).trim();
  }
  const lastSpace = sliced.lastIndexOf(" ");
  const fallback = lastSpace > Math.floor(maxLength * 0.6)
    ? sliced.slice(0, lastSpace)
    : sliced.slice(0, Math.max(0, maxLength - 1));
  return `${fallback.trim()}…`;
}

function sentenceLead(text) {
  const value = clean(text);
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "";
}

function polishDisplayCopy(value) {
  const replacements = [
    [/\bone cikan\b/gi, "öne çıkan"],
    [/\bbaglantilari\b/gi, "bağlantıları"],
    [/\bbaglantili\b/gi, "bağlantılı"],
    [/\bbaglantisi\b/gi, "bağlantısı"],
    [/\bbaglantisinde\b/gi, "bağlantısında"],
    [/\bbaglantisini\b/gi, "bağlantısını"],
    [/\bbaglantilarini\b/gi, "bağlantılarını"],
    [/\bbaglantilariyle\b/gi, "bağlantılarıyla"],
    [/\bbaglanti\b/gi, "bağlantı"],
    [/\bakisi\b/gi, "akışı"],
    [/\bakis\b/gi, "akış"],
    [/\bhizlica\b/gi, "hızlıca"],
    [/\bhizli\b/gi, "hızlı"],
    [/\bsecili\b/gi, "seçili"],
    [/\bsecimi\b/gi, "seçimi"],
    [/\bsecenekleri\b/gi, "seçenekleri"],
    [/\bilce\b/gi, "ilçe"],
    [/\bbolgeler\b/gi, "bölgeler"],
    [/\bbolge\b/gi, "bölge"],
    [/\bguncel\b/gi, "güncel"],
    [/\bkullaniciya\b/gi, "kullanıcıya"],
    [/\bkullaniciyi\b/gi, "kullanıcıyı"],
    [/\bkullanici\b/gi, "kullanıcı"],
    [/\bcevre\b/gi, "çevre"],
    [/\bcevresi\b/gi, "çevresi"],
    [/\bsayfasi\b/gi, "sayfası"],
    [/\buyusan\b/gi, "uyuşan"],
    [/\btasiyan\b/gi, "taşıyan"],
    [/\bdogrudan\b/gi, "doğrudan"],
    [/\buzerinden\b/gi, "üzerinden"],
    [/\baramayi\b/gi, "aramayı"],
    [/\bdaraltir\b/gi, "daraltır"],
    [/\bsonuclara\b/gi, "sonuçlara"],
    [/\bulasabilir\b/gi, "ulaşabilir"],
    [/\byakin\b/gi, "yakın"],
    [/\bayni\b/gi, "aynı"],
    [/\bguclu\b/gi, "güçlü"],
    [/\bguclenen\b/gi, "güçlenen"],
    [/\byogun\b/gi, "yoğun"],
    [/\bhattinda\b/gi, "hattında"],
    [/\baksinda\b/gi, "aksında"],
    [/\byakasinda\b/gi, "yakasında"],
    [/\byakasi\b/gi, "yakası"],
    [/\bbogaz\b/gi, "boğaz"],
    [/\bbati\b/gi, "batı"],
    [/\bdogu\b/gi, "doğu"],
    [/\bkuzeydogu\b/gi, "kuzeydoğu"],
    [/\bic\b/gi, "iç"],
    [/\bgenis\b/gi, "geniş"],
    [/\byerlesim\b/gi, "yerleşim"],
    [/\byonlenme\b/gi, "yönlenme"],
    [/\byuksek\b/gi, "yüksek"],
    [/\bnetlestiren\b/gi, "netleştiren"],
    [/\bsinirinda\b/gi, "sınırında"],
    [/\bkarmasini\b/gi, "karmasını"],
    [/\byasam\b/gi, "yaşam"],
    [/\bgol\b/gi, "göl"],
    [/\bbandinda\b/gi, "bandında"],
    [/\bkontrollu\b/gi, "kontrollü"],
    [/\berisim\b/gi, "erişim"],
    [/\bsadeleyen\b/gi, "sadeleyen"],
    [/\bonceligi\b/gi, "önceliği"],
    [/\bfiltrelenmis\b/gi, "filtrelenmiş"],
    [/\barasinda\b/gi, "arasında"],
    [/\besiginde\b/gi, "eşiğinde"],
    [/\bis\b/gi, "iş"],
    [/\bdagilan\b/gi, "dağılan"],
    [/\bdagilimi\b/gi, "dağılımı"],
    [/\bduzenli\b/gi, "düzenli"],
    [/\bduzenleyen\b/gi, "düzenleyen"],
    [/\bbirlestiren\b/gi, "birleştiren"],
    [/\baramasinda\b/gi, "aramasında"],
    [/\bkisa\b/gi, "kısa"],
    [/\bdis\b/gi, "dış"],
    [/\bvucut\b/gi, "vücut"],
    [/\bodakli\b/gi, "odaklı"],
    [/\bhazirlanmistir\b/gi, "hazırlanmıştır"],
    [/\bicin\b/gi, "için"]
  ];

  return replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), clean(value));
}

function districtFocus(district) {
  return polishDisplayCopy(district?.focus || "mobilde hızlı profil seçimi ve seçili kart yapısı");
}

function districtTransit(district, nearbyDistrictNames) {
  return polishDisplayCopy(district?.transit || formatList(nearbyDistrictNames));
}

function districtAliasLinks(district, profiles = null) {
  if (!district) return [];
  const sourceName = district.is_alias ? district.parent_district : district.name;
  if (!sourceName) return [];

  return getDistrictAliases(sourceName)
    .filter((alias) => alias.slug !== district.slug)
    .filter((alias) => (
      !Array.isArray(profiles) ||
      profiles.length > 0
    ))
    .map((alias) => ({
    href: `/${alias.slug}`,
    title: `${alias.name} Escort`
  }));
}

function districtAliasNames(district, profiles = null) {
  return districtAliasLinks(district, profiles)
    .map((link) => link.title.replace(/\s+Escort$/i, ""))
    .filter(Boolean);
}

function districtAliasSentence(district) {
  const aliases = districtAliasNames(district).slice(0, 6);
  return aliases.length ? `${formatList(aliases)} gibi semt ilanları` : "";
}

function districtLocalIntentRows(district, profiles = null) {
  if (!district) return [];

  const sourceName = district.is_alias ? district.parent_district : district.name;
  const aliasRows = sourceName ? getDistrictAliases(sourceName) : [];
  const rows = district.is_alias
    ? [
      district,
      ...aliasRows.filter((alias) => alias.slug !== district.slug)
    ]
    : aliasRows;

  return rows
    .filter((alias) => (
      !Array.isArray(profiles) ||
      profiles.length > 0
    ))
    .slice(0, 6)
    .map((alias) => {
    const aliasName = clean(alias.name);
    const parentName = clean(alias.parent_district || district.parent_district || district.name);
    return {
      href: `/${alias.slug}`,
      title: `${aliasName} Escort`,
      text: `${aliasName} escort ilanlarını ${parentName} içindeki ayrı semt sayfasında inceleyin.`
    };
  });
}

function buildDistrictInventoryText(district, coverage) {
  const exactCount = coverage?.exactProfiles?.length || 0;
  const parentCount = coverage?.parentProfiles?.length || 0;
  const citywideCount = coverage?.citywideProfiles?.length || 0;
  const totalCount = coverage?.profiles?.length || 0;

  if (!totalCount) {
    return `${district.name} veya İstanbul Geneli konum bilgisi taşıyan aktif profil şu anda görünmüyor.`;
  }

  const parts = [
    exactCount
      ? `${exactCount} profil ${district.name} ${district.is_alias ? "semt" : "ilçe veya semt"} konumuyla`
      : "",
    parentCount
      ? `${parentCount} profil ${district.parent_district} ilçe konumuyla`
      : "",
    citywideCount
      ? `${citywideCount} profil İstanbul Geneli kapsamıyla`
      : ""
  ].filter(Boolean);

  return `Toplam ${totalCount} aktif profil gösterilir: ${parts.join(", ")}.`;
}

function buildDistrictIntro(district, nearbyDistrictNames, inventoryText) {
  const name = clean(district?.name);
  const parentName = clean(district?.parent_district || "");
  const pageType = district?.is_alias ? "semt" : "ilçe";
  const parentText = parentName ? `${parentName} ilçesine bağlı bu semt sayfasında` : `Bu ${pageType} sayfasında`;
  const nearbyText = nearbyDistrictNames.length
    ? ` ${formatList(nearbyDistrictNames.slice(0, 3))} ve diğer yakın bölgelerin ilanlarına da tek dokunuşla geçebilirsiniz.`
    : " İstanbul genelindeki diğer ilanlara ve kategorilere de kolayca ulaşabilirsiniz.";

  return `${name} escort ilanlarını fotoğrafları ve temel profil bilgileriyle inceleyin. ${parentText} yalnız desteklenen yerel ve şehir geneli kapsam gösterilir. ${inventoryText}${nearbyText}`;
}

function buildCategoryIntro(name, districtNames) {
  return `${name} kategorisi, ilgili profilleri tek listede daha kolay incelemek için hazırlanmıştır. ${districtNames.length ? `${formatList(districtNames.slice(0, 3))} gibi öne çıkan bölgelerle aramayı hızla daraltır.` : "Kategori akışı, aktif vitrinleri sade ve okunur bir düzende sunar."}`;
}

function categoryFocus(category) {
  return polishDisplayCopy(category?.focus || "kategori tercihine uyan seçili profil akışı");
}

function categoryDiscovery(category) {
  return polishDisplayCopy(category?.discovery || "ilgili ilçe ve kategori bağlantıları");
}

function categoryAssist(category) {
  return polishDisplayCopy(category?.assist || "kategori ile bölge arasında rahat bağlantı");
}

function buildCategoryEditorialIntro(category, districtNames) {
  const name = clean(category?.name || "Kategori");
  const districtText = districtNames.length
    ? ` ${formatList(districtNames.slice(0, 3))} ve diğer ilçe sayfalarından bölgeye göre seçim yapabilirsiniz.`
    : " İstanbul genelindeki ilçe ve semt ilanlarına da kolayca ulaşabilirsiniz.";

  return `${name} etiketine uyan aktif profil ilanlarını fotoğrafları ve temel bilgileriyle tek listede inceleyin.${districtText}`;
}

function buildCityIntro() {
  return "İstanbul escort araması için şehir geneli güncel profiller, ilçe ve semt bağlantıları ile dolu kategori seçenekleri tek sayfada kolayca incelenir.";
}

function buildQuickCategoryLinks(currentSlug, profiles) {
  return uniqueLinks(
    QUICK_CATEGORY_SLUGS
      .filter((slug) => slug !== currentSlug)
      .map((slug) => {
        const category = getCategoryBySlug(slug);
        if (!category) return null;
        if (!category.is_city_hub && !filterProfilesForLanding(category.slug, profiles).length) {
          return null;
        }
        return { href: `/${category.slug}`, title: category.name };
      })
  );
}

/** Soft cap for the secondary "İstanbul geneli diğer" rail — keeps pages lighter. */
const SECONDARY_PROFILE_CAP = 18;

/**
 * Primary inventory membership (indexability + main grid).
 * District/semt: exact local + parent + citywide geneli (hybrid split applied in filter).
 * Category: category-matching profiles only.
 * City: full Istanbul inventory.
 */
function profilesSupportingLanding(slug, profiles) {
  const target = resolveLandingTarget(slug);
  if (!target) return [];

  const active = activeProfiles(profiles).filter(isIstanbulProfile);
  const sortedActive = sortProfiles(active);

  if (target.type === "city") {
    return sortedActive;
  }

  if (target.type === "district" && target.district) {
    return districtLandingCoverage(target.district, sortedActive, target.slug, { rank: false }).profiles;
  }

  if (target.type === "category" && target.category) {
    return sortedActive.filter((profile) => categoryMatches(profile, target.category));
  }

  return [];
}

/**
 * Cap primary pure-citywide grids so each district's visible primary selection
 * stays distinct under ranking, while the rest moves to the discovery rail.
 */
const PURE_CITYWIDE_PRIMARY_CAP = 12;

function filterProfilesForLanding(slug, profiles) {
  const target = resolveLandingTarget(slug);
  const supported = profilesSupportingLanding(slug, profiles);

  if (target?.type === "district" && target.district) {
    const coverage = districtLandingCoverage(
      target.district,
      activeProfiles(profiles).filter(isIstanbulProfile),
      target.slug,
      { rank: false }
    );
    const hasLocal = (coverage.exactProfiles?.length || 0) + (coverage.parentProfiles?.length || 0) > 0;
    const ranked = rankProfilesForLocalIntent(supported, target.slug);
    // When inventory is only citywide geneli, keep a demand-ranked top slice in
    // primary (a distinct visible selection per district) and push the remainder secondary.
    if (!hasLocal && ranked.length > PURE_CITYWIDE_PRIMARY_CAP) {
      return ranked.slice(0, PURE_CITYWIDE_PRIMARY_CAP);
    }
    return ranked;
  }

  if (target?.type === "category" && target.category) {
    return rankProfilesForCategoryIntent(supported, target.category, target.slug);
  }

  return supported;
}

/**
 * Secondary rail: remaining active Istanbul profiles not in the primary set.
 * Improves discovery without polluting the local/category primary grid.
 */
function secondaryProfilesForLanding(slug, profiles) {
  const target = resolveLandingTarget(slug);
  if (!target || target.type === "city") return [];

  const active = activeProfiles(profiles).filter(isIstanbulProfile);
  const primarySet = new Set(filterProfilesForLanding(slug, profiles));
  const rest = sortProfiles(active).filter((profile) => !primarySet.has(profile));
  if (!rest.length) return [];

  if (target.type === "district") {
    return rankProfilesForLocalIntent(rest, target.slug).slice(0, SECONDARY_PROFILE_CAP);
  }

  if (target.type === "category" && target.category) {
    return rankProfilesForCategoryIntent(rest, target.category, target.slug).slice(0, SECONDARY_PROFILE_CAP);
  }

  return rest.slice(0, SECONDARY_PROFILE_CAP);
}

function exactLocalProfilesForLanding(slug, profiles) {
  const target = resolveLandingTarget(slug);
  if (!target || target.type !== "district" || !target.district) return [];
  return localProfilesForDistrict(target.district, activeProfiles(profiles));
}

function buildDistrictLinksFromBuckets(buckets, excludeSlug, limit = 8) {
  return uniqueLinks(
    buckets
      .filter((bucket) => bucket.slug !== excludeSlug)
      .slice(0, limit)
      .map((bucket) => ({
        href: `/${bucket.slug}`,
        title: `${bucket.name} Escort`
      }))
  );
}

function districtLinkFromRow(district) {
  return {
    href: `/${district.slug}`,
    title: `${district.name} Escort`,
    side: district.side || "",
    sideLabel: district.side_label || districtSideLabel(district.name)
  };
}

function buildAllDistrictLinks(excludeSlug = "", profiles = []) {
  if (!profiles.length) return [];

  return uniqueLinks(
    districtRows()
      .filter((district) => district.slug !== excludeSlug)
      .map(districtLinkFromRow)
  );
}

function buildSideDistrictGroups(profiles) {
  if (!profiles.length) return [];

  return sideGroups()
    .map((group) => {
      const districts = group.districts;
      const aliases = group.aliases;
      return {
        key: group.key,
        title: group.title,
        count: districts.length,
        semtCount: aliases.length,
        links: districts.map(districtLinkFromRow)
      };
    })
    .filter((group) => group.links.length > 0);
}

function buildLandingContext(slug, profiles) {
  const target = resolveLandingTarget(slug);
  if (!target) return null;

  const safeLandingSlug = target.slug;
  const type = target.type;
  const district = target.district;
  const category = target.category;
  const active = activeProfiles(profiles).filter(isIstanbulProfile);
  // Hybrid: primary = local/parent/geneli or category match; secondary = other Istanbul.
  const districtCoverage = type === "district" && district
    ? districtLandingCoverage(district, active, safeLandingSlug, { rank: false })
    : null;
  const filtered = filterProfilesForLanding(safeLandingSlug, active);
  const secondaryProfiles = secondaryProfilesForLanding(safeLandingSlug, active);
  const indexable = type === "city"
    || (type === "district" ? filtered.length > 0 : filtered.length > 0)
    || (type === "category" && category?.is_city_hub === true);

  const featured = type === "district" ? [] : filtered.filter(isVipProfile).slice(0, 12);
  const orderedPrimaryProfiles = (
    type === "district"
      ? filtered
      : (featured.length ? featured.concat(filtered.filter((profile) => !featured.includes(profile))) : filtered)
  );
  // Category primary stays focused (cap); district primary is full local coverage set.
  const primaryProfiles = type === "district"
    ? orderedPrimaryProfiles
    : orderedPrimaryProfiles.slice(0, 24);
  const recentProfiles = (type === "district" ? filtered : latestProfiles(filtered)).slice(0, 6);
  const filteredBuckets = districtBuckets(filtered.length ? filtered : active);
  const totalDistrictCount = new Set(active.map((profile) => safeSlug(profileDistrict(profile))).filter(Boolean)).size;
  const vipCount = filtered.filter(isVipProfile).length;
  const secondaryTitle = "İstanbul Geneli Diğer İlanlar";
  const secondaryText = secondaryProfiles.length
    ? `Bu sayfanın ana listesine girmeyen ${secondaryProfiles.length} aktif İstanbul ilanı keşif için ayrı blokta listelenir; iletişim yine profil detayında açılır.`
    : "";

  if (type === "city") {
    const districtLinks = buildAllDistrictLinks("", active);
    const sideDistrictGroups = buildSideDistrictGroups(active);
    const categoryLinks = buildQuickCategoryLinks(safeLandingSlug, active);
    const activeDistrictLinks = buildDistrictLinksFromBuckets(filteredBuckets, "", 10);
    const quickLinks = uniqueLinks([
      ...activeDistrictLinks.slice(0, 5),
      ...categoryLinks.slice(0, 4)
    ]);

    return {
      type,
      indexable,
      slug: safeLandingSlug,
      name: "İstanbul",
      totalProfileCount: filtered.length,
      kicker: "İstanbul İlanları",
      heroLead: "İstanbul",
      heroAccent: "Escort",
      heroText: buildCityIntro(),
      pageTitle: "İstanbul Escort | Güncel VIP İlanları | VIP Gece",
      metaDescription: trimSentence(
        `İstanbul escort ilanlarında ${active.length} güncel profili fotoğraf, yaş, boy ve konum bilgileriyle inceleyin; ${districtLinks.length} ilçe ve semt sayfasına tek yerden ulaşın.`,
        160
      ),
      sectionTitle: "İstanbul Geneli Güncel Profiller",
      sectionText: "Şehir genelindeki aktif vitrinler, öne çıkan profiller ve ilçe bazlı ilan bağlantıları aynı akış içinde listelenir.",
      primaryProfiles,
      secondaryProfiles: [],
      secondaryTitle: "",
      secondaryText: "",
      recentProfiles,
      summaryItems: [
        { value: String(districtLinks.length), label: "aktif ilçe" },
        { value: String(sideDistrictGroups.length), label: "yaka grubu" },
        { value: String(active.length), label: "aktif profil" },
        { value: String(filteredBuckets.length), label: "aktif bölge" }
      ],
      districtLinks,
      sideDistrictGroups,
      categoryLinks,
      quickLinks,
      nearbyTitle: "İlçelere Hızlı Erişim",
      nearbyText: "Güncel profil bulunan ilçe sayfaları Avrupa Yakası ve Anadolu Yakası olarak ayrılır.",
      nearbyLinks: districtLinks,
      faqTitle: "İstanbul Escort İlanları",
      faqItems: [
        {
          question: "İstanbul sayfası ne işe yarar?",
          answer: "Bu sayfa, şehir geneli profilleri tek ekranda toplar; ilçe ve kategori sayfalarına hızlı erişim verir."
        },
        {
          question: "Mobil akış nasıl düzenlendi?",
          answer: "Üst bölüm kısa özet, hızlı çipler ve seçili kartlarla başlar; alt bölümde ilçe ve kategori bağlantıları daha sakin bir bölümde devam eder."
        }
      ],
      seoTitle: "İstanbul Profil Seçenekleri",
      seoParagraphs: [
        "İstanbul escort sayfası, şehir genelindeki güncel profil ilanlarının ana girişidir. Avrupa Yakası ve Anadolu Yakası ilçe bağlantıları ayrı gruplar halinde verilir.",
        "Bu sayfada ziyaretçi önce şehir genelindeki aktif vitrinleri görür, ardından ilçe veya kategori seçerek aramasını daraltır. Görsel kartlar, profil isimleri, temel bilgiler ve ilan bağlantıları birlikte verildiği için karar süreci dağılmaz.",
        "İstanbul genelinde arama yapan kullanıcı, güncel profil kartlarına tek sayfadan erişebilir; daha yerel sonuç isteyen kullanıcı ilçe veya semt bağlantılarına geçebilir.",
        "Kategori bağlantıları da şehir sayfasından ayrılmadan kullanılabilir. Yalnız aktif profille eşleşen dolu kategoriler gösterilir; kullanıcı ardından bölge ve profil detayını daha net karşılaştırır."
      ],
      searchTerms: uniqueTexts([
        "istanbul escort",
        ...districtLinks.map((link) => `${link.title.toLocaleLowerCase("tr-TR")}`)
      ]),
      internalLinks: uniqueLinks([
        ...districtLinks,
        ...categoryLinks
      ]),
      breadcrumbItems: [
        { name: "Ana Sayfa", url: "/" },
        { name: "İstanbul Escort", url: `/istanbul-escort` }
      ]
    };
  }

  if (type === "district" && district) {
    const nearby = active.length ? getNearbyDistricts(district.name) : [];
    const sideLabel = district.side_label || districtSideLabel(district.parent_district || district.name);
    const parentDistrict = district.parent_district
      ? districtRows().find((row) => row.name === district.parent_district)
      : null;
    const supportedParentDistrict = parentDistrict && active.length ? parentDistrict : null;
    const aliasLinks = districtAliasLinks(district, active);
    const aliasNames = districtAliasNames(district, active);
    const localIntentRows = districtLocalIntentRows(district, active);
    const aliasText = aliasNames.length ? formatList(aliasNames.slice(0, 6)) : "";
    const nearbyLinks = uniqueLinks([
      supportedParentDistrict
        ? { href: `/${supportedParentDistrict.slug}`, title: `${supportedParentDistrict.name} Escort` }
        : null,
      ...aliasLinks,
      ...nearby.map((row) => ({
        href: `/${row.slug}`,
        title: `${row.name} Escort`
      }))
    ]);
    const demandLabels = demandLabelsForLanding(safeLandingSlug, 4);
    const categoryLinks = buildQuickCategoryLinks(safeLandingSlug, active);
    const quickLinks = uniqueLinks([
      { href: "/istanbul-escort", title: "İstanbul Escort" },
      ...aliasLinks.slice(0, 3),
      ...categoryLinks.slice(1, 6)
    ]);
    const inventoryText = buildDistrictInventoryText(district, {
      exactProfiles: districtCoverage?.exactProfiles || [],
      parentProfiles: districtCoverage?.parentProfiles || [],
      citywideProfiles: districtCoverage?.citywideProfiles || [],
      // Inventory copy reflects full supporting coverage, not the primary grid cap.
      profiles: districtCoverage?.profiles || filtered
    });
    const districtMetaDescription = trimSentence(
      `${district.name} escort ilanlarında güncel profil kartlarını fotoğraf, yaş, boy ve konum bilgileriyle inceleyin; yakın bölge ve iletişim seçeneklerine ulaşın.`,
      160
    );
    const districtFaqItems = [
      {
        question: `${district.name} escort sayfasında neler var?`,
        answer: `${inventoryText}${secondaryProfiles.length ? ` Altta ayrıca ${secondaryProfiles.length} İstanbul geneli diğer ilan keşif için listelenir.` : ""} Profil kartları bölgeyle uyum ve güncellik dikkate alınarak sıralanır.`
      },
      aliasNames.length
        ? {
          question: `${district.name} içinde hangi semt ilanları var?`,
          answer: `${district.name} sayfasında ${aliasText} bağlantıları da yer alır; kullanıcı ilçe sayfasından semt odaklı aramasına geçebilir.`
        }
        : null,
      {
        question: "İletişim bilgilerine nereden ulaşılır?",
        answer: "Telefon, WhatsApp ve diğer iletişim seçenekleri yalnızca seçilen profilin detay sayfasında gösterilir."
      }
    ].filter(Boolean);

    return {
      type,
      indexable,
      slug: safeLandingSlug,
      name: district.name,
      place: {
        name: `${district.name}, İstanbul`,
        addressLocality: district.parent_district || district.name,
        addressRegion: "İstanbul",
        addressCountry: "TR"
      },
      totalProfileCount: filtered.length,
      kicker: district.is_alias ? `${sideLabel || "İstanbul"} Semt İlanları` : `${sideLabel || "İstanbul"} İlçe İlanları`,
      heroLead: district.name,
      heroAccent: "Escort",
      heroText: buildDistrictIntro(district, nearby.map((row) => row.name), inventoryText),
      pageTitle: trimSentence(`${district.name} Escort | İstanbul VIP İlanları | VIP Gece`, 60),
      metaDescription: districtMetaDescription,
      sectionTitle: `${district.name} Odaklı Güncel Profiller`,
      sectionText: `${inventoryText} Ana listede yalnız bu bölge, bağlı ilçe ve İstanbul Geneli kapsamı yer alır; sıra yerel uyuma göre ayarlanır.`,
      primaryProfiles,
      secondaryProfiles,
      secondaryTitle,
      secondaryText,
      recentProfiles,
      summaryItems: [
        { value: sideLabel || "İstanbul", label: "bölge" },
        { value: String(primaryProfiles.length), label: "bölge kartı" },
        { value: String(vipCount), label: "VIP profil" },
        { value: String(localIntentRows.length || nearbyLinks.length), label: localIntentRows.length ? "semt ilanı" : "yakın ilçe" }
      ],
      categoryLinks,
      quickLinks,
      nearbyTitle: "Yakın Bölgeler",
      nearbyText: `${district.name} çevresindeki semt ve komşu ilçe ilanlarını inceleyin.`,
      nearbyLinks,
      faqTitle: `${district.name} Escort Hakkında`,
      faqItems: districtFaqItems,
      seoTitle: `${district.name} Profil Seçenekleri`,
      seoParagraphs: [
        `${inventoryText} ${district.name} sayfasının ana listesi yerel konum, bağlı ilçe ve İstanbul Geneli kapsamdaki kartları fotoğraf öncelikli gösterir.`,
        secondaryProfiles.length
          ? `Ana listeden ayrı olarak ${secondaryProfiles.length} İstanbul geneli diğer ilan keşif bloğunda yer alır; arama niyeti önce ${district.name} odaklı kartlara yönelir.`
          : "",
        localIntentRows.length ? `${formatList(localIntentRows.map((row) => row.title.replace(/\s+Escort$/i, "")).slice(0, 6))} semt sayfaları, ${district.name} içindeki ilanları daha ayrıntılı incelemek isteyen ziyaretçiler için doğrudan bağlantı sağlar.` : "",
        nearby.length ? `${formatList(nearby.map((row) => row.name).slice(0, 4))} sayfalarına geçerek yakın ilçelerdeki ilan sıralamalarını da karşılaştırabilirsiniz.` : "",
        `${district.name} profil kartlarında fotoğraf, isim, bölge, yaş ve boy bilgileri birlikte gösterilir. Telefon, WhatsApp ve diğer iletişim seçenekleri seçilen profilin detay sayfasında açılır.`,
        aliasNames.length ? `${aliasText} semt bağlantıları ile ${district.name} içindeki ilan sayfalarına ulaşabilir; kategori seçenekleriyle profil tercihine göre listeyi daraltabilirsiniz.` : `Kategori seçenekleriyle ${district.name} ilanlarını profil tercihine göre inceleyebilir, İstanbul sayfasından tüm bölgelere ulaşabilirsiniz.`
      ].filter(Boolean),
      searchTerms: uniqueTexts([
        `${district.name.toLocaleLowerCase("tr-TR")} escort`,
        ...demandLabels.map((label) => `${district.name.toLocaleLowerCase("tr-TR")} ${label.toLocaleLowerCase("tr-TR")} escort`),
        ...localIntentRows.map((row) => `${row.title.replace(/\s+Escort$/i, "").toLocaleLowerCase("tr-TR")} escort`),
        ...aliasNames.map((name) => `${name.toLocaleLowerCase("tr-TR")} escort`)
      ]),
      localIntentTitle: district.is_alias ? `${district.name} ve Yakın Semtler` : `${district.name} Semt İlanları`,
      localIntentRows,
      internalLinks: uniqueLinks([
        { href: "/istanbul-escort", title: "İstanbul Escort" },
        ...localIntentRows.map((row) => ({ href: row.href, title: row.title })),
        ...nearbyLinks,
        ...categoryLinks
      ]),
      breadcrumbItems: [
        { name: "Ana Sayfa", url: "/" },
        { name: "İstanbul Escort", url: "/istanbul-escort" },
        { name: `${district.name} Escort`, url: `/${district.slug}` }
      ]
    };
  }

  const districtLinks = buildDistrictLinksFromBuckets(filteredBuckets, "", 8);
  const categoryLinks = buildQuickCategoryLinks(safeLandingSlug, active);
  const quickLinks = uniqueLinks([
    { href: "/istanbul-escort", title: "İstanbul Escort" },
    ...districtLinks.slice(0, 4),
    ...categoryLinks.slice(0, 3)
  ]);
  const categoryName = category?.name || `${titleCaseArea(safeLandingSlug)} Escort`;
  const categoryCount = filtered.length;
  const matchedCategoryCount = filtered.filter((profile) => categoryMatches(profile, category)).length;
  const categoryDistrictNames = districtLinks.map((link) => link.title.replace(/\s+Escort$/i, ""));

  return {
    type,
    indexable,
    slug: safeLandingSlug,
    name: categoryName,
    totalProfileCount: filtered.length,
    kicker: "Kategori",
    heroLead: categoryName.replace(/\s+Escort$/i, ""),
    heroAccent: "Escort",
    heroText: buildCategoryEditorialIntro(category, districtLinks.map((link) => link.title.replace(/\s+Escort$/i, ""))),
    pageTitle: trimSentence(`${categoryName} | İstanbul VIP İlanları | VIP Gece`, 60),
    metaDescription: trimSentence(
      categoryCount
        ? `${categoryName}: ${categoryCount} aktif profili fotoğraf, yaş, boy ve konum bilgileriyle karşılaştırın; ilan detaylarını ve iletişim seçeneklerini inceleyin.`
        : `${categoryName}: İstanbul genelindeki güncel profil kartlarını ve ilçe bağlantılarını inceleyin; yeni eşleşen ilanlar yayınlandığında burada görünür.`,
      160
    ),
    sectionTitle: `${categoryName} Eşleşen Profiller`,
    sectionText: categoryCount
      ? `${categoryName} ana listesinde ${matchedCategoryCount || categoryCount} kategori uyumlu profil yer alır; sıra arama niyetine göre ayarlanır.`
      : `${categoryName} için henüz kategori uyumlu yayınlanmış profil yok.`,
    primaryProfiles,
    secondaryProfiles,
    secondaryTitle,
    secondaryText,
    recentProfiles,
    summaryItems: [
      { value: String(primaryProfiles.length), label: "eşleşen kart" },
      { value: String(vipCount), label: "VIP profil" },
      { value: String(districtLinks.length), label: "öne çıkan bölge" }
    ],
    districtLinks,
    categoryLinks,
    quickLinks,
    nearbyTitle: "Öne Çıkan Bölgeler",
    nearbyText: "İstanbul ilçe ve semt sayfalarındaki güncel profil ilanlarını inceleyin.",
    nearbyLinks: districtLinks,
    faqTitle: `${categoryName} İlanları`,
    faqItems: [
      {
        question: `${categoryName} sayfası neyi listeler?`,
        answer: `Ana listede ${categoryName} etiketine uyan aktif profil ilanları yer alır.${secondaryProfiles.length ? ` Altta ayrıca ${secondaryProfiles.length} İstanbul geneli diğer ilan keşif için gösterilir.` : ""}`
      },
      {
        question: "İletişim bilgileri nerede görünür?",
        answer: "Telefon, WhatsApp ve diğer iletişim seçenekleri yalnızca seçilen profilin detay sayfasında gösterilir."
      }
    ],
      seoTitle: `${categoryName} Profil Seçenekleri`,
      seoParagraphs: [
      `${categoryName} sayfasının ana listesi bu kategoriyle eşleşen güncel profil ilanlarını fotoğraf öncelikli kartlarla gösterir.`,
      secondaryProfiles.length
        ? `Kategori eşleşmesi taşımayan ${secondaryProfiles.length} İstanbul ilanı ayrı keşif bloğunda listelenir; arama niyeti önce ${categoryName} uyumlu kartlara yönelir.`
        : "",
      categoryDistrictNames.length ? `${formatList(categoryDistrictNames.slice(0, 4))} ve diğer İstanbul ilçe sayfalarından bölgeye özel ilan sıralamalarına ulaşabilirsiniz.` : "",
      `${categoryName} ilanlarında telefon, WhatsApp ve diğer iletişim seçenekleri yalnızca seçilen profilin detay sayfasında açılır.`
    ].filter(Boolean),
    searchTerms: uniqueTexts([
      `${categoryName.toLocaleLowerCase("tr-TR")}`,
      `istanbul ${categoryName.toLocaleLowerCase("tr-TR")}`,
      ...districtLinks.slice(0, 6).map((link) => `${link.title.replace(/\s+Escort$/i, "").toLocaleLowerCase("tr-TR")} ${categoryName.toLocaleLowerCase("tr-TR")}`)
    ]),
    internalLinks: uniqueLinks([
      { href: "/istanbul-escort", title: "İstanbul Escort" },
      ...districtLinks,
      ...categoryLinks
    ]),
    breadcrumbItems: [
      { name: "Ana Sayfa", url: "/" },
      { name: "İstanbul Escort", url: "/istanbul-escort" },
      { name: categoryName, url: `/${safeLandingSlug}` }
    ]
  };
}

function countLandingProfiles(slug, profiles) {
  const context = buildLandingContext(slug, profiles);
  return context ? context.totalProfileCount : 0;
}

function listIndexableLandingSlugs(profiles) {
  const active = activeProfiles(profiles);
  const districtSlugs = districtRows()
    .filter((district) => profilesSupportingLanding(district.slug, active).length > 0)
    .map((district) => district.slug);
  const aliasSlugs = landingAliasRows()
    .filter((alias) => profilesSupportingLanding(alias.slug, active).length > 0)
    .map((alias) => alias.slug);
  const categorySlugs = categoryRows()
    .filter((category) => (
      category.is_city_hub ||
      profilesSupportingLanding(category.slug, active).length > 0
    ))
    .map((category) => category.slug);

  return [...new Set([...districtSlugs, ...aliasSlugs, ...categorySlugs])];
}

module.exports = {
  SEARCH_DEMAND_INTENTS,
  buildLandingContext,
  countLandingProfiles,
  exactLocalProfilesForLanding,
  filterProfilesForLanding,
  secondaryProfilesForLanding,
  profilesSupportingLanding,
  isVipProfile,
  resolveLandingTarget,
  listIndexableLandingSlugs,
  rankProfilesForLocalIntent,
  demandLabelsForLanding,
  sortProfiles
};
