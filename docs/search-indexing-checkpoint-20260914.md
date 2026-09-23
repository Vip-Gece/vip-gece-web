# Search Indexing Checkpoint - 2026-09-14

## Verified production state

- Current: `/var/www/vip-gece-site/releases/20260914-autoindex-v1`.
- Rollback: `/var/www/vip-gece-site/releases/20260914-public-runtime-repair-v1`.
- Backup: `/var/backups/vip-gece/autoindex-20260914/` (private environment backup retained).
- Only six files differ from the preceding live release: `src/services/indexNowService.js`, `src/services/sitemapService.js`, `scripts/indexnow-submit.mjs`, `scripts/autoindex-sitemap.test.cjs`, and the two `ops/systemd/vip-gece-indexnow.*` units.
- Candidate and activated-runtime checks passed (63 checks). Deployment used the deploy-user PM2 application; readiness and private/public panel boundaries passed.
- Database state was not changed: 27 profiles, 15 active, 43 working images; 12 inactive profiles and their descriptions retained.
- Local Android, customer-account, gateway and original-image changes were NOT part of this release. Customer access remains closed.

## Google Search Console

The supplied ZIP contains four CSV files, all read. Its report data was last updated on September 4, despite the September 14 export filename. It reported 42 indexed and 267 non-indexed URLs.

All 267 issue examples were read through the Chrome tables: 201 crawled-not-indexed, 29 server errors, 19 redirects, 12 discovered-not-indexed, 4 noindex, 1 different Google canonical, and 1 not found. CSV download was blocked by the browser, so these were read from visible tables instead; no download restriction was bypassed.

Actions and evidence:

- Submitted `https://vip-gece.site/sitemap.xml`. Search Console subsequently showed successful processing, September 14 last read, and 254 discovered pages.
- Submitted `https://vip-gece.site/image-sitemap.xml`; the success dialog was observed. The table still showed an older last-read date at that observation, so fresh image-sitemap processing is not claimed.
- Started validation for the 29-URL server-error group. The UI showed validation started on September 14.
- Final live check at `2026-09-14T08:17:41.576Z`: all 254 current sitemap URLs return 200, self-canonical, without a noindex directive. All 29 historical server-error URLs passed.
- The 201 crawled-not-indexed examples now contain 178 current sitemap pages, one intentionally noindex empty category, and 22 retired/ambiguous URLs returning 404. These are not 201 current technical failures.
- The other 37 examples were rechecked after cache cleanup: no 5xx or redirect loop was found. Empty categories retain noindex; invalid/retired profile addresses retain 404; valid aliases redirect to their current URL.
- `moda-escort` currently self-canonicalizes. Google's eventual canonical choice is not independently verified by this fetch.

Google receiving a sitemap or starting validation does not prove indexing or ranking. Do not promise top-five placement or mark every historical exclusion as fixed.

## Cloudflare cache correction

Eight retired profiles incorrectly served old cached 200 HTML, while cache-bypassed requests returned the intended 404: `ela-istanbul`, `melike-istanbul`, `burcu-istanbul`, `melis-istanbul`, `irem-vip-istanbul`, `gizem-istanbul`, `tatyana`, and `bade-nur`.

An initial targeted URL purge cleared only three. After the user's explicit approval, exactly one hostname purge for `vip-gece.site` was performed in Chrome and confirmed in Recently Purged. All eight plain URLs subsequently returned 404 in a fresh 201-URL comparison. No `.com`, `.online`, panel-host, DNS, security, or cache-rule changes were made by this purge.

The public HTML cache rule respects origin cache-control; private surfaces have a bypass rule. Method-sensitive cache-rule matching may explain the incomplete single-URL purge, consistent with Cloudflare documentation, but the precise cache-key cause is not proven.

## Non-Google automatic notifications

- `vip-gece-indexnow.timer` is enabled and active, checking approximately every five minutes with up to 30 seconds of jitter.
- It submits newly added, changed and removed sitemap URLs, not every unchanged URL repeatedly.
- State: `/var/lib/vip-gece/indexnow-state.json`; latest result: `/var/lib/vip-gece/indexnow-latest.json`.
- First accepted submission: `2026-09-14T07:57:56.450Z`, 254 URLs, HTTP 200, key verified, `submission_status=accepted`, `indexed_status=not_verified`.
- Follow-up: `2026-09-14T08:13:45.710Z`, `submission_status=no_changes`, zero URLs selected. The diff mechanism is operating.
- Final follow-up: `2026-09-14T08:36:30.025Z`, still `no_changes`; the timer remains active and `current` still resolves to the verified auto-indexing release.
- IndexNow shares submissions among participating engines. Its current official FAQ lists Amazon, Bing, Naver, Seznam.cz, Yandex and Yep endpoints. Acceptance by the shared protocol is not proof of indexing in each engine.
- DuckDuckGo gets much of its traditional web results from Bing; this is indirect coverage, not a separate confirmed submission.
- No direct Brave/Baidu submission, new third-party webmaster account, or universal all-engine acceptance is claimed.
- No Google Cloud project, OAuth client or Google Indexing API was created or used by this implementation.

Initial activation encountered a test working-directory permission failure and an incorrect systemd environment-file condition; rollback restored the preceding release. Both were corrected before final activation. Initial external IndexNow verification returned 403; a later automatic attempt was accepted. The backup's `first-run.json` and `manifest.json` capture that initial pending state, not the later accepted result. Preserve this distinction.

After local evidence was retained, six session-owned temporary files were removed from `/tmp`: the search-baseline helper, cache helper, deployment helper, deployment bundle, and runtime-integrity helper/report. Live files, IndexNow state and rollback backups were retained. The first cleanup connection timed out; the successful retry explicitly reported the six removals and active timer.

## .com to .site cancellation

Google's Change of Address was still active, started July 24, 2026, from `vip-gece.com` to `vip-gece.site`. On September 14, the existing request was cancelled through Search Console. The page returned to the new-site selection/setup screen with no active transfer.

Cloudflare `.com` inspection: Rules overview showed only templates, Page Rules showed 0/3 used and no data, Workers Routes showed no configured routes, and account Bulk Redirects showed no lists. No remaining cross-domain rule was found on those surfaces.

The live Nginx configuration has no `.com` virtual host. The local `ops/nginx/vip-gece.com-redirect.conf` expresses 410/noindex but is not deployed, so live 410 is NOT claimed. Hetzner observed HTTP `.com` redirect only to HTTPS on the same `.com` hostname; HTTPS probes timed out. Local access is also blocked/unavailable. Cancellation is verified in Google, but full `.com` HTTPS behavior remains unverified. Do not recreate a redirect, change DNS or reopen `.com` merely to remove that uncertainty. `.online` remains separate.

## Evidence and sources

- `work/search-live-audit-20260914.json`
- `work/gsc-crawled-live-comparison-20260914.json`
- `work/gsc-other-live-comparison-20260914.json`
- `work/runtime-integrity-remote-20260914.json` includes the accepted IndexNow result.
- Browser observations in this task: Google submission/validation/cancellation and Cloudflare purge/rule listings.
- [IndexNow FAQ](https://www.indexnow.org/faq)
- [DuckDuckGo result sources](https://duckduckgo.com/duckduckgo-help-pages/results/sources)
- [Google Change of Address](https://support.google.com/webmasters/answer/9370220)
- [Cloudflare single-file purge](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-single-file/)

Next verification should inspect Google's completed validation and image-sitemap processing, not blindly resubmit all URLs or enable indexing of retired/private pages.
