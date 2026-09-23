# Live Runtime Repair Checkpoint - 2026-09-14

## Current Runtime

- Live release: `/var/www/vip-gece-site/releases/20260914-public-runtime-repair-v1`.
- Previous release retained: `/var/www/vip-gece-site/releases/20260913-image-fallback-v1`.
- PM2 `vip-gece-site` verified online as deploy, PID 201460 at activation; process cwd resolved to the new release.
- Eight runtime source files and two new regression tests were deployed. Unrelated dirty-worktree changes were not deployed.
- Bundle SHA-256: `f7cf338ca6570276f6d3c56527d5d426d00925bcef7eabc5e257b1b73ec20131`.
- Root-only deployment/rollback record: `/var/backups/vip-gece/public-runtime-repair-20260914.json`.
- All 27 profile row hashes and description hashes were unchanged across activation. Fifteen active profiles retain 43 usable images; twelve inactive records remain preserved without photos.

## Repairs Deployed

1. Profile resolution reserves inactive canonical URLs and rejects ambiguous name aliases instead of selecting a different profile by list order. This also covers the public profile API and analytics proof lookup.
2. Minimal slug ownership metadata is cached together with publication invalidation. Failed or invalidated lookups do not reuse stale ownership; fresh inactive ownership overrides stale public rows.
3. Retired-only image references no longer automatically turn into logo-backed published profiles.
4. Landing pages honor the indexing decision used by the sitemap. The seven currently empty categories return `noindex, follow`.
5. Profile, landing and public-hub uppercase/trailing-slash variants redirect to the canonical address with query strings preserved.
6. Default HTML edge cache lifetime changed from 300 seconds plus one-day stale serving to 60 seconds with mandatory revalidation. No live env override was present. No Cloudflare purge or account configuration change was performed.

## Verification

- Initial targeted regression: 11 failures among 18 assertions, reproduced before the repair. Final targeted suite: 19/19 passing, including an additional stale-row check.
- Ownership cache suite: 5/5 passing. Publication suite: 23/23 passing.
- Full local application contract suite: 489 passing checks, zero failures, against an isolated demo server without production credentials.
- Private panel, admin role, district SEO, citywide coverage, structured data, analytics proof, Supabase security-source contracts and smoke suite passed.
- Candidate verification: 63 real-data HTTP checks passed before activation. The same 63 checks passed on the running production process afterward.
- External HTTPS sitemap audit: all 254 URLs passed, with explicit expected totals of 234 landings, 15 profiles and 5 other URLs.
- External HTTPS surface audit: 261 pages and 220 assets passed, zero broken responses. Fifteen external links/resources were inventoried but not recursively audited.
- External image audit: 15 active profiles and 43 usable images passed.
- External unpublication audit: all twelve inactive canonical detail/API addresses return 404; the earlier MERVE alias exception is no longer accepted.
- Actual live JavaScript syntax audit: 104 files passed. This does not prove every runtime branch is correct.
- Production dependency audit reported zero known npm vulnerabilities. No dependency update was performed.
- HTTP and www both redirect permanently to `https://vip-gece.site/`. Observed HSTS: `max-age=31536000; includeSubDomains`.

## Remaining Limits and Finding

- Extended external URL boundary audit passed 30/31 checks. `/INDEX.HTML/` still returns 404 because the full application's static-file allowlist runs before public alias normalization. The standalone public-router test did not include that middleware. Canonical `/` and normal `/index.html` work; do not claim every HTML case/trailing-slash alias was fixed. A follow-up should add a full-app regression and a narrowly scoped public alias solution without widening private-file access.
- One boundary-audit attempt timed out before retaining its partial report. The complete retry had no transport retries and retained the above reproducible 404 finding.
- Chrome browser automation was blocked by the machine's administrator policy: `DevTools remote debugging is disallowed by the system admin`. The policy was not changed or bypassed. No new rendered desktop/mobile screenshots or authenticated FIDO UI checks were completed.
- Semrush Projects and Site Audit discovery returned an active-subscription / insufficient-API-units response. No Semrush audit, health score, or page findings were obtained. No credits were purchased. User options: https://www.semrush.com/mcp-access
- This is not proof that every possible production bug or vulnerability is absent.

## Evidence

Local JSON reports are under `work/`:

- `vip-public-repair-deployment-20260914.json`
- `vip-public-repair-postdeploy-summary-20260914.json`
- `vip-public-repair-sitemap-20260914.json`
- `vip-public-repair-surface-20260914.json`
- `vip-public-repair-images-20260914.json`
- `vip-public-repair-unpublication-20260914.json`
- `vip-public-repair-url-boundaries-20260914.json`
- `vip-public-repair-syntax-20260914.json`
- `contracts.mjs.repair.log` and the individual focused test logs.

## New User Direction

The user redirected work to a clean Android customer application, an intermediary API that does not embed origin-server secrets in the APK, and split image storage: exact originals on the owned server, optimized copies in Supabase. See `docs/customer-android-storage-contract-20260914.md`. Customer access remains disabled; no new mobile application, gateway or image-storage migration was deployed in this turn.
