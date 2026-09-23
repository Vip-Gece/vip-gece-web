# Android Commercial Package Checkpoint - 2026-09-14

## Honest status

SIGNED INSTALLABLE APK PRODUCED. This is not a debug-signed build. It is NOT
verified as a fully operational customer service: the customer gateway remains
empty/closed and the earlier activation gates still apply. Do not equate the
commercial signing/build identity with completed production acceptance.

## Saved handoff boundary

Saved at the user's request on 2026-09-14. This is the current Android commercial
package/Firebase continuation checkpoint. It supplements, and does not close,
the gates in [the customer implementation checkpoint](customer-android-implementation-checkpoint-20260914.md).
It does not replace the separate live indexing and runtime-integrity records.

During this checkpoint-only save, the local APK size and SHA256 were checked
again and matched the delivery below. Build/test, Firebase and server results
in the following sections are recorded evidence from the preceding work, not
fresh checks performed during this save. No build, deployment, Firebase write,
customer activation or physical-device test was performed during this save.
The checkpoint request is not approval to publish the Remote Config template.

Resume with the activation gates below; keep customer access closed until they
pass. Preserve the existing signing keys and unrelated working-tree changes.
This document records a working-tree checkpoint, not a Git commit or deployment.

Local evidence and delivery:

- [Commercial APK](../output/android-commercial-1.0.0/vip-gece-customer-clean-1.0.0-10001.apk)
- [Packaging verification](../output/android-commercial-1.0.0/verification.json)
- [APK audit](../output/android-commercial-1.0.0/apk-audit.json)
- [Checksums](../output/android-commercial-1.0.0/SHA256SUMS.txt)
- [Local signed update manifest](../output/android-commercial-1.0.0/vip-gece-customer-clean-latest.json)

## Current delivery

- File: `output/android-commercial-1.0.0/vip-gece-customer-clean-1.0.0-10001.apk`
- Package: `com.vipgece.customer`; label: VIP GECE.
- Version: 1.0.0; versionCode: 10001.
- Size: 782090 bytes.
- SHA256: `c9c7187e6dbc1585131389168533bc5bd7d149a13578b6af581ab688607d6e8c`.
- Certificate SHA256: `59f0d329e1fd98f0092c1bf6b1e1baa12f5be88f93554093805681b95cd21c2c`.
- Android minimum SDK 26, target SDK 36, optimized with R8, not debuggable.
- Includes arm64-v8a, armeabi-v7a, x86 and x86_64 dependency libraries.
- The earlier versionCode 10000 file was an internal pre-Firebase candidate;
  it was not published. Use only the 10001 file above.
- At the user's folder-organization request, the 10000 APK was moved intact to
  `output/android-commercial-1.0.0/ESKI-KURMAYIN/`. Its hash was compared before
  and after the move. The 10001 APK hash was rechecked against verification.json;
  its filename and signed manifest were unchanged. `ONCE-OKU.txt` identifies
  the current APK and the remaining customer activation limits.

## Recorded build verification

- `assembleRelease`, `testReleaseUnitTest`, `lintRelease`: successful.
- 14 Java tests: 3 gateway, 8 signed-update/integrity, 3 notification-hint tests.
- 4 existing Node customer password/gateway-boundary tests rerun successfully.
- Lint: no issues found.
- APK signature independently verified by apksigner and compared with the
  protected commercial keystore certificate by the packaging tool.
- `zipalign -c -P 16 4`: exit 0. Every PT_LOAD segment in all four packaged
  native libraries has 16384-byte alignment.
- APK public update key matches the pinned source asset.
- Exact known origin IP, direct Supabase host and PEM private-key markers were
  absent from DEX. This is a bounded marker test, not proof of undetectable
  endpoints or a complete supply-chain/security audit.
- Generated Firebase resources identify the expected project and Android app.
- No physical device installation, real-device FCM delivery, PackageInstaller
  self-update cycle, or current native screen-rendering test was performed.
  The 14 images from the previous redesign are historical, not this build's UI proof.
- Build tools reported deprecated Gradle/API usage and could not strip an
  upstream datastore library. Alignment and signing were independently checked;
  those warnings were not treated as proof of a broken APK.

## Firebase changes and boundaries

- Project: `vip-gece-android-20260914`, display name VIP GECE Android.
- Project number: `134821364830`; state ACTIVE verified through official MCP.
- Android app: `1:134821364830:android:0e0cb17dfbc84e3d7760cf`.
- Android package registration and downloaded SDK configuration match the APK.
- Fresh official MCP environment check: Billing Enabled: No; Gemini terms NOT
  ACCEPTED. Console setup explicitly left Google Analytics off.
- User explicitly approved the selected CLI account, new no-billing project,
  Firebase terms, and the irreversible relationship with the newly created
  Google Cloud project. Other Cloud projects and their IAM/org policies were
  not modified by this task.
- The first CLI add-Firebase step failed generically after creating the Cloud
  project. The same project was completed through the approved console workflow;
  no duplicate project or policy bypass was used.
- Firebase CLI 15.30.0 and the official MCP server were verified. MCP was run
  as a temporary stdio client, closed after each call. No Codex-wide MCP config
  or unrelated plugin configuration was replaced.
- No Firebase Authentication, customer Google login, Analytics SDK, Firestore,
  customer Storage, Cloud Functions, Gemini or billing was configured. The
  downloaded Android configuration contains zero OAuth clients.
- FCM/Remote Config are used only for public, rate-limited update hints. Customer
  account data, passwords, profile descriptions, images and private origin keys
  are not sent to those features by this implementation.

## Update implementation

- Automatic checks use WorkManager every six hours on unmetered networks;
  manual checks can use the current connection.
- A signed RSA-SHA256 envelope is verified before parsing release metadata.
  Timestamp/expiry, APK path, size, SHA256, app identity, installed certificate,
  increasing version and highest observed version are checked.
- Downloads remain in private app storage; bytes and identity are rechecked
  before Android PackageInstaller is used.
- Android installation approval/unknown-source permissions are respected.
  Automatic installation is requested only where the platform permits it;
  a waiting confirmation can be recovered after app process death.
- FCM topic: `vip_gece_customer_updates_v1`. Data messages may contain only a
  hint `type=customer_update`, `version_code=<new integer>` for this workflow.
  URL/command fields are ignored by the app handler. Do not send private
  customer data or notification links to this public topic.
- Remote Config source template: `apps/customer-android/remote_config.json`.
  Only `customer_latest_version_code=10001` is proposed. Existing template was
  freshly read as empty. Publication approval was requested and has NOT yet
  been received as of this checkpoint; template NOT deployed.
- APK, signed manifest and verification records are local. No APK or manifest
  was uploaded to production in this task. The server was inspected read-only.
- `src/app.js` adds the new latest-manifest filename to no-store handling, but
  this one-line change is local and NOT deployed. The current live generic
  static handler otherwise gives new JSON files a long cache lifetime.

## Signing material

New independent commercial keys were generated; no legacy private keys or APKs
were reused. Private material is outside the repository in
`C:/Users/o-neo/.codex/secrets/vip-gece-customer-commercial`.
Directory ACL was checked: only the owner account and SYSTEM have explicit
FullControl, with inheritance disabled. Secret values were not included in the
APK or this document. Secure offline backup of these keys remains the owner's
backup step; it was not performed in this task.

Do not regenerate these keys or distribute the older debug-signed APK. An
existing debug install has a different signer and cannot be upgraded in place
by the commercial key. Do not remove an existing installation/data without the
owner's approval and a data-migration decision.

## Required before real customer distribution

1. Complete the customer activation gates in
   `docs/customer-android-implementation-checkpoint-20260914.md`: Supabase account
   persistence/ownership isolation, admin-assigned random customer URLs, the
   verified authenticated gateway, persistent uploads and full remote gallery.
2. Validate those flows with isolated real integration tests, then approve and
   perform the protected gateway/backend deployment. Do not silently point the
   app at the origin or remove authorization to make login appear functional.
3. Publish the verified APK before its signed manifest, configure no-store on
   the manifest, and verify public download hashes. The existing server download
   directory was observed with world-write permissions; do not use it for
   trustworthy distribution without a scoped permissions/ownership correction
   or a dedicated protected distribution directory.
4. After explicit template approval, deploy only Remote Config in the dedicated
   project, then read back the version. Do not deploy any other Firebase product.
5. Test first install, customer login/password change, photos and original
   retention, FCM, opt-out, corrupt update rejection, and a same-certificate
   upgrade on a real device before calling the service commercially ready.

The current APK is an installation artifact with commercial signing, not a
claim that these remaining production requirements are complete.
