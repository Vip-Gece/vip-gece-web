# Customer Android Implementation Checkpoint - 2026-09-14

## Status

Implemented and tested locally. NOT production-enabled, NOT installed on a phone, and NOT included in the auto-indexing release. Keep customer access closed and preserve the existing FIDO-only administrator boundary.

The new source is `apps/customer-android`. Legacy Android folders are reference-only and were not copied into this application. The earlier `docs/customer-android-storage-contract-20260914.md` records the design requirements; this file records implementation and remaining gaps.

## Native client

Later design update: `docs/customer-android-redesign-20260914.md` records the newly implemented legacy-inspired night theme, tabbed profile editor, fresh 14-screen native rendering and final APK verification. The earlier APK hash and ten-image evidence below remain historical; use the redesign record for the current UI. Customer activation gaps at the end of this checkpoint still apply.

- Native Java Android project: AGP 8.13.2, Gradle 8.13, Java 17 target, SDK 36, minimum SDK 26.
- Login, mandatory first-login password change, owned-profile list/create/edit, Photo Picker original upload, selected-image preview, stable UUID retry, and logout are implemented.
- Only the future gateway URL belongs in client configuration. Its current BuildConfig value is empty, so login is unavailable rather than falling through to the origin.
- HTTPS-only requests, redirect rejection, Android Keystore AES-GCM session storage, disabled backup, and FLAG_SECURE are present.
- No origin address or Supabase service credential is compiled into the client.
- An app's public network endpoint cannot be made impossible to discover. The enforceable boundary is an authenticated gateway and a separately protected origin, not endpoint invisibility.

Verification in this task: `assembleDebug`, `testDebugUnitTest`, and `lintDebug` succeeded; three Java unit tests passed; lint reported no issues. No emulator/device UI or real gateway test was performed.

Debug APK: `apps/customer-android/app/build/outputs/apk/debug/app-debug.apk`, 50,540 bytes, SHA-256 `A652C2D11B545F6B391C614F152AACEDB1180496353C02F90595FE843FC2BF37`. It is not a signed production deliverable and cannot connect until the gateway is configured and verified.

Later on September 14, ten native Android screen/dialog images were rendered on the authorized Hetzner server using the unchanged app sources and an external Robolectric native-graphics test harness. Test passed; all ten images were visually opened and their downloaded SHA-256 values verified. This adds native-view rendering evidence but is not a physical-device/emulator session or a live backend test. Details: `tools/android-screenshots/README.md`; outputs: `output/android-screenshots-20260914/`. Production code and the secure-window flag remain unchanged.

## Server originals and Supabase derivatives

`src/services/profileOriginalArchiveService.js` implements a private server-side archive with original bytes, optimized derivative, hashes, manifests and append-only transition journals. Default production path is `/var/lib/vip-gece/customer-profile-originals`; activation requires the explicit `server-original-supabase` storage mode.

- JPEG/PNG/WebP original input, 8 MiB / 40 megapixel limits; optimized metadata-stripped JPEG, 2048-pixel and 2.5 MiB bounds.
- `original.bin`, `display.jpg` and manifest/remote/link records remain private, using restrictive file/directory permissions and symlink rejection.
- Stable upload UUIDs provide retry identity; mismatched duplicate content is rejected.
- Supabase receives the optimized derivative with overwrite disabled, followed by a download/hash verification before success is reported.
- Database detachment precedes remote image deletion; the server original is retained.
- Recovery can re-upload a verified retained derivative. Regeneration from only the original after the derivative is lost is not yet implemented.

Twelve focused Node archive tests passed using real image processing and controlled storage/disk failure collaborators. This is not proof of real production Supabase upload or off-server backup restoration.

## Password and gateway boundaries

- Missing `must_change_password` defaults to true. Admin creation/reset forces password change.
- Password change requires the current password and a different 12-1024-character new password; session revision revokes older sessions and returns a replacement.
- Other customer operations remain forbidden until first-login password change succeeds.
- `src/middleware/customerGateway.js` defaults customer access to 404 and requires a strong gateway-to-origin secret for production activation.
- `services/customer-gateway/worker.mjs` is a default-closed Worker implementation with explicit route/header allowlists, size limits and projected JSON responses. It is not deployed and has no active Wrangler configuration.
- Four focused password/gateway-boundary Node tests passed. General contracts and private-panel contracts passed earlier in this task.

## Required before activation

1. Migrate customer account persistence from the current private JSON store to the user's intended Supabase-backed account design, with ownership isolation and recovery tests.
2. Complete admin-assigned random customer URLs and chosen local-part plus `@vipgece.com` naming requirements. Do not substitute public signup or Google login.
3. Add Worker-specific unit/integration tests and trusted client-IP forwarding so login rate limits do not group every customer under a Worker address.
4. Configure and deploy the gateway with secret-backed origin authorization; verify direct-origin denial and absence of secrets in APK/network error responses.
5. Add persistent background upload jobs/recovery across process death. Current retry identity is not a full WorkManager upload queue.
6. Complete remote gallery image rendering; current app previews newly selected upload content and counts, not the full remote gallery.
7. Exercise real Supabase uploads, quotas, orphan reconciliation, original/derivative restore and off-server backups in an isolated environment.
8. Verify the existing customer-mobile POSIX-permission contract on Linux; its Windows permission assertion was environment-limited.
9. Perform desktop/mobile API and Android device testing, then release signing and a separately verified deployment. Do not enable customer access merely because the debug build passes.

No live account, original-image archive, database schema, mobile endpoint or customer-access setting was changed by the selective search-indexing deployment.
