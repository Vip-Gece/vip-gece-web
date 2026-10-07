# VIP Gece .site Audit Scope - 2026-10-07

## Owner Instructions

- Finish one site before moving to another.
- Current site: `https://vip-gece.site` only.
- Current third-party audit scope: Istanbul landing, all 39 Istanbul districts, and active profile pages. Also validate homepage navigation.
- Semrush crawl cap: 100 pages. Use an explicit URL allowlist; do not spend the cap on neighborhoods or categories.
- Remaining neighborhoods/categories and other sites: audit after the relevant quota renews. This is a backlog entry, not a completed audit or a newly scheduled automation.
- Do not modify Melek's record, images, contact number, or profile content.
- Keep the +57 advertising number fixed unless the owner explicitly writes `+57 ilan numarası`.
- Do not delete Leyla Ajans.
- `/Users/o-neo/Desktop/yntm` contains only site/admin URL text. Store evidence outside that folder.

## Completed .site Data Correction

- Original 15 profiles had all pointed to `+16135099017`.
- Updated only WhatsApp on IDs `89,87,85,77,71,18,16` to `+17536698509`.
- Remaining eight original profiles retain `+16135099017`.
- Protected Melek ID `92` was never an update target. Full-record SHA-256 was identical before and after:
  `51a681332bc6c3f634b9c1c12a30006e8352d18ba2be023ec8bd1dd34a4f0185`.
- Advertising settings were not changed.
- Rollback backup outside webroot, mode 0600:
  `/var/backups/vip-gece/site-contact-split-2026-10-07T08-32-43-845Z.json`.
- Public API and profile links were rechecked after cache expiry: seven original profiles use 8509, eight use 9017. Melek still has seven images and the same protected contact/content.
- Public proof: `site-contact-proof.json` in the evidence folder below.

## Current Focused HTTP Audit

- Explicit scope: homepage + Istanbul + 39 districts + 16 active profile pages = 57 URLs.
- All 57 returned HTTP 200 with indexable metadata, self-canonical URLs, unique titles/descriptions, H1s, and valid checked JSON-LD relationships.
- 208 image requests and 201 unique internal-link checks completed without a confirmed broken image/link.
- Unknown routes still return genuine 404; private panels remain intentionally noindex and access-controlled.
- Current authoritative result: `site-focus.json`. Initial timeout/parser anomalies were reconciled, not disguised as website fixes.

## Visitor Counter Fix And Live Verification

- The old word-boundary bot expression missed compound user agents including Googlebot and HeadlessChrome. Rejected proof requests also returned 403, producing Lighthouse console failures.
- Known bot/test user agents are now ignored by analytics only. Both telemetry routes return 202, `tracked: false`, no proof, and no-store headers. Origin checks, proof signatures, expiry, rate limits, and replay protection remain enforced.
- A separate real defect was confirmed: Bahar's public slug `bahar-istanbul` differed from stored slug `bahar-39bc3dbe`, so an otherwise valid normal event silently recorded nothing.
- Event storage now uses the existing public-profile resolver and locks the same active profile by ID. It still verifies the proof against that ID and preserves the requested page path and ownership snapshot.
- Pre-deploy isolated router verification used the production storage: one synthetic QA visit was recorded, replay recorded nothing, and five bot identities created zero events.
- After deploy, a genuine Chrome visit incremented Bahar's count from 1 to 2; refreshing the same tab left it at 2. These two QA records are retained, not presented as organic traffic.
- Live bot verification: Googlebot, HeadlessChrome, Chrome-Lighthouse, bingbot, SiteAuditBot. Both POST endpoints returned 202, issued no proof, and created zero matching event rows; the count remained unchanged during that test.
- After deploy, 12 public GET checks across Googlebot/HeadlessChrome returned 200 for the homepage, Istanbul, Sisli, Bahar, robots.txt, and sitemap.xml. Public HTML had no noindex and robots.txt did not block the site root.
- Regression coverage: normal/canonical/stored aliases, contact channels, foreign-profile proofs, duplicate events, missing/unpublished/ambiguous identities, inactive storage rows, rejected user agents, and cross-origin requests.
- Passed: `npm run check`, `npm run analytics-event-proof-contract`, `npm run contracts`, `npm run smoke`, `npm run secret-scan`, `git diff --check`. The fixture server was restarted to load the final source before the last contracts/smoke runs.
- Only PM2 `vip-gece-site` was restarted. Other process PIDs/statuses were unchanged; no other site deployment or customer/profile mutation was part of this hotfix.
- Rollback files outside webroot, directory 0700/files 0600:
  `/var/backups/vip-gece/site-analytics-20261007-1791365853881`.
- Published file SHA-256:
  `src/routes/analyticsRoutes.js`: `02edca7d0545434f1f655926aff78cf2af3b74cdb0be4920eb62106ed5a09b9f`
  `src/services/profileAnalyticsService.js`: `84dce616b885ca3535a4824e8f995c5c201d12f787e1b683c226ef79d094b5b5`.
- Evidence: `site-analytics-deploy-proof.json`, `site-normal-browser-after-ax.txt`, `site-bot-crawl-after-proof.json`.

## Third-Party Evidence Status

- Semrush MCP returned `no_api_units`; do not retry that endpoint until units are available.
- Chrome Semrush Site Audit campaign `31508893` completed, one-time/manual only, mobile crawler, JS rendering off, 100-page cap, explicit 57-URL import, no all-subdomain crawl.
- All 57 imported URLs appear in the 60-row result. The extra rows are `llms.txt`, `robots.txt`, and the expected 301 from `https://www.vip-gece.site/`.
- Semrush: health 99%, zero errors, one warning, two notices. Crawlability/HTTPS/performance/markup are 100%; internal linking is 97%.
- Warning: homepage text/HTML ratio 0.04. Its inlined critical CSS/AVIF contributes to HTML size; this heuristic alone is not proof of an indexing block. Do not add keyword filler or remove critical assets just to silence it.
- Notices: 16 external nofollow links and one single-incoming-internal-link page (Adalar). External contact-link policy is not a public-page noindex. Follow-up inspection clarified the misleading Turkish issue title: Semrush reports 43 outgoing internal links, but only one incoming link in the restricted crawl, from `/istanbul-escort`. Its help text describes incoming links. This is not an absent-navigation or broken-link defect; the notice remains open, not excluded or claimed fixed.
- Evidence: `semrush-site-crawled-pages-ax.txt`, `semrush-site-scope-coverage.json`, `semrush-site-adalar-notice-ax.txt`. The next crawl must inspect remaining notices rather than excluding the checks to manufacture a perfect score.
- Ubersuggest's fresh PageSpeed audit completed for the domain, desktop/mobile:
  mobile LCP 1.4 s, CLS 0, TBT 88 ms; desktop LCP 1.1 s, CLS 0, TBT 1.4 s.
- The wrapper also reported redirect savings. Verify direct canonical HTTPS with PageSpeed Insights before attributing this to a site defect.
- No field INP result was returned by that audit; do not claim a complete real-user Core Web Vitals pass.
- Direct PageSpeed Insights UI results, score order performance/accessibility/best practices/SEO:
  - Istanbul mobile and desktop: 100/100/100/100.
  - Sisli mobile: 100/100/100/100; desktop evidence is separately saved.
  - Bahar before fix: mobile 100/100/96/100 with two telemetry 403 console errors.
  - Bahar after fix: mobile and desktop 100/100/100/100. Fresh report ID `l4zmgp3bxa`, captured 2026-10-07.
  - Bahar mobile: FCP 989 ms, LCP 1201 ms, TBT 37 ms, CLS 0, speed index 1280 ms. Desktop: FCP 292 ms, LCP 365 ms, TBT 0, displayed CLS 0.011, speed index 454 ms.
- These are lab measurements for representative templates, not 57 individually completed PageSpeed runs. All reports show no field data; do not claim real-user INP or a field Core Web Vitals pass.
- Minor lab optimization opportunities still appear despite scores of 100 (for example render-blocking CSS and image-byte savings). Do not equate a 100 score with no remaining possible improvements.
- Keyless PageSpeed API returned 429 with zero daily allowance; live UI measurement succeeded instead. No quota workaround or duplicate paid crawl was used.
- Native Chrome control worked after debugger attachment failures; browser results were read through the approved UI controller.

## GSC Evidence Must Be Distinguished From Live State

- Last stored index report update: 2026-10-04; read on 2026-10-07.
- 43 indexed, 269 excluded. These are not 269 confirmed current code errors.
- Four noindex examples were last crawled in July/August. Their current public pages returned 200 with indexable metadata in the HTTP audit.
- Eight historical 404 URLs are not linked by the current sitemap pages. Do not redirect every retired URL to the homepage or another person's profile merely to hide the report.
- All 31 historical 5xx examples were extracted from GSC and freshly rechecked: HTTP 200 on 2026-10-07. Proof: `gsc-site-historical-5xx-live-proof.json`.
- GSC's existing 5xx validation still says started (start date 2026-09-14); it was not unnecessarily restarted. Current 200 responses do not mean Google has completed validation or indexed each page.
- Settings: verified owner. Manual actions: no issues detected. Security issues: no issues detected. Both sitemap.xml and image-sitemap.xml show successful processing.
- Evidence: `gsc-site-settings-ax.txt`, `gsc-site-manual-actions-ax.txt`, `gsc-site-security-ax.txt`, `gsc-site-sitemaps-ax.txt`.

## Remaining Work After Quota Renewal

- Recheck Semrush's homepage ratio and Adalar's restricted-crawl incoming-link notice without hiding diagnostics; retain deliberate external-link protections unless separately reviewed.
- Audit neighborhoods/categories and the other five sites individually, finishing one site before moving to the next. Do not assume .site results apply to another hostname.
- Add broader per-URL PageSpeed measurements where fresh quota/report capacity permits, especially any template with a new regression.
- Check subsequent GSC report dates/validation outcomes and actual indexed state. Crawled-not-indexed remains a Google indexing decision, not a promise that can be forced by telemetry fixes.
- No new recurring automation was created. Melek and the +57 advertising number stay protected throughout.

## Read-Only Follow-Up - 2026-10-07

- Rechecked all 57 agreed public URLs sequentially with declared `Googlebot` and `HeadlessChrome/153.0.0.0` user agents: 114 requests, 57 passing pages, zero failures. Both variants returned 200, the expected self-canonical, matching titles, and no public noindex. These HTTP identities are not proof of a genuine Google crawl.
- Proof: `site-focused-crawler-followup.json`. This run made no database writes, profile changes, deployment, or indexing submissions.
- Production SHA-256 of both analytics hotfix files still matches the published hashes above.
- GSC's aggregate report still has last-update date 2026-10-04, 43 indexed and 269 excluded. It has not become a fresh report just because it was reopened.
- GSC individual URL inspection:
  - Homepage: already indexed. Last stored crawl 2026-10-04 13:19:57, successful fetch, crawl/index allowed, Google canonical is the inspected URL.
  - Istanbul: stored `crawled - currently not indexed`, last crawl 2026-09-23 07:12:03. Fetch/crawl/index permission succeeded; Google canonical is the inspected URL.
  - Bahar public alias: stored `crawled - currently not indexed`, last crawl 2026-08-22 06:50:48. Fetch/crawl/index permission succeeded; Google canonical is the inspected URL. The stored referring page is historical `.online` data, not evidence of a new cross-site link.
- Genuine GSC live tests completed for those three URLs on 2026-10-07 at 13:37, 13:41, and 13:44 local time. All said the URL is available to Google and can be indexed, with successful fetch and crawl/index permission. Istanbul had one valid breadcrumb item; Bahar had one valid breadcrumb and one valid profile-page item. No index requests or validation restarts were issued.
- The latest sitemap screen shows both submitted/read on 2026-10-05 and successful: 262 normal URLs and 16 image-sitemap URLs. The current normal XML parsed successfully with `xmllint`; it contains both the Istanbul and Bahar canonical URLs. Older individual URL records with a temporary sitemap processing error do not override this newer sitemap result.
- Evidence: `gsc-site-index-followup-ax.txt`, `gsc-site-home-indexed-followup-ax.txt`, `gsc-site-home-live-followup-ax.txt`, `gsc-site-istanbul-index-followup-ax.txt`, `gsc-site-istanbul-live-followup-ax.txt`, `gsc-site-bahar-index-followup-ax.txt`, `gsc-site-bahar-live-followup-ax.txt`, `gsc-site-sitemaps-followup-ax.txt`, `semrush-site-adalar-clarified-ax.txt`.
- Fresh homepage PageSpeed report `fmkew803np`, captured 2026-10-07 13:47 GMT+3: mobile and desktop both 100/100/100/100. Mobile FCP 957 ms, LCP 993 ms, TBT 0, CLS 0, speed index 957 ms; desktop FCP 272 ms, LCP 292 ms, TBT 0, CLS 0, speed index 490 ms. No real-user field data. The PageSpeed service initially returned its own 503; one retry worked. Do not attribute that service response to `.site`.
- PageSpeed still includes unscored/manual-review items. Its CSP evaluation specifically labels host allowlisting as high severity and recommends a nonce/hash-based strict policy. The current shared middleware uses `script-src 'self' https://cdn.jsdelivr.net https://static.cloudflareinsights.com` for public pages and a separate admin policy. This is a confirmed hardening recommendation, not a demonstrated XSS exploit. It is not fixed and must not be hidden behind the 100 score.
- CSP remains a separate pending technical task: inventory trusted scripts, cache/header consistency, public/customer/admin behavior, and compatibility before changing the shared policy. Do not remove the check, weaken Trusted Types, or blindly deploy a global policy change to silence Lighthouse.
- PageSpeed evidence: `psi-home-mobile-followup-ax.txt`, `psi-home-mobile-followup.png`, `psi-home-desktop-followup-ax.txt`.

## Evidence Location

`/Users/o-neo/Documents/Vip-Gece-GSC-Kontrol-2026-10-07/alti-site-denetim`

The initial broad `site.json` contains historical request/parser anomalies. Use the reconciled `site-focus.json` for the current agreed scope; do not present initial data-URI or JSON-LD @id parser false positives as website defects.
