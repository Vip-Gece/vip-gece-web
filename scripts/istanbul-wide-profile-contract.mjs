import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { districtRows, landingAliasRows } = require("../src/data/publicMetadata");
const { buildLandingContext, rankProfilesForLocalIntent } = require("../src/services/landingContextService");
const {
  applyProfileCreateDefaults,
  applyProfileUpdateDefaults
} = require("../src/services/profileDefaults");
const { renderCategoryHtml } = require("../src/services/render/landingRenderer");

const baseProfile = {
  description: "Sözleşme testi için eksiksiz profil.",
  images: ["/logo.png.webp"],
  is_active: true,
  city: "İstanbul"
};

const created = applyProfileCreateDefaults({
  ...baseProfile,
  name: "Kapsam Testi",
  slug: "kapsam-testi",
  district: "Kadıköy"
}, []);

assert.equal(created.city, "İstanbul", "new Istanbul profile keeps canonical city");
assert.equal(
  created.district,
  "İstanbul Geneli",
  "new Istanbul profile is always normalized to Istanbul Geneli"
);

const updated = applyProfileUpdateDefaults(
  { description: "Güncellenmiş açıklama." },
  { ...created, district: "Beşiktaş" }
);
assert.equal(updated.city, "İstanbul", "updated Istanbul profile keeps canonical city");
assert.equal(
  updated.district,
  "İstanbul Geneli",
  "updated Istanbul profile is normalized without manual location editing"
);

const nonIstanbul = applyProfileCreateDefaults({
  ...baseProfile,
  name: "Ankara Kapsam Testi",
  slug: "ankara-kapsam-testi",
  city: "Ankara",
  district: "Çankaya"
}, []);
assert.equal(nonIstanbul.city, "Ankara", "explicit non-Istanbul city is preserved");
assert.equal(nonIstanbul.district, "Çankaya", "explicit non-Istanbul district is preserved");

const profiles = [
  {
    ...baseProfile,
    id: "istanbul-wide-a",
    name: "İstanbul Wide A",
    slug: "istanbul-wide-a",
    district: "Kadıköy",
    type: "vip",
    vip_slot: 1
  },
  {
    ...baseProfile,
    id: "istanbul-wide-b",
    name: "İstanbul Wide B",
    slug: "istanbul-wide-b",
    district: "Beşiktaş",
    type: "normal",
    normal_slot: 2
  },
  {
    ...baseProfile,
    id: "istanbul-wide-c",
    name: "İstanbul Wide C",
    slug: "istanbul-wide-c",
    district: "İstanbul Geneli",
    type: "normal",
    normal_slot: 3
  },
  {
    ...baseProfile,
    id: "istanbul-wide-d",
    name: "İstanbul Wide D",
    slug: "istanbul-wide-d",
    district: "Şişli",
    type: "normal",
    normal_slot: 4
  },
  {
    ...baseProfile,
    id: "istanbul-wide-e",
    name: "İstanbul Wide E",
    slug: "istanbul-wide-e",
    district: "Bakırköy",
    type: "normal",
    normal_slot: 5
  }
];

const excludedProfiles = [
  {
    ...baseProfile,
    id: "inactive-istanbul",
    name: "Inactive Istanbul",
    slug: "inactive-istanbul",
    district: "Üsküdar",
    is_active: false
  },
  {
    ...baseProfile,
    id: "active-ankara",
    name: "Active Ankara",
    slug: "active-ankara",
    city: "Ankara",
    district: "Çankaya"
  }
];
const inventory = [...profiles, ...excludedProfiles];
const districtLandings = [...districtRows(), ...landingAliasRows()];

function sectionBetween(html, startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} section boundaries exist`);
  return html.slice(start, end);
}

for (const landing of districtLandings) {
  const html = renderCategoryHtml(landing.slug, inventory);
  assert.ok(html, `${landing.slug} renders`);

  const primaryHtml = sectionBetween(
    html,
    'id="categoryProfiles"',
    'id="categorySecondarySection"'
  );
  const secondaryHtml = sectionBetween(
    html,
    'id="categorySecondarySection"',
    'id="categoryNearbyBox"'
  );

  assert.equal(
    (primaryHtml.match(/class="category-card"/g) || []).length,
    profiles.length,
    `${landing.slug} primary list contains every active Istanbul profile without a cap`
  );

  for (const profile of profiles) {
    assert.ok(
      primaryHtml.includes(`/profil/${profile.slug}`),
      `${landing.slug} primary list includes ${profile.slug} regardless of stored district metadata`
    );
  }

  for (const profile of excludedProfiles) {
    assert.ok(
      !primaryHtml.includes(`/profil/${profile.slug}`),
      `${landing.slug} excludes ${profile.slug} from the active Istanbul inventory`
    );
  }

  assert.equal(
    (secondaryHtml.match(/class="category-card"/g) || []).length,
    0,
    `${landing.slug} does not split profiles into a secondary rail`
  );
  assert.match(
    secondaryHtml,
    /hidden style="display:none"/,
    `${landing.slug} keeps the empty secondary section hidden`
  );
  assert.doesNotMatch(
    html,
    /profil havuzu|arama niyeti|güncellik sinyali|profil veritabanı/i,
    `${landing.slug} public copy avoids internal product terminology`
  );
}

const categoryContext = buildLandingContext("vip-escort", inventory);
assert.ok(categoryContext, "VIP category context renders");
assert.deepEqual(
  categoryContext.primaryProfiles.map((profile) => profile.id),
  ["istanbul-wide-a"],
  "category primary filtering remains limited to matching profiles"
);

const intentProfiles = [
  {
    ...baseProfile,
    id: "generic-vip",
    slug: "generic-plan",
    name: "Genel Profil",
    description: "Genel profil ilanı.",
    district: "Şişli",
    type: "vip",
    vip_slot: 1
  },
  {
    ...baseProfile,
    id: "esmer-trait",
    slug: "esmer-trait",
    name: "Esmer Profil",
    description: "Esmer profil ilanı.",
    district: "Şişli",
    type: "vip",
    vip_slot: 2
  },
  {
    ...baseProfile,
    id: "sarisin-trait",
    slug: "sarisin-trait",
    name: "Sarışın Profil",
    description: "Sarışın profil ilanı.",
    district: "İstanbul Geneli",
    type: "vip",
    vip_slot: 3
  }
];

const demandTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vip-gece-intent-"));
const previousDemandPath = process.env.VIP_GECE_SEARCH_DEMAND_PATH;
process.env.VIP_GECE_SEARCH_DEMAND_PATH = path.join(demandTempDir, "search-demand.json");

try {
  const orderedIds = (rows, slug) => rankProfilesForLocalIntent(rows, slug).map((row) => row.id);
  assert.equal(orderedIds(intentProfiles, "sisli-escort")[0], "sarisin-trait", "district intent outranks locality and VIP package type");
  assert.equal(orderedIds(intentProfiles, "kadikoy-escort")[0], "esmer-trait", "district-specific intent changes the first profile");

  const newProfile = {
    ...baseProfile,
    id: "new-genc-trait",
    slug: "new-genc-trait",
    name: "Yeni Profil",
    description: "Yeni profil ilanı.",
    tags: ["genç"],
    district: "İstanbul Geneli",
    type: "vip",
    vip_slot: 4
  };
  assert.equal(
    orderedIds([...intentProfiles, newProfile], "kadikoy-escort")[0],
    "new-genc-trait",
    "new tagged profile enters the matching district intent first"
  );

  const attributeProfiles = [
    { ...baseProfile, id: "height-172", slug: "height-172", name: "Profil A", type: "vip", height: "1,72 m", weight: "55 kg", district: "İstanbul Geneli" },
    { ...baseProfile, id: "height-165", slug: "height-165", name: "Profil B", type: "vip", height: "165 cm", weight: "62", district: "İstanbul Geneli" },
    { ...baseProfile, id: "height-invalid", slug: "height-invalid", name: "Profil C", type: "vip", height: "172 kg", weight: "belirsiz", district: "İstanbul Geneli" },
    { ...baseProfile, id: "hair-red", slug: "hair-red", name: "Profil D", type: "vip", tags: ["kızıl saç", "atletik"], district: "İstanbul Geneli" },
    { ...baseProfile, id: "hair-black", slug: "hair-black", name: "Profil E", type: "vip", tags: ["siyah saçlı"], district: "İstanbul Geneli" }
  ];

  const writeObservedDemand = (name, keys) => {
    const file = path.join(demandTempDir, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      source: "search_provider",
      generated_at: new Date().toISOString(),
      landings: { "sisli-escort": keys.map((key) => ({ key })) }
    }));
    process.env.VIP_GECE_SEARCH_DEMAND_PATH = file;
  };

  writeObservedDemand("height", ["boy170", "boy160"]);
  assert.equal(orderedIds(attributeProfiles, "sisli-escort")[0], "height-172", "stored height range takes precedence when search demand names it");
  assert.ok(orderedIds(attributeProfiles, "sisli-escort").indexOf("height-invalid") > 0, "invalid height unit cannot create a height match");

  writeObservedDemand("weight", ["kilo60", "kilo50"]);
  assert.equal(orderedIds(attributeProfiles, "sisli-escort")[0], "height-165", "stored weight range can drive district intent without body-shape inference");

  writeObservedDemand("hair-body", ["kizil", "atletik"]);
  assert.equal(orderedIds(attributeProfiles, "sisli-escort")[0], "hair-red", "declared hair color and body type participate in intent ordering");

  writeObservedDemand("black-hair", ["siyahSac", "kizil"]);
  assert.equal(orderedIds(attributeProfiles, "sisli-escort")[0], "hair-black", "natural Turkish hair-color phrasing matches the declared intent");

  const sisliHtml = renderCategoryHtml("sisli-escort", intentProfiles);
  const sisliPrimary = sectionBetween(sisliHtml, 'id="categoryProfiles"', 'id="categorySecondarySection"');
  assert.ok(
    sisliPrimary.indexOf("/profil/sarisin-trait") < sisliPrimary.indexOf("/profil/esmer-trait"),
    "public district HTML reflects the intent order"
  );

  writeObservedDemand("existing-traits", ["esmer", "sarisan"]);
  assert.equal(
    orderedIds(intentProfiles, "sisli-escort")[0],
    "esmer-trait",
    "observed search-provider intent overrides the predefined fallback order"
  );
} finally {
  if (previousDemandPath === undefined) delete process.env.VIP_GECE_SEARCH_DEMAND_PATH;
  else process.env.VIP_GECE_SEARCH_DEMAND_PATH = previousDemandPath;
  fs.rmSync(demandTempDir, { recursive: true, force: true });
}

console.log(
  `istanbul-wide profile contract: ${profiles.length} active Istanbul profiles appear on all ${districtLandings.length} district/semt landings; new-profile intent ordering and category filtering remain intact`
);
