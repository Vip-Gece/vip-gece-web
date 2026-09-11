import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { districtRows, landingAliasRows } = require("../src/data/publicMetadata");
const { buildLandingContext } = require("../src/services/landingContextService");
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

console.log(
  `istanbul-wide profile contract: ${profiles.length} active Istanbul profiles appear in the primary list on all ${districtLandings.length} district/semt landings; category filtering remains intact`
);
