# .site save isolation, galleries and ownership - 2026-10-11

## Scope and deployed source

Only `.site` application code is changed. Source commits `dc1f1c2` and
`46c4a12` are deployed at
`/var/www/vip-gece-site/releases/20261011-save-safety-46c4a12`.
Promotion completed at `2026-10-11T11:44:37.543Z`. The production environment
and all sibling process IDs are unchanged.

## Fixed behavior

- Switching or reopening a profile clears pending file selections. An active
  save locks switching, cancellation and deletion until completion.
- Upload and payload errors are handled by the save workflow, preserving
  user-entered fields and pending files on failure.
- JPEG, PNG and WebP batches are checked for supported type, nonempty bytes
  and the existing 8 MiB limit before any upload or profile write.
- Concurrent save calls are guarded. Retries retain a stable upload ID and
  reuse successful uploads after a subsequent profile-write failure.
- The admin entry point, profile editor and analytics module now import the
  identical version of the customer-account module. Previously its separate
  instances could disagree about whether customer accounts had loaded.
- Server-rendered gallery buttons receive escaped original source attributes.
  They are bound before the detail-data response, and hydration preserves
  the selected image, buttons and keyboard behavior.
- Missing former customer relationships fall back to site management. New
  invalid owner assignments remain rejected. Account-store errors are never
  treated as evidence of deleted ownership, including a missing JSON file.
- A production startup check and five-minute maintenance cycle reconcile
  orphans. The authenticated admin list also reconciles before reading.
  A transaction-level profile lock prevents concurrent new assignments from
  entering between the account snapshot and ownership update.

## Data and safety evidence

Eleven deleted-account relationships were changed to site ownership. The
17 stored rows now contain 16 site-owned profiles and one valid customer-owned
profile, with zero orphan relationships. This includes inactive records.
All other profile fields match the original snapshot, apart from the
database-managed modification timestamp. Melek's public fields, seven images,
contact and visibility are preserved. The locked announcement configuration
is unchanged. Reconciliation is idempotent.

The first promotion's ordered API digest failed and the code was rolled back
automatically. Investigation compared every API field against the original
database snapshot and found no public-field change; five rows have an equal
creation timestamp, allowing their raw database response order to vary.
The final deployment compares all API fields by stable slug and separately
checks the visible homepage slot order, without ignoring public fields.

## Fresh verification

- Isolated smoke and full contracts review passes.
- 46 customer-safety tests, 11 CSP/runtime-boundary tests, secret scan and
  whitespace checks pass. The final candidate runs 30 focused tests on the
  production Node runtime before promotion.
- Real Chrome lab tests use the actual editor and gallery code with fixture
  data and controlled API failures; no production profile writes are simulated
  as real writes or performed for those UI checks.
- Live Chrome checks 19 routes at 390 px and 1366 px: 38 passes with no page
  errors, failed requests, CSP violations, overflow, broken loaded images or
  public nofollow anchors detected. Analytics is excluded from this browser
  audit so test visits cannot create visitor or click events.
- Four additional live-HTML/module tests hold or replace the profile API
  response in the browser. Early gallery selection, post-response selection
  retention and keyboard navigation pass at both widths. The injected delay
  and 503 response are test conditions, not observed production outages.
- Fresh strict sitemap SEO and content/image audits check all 262 URLs with
  zero findings within those checks and zero broken image resources.
- Cloudflare purges 19 `.site` URLs only. Private APIs remain hidden from
  unauthenticated origin requests with their private robots rules.

## Shared server capacity

Six unreferenced old v6 release directories contained byte-identical dependency
trees. Regular files and symlink targets were compared without following
workspace links into different source versions. Only those old `node_modules`
copies were removed. Source, media, build outputs, backups, logs, active
dependencies and the newest ready rollback copy were preserved. A dependency
restore manifest was retained in each cleaned release.

This frees 4,588,326,912 bytes. Server disk use decreases from 90% to 78%, with
8.0 GiB available. No sibling process was restarted or redeployed.

## Evidence location and limits

Raw evidence remains outside the source tree in
`/Users/o-neo/Documents/Vip-Gece-GSC-Kontrol-2026-10-09/site/`:

- `save-safety-deployment-proof-46c4a12.json`
- `fix-browser-lab-proof.json` and `live-save-safety-browser-proof.json`
- `seo-discovery-after-20261011.json` and `content-discovery-after-20261011.json`
- `disk-cleanup-proof-46c4a12.json` and `gallery-review.log`

These bounded passing checks do not prove all conceivable defects absent,
refresh an exhausted Semrush quota, clear historical GSC reports, guarantee
indexing or validate the other independent sites.
