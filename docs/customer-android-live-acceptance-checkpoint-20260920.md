# Android customer live acceptance checkpoint - 2026-09-20

## Status

SERVER_TESTS_AND_REAL_STORAGE_ACCEPTANCE_PASSED; COMMERCIAL_DELIVERY_NOT_READY.
The goal remains active. This record supersedes completion assumptions in the
earlier Android checkpoints, but does not erase their historical evidence.
No promotional content was generated or published. Test profiles were generic,
inactive drafts, and were removed after testing.

## Implemented upload queue

- New `PendingPhotoStore`, `PhotoUploadProcessor`, and `PhotoUploadWorker` keep
  byte-exact originals in the app's private no-backup directory until the API
  confirms original preservation, or the owner explicitly cancels the upload.
- Immutable ZIP envelopes, SHA256, synced atomic writes, account/profile/upload
  binding, 8 MiB per image, 24 queued jobs and 128 MiB aggregate storage cap.
- WorkManager uses connected-network/storage constraints and exponential retry.
  The same upload ID is retained after ambiguous network outcomes. Exhausted or
  permanently rejected work retains its original for a user-directed retry.
- Queue metadata and WorkManager Data contain no session credentials. The
  existing AndroidKeyStore session vault now binds the token and account ID in
  one encrypted record. Legacy records bind only after authenticated bootstrap.
- MainActivity stages before scheduling, shows queued/retrying/login-required
  and failed states, supports retry/cancel, and reconciles completed uploads
  with the authenticated gallery without discarding a form draft.
- Fresh server verification: 39 Android tests, 0 failures/errors/skips, and 0
  issues in the downloaded lint XML. This includes byte-cap, damaged-envelope,
  account-switch, interrupted-write, same-ID retry and late-reply/cancel tests.
- These tests do not establish real AndroidKeyStore migration, OS background
  scheduling, physical installation, or device push delivery. Robolectric
  graphics are fixture renders, not emulator/device screenshots.

## Actual Supabase change

Migration `private_customer_accounts` was applied to project
`rklydqhknkhcydoijmlq`, using the existing SQL in
`ops/postgres/003-private-customer-accounts.sql`.

`private.customer_accounts` now exists with identity constraints and RLS.
Fresh privilege queries showed no SELECT/INSERT/UPDATE/DELETE grants for
`anon` or `authenticated`. No client-facing policy was added: this table is
accessed by the server-side database adapter, not by the Android client.
The production process still uses its previous configuration; the new table
is not evidence that customer login has been activated.

Verified runtime variable names are `CUSTOMER_ACCOUNT_STORE_BACKEND` and
`CUSTOMER_GATEWAY_ORIGIN_SECRET`. Do not substitute plural or shortened names.

### Account acceptance

`tools/customer-account-live-check.cjs` ran as deploy against real Postgres:

1. Create/readiness and distinct account identities.
2. Mandatory initial password change and old password/session invalidation.
3. Login from a separate Node process after the password change.
4. Concurrent partial updates preserve both fields through database locking.
5. Stored password hashes; account disable invalidates sessions.
6. RLS and client-role privilege checks.

Disposable accounts were removed. Existing account and profile baselines were
compared before/after. No existing profile was edited or reassigned.

### HTTP and media acceptance

`tools/customer-media-live-check.cjs` used real loopback HTTP, the actual
customer router, real Postgres and Supabase Storage. Its signing/origin secrets
were ephemeral and valid only in the test process. No production listener or
environment was changed.

Verified:

1. HTTP login, mandatory password change, and old-session rejection.
2. Inactive draft creation; another disposable customer cannot read or update
   that draft, and its own bootstrap remains empty.
3. A generated solid-color PNG is preserved byte-for-byte on the server; its
   sanitized JPEG in Supabase matches the recorded derivative SHA256.
4. Repeating the same upload ID produces one profile image, not a duplicate.
5. Authenticated JPEG delivery; the other test customer cannot read the image.
6. Copying the archive to a separate backup/restoration directory, removing
   only the disposable remote object, and recovering from the restored copy
   recreates the hash-verified remote JPEG.

The test cleaned its Storage object, two accounts, draft and private temporary
archive. Final database inventory: 0 new private customer accounts, 27 existing
profiles. Ten existing profiles have historical `customer:` ownership; those
were not assigned to any newly created account. Both acceptance reports have
`cleanup_verified: true`. The media report has `completed: true`.

This is a real disposable restore exercise, not a full disaster recovery test
of all production originals, off-server backups, or customer content.

## Site release gates

`tools/customer-release-gates.cjs` starts a loopback fixture server with an
explicit environment that does not load production secrets. The actual
listening origin is used for SITE_URL, EXPECTED_SITE_URL and SMOKE_BASE_URL.

Final Linux run at `2026-09-20T02-12-18-080Z` passed all five scripts with exit 0:

- `scripts/smoke.mjs`
- `scripts/contracts.mjs`
- `scripts/admin-role-contract.mjs`
- `scripts/private-panels-contract.mjs`
- `scripts/secret-scan.mjs`

Earlier Windows run had one /iletisim request timeout and reached the
180-second contract budget before completion. Its partial output is not a
pass. The first Linux fixture package omitted an admin update public key and
reference files; that caused one 503 and two ENOENT setup errors. Adding the
existing reference files, without changing application behavior or assertions,
produced the final passing run. No source defect was established for the
Windows timing results. A transient SSH connect timeout was also observed.

The first media runner failed at the production analytics-proof prerequisite.
Independent temporary proof secrets were added to its isolated environment,
then the entire acceptance run passed. The failed setups left no test accounts.

## Cloudflare activation limit

The existing credential can read the owned account and vip-gece.site zone.
`customer-api.vip-gece.site` had no DNS record and the Worker list was empty.
The local Wrangler configuration now specifies that custom domain and the
verified account, while `ENABLED` remains `false`.

Wrangler 4.135.0 dry-run passed. The actual deployment failed on the Worker's
`/secrets` management request with `No access to the specified resource`.
Post-failure API reads confirmed an empty Worker list and no new matching DNS
record. Nothing was activated. No origin secret was uploaded.

The browser inventory showed only an empty Codex in-app browser; no Chrome
connection was available. The user was asked to reconnect the Cloudflare Chrome
session so the precise missing permissions can be inspected. Do not weaken
Chrome policy, reuse unrelated credentials, or call read access deployment proof.

## Evidence and environment

Server scratch root: `/var/tmp/vip-gece-android-capture-build.KL6pOoqb`.
Android build user: deploy. The full site fixture is under `release-tests`.
The temporary reference to live installed node_modules was unlinked after
testing; no npm install or mutation of production dependencies occurred.

Local evidence: `output/android-customer-acceptance-20260920/`:

- `build-check-proof.json`, 7 Android test reports, final lint XML.
- `customer-account-live-proof.json`, `customer-media-live-proof.json`.
- `gates/customer-release-gates-2026-09-20T02-12-18-080Z/` logs and proof.

Latest server-only INTERNAL DEBUG APK SHA256:
`3688bc902561bada540f3ad8d1441ed8a39792820e699fff8fc5bc7cbde76513`.
Its gateway is empty; it is not a usable commercial delivery. Signing material
was not transferred, changed or regenerated in this work.

Verified transfer hashes:

| Archive | SHA256 |
| --- | --- |
| Android queue final source/tests | 3a31d841ed37a9746b6ca31b3bab1540599c6ac2f19ee53fe37290e21ac2c351 |
| Site fixture source | aaa6f971d6c0fa424ee9c2bcd85bb6d689106295dd25ff173f9efca4c31307ad |
| Admin update public key | 32c2e1a0589d863965c35711f25db58c8c207fcb1a37696cb4b379e13e16db73 |
| Additional gate references | d7cd2488b5ae10af5a56c745feb0ae19c795e4b70669315e4720a68f62b8331e |

Fresh production comparison: release `20260914-autoindex-v1`, PM2 online,
PID `208061`, uptime marker `1789379706865`, account service SHA256
`89624c1a4e5ee5760beb640e1149de6f827c95ccf43c465ab2622fa0a2e077a4`.
These scoped observations match the previous checkpoint; no restart/deployment
occurred. The private table migration above IS an actual external-state change.

Supabase advisors reported INFO for intentionally policy-free private-table
RLS. Existing warnings for `profiles_updated_at_trigger` search_path and
Supabase Auth leaked-password protection were observed but not changed in this
scoped app acceptance work. References:
[RLS advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
[function search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable),
[password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Remaining acceptance gates

1. Resolve Cloudflare management access; deploy the closed gateway, verify TLS,
   then activate gateway and origin together with independent protected secret.
2. Prepare a scoped backend release and environment update, backups and rollback;
   rerun gates against that exact candidate before switching production.
3. Admin-assigned individual customer access URL and complete onboarding flow.
   MRS account has not been provisioned; no direct-publication permission enabled.
4. Existing-key commercial build on Hetzner with a greater version code and the
   verified gateway, signature/alignment/update-envelope validation and cleanup
   of any temporary signing material. Do not ship the empty-gateway debug APK.
5. Real install/update/background scheduling/AndroidKeyStore/FCM acceptance on a
   usable emulator or device. The software emulator has not booted successfully
   and physical testing is unavailable; these must not be represented as passed.

No absolute defect-free claim, finished commercial APK claim, or completed-goal
status follows from this checkpoint.

## Activation update - 2026-09-20 (later same day)

Gates 1-3 above are now closed; gate 4 is partially prepared and gate 5 remains
open. The Cloudflare MCP connection was re-authorized with write scopes
(excluding account user-settings and billing) after the previous read-only
token. With that access:

- Production backend release switched to
  `20260920T0401Z-customer-8983838a`
  (package SHA `8983838a52d1bfb707ada5cdd6b6427e19e2f67d2990f9db98c38d597afb833e`,
  rollback `20260914-autoindex-v1`). Unlimited profile quota
  (`max_profiles=0`) and the customer access-link flow are live. All five
  release gates (smoke, contracts, admin-role, private-panels, secret-scan)
  passed locally against this exact tree before the switch, plus 22/22
  customer access/safety/first-login tests and the 37-assertion customer
  safety contract.
- Production `.env` now sets `CUSTOMER_MOBILE_ENABLED=true`,
  `CUSTOMER_GATEWAY_URL=https://customer-api.vip-gece.site` and a 48-hex
  `CUSTOMER_GATEWAY_ORIGIN_SECRET` (backup `.env.bak-20260920T040800Z`;
  the temporary server-side secret file was shredded after use). PM2 was
  reloaded; origin probes: no secret `404`, with secret `401` (expected).
- Worker `vip-gece-customer-gateway` was deployed from
  `services/customer-gateway/worker.mjs` with `ENABLED=true`,
  `CUSTOMER_ORIGIN_URL=https://vip-gece.site` and the shared origin secret as
  a Worker secret; custom domain `customer-api.vip-gece.site` is attached
  (AAAA `100::`, proxied). Live gateway checks: bootstrap without auth `401`
  (expected), main site `/` `200`, `/api/ready` `200`, `/vg-panel-91x` `404`.
- MRS Ajans customer account was created:
  `mrsajans@vipgece.com` (id `7ceaf10c-40c3-4681-9a7f-0ddb23d16c12`),
  unlimited profile quota, enabled, `auto_publish=false`, mandatory first
  password change. Live login through the gateway returned `200 ok=true`
  with `must_change_password=true` and `max_profiles=0`. The initial
  password exists only in the local file
  `output/mrs-ajans/mrs-ajans-first-login.txt`; no plaintext credential is
  stored on the server.
- No release keystore was found on this machine (only
  `work/android-toolchain/android-user/debug.keystore`); commercial build
  (gate 4) still needs the existing signing material or a newly generated
  release keystore, with `CUSTOMER_GATEWAY_URL` set to the live gateway and a
  version code greater than 10001. The empty-gateway debug APK must still not
  be shipped. Real-device/emulator acceptance (gate 5) remains unverified.

## Commercial APK record - 2026-09-20 (final same-day update)

Gate 4 is now satisfied; gate 5 remains open. With the owner's decision, a
NEW release keystore was generated on Hetzner (no existing commercial key
existed anywhere searched):

- Keystore: `/var/lib/vip-gece/signing/vip-gece-customer-release.jks`
  (deploy:deploy, mode 600, alias `vipgece-customer`, RSA-2048, validity
  36500 days, certificate SHA-256
  `c82f0f78fb2ee508a13008735cb90ccb27d365a5e0c9dafc2b2b5962a7075c06`,
  DN `CN=VIPGeceCustomer, OU=Mobile, O=VIPGece, L=Istanbul, C=TR`).
  Java's PKCS12 implementation requires store and key passwords to match;
  this was applied. Passwords exist only in the server-side
  `customer-release.properties` (mode 600) and the downloaded backup.
- Build: `versionCode 10002` / `versionName 1.0.0`,
  `CUSTOMER_GATEWAY_URL=https://customer-api.vip-gece.site` (the live,
  verified gateway), R8 minify + resource shrink. The screenshot harness
  tests were deliberately NOT included in the commercial build; the app's
  own `testReleaseUnitTest` passed 38/38 (release variant).
- Validation: `zipalign -c 4` exit 0; `apksigner verify --print-certs` exit 0
  with the certificate fingerprint matching the keystore exactly;
  `classes.dex` embedding of both `https://customer-api.vip-gece.site` and
  the update origin verified from the downloaded APK.
- Deliverable: `output/android-customer-release-20260920/vip-gece-customer-release-1.0.0-10002.apk`,
  SHA-256 `829db11941a1a547027acd2a9ca9113c8e40a61851ce8d304eafc23c110da5f9`,
  788150 bytes (server and local hashes identical).
- Signing backup (keystore + properties, secrets inside - must be stored
  safely by the owner; all future updates must be signed with this key):
  `output/android-customer-release-20260920/vip-gece-signing-backup-20260920.tar.gz`,
  SHA-256 `9a7c2dd69fa39b7a4de4619c015629b5c763e1891c20af114e34306c3889d471`.
  The temporary server-side backup copy was deleted; the live signing
  material remains only under `/var/lib/vip-gece/signing/` and the owner's
  backup copy.
- Gate 5 (real install/update/background scheduling/AndroidKeyStore/FCM
  acceptance on a usable emulator or physical device) is still NOT done and
  must not be represented as passed. The software emulator has not booted
  successfully on Hetzner (no KVM) and no physical device test was performed.
