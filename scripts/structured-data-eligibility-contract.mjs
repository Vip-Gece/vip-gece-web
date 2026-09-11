import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  categoryRows,
  districtRows,
  landingAliasRows
} = require("../src/data/publicMetadata");
const { getDemoProfiles } = require("../src/data/demoProfiles");
const { buildLandingContext } = require("../src/services/landingContextService");
const {
  buildCategoriesHubStructuredData,
  buildHomeStructuredData,
  buildLandingStructuredData,
  buildListingsHubStructuredData
} = require("../src/services/render/structuredData");

const profiles = getDemoProfiles();
const imageUrl = "https://vip-gece.site/logo.png.webp";

function extractJsonLd(markup) {
  return [...String(markup || "").matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)]
    .map((match) => JSON.parse(match[1]));
}

function assertNoUnsupportedCarousel(markup, label) {
  const blocks = extractJsonLd(markup);
  assert.ok(blocks.length > 0, `${label} must expose valid JSON-LD`);
  assert.equal(
    blocks.some((block) => block?.["@type"] === "ItemList"),
    false,
    `${label} must not claim a Google Carousel for unsupported profile/category content`
  );
  assert.equal(
    blocks.some((block) => /#(?:profiles|categories)$/.test(String(block?.mainEntity?.["@id"] || ""))),
    false,
    `${label} must not reference a removed Carousel list`
  );
}

assertNoUnsupportedCarousel(
  buildHomeStructuredData(
    { siteName: "VIP GECE" },
    "İstanbul VIP Escort Profilleri | VIP Gece",
    "VIP Gece ana sayfası",
    profiles,
    districtRows(),
    imageUrl
  ),
  "home"
);

assertNoUnsupportedCarousel(
  buildListingsHubStructuredData(
    "İstanbul Escort İlanları",
    "Güncel profil listesi",
    profiles,
    imageUrl,
    []
  ),
  "listings hub"
);

assertNoUnsupportedCarousel(
  buildCategoriesHubStructuredData(
    "Escort Kategorileri",
    "İstanbul kategori listesi",
    categoryRows(),
    imageUrl,
    []
  ),
  "categories hub"
);

const landingRows = [
  { slug: "istanbul-escort" },
  ...districtRows(),
  ...landingAliasRows(),
  ...categoryRows()
];
let checkedLandings = 0;

for (const row of landingRows) {
  const context = buildLandingContext(row.slug, profiles);
  assert.ok(context, `${row.slug} landing context must exist`);
  assertNoUnsupportedCarousel(buildLandingStructuredData(context, imageUrl), row.slug);
  checkedLandings += 1;
}

console.log(`structured data eligibility contract: ${checkedLandings} landings and 3 hubs avoid unsupported Carousel markup`);
