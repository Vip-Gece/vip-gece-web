# VIP GECE Customer Android

Independent native Android source. Legacy mobile directories are reference-only.

## Distribution identity

- Customer-facing name: VIP GECE.
- Application ID: `com.vipgece.customer`.
- Commercial distribution uses Android's signed, optimized `release` build type.
- Android 8.0 or newer; target SDK 36.
- The signing store and update-manifest private key are outside the repository.
- Never replace the commercial signing identity when producing an update.
- Installation readiness is separate from verified customer-service readiness.

## Signed updates

The client reads `/public/downloads/vip-gece-customer-clean-latest.json` from
`CUSTOMER_UPDATE_ORIGIN` (a bare HTTPS origin, default `https://vip-gece.site`).
An envelope has `schema: 1`, a Base64-encoded UTF-8 JSON `payload`, and a
Base64-encoded RSA-SHA256 `signature`. The payload contains the package name,
version code/name, APK size/SHA256, signing-certificate SHA256, issued/expiry
timestamps, minimum SDK, and a bounded relative APK path. The public key is
pinned in `app/src/main/assets/update-public.pem`.

Only newer versions signed with the installed application's certificate are
accepted. The APK is private, size-bounded and hash-checked before and after
download and again before installation. Redirects and arbitrary update URLs are
rejected. No customer session token is sent to the public distribution endpoint.

Automatic checks use WorkManager on unmetered networks. Manual checks can use
the current connection. Android controls the installation permission and any
required user confirmation; the application does not bypass those controls.
Real device installation/update verification remains a separate release gate.

## Build and packaging

Use JDK 21, Gradle 8.13 and Android SDK 36. Set `ANDROID_HOME`,
`ANDROID_USER_HOME`, and `GRADLE_USER_HOME` to the local toolchain directories.
Set `CUSTOMER_SIGNING_PROPERTIES` to the protected signing properties path.
`CUSTOMER_GATEWAY_URL` must contain only the verified HTTPS customer gateway;
an empty value intentionally keeps login unavailable.

Run `:app:assembleRelease :app:testReleaseUnitTest :app:lintRelease` in this
project, then use `tools/customer-android-release.mjs package` from the repository
root. The tool independently checks the APK signature against the protected
keystore, package ID, version, debug flag, SDK bounds and pinned update key.
It produces an APK, signed manifest and checksums without copying private keys.

The `prepare` operation creates new keys only when none exist. A partial key set
or mismatched pinned public key is an error, never a reason to overwrite keys.
Back up the signing folder through the owner's secure backup process; losing
the key prevents compatible updates. Do not put that folder in a source archive.

Each published version code must be strictly greater than the previous one.
Upload the versioned APK before replacing the latest manifest, verify public
hashes, and use no-store for the manifest. This packaging command does not
publish files or activate customer accounts. A generated manifest expires after
30 days; publish refreshed signed metadata as part of release maintenance.

## Firebase

The dedicated Firebase project is `vip-gece-android-20260914`, Android app ID
`1:134821364830:android:0e0cb17dfbc84e3d7760cf`. Billing is not enabled. Google
Analytics, Google sign-in, Firestore, Storage, Functions and Gemini are not
enabled by this integration. Customer data is not migrated to Firebase.

Cloud Messaging subscribes to the public `vip_gece_customer_updates_v1` topic
when automatic updates are enabled. Use data-only messages with
`type=customer_update` and `version_code=<new version>`. Do not send customer
details, credentials or photographs through this topic. The client ignores URLs
and arbitrary commands, checks version bounds, and limits hints to once per
15 minutes. The fixed HTTPS signed-manifest policy remains authoritative.

Remote Config reads only `customer_latest_version_code`. The checked-in template
needs explicit publication approval. No API endpoint or private credential may
be added to Remote Config. Standard signed checks remain available without
Firebase or Google Play services. Actual phone push delivery is not yet tested.

## Remaining activation gates

See `docs/customer-android-live-acceptance-checkpoint-20260920.md` at repository
root for the latest evidence. Durable uploads, the authenticated gallery, real
Postgres account persistence and disposable Storage restore tests are now
implemented/verified at the documented levels. Production customer activation,
Cloudflare management access, admin-assigned access URLs, commercial packaging
and real device/emulator acceptance remain open. Do not describe an APK with
an empty gateway as a working commercial service.
