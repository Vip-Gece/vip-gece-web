# Customer Android and Image Storage Contract - 2026-09-14

Status: requirements and verified implementation gaps. Not a shipped application or activated storage migration.

## Confirmed User Requirements

- Build a clean Android customer panel. Old, unclean project/application folders are reference material only: do not copy their code, binaries or assets into the new implementation.
- The application talks to an intermediary service, which talks to the origin. Do not embed the origin IP, origin hostname, database credentials, Supabase service keys or gateway-to-origin secrets in the APK, resources, logs or client configuration.
- The exact uploaded photo bytes are retained privately on the owned server.
- A suitable, optimized derivative is stored in Supabase Storage and associated with the customer's profile in the database.
- Preserve the existing FIDO-only admin model. Customer access must not be reopened as a side effect of scaffolding the mobile application.
- Previous account requirements remain: admin-issued random customer access link, admin-selected email local part with `@vipgece.com`, random initial password, mandatory password change on first login, and access only to that customer's records.
- `.online` is a separate future site, not a fallback origin. Do not restore the canceled `.com` to `.site` migration or add Google Cloud OAuth dependencies.

## Security Boundary

The intermediary address and the device's own traffic cannot be made impossible for the device owner to discover. APK obfuscation is not an authorization boundary. Android uses APK/AAB packaging, not Electron ASAR.

The enforceable requirement is that discovering the intermediary endpoint or extracting the APK does not grant privileged origin access. Authenticate every customer request, verify profile ownership server-side, use short-lived scoped sessions, protect device-held session material with Android Keystore, disable cleartext transport, and keep gateway-to-origin authentication entirely server-side. Do not claim that a rooted/instrumented client can never inspect its own decrypted data.

An intermediary must relay approved routes rather than issue a redirect to the origin. A separate credential and restrictive origin policy are required; hiding an IP or relying on an app-wide embedded secret is insufficient. The gateway's actual hosting, domain, credentials and deployment have not yet been provisioned.

## Image Data Flow

1. Android sends the selected source bytes without client-side recompression, through the authenticated intermediary. Validate actual decoding, format, byte and pixel limits, customer ownership and quota on the server.
2. Assign a stable upload ID; archive exact original bytes outside the web root with private permissions and integrity metadata. Keep owner/profile ID, source type, dimensions, byte count and SHA-256 in a private manifest. Orphaned or failed uploads must remain identifiable for recovery.
3. Generate a separate display derivative. Resize/compress that copy and remove public EXIF/location metadata. Never overwrite the original with the derivative.
4. Upload the derivative to a new, immutable object key in the intended Supabase bucket. Do not reuse a filename with overwrite caching ambiguities. Supabase credentials remain server-side.
5. Verify that the derivative exists and can be decoded, then persist its object reference and the stable upload ID against the correct profile. Return success only after the original and derivative/reference stages are durable.
6. Client responses expose only authorized application data/media references, never the archive's filesystem location or origin infrastructure. A gateway media route can keep storage host details out of mobile responses as required.
7. Preserve sufficient mapping to regenerate and re-upload a missing derivative from the server original. Supabase database backup alone is not an original-image backup.

## Failure and Retention Rules to Implement

- If original archival fails, do not report success or publish the new image.
- If processing or Supabase upload fails, retain a recoverable pending original and expose a retryable failure, not a broken profile image.
- If the profile update fails after upload, retain a journal record to reconcile the object; do not blindly delete the only original during error cleanup.
- Retries need idempotency and bounded storage quotas. A process crash must not create an untraceable upload.
- Removing a public image must remove its public association without accidentally erasing the private recovery original. An explicit permanent-deletion operation must cover all copies under the chosen retention policy; do not promise indefinite undeletable retention.
- The original archive needs a separate backup and a tested restore path. Merely writing a second file to the same server is not protection against loss of that server.
- Original EXIF/GPS data stays private. Only derivatives have metadata stripped automatically.

## Verified Current Gaps

- `src/services/customerProfileImageService.js` currently sanitizes the source into JPEG and writes only `sanitized.body`. It does not archive the input bytes. Local and live SHA-256 matched: `ff4ead451bc9752d93094e5671da3ab4231e1ac47ccc4a3b9df0897570ef3d0b`.
- Current source accepts JPEG/PNG/WebP up to 8 MiB and 40 million pixels; stored display JPEG is at most 2048 pixels per edge and 2.5 MB. These are current limits, not a decision to discard larger Android originals silently. HEIC/AVIF support or an explicit unsupported-format response needs a separate tested choice.
- Both customer and admin upload routes call that local-only storage function. The customer route associates `stored.publicPath`; it does not presently upload the new optimized copy to Supabase Storage.
- The customer mobile account service currently stores account state in a private JSON file while profile records use Postgres. This must be reconciled with the user's Supabase customer-record requirement before opening access; do not present the current account storage as Supabase-backed.
- The first-login mandatory password-change workflow is not implemented in the inspected customer mobile account service.
- The current backup script archives `customer-profile-images`; a separate originals directory would require explicit backup coverage and restore verification.
- Existing missing-image evidence concerns 41 references in twelve profiles pointing to a retired, unavailable Supabase project. Those original bytes were not recovered. Missing original retention is a recovery gap, not proof of the sole original outage cause.
- The 43 currently working image files are usable stored images, not verified byte-for-byte camera originals. Do not label regenerated or resized copies as originals, or claim this design recovers already-lost files.

## Acceptance Evidence Before Release

- APK inspection finds no origin/DB/service credentials; network inspection shows only intended client-facing services. This is an inspection result, not an impossibility guarantee.
- Anonymous, expired-session, wrong-customer and direct-origin access are denied; first login permits only password rotation until completed.
- JPEG/PNG/WebP uploads preserve original SHA-256 while producing valid, metadata-stripped display copies in Supabase.
- Fault-injection tests cover full disk, invalid images, Supabase failure, database failure, network interruption and duplicate upload retry.
- Removing a display copy and rebuilding it from the archive succeeds; server archive backup/restore is tested.
- Real Android build and device/emulator tests cover login, forced password change, own-profile editing, photo selection, upload progress/retry and logout.

## Primary References

- Android security: https://developer.android.com/privacy-and-security/security-best-practices
- Supabase upload API: https://supabase.com/docs/reference/javascript/file-buckets-upload
- Supabase standard uploads and immutable object paths: https://supabase.com/docs/guides/storage/uploads/standard-uploads
- Supabase Storage access control: https://supabase.com/docs/guides/storage/security/access-control
