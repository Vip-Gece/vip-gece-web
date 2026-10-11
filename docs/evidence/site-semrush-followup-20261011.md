# .site Semrush follow-up - 2026-10-11

## Scope and verdict

- Target: `https://vip-gece.site`, Semrush campaign `31508893`.
- Other independent sites, phone numbers, profile records and Melek were not changed.
- Verdict: partial, not a zero-warning or indexing guarantee.
- The initial read-only follow-up did not deploy. The later owner-requested public-link change was deployed as `9038ec5`; see the deployment follow-up below.

## Semrush observations

Chrome Site Audit still shows the 2026-10-07 mobile, non-JavaScript crawl:

- 60/100 crawled pages; health 99%; 0 errors, 1 warning, 2 notice types.
- 41 healthy pages, 18 pages with warnings/notices, 1 redirect, 0 broken or blocked pages.
- Rerun was attempted on 2026-10-11. The UI refused it with the monthly crawl-limit message and an upgrade offer.
- No trial/subscription was started, findings hidden or checks excluded. The crawl was not refreshed.

| ID | Finding | Evidence and disposition |
| --- | --- | --- |
| 112 | Low text/HTML ratio on the homepage | Still present. Current HTML is 89,830 bytes, parsed text 4,039 bytes and inline CSS 37,714 bytes. This independent byte measurement is not Semrush's exact ratio algorithm. The current render pipeline embeds an already purged/minified stylesheet for first paint. Do not mark resolved, remove critical styles blindly or add filler solely for the ratio. A future CSS split must preserve initial rendering and interaction states and pass mobile/desktop visual and performance checks. |
| 202 | 16 external nofollow links in the old crawl | The owner subsequently requested removing public-link `nofollow` and preventing its return. Release `9038ec5` removes it from the shared contact template while preserving `noopener` and private robots rules. The post-deployment crawl checks all 262 sitemap pages and finds zero nofollow anchors; all contact targets are unchanged. Semrush's old report is not refreshed because of quota. |
| 213 | Adalar has only one incoming internal link in the old crawl | The Turkish list says outgoing, but Semrush's explanation and official issue description specify incoming. Current Kartal and Maltepe each contain two HTML links to `/adalar-escort`, on distinct source pages. The earlier fix is live; confirmation in a new Semrush report remains blocked by quota. |

## Fresh checks

- `node scripts/district-seo-contract.mjs`: exit 0; 39/39 districts and 241 landing descriptions pass their contract, including district discovery coverage.
- `node scripts/full-sitemap-seo-audit.mjs --site=https://vip-gece.site --strict --json`: exit 0; checked at `2026-10-11T07:16:45.426Z`; sitemap 200; all 262 URLs checked; zero findings within this script's HTTP, metadata, canonical and structured-data checks.
- Live homepage, Kartal, Maltepe and Adalar each return 200. Adalar contains 44 unique same-host link destinations.
- These checks do not prove Google indexing, real-user Core Web Vitals, absence of every possible defect or a refreshed Semrush pass.

## Evidence

- Live audit JSON: `/Users/o-neo/Documents/Vip-Gece-GSC-Kontrol-2026-10-09/site/seo-semrush-followup-20261011.json`.
- Chrome quota screenshot: `/Users/o-neo/Documents/Vip-Gece-GSC-Kontrol-2026-10-09/site/semrush-quota-20261011.jpg`.
- Previous release: `dee09f4`; responsive gallery delivery changes from 2026-10-09 are not a deployment made during this follow-up.
- The latest attempted Lighthouse run from 2026-10-09 failed with `NO_NAVSTART`; it is not a valid new score.

## References

- https://www.semrush.com/kb/542-site-audit-issues-list
- https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links

## Next verification

When the existing free Semrush quota renews, rerun the unchanged priority crawl and inspect issues 202 and 213. Keep issue 112 open until a measured, regression-tested improvement and fresh report exist. Do not reintroduce public-link nofollow or hide findings to obtain a score.

## Public-link deployment follow-up

- Owner request: remove public-link nofollow and prevent reintroduction; later explicitly authorized deployment.
- Source commit: `9038ec5`; deployed at `2026-10-11T09:08:35.084Z`.
- Active release: `/var/www/vip-gece-site/releases/20261011-contact-links-9038ec5`.
- Only `detay.html`, the package test commands and the new public-contact regression test were promoted. Repository `AGENTS.md` also records the public/private distinction.
- Four regression tests pass and are included in `npm run contracts`; the isolated smoke/contracts review, gallery contract, private-panel contract, source checks and secret scan also pass.
- Two pre-promotion attempts stopped on deployment-harness assumptions, not a production change: public profile summaries omit contact numbers, and the private API intentionally returns 404 without its edge secret. Checks were corrected to compare exact baseline-rendered contact URLs and preserve the 404/private-robots boundary. Both attempts stopped before promotion.
- Canary and post-promotion checks pass for all 16 profiles. Profile list/detail data hashes, production environment and sibling process IDs are unchanged.
- Public post-deployment crawl at `2026-10-11T09:09:59.858Z`: all 262 pages return 200, zero nofollow anchors, new-tab links retain noopener, and the aggregate contact-target hash matches the before-deployment crawl.
- A fresh strict sitemap SEO audit at `2026-10-11T09:09:59.770Z` checks all 262 URLs with zero findings within its HTTP, canonical, metadata and structured-data scope. This does not close the remaining text/HTML-ratio warning or guarantee indexing.
- HTML size analysis: 89,830 bytes total, including 37,714 bytes of inline CSS and 11,211 bytes of inline image data. These support first paint; they were not removed merely to change the text/HTML ratio. No comments or large inline application script were found as a trivial safe reduction.
- Evidence files: `contact-links-deployment-proof-9038ec5.json`, `contact-links-before-20261011.json`, `contact-links-after-20261011.json`, `seo-contact-links-after-20261011.json` and deployment logs under `/Users/o-neo/Documents/Vip-Gece-GSC-Kontrol-2026-10-09/site/`.
