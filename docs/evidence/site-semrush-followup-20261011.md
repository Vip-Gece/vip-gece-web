# .site Semrush follow-up - 2026-10-11

## Scope and verdict

- Target: `https://vip-gece.site`, Semrush campaign `31508893`.
- Other independent sites, phone numbers, profile records and Melek were not changed.
- Verdict: partial, not a zero-warning or indexing guarantee.
- This follow-up did not change production code or deploy a new release.

## Semrush observations

Chrome Site Audit still shows the 2026-10-07 mobile, non-JavaScript crawl:

- 60/100 crawled pages; health 99%; 0 errors, 1 warning, 2 notice types.
- 41 healthy pages, 18 pages with warnings/notices, 1 redirect, 0 broken or blocked pages.
- Rerun was attempted on 2026-10-11. The UI refused it with the monthly crawl-limit message and an upgrade offer.
- No trial/subscription was started, findings hidden or checks excluded. The crawl was not refreshed.

| ID | Finding | Evidence and disposition |
| --- | --- | --- |
| 112 | Low text/HTML ratio on the homepage | Still present. Current HTML is 89,830 bytes, parsed text 4,039 bytes and inline CSS 37,714 bytes. This independent byte measurement is not Semrush's exact ratio algorithm. The current render pipeline embeds an already purged/minified stylesheet for first paint. Do not mark resolved, remove critical styles blindly or add filler solely for the ratio. A future CSS split must preserve initial rendering and interaction states and pass mobile/desktop visual and performance checks. |
| 202 | 16 external nofollow links | All 16 current sitemap profile pages return 200 and contain a `wa.me` contact link with `rel="nofollow noopener"`. This is link qualification, not a page-level noindex rule. Kept intentionally; not a broken internal-link or local indexing defect. |
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

When the existing free Semrush quota renews, rerun the unchanged priority crawl and inspect issue 213. Keep issue 112 open until a measured, regression-tested improvement and fresh report exist. Preserve deliberate external contact-link qualification rather than hiding notice 202.
