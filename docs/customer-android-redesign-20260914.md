# Customer Android redesign - 2026-09-14

## Status

The new native Android UI is implemented in `apps/customer-android`, built and tested. Customer access remains closed. No production release, account, database, Cloudflare setting, or administrator authentication setting was changed.

## Legacy reference actually inspected

- `mobile-customer-native/README.md`, `android/app/src/main/res/values/colors.xml` and `styles.xml` were read.
- The old `MainActivity.java` UI inventory was searched; login/dashboard lines 412-749, profile card lines 924-1045, and presentation helpers lines 2409-2661 were read. This is targeted design review, not a claim that all 2,770+ lines or all archived sessions were read.
- `mobile-customer-native/android/app/src/main/res/drawable-nodpi/vip_gece_logo.webp` was opened visually. It has a pink/gold identity on black. No old binary, source block, logo or other asset was copied into the clean app.
- The retained reference was source and branding, not a verified screenshot from the old installed application. Existing teal screenshots in `output/android-screenshots-20260914` show the earlier clean app, not the legacy app.

## Implemented design

- Neutral charcoal background, pink actions, gold draft states, green live counters; improved contrast and consistent native controls.
- New typographic VIP GECE wordmark inspired by the reference palette, not a duplicate of the legacy logo image.
- Persistent field labels, password visibility controls, minimum 48 dp icon hit areas, explicit focus states and native keyboard types.
- Unframed profile totals and real local all/live/draft filters; compact profile rows with status, area and image counts.
- Separate information, images and contact tabs, with a persistent save action.
- Unsaved fields survive tab changes and photo selection within the same activity. Leaving a changed form requires confirmation.
- Photo selection preview, clear-selection action, visible pending status, and the existing original-byte upload behavior retained.
- Required profile-name validation keeps the creation dialog open on empty input.
- Clear empty states and disabled service login when no gateway is configured.

Native presentation helpers live in `PanelUi.java`; network and secure-session classes were not redesigned. The 13 icon vectors were obtained from the official Material Design Icons repository at commit `40a7a292a79d9394157e1ea24f83d52d5e17c556`, with license and source records under `apps/customer-android/third-party`. The downloaded vectors' tint attribute was qualified as `?android:attr/colorControlNormal` for the platform theme. These are packaged local assets, not a Google Cloud service integration.

## Fresh verification

- Final local `assembleDebug`, `testDebugUnitTest`, and `lintDebug`: successful.
- Three existing gateway-policy tests: passed. Final lint report: `No issues found.`
- Three isolated server-native tests: full screen capture, 320 dp text bounds, tab state retention and unsaved-back confirmation: passed.
- Fourteen distinct nonblank PNGs at 390 dp / 320 dp and native dialog sizes. All were visually inspected; final changed icon-bearing screens were inspected again.
- Downloaded PNG SHA-256 values verified. All 25 `app/src` files on the test server match local sources.
- `ApiClient.java`, `GatewayPolicy.java`, and `SessionVault.java` match the pre-redesign source archive byte-for-byte.
- API client remained null in the screen tests; the main activity's `FLAG_SECURE` remained set. No real session or customer data was used. The sample image is the app icon.
- Native rendering uses Robolectric 4.16 / Android SDK 34, not a booted emulator or physical device. Keyboard, external document picker, font-scaling, process-death restoration, live uploads and real-device behavior are not proven by these tests.
- Gradle emitted SDK XML-version and deprecated-tooling notices; application lint itself was clean.

Final debug APK: 60,526 bytes, SHA-256 `19014bf5d7fcd92c94553d1dc2637090485a46c88caf0d56c601c418d3e301cc`. The gateway is intentionally empty. This is not a production-enabled customer release.

## Outputs and cleanup

- `output/android-screenshots-20260914-redesign/`: 14 PNGs, manifests, native JUnit report, source/toolchain proof, verification and cleanup records.
- `output/vip-gece-android-yeni-tasarim-20260914.zip`: portable screenshot/evidence bundle.
- `/var/tmp/vip-gece-android-capture-20260914-redesign`: deleted after evidence download and hash verification. Restricted transient setup/test units completed and were collected.
- Live release remained `/var/www/vip-gece-site/releases/20260914-autoindex-v1`; `/api/ready` returned 200 during final verification.

## Still separate work

The full remote image gallery is not implemented: current screens show stored-image counts and preview the locally selected upload. Do not claim existing remote profile photos are displayed by this redesign. No analytics, publication controls, update service, theme picker or support session from the legacy app was silently ported.

The existing implementation checkpoint still governs account migration, admin-issued customer URLs, gateway deployment, persistent upload recovery, storage integration, real-device verification and release signing. This design pass does not complete or activate those systems.
