# Android server build and test checkpoint - 2026-09-20

## Current outcome

SERVER_BUILD_VERIFIED, COMMERCIAL_DELIVERY_NOT_READY.

The authenticated customer profile-management application was compiled and
tested on the owner's Hetzner server. This continues the clarified management
app goal; no promotional content was generated or published. Historical
checkpoints describe earlier work, not the current completion state.

The user currently cannot provide a physical Android device. A graphical
Android Studio desktop was not installed: its SDK, build tools and Android
Emulator were prepared for headless server operation instead.

## Isolated server environment

- Scratch root: `/var/tmp/vip-gece-android-capture-build.KL6pOoqb`.
- Build/test user: `deploy`; no production application restart or deployment.
- JDK: verified Adoptium 21.0.12.1; Gradle 8.13; Android platform 36.
- Build Tools 35.0.0; Platform Tools 37.0.1; Emulator 37.1.11.
- AVD: `customer_acceptance`, API 36 AOSP x86_64 system image revision 2.
- No `/dev/kvm` or CPU virtualization flags were exposed by the server.
- 56 missing Linux dependency packages were downloaded from the configured
  Ubuntu repositories and extracted into `toolchain/host-libs`. They were NOT
  installed into the system package database. Package hashes are recorded.
- Software emulator used SwiftShader, two CPU affinity slots, low priority,
  2048 MB guest RAM and a 600-second boot budget. Observed host RSS approached
  4 GB; guest RAM is not a host RSS limit. Test ADB used private port 5038.
- Observed emulator/ADB listeners were loopback only. No firewall or SSH
  security policy was changed. Existing SSH host-key verification remained on.
- Toolchain and source scratch files remain for the next build. They contain
  no production `.env`, customer database or commercial signing private keys.

## Implemented source changes

1. Cloudflare customer gateway now forwards an edge-derived client IP through
   its own header. It ignores caller-provided origin proof, forwarded-IP and
   cookie headers. Preserved IPv6 is used only with Cloudflare pseudo IPv4.
2. Production customer middleware requires both valid gateway proof and a
   valid client address. Customer rate limiters use that verified address,
   with IPv6 subnet grouping. This is an origin/Worker compatibility change;
   deploy them together. Existing production customer access was not enabled.
3. Added default-closed `services/customer-gateway/wrangler.jsonc`. Wrangler
   4.135.0 dry-run packaging passed; no Worker was deployed.
4. Android's image tab now has bounded two-column remote photo slots, protected
   JPEG downloads through the gateway, bounded decode, stale-screen checks and
   retry controls. Separate image I/O avoids blocking ordinary form requests.
   Real authenticated remote-image delivery remains an integration gate.
5. Added gateway contracts, Android photo-transfer tests and a gallery layout
   test. The rendering harness disables optional background update/Firebase
   activity in test preferences; production behavior is unchanged by that
   test setup. The app's secure-window flag remains enabled.

## Fresh verification

- Node customer/gateway/archive checks: 41/41 passed locally and on Linux
  Node v22.23.2, zero skipped. Database/Storage boundaries use test fixtures,
  not real tenant or production data. Server TAP report is retained.
- Server Android: `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug`
  passed. 21 tests, zero failures/errors/skips. Final lint XML has zero issues.
- 14 native Android graphics renders were produced with Robolectric 4.16,
  SDK 34 and 390/320 dp fixtures. All downloaded PNG hashes matched and all
  captures were nonblank. These are NOT device/emulator screenshots and do
  not establish real login, Firebase delivery or upload success.
- Actual emulator: software boot did NOT finish in 603 seconds. Installation
  and launch were not attempted successfully. The runner stopped its emulator
  process group and private ADB server afterward. This is an environment/test
  limitation, not proof of an application launch defect.
- Administrator role contract: 29 assertions passed. Private panel contract
  passed. Final secret-scan passed. `git diff --check` passed with existing
  unrelated line-ending warnings. Full site smoke/contracts were not rerun;
  they remain mandatory before a production deployment.
- Cloudflare account token read access was freshly confirmed: the target
  account's Worker inventory returned HTTP 200 and an empty list. This does
  not prove all write permissions or an active customer gateway.

Initial Android rendering failed because WorkManager was not initialized in
the isolated view-test environment. The harness now opts out of background
connections before creating the Activity, and all tests were rerun. Two new
lint translation warnings were fixed with string resources, then the complete
Android test/lint/build sequence was rerun successfully. The first Linux Node
runner inherited `/root` as its working directory and could not spawn test
children as deploy; rerunning in the owned test directory resolved that setup
error without changing permissions. A temporary node_modules reference to the
live installed dependencies was unlinked after the tests.

## Artifacts and hashes

Local evidence root: `output/android-server-verification-20260920/`.
It contains `build-check-proof.json`, toolchain/emulator provenance,
`backend-tests.tap`, `emulator-check-proof.json`, final lint/test XML and
`screenshots/` with both capture manifests.

The server-only debug APK is an INTERNAL TEST ARTIFACT, not the requested
commercial package. Its SHA256 is
`b51e440bfc3d5e31f86788fda8e9716f10984ae645d6857f817f29f3107c8e9d`.
It has an empty customer gateway, so it must not be distributed as usable.

Verified local/server source equality:

| File | SHA256 |
| --- | --- |
| MainActivity.java | 397197bad3fc68b33c2770d1811bbbf8c93b0b95689ae688ccdb23572e84af5f |
| ApiClient.java | bb2c228844e6e34f4aa432e7193f9d50a372645a101841958cba0b09e30e50ba |
| values/strings.xml | 4d12de703f559e40ad2873a5025860135b9cfcac8b3f916afb4803cc63047f57 |

Transfer hashes:

- Toolchain bootstrap: `97955aa0ba238d0759081cb2699573258499ea9b6c91e15844d892845bf8ff62`.
- Initial Android source/tests: `3cfc6e20c6c09489471efe0602aaf3edb497cb5b9e2026c502b18893f4296f32`.
- Gallery source/tests before final string-resource fix: `7b72ee0c5c629db651587ce3f8bb0b60bb605868f2e8b5bbbfa73a20cd224261`.
- Backend fixtures: `5202fce9812f88855e36af3f31a995226f7304d3d45cc8865892503c99eae498`.

The observed live PM2 PID remained `208061`; the measured production account
service hash remained
`89624c1a4e5ee5760beb640e1149de6f827c95ccf43c465ab2622fa0a2e077a4`.
This is a scoped comparison, not a claim that all server files were audited.

## Next required work

1. Durable image-upload queue and process-death/offline recovery, with explicit
   account binding, bounded storage, cancellation and idempotent retry tests.
2. Real private customer persistence, tenant isolation and original-media
   backup/restore acceptance, without reassigning existing public profiles.
3. Admin-assigned customer access URL and account provisioning flow; preserve
   mandatory first-password change and the separate administrator/FIDO gate.
4. Verified production gateway/secret activation and scoped backend deployment
   with fresh release gates, backups, health checks and a tested rollback.
5. Increment version code, build the actual commercial APK on this server using
   the EXISTING protected signing identity, validate certificate/hash/alignment
   and signed update metadata, and remove temporary signing material afterward.
6. Complete installation and critical-flow tests using a viable emulator or
   device. Physical-device/FIDO/push acceptance remains explicitly unverified.

Do not close the active goal based on this checkpoint or distribute the debug
artifact. A passing build/test suite is not an absolute no-defects guarantee.
