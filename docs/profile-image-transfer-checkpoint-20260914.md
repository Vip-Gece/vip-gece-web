# Profile Images and Unpublication - 2026-09-14

## User decision and applied state

The user requested unpublishing profiles whose original photos could not be recovered, preserving descriptions and other fields for later photo upload and reactivation. They explicitly clarified that records must not be deleted.

- Transaction committed at 2026-09-14T02:57:19Z for IDs 2 through 13 only.
- `is_active=false`, `images=[]`; descriptions, SEO fields, identity, contact details, ownership, and other fields preserved exactly.
- All 27 rows remain: 15 active and 12 inactive. The other 15 rows were checked unchanged within the transaction.
- Complete pre-change records saved on the server with mode 0600: `/var/backups/vip-gece/manual-profile-unpublish-2026-09-14T02-57-19-922Z.json`.
- Backup SHA-256: `6ae290cd98b60933366c01bec3e08247c90fec499516f37584c7c43b6c7bd753`.
- Original broken references remain in that private backup; original photo bytes were not recovered or fabricated.
- PM2 app `vip-gece-site` reloaded as deploy to clear its profile cache. No runtime source or security configuration was changed for this data operation.

## Actual data and image flow

The live app uses the Supabase-hosted PostgreSQL database `rklydqhknkhcydoijmlq` through the server-side pg client and DATABASE_URL. The optional Supabase REST profile fallback is disabled.

Profile metadata and the `images` path array are read by postgresProfilesRepo, exposed by the public API, and consumed by server rendering. Image bytes are not embedded in these database rows.

The 43 verified photos are stored persistently under `/var/lib/vip-gece/customer-profile-images` and served through `/media/customer-profile/...`. Upload handlers store sanitized files there and save the resulting path to the profile's images array. Admin listing reads inactive records as well as active ones.

Before unpublication, 41 references in 12 profiles still pointed at the retired `hofblpqaxzhybozavtaz.supabase.co` project. That source hostname did not resolve; probing an identical object key on the current project's storage returned Object not found. Current Storage has two buckets and zero objects. Replacing a hostname does not restore missing bytes.

Existing profile validation allows an inactive record without photos, rejects publication without photos, and accepts a valid image path with the existing required fields. This was checked without publishing a fixture or uploading someone else's photo. Browser-authenticated upload/FIDO interaction was not exercised.

## Backup examination

Read all 18 existing database backup profile tables from 2026-08-28 through 2026-09-13 with pg_restore data-only output, without restoring any dump into production. All selected bindings were identical and none contained profiles 79 through 84.

Enumerated all 20 image archives. After excluding AppleDouble `._` metadata sidecars, every archive contained the same 94 image paths. No new binding for the 41 missing sources was recovered. Unassigned galleries were not attached to unrelated people.

## Final fresh verification

At 2026-09-14T05:07:54Z, server-side external HTTPS audit verified 15/15 live detail pages and decoded 43/43 original images. No broken images, placeholder images, retired-host references, or network failures in that final run.

All 12 inactive profiles were absent from the homepage, public catalog, and sitemap. Eleven former canonical paths returned 404. The old MERVE path redirected to the separate active ID 71; it did not expose inactive ID 9. The resulting alias-ownership defect is documented in `docs/slug-audit-20260914.md`.

Earlier local probes saw transport timeouts and stale Cloudflare UPDATING responses. Later server checks were current, and a local external curl also confirmed the MELIS path was 404/BYPASS. No manual Cloudflare purge succeeded: the configured server token file was absent and browser access failed. Do not claim a purge or Cloudflare configuration change occurred.

Evidence: `work/profile-unpublish-result-20260914.json`, `work/vip-live-profile-after-unpublish-20260914.json`, `work/vip-unpublication-verification-20260914.json`, and `work/profile-image-backup-bindings-report-20260914.json`.
