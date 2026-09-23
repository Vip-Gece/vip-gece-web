# Native Android screen capture

## 2026-09-20 server verification

Current evidence is under `output/android-server-verification-20260920/`.
`build-check-remote.py` runs all 21 unit/view tests, lint and a debug test build
in an isolated server source copy. Four view tests include bounded gallery
slots; the capture count remains 14. Optional background updates are disabled
only in the view-test preferences to avoid live service connections.

`setup-emulator-remote.py` prepares the official API 36 AVD.
`prepare-emulator-libs-remote.py` downloads pinned repository package versions
and extracts them privately, without installing system packages.
`emulator-check-remote.py` bounds a software-emulator attempt to 600 seconds,
two CPU affinity slots, low priority, private ADB and process cleanup. This
attempt timed out before boot, so it established no installation/launch result.
See `docs/customer-android-server-build-checkpoint-20260920.md` for exact limits.

Test-only harness for the current `apps/customer-android` implementation. It is applied through a Gradle init script to a verified temporary source copy; it does not change the production application, enable customers, or put a preview bypass into an APK.

The 2026-09-14 run used the authorized Hetzner server, `/var/tmp/vip-gece-android-capture-20260914`, unprivileged `nobody`, a 4 GiB memory ceiling, a two-CPU quota, read-only system/home restrictions and a writable binding for only the scratch directory. The host does not expose `/dev/kvm`, so these are Robolectric 4.16 native Android graphics renders at SDK 34, not screenshots taken from a physical device or a booted emulator.

## Captured coverage

The current harness also captures contact and image tabs plus two 320 dp screens, for 14 PNGs. The original ten-screen run below is the pre-redesign baseline. Current output: `output/android-screenshots-20260914-redesign/`. Use `node tools/android-screenshots/collect-proof.cjs --run=20260914-redesign` before scratch cleanup, then the same command with `--cleanup` after evidence download. `manifest.json` contains 12 main captures and `narrow-manifest.json` two narrow ones. The three tests also exercise empty-name validation, draft preservation across tabs and confirmation before discarding changes.

1. Actual service-disabled customer login.
2. Mandatory password renewal.
3. Password validation message.
4. Empty profile list.
5. Profile list with an explicitly fictional draft.
6. Native new-profile dialog.
7. Profile editing, upper viewport.
8. Profile editing, lower viewport.
9. Pending photo preview, using the app's own icon as a fixture.
10. Native logout confirmation dialog.

Application captures are 780 x 1688; dialogs are native-view crops. The external Android document picker and keyboard are operating-system surfaces and are not captured. There is no backend session or upload verification here.

## Reproduction boundaries

- `setup-remote.py` installs archive-verified tools under the approved scratch directory and reuses the existing SDK license records. No system-wide Java/Android install is performed.
- Copy only the current Android source tree, manifests, Gradle files and this harness; exclude credentials, local caches, old app folders and production server files.
- `run-remote.py` sets an empty gateway origin and invokes only `NativeScreenCaptureTest` with `screenshot.init.gradle`.
- The test invokes the real activity's view construction with fixture data. Its invariant checks assert a null API client and an unchanged secure-window flag.
- PNG compression, native Android view drawing, dimensions, pixel diversity and hashes are recorded in the screenshot manifest.
- `collect-proof.cjs` verifies downloaded hashes and compares the temporary Android sources with local originals before optionally removing the exact ownership-marked scratch directory.
- These renders do not replace Android device testing, accessibility testing, live login testing or real image backup/restore tests.

Outputs and machine-readable evidence: `output/android-screenshots-20260914/`.

Official references: [Robolectric setup](https://robolectric.org/getting-started/), [native graphics mode](https://robolectric.org/javadoc/4.10/org/robolectric/annotation/GraphicsMode.Mode.html), [Adoptium download verification](https://adoptium.net/installation/ci-scripts).
