# Slug Audit - 2026-09-14

## Scope and verdict

Read-only audit requested after the missing-image profiles were unpublished.
No slug, production code, routing configuration, database record, or Cloudflare setting was changed during this audit.

Verdict: canonical inventory passes, but alias ownership and indexability have confirmed defects. URL variant normalization also needs improvement.

Coverage:

- All 254 URLs in the live HTTPS sitemap, with no maximum/sample filter: 234 landing pages, 15 profiles, 5 static/hub pages.
- All 241 configured landing slugs: 39 districts, 188 local aliases, 14 categories. Seven configured categories are outside the sitemap.
- All 27 database profile records: 15 active and 12 inactive.
- All 122 distinct candidates derived from those records' canonical/stored/name/city/district aliases, resolved through the live runtime helper.
- Eleven additional live HTTP checks for case, trailing slash, legacy HTML, short profile paths, and nonexistent routes. These variants are representative, not every possible spelling of every URL.
- SHA-256 parity between local and deployed profile.js, text.js, publicRoutes.js, sitemapService.js, landingRenderer.js, and landingContextService.js.

## Confirmed findings

### P2: An inactive profile's canonical URL resolves to a different profile

Inactive ID 9 has stored slug `istanbul-merve-9` and canonical slug `merve-istanbul`.
The live `/profil/merve-istanbul` returns 301 to `/profil/merve-90bd8272`.
The corresponding public API returns active ID 71, not inactive ID 9.
The unpublication itself is preserved, but the old URL identity is reassigned by name fallback.

`src/utils/profile.js:52` checks exact matches only among the provided active rows. The fallback at line 69 resolves name/city variants without reserving inactive profiles' canonical URLs.
Eight alias strings are shared across the two IREM records and the two MERVE records. Canonical slugs themselves are unique across all 27 records.

Remediation direction: preserve alias ownership by stable profile ID; an inactive profile's reserved canonical URL must not silently fall through to a different same-name record. Keep legitimate, explicitly verified legacy mappings.

### P2: Seven non-indexable categories render an index directive

These configured slugs have zero matching primary profiles and runtime `indexable=false`:

- `anal-escort`
- `otel-escort`
- `yabanci-escort`
- `gfe-escort`
- `kumral-escort`
- `balik-etli-escort`
- `genc-escort`

They are excluded by `listIndexableLandingSlugs`, yet all seven live pages return 200, a self canonical, and `index, follow, max-image-preview:large`.
`src/services/render/landingRenderer.js:127` hardcodes the robots directive rather than using the context decision from `src/services/landingContextService.js:1007`.
Absence from a sitemap is not an exclusion from indexing.

Remediation direction: make robots and sitemap inclusion follow one explicit indexability decision; retain the normal routes and data.

### P3: Case and trailing-slash variants do not redirect

`/profil/ISTANBUL-KARDELEN`, `/profil/istanbul-kardelen/`, `/ISTANBUL-ESCORT`, `/istanbul-escort/`, `/ILANLAR`, and `/ilanlar/` all return 200.
Their canonical tags correctly use lowercase, slashless URLs.
This is a normalization gap rather than missing canonical protection.
`src/routes/publicRoutes.js:216` compares the normalized request slug, so case/spelling changes normalized by safeSlug cannot trigger that redirect. Landing/static route handling also serves these variants.

Remediation direction: canonicalize raw public request paths consistently without changing private/API/media routes or query meaning.

## Passing evidence

- 254/254 sitemap URLs: HTTP 200, correct canonical, no duplicate sitemap URLs, and no page findings from the existing full audit.
- 27/27 profile canonical slugs: valid lowercase/hyphen syntax and unique.
- 234/234 indexable landing slugs: valid and resolvable with no duplicates.
- Database has a unique partial index on nonempty stored `profiles.slug`; this does not cover derived aliases or canonical overrides.
- Unknown profile and unknown landing examples returned real 404 responses.
- `detay.html?slug=istanbul-kardelen`, `/istanbul-kardelen`, and `/index.html` returned the expected one-hop 301 targets.

## Audit harness limitation

The existing strict full-sitemap audit exited 1 only because its default expected landing count is 235 while the current inventory has 234. All 254 checked pages passed. The fixed expectation in `scripts/full-sitemap-seo-audit.mjs:8` was not changed during this review.
Search Console / Google's selected canonical and historical indexed URL inventory were not queried. The conclusions concern current application data, code, and HTTP responses.

## Evidence

- `work/vip-full-slug-sitemap-audit-20260914.json`
- `work/vip-profile-slug-bindings-audit-20260914.json`
- `work/vip-slug-variant-audit-20260914.json`
- `work/vip-slug-excluded-landings-20260914.json`

References: [Google URL structure guidance](https://developers.google.com/search/docs/crawling-indexing/url-structure), [Google canonicalization guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).
