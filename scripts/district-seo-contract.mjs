import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  categoryRows,
  districtRows,
  getDistrictAliases,
  getNearbyDistricts,
  landingAliasRows
} = require("../src/data/publicMetadata");
const { buildLandingContext } = require("../src/services/landingContextService");
const { getDemoProfiles } = require("../src/data/demoProfiles");
const { buildLandingStructuredData } = require("../src/services/render/structuredData");

const profiles = getDemoProfiles().map((profile) => ({
  ...profile,
  district: "İstanbul Geneli",
  area: "İstanbul Geneli"
}));
const districts = districtRows();

assert.equal(districts.length, 39, "all 39 Istanbul districts must be present");
assert.equal(new Set(districts.map((row) => row.slug)).size, 39, "district slugs must be unique");
assert.equal(new Set(districts.map((row) => row.focus)).size, 39, "district editorial focus must be unique");
assert.equal(new Set(districts.map((row) => row.transit)).size, 39, "district connection copy must be unique");

const contexts = districts.map((district) => {
  const context = buildLandingContext(district.slug, profiles);
  assert.ok(context, `${district.slug} context must exist`);
  assert.equal(context.indexable, true, `${district.slug} must be indexable with citywide inventory`);
  assert.equal(context.place?.addressLocality, district.name, `${district.slug} place locality`);
  assert.ok(context.metaDescription.length >= 100 && context.metaDescription.length <= 160, `${district.slug} meta length`);
  assert.match(context.metaDescription, /[.!?]$/, `${district.slug} meta must end as a complete sentence`);
  assert.doesNotMatch(
    context.metaDescription,
    /\b(?:temel|ve|ile|için)\.$/i,
    `${district.slug} meta must not end on a connector word`
  );
  assert.ok(context.heroText.includes(district.name), `${district.slug} hero uses district name`);
  assert.ok(context.seoParagraphs.length >= 5, `${district.slug} has substantial editorial paragraphs`);
  assert.ok(context.internalLinks.length >= 10, `${district.slug} has contextual internal links`);
  assert.ok(context.localIntentRows.length >= 4, `${district.slug} has neighborhood intent links`);
  assert.equal(getNearbyDistricts(district.name).length, 3, `${district.slug} has three neighboring districts`);
  assert.ok(getDistrictAliases(district.name).length >= 4, `${district.slug} has neighborhood aliases`);

  const jsonLd = buildLandingStructuredData(context, "https://vip-gece.site/logo.png.webp");
  assert.ok(jsonLd.includes('"spatialCoverage"'), `${district.slug} has spatialCoverage structured data`);
  assert.ok(jsonLd.includes(`"name":"${context.place.name}"`), `${district.slug} structured data names its place`);
  return context;
});

const categories = categoryRows();
const categorySlugs = new Set(categories.map((row) => row.slug));
const allLandingRows = [
  ...districts,
  ...landingAliasRows(),
  ...categories
];
const allLandingContexts = allLandingRows.map((landing) => {
  const context = buildLandingContext(
    landing.slug,
    categorySlugs.has(landing.slug) ? profiles : []
  );
  assert.ok(context, `${landing.slug} context must exist`);
  assert.ok(
    context.metaDescription.length >= 120 && context.metaDescription.length <= 160,
    `${landing.slug} meta length must stay within the external-audit range`
  );
  assert.match(context.metaDescription, /[.!?]$/, `${landing.slug} meta must end as a complete sentence`);
  assert.doesNotMatch(
    context.metaDescription,
    /\b(?:temel|ve|ile|için)\.$/i,
    `${landing.slug} meta must not end on a connector word`
  );
  return context;
});

assert.equal(
  new Set(allLandingContexts.map((row) => row.metaDescription)).size,
  allLandingContexts.length,
  "all district, neighborhood and category meta descriptions must be unique"
);

for (const [label, values] of Object.entries({
  titles: contexts.map((row) => row.pageTitle),
  descriptions: contexts.map((row) => row.metaDescription),
  heroes: contexts.map((row) => row.heroText),
  editorialOpeners: contexts.map((row) => row.seoParagraphs[0])
})) {
  assert.equal(new Set(values).size, 39, `${label} must be unique across all districts`);
}

const linkSources = [
  { slug: "istanbul-escort", context: buildLandingContext("istanbul-escort", profiles) },
  ...districts.map((row) => ({ slug: row.slug, context: buildLandingContext(row.slug, profiles) })),
  ...landingAliasRows().map((row) => ({ slug: row.slug, context: buildLandingContext(row.slug, profiles) }))
];

for (const district of districts) {
  const targetHref = `/${district.slug}`;
  const inboundSources = linkSources.filter((source) => (
    source.slug !== district.slug &&
    source.context?.internalLinks?.some((link) => link.href === targetHref)
  ));
  const aliasSourceSlugs = new Set(getDistrictAliases(district.name).map((row) => row.slug));

  assert.ok(
    inboundSources.some((source) => source.slug === "istanbul-escort"),
    `${district.slug} receives a city-hub internal backlink`
  );
  assert.ok(
    [...aliasSourceSlugs].every((slug) => inboundSources.some((source) => source.slug === slug)),
    `${district.slug} receives internal backlinks from every neighborhood page`
  );
  assert.ok(inboundSources.length >= 5, `${district.slug} has a minimum internal backlink baseline`);
}

console.log(`district SEO contract: 39/39 districts and ${allLandingContexts.length} landing metas are unique, complete and externally audit-ready`);
