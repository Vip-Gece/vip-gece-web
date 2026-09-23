# Customer account safety checkpoint - 2026-09-20

Follow-up: the same 29 checks also passed in an isolated Linux directory on
the owned server. See `customer-safety-server-checkpoint-20260920.md` for the
transfer hashes, initial setup failure, final result and verified cleanup.
This follow-up did not deploy the changes or build an APK.

## Scope and state

This checkpoint covers local, general-purpose account safety and regression
checks only. No production configuration, database schema, account, customer
gateway, FIDO registration or Android artifact was changed or deployed.

The earlier unlimited-quota/automatic-publication changes remain separate,
unreleased work. They were not extended, activated or included in a release.
The MRS Ajans account was not created by this work. Automatic publication of
sexual-service advertisements is outside this assistance scope (MODEL_POLICY).
Do not interpret this checkpoint as permission or a procedure to activate it.

## Completed source changes

- `src/services/customerMobileAccountService.js`: reject absent, blank,
  non-string or overlong login identifiers and empty passwords before lookup.
- Validate the account container and records on reads and before writes.
  A malformed list is no longer converted to an empty account store. Invalid
  versions, invalid records, duplicate IDs and conflicting login identifiers
  fail closed. Unknown stored fields remain preserved but are not exposed by
  the public account projection.
- Apply the validation to the optional PostgreSQL account adapter as well as
  the JSON file path, including readiness. No live PostgreSQL test was run.
- `src/data/customerAccountsRepo.js`: allow only the existing default/`json`
  and explicit `postgres` backend selections; other values cause a 503 error
  instead of silently selecting the file store. Reject invalid record shapes
  before building the mutation snapshot, without any write.
- `scripts/customer-account-safety.test.cjs`: add eight isolated checks using
  temporary files and generated test credentials, without live accounts.
- `scripts/customer-first-login.test.cjs`: isolate backend selection and cover
  all 14 current protected customer routes for absent sessions and mandatory
  first-login password rotation. Check `no-store` and administrator endpoint
  authentication separately.
- `scripts/customer-account-storage-safety.test.cjs`: add three checks with a
  mocked PostgreSQL query/transaction boundary for safe persistence, invalid
  records and rejection of a silent JSON fallback during database failure.
- Replace the existing hardcoded password-reset test fixture with a generated
  random password; no scanner exception or rule weakening was added.
- `package.json`: add `npm run customer-safety:contract` to repeat the selected
  29-test account, storage, first-login and original-image archive suite.

## Fresh verification

Classification: LAB_VERIFIED for the listed local checks, not production proof.

| Check | Result |
| --- | --- |
| Initial eight account-safety tests, before changes | Four failed and four passed; failures matched the corrected gaps |
| `npm run customer-safety:contract`, final state | Exit 0, 29 passed, 0 failed, 0 skipped |
| Initial added PostgreSQL safety checks | One failed before correcting the invalid-record snapshot path; all three passed afterward |
| `npm run admin-role-contract` | Exit 0, 29 assertions |
| `npm run private-panels:contract` | Exit 0 |
| Scoped `git diff --check` | Exit 0 |
| `node --check` on both modified runtime modules | Exit 0 |
| `npm run secret-scan`, final rerun | Exit 0; no secret-like values found by the configured scanner |

The first secret scan reported the pre-existing hardcoded reset-password test
fixture. It was replaced with runtime-generated test data, then the full
configured scanner passed. Its existing excluded paths, extensions and size
limits were not changed; this is not a forensic all-byte scan.

Current file hashes are recorded in `customer-account-safety-20260920.sha256`.
These identify complete local files, including earlier unrelated changes in
already-dirty files; they are not a deployable release or an approved patch set.

Password reset and disable/re-enable checks confirm that old sessions stay
invalid. Concurrent password changes are tested against the real in-process
JSON mutation queue. This is not evidence of multi-process locking or live
PostgreSQL transaction behavior.

Original-image tests use generated images, real local files and a mocked
Supabase Storage interface. They cover exact original retention, metadata
removal from derivatives, retries, remote failure, hash checks and a copied
backup. They do not prove remote durability, production filesystem permissions
or restoration of a real customer's image. Windows ACLs were not audited.

The existing owner-filtered SQL reads/writes were inspected. Live tenant
isolation and database permissions were not exercised. Existing admin-role
and private-panel tests passed; no physical FIDO ceremony was performed.

## Not claimed complete

- No full-site `npm run smoke` or `npm run contracts` run in this scoped pass.
- No production deployment, schema migration or gateway activation.
- No real-device customer login, image upload, push delivery or APK update test.
- No claim that all website/application defects have been found or corrected.

No temporary credentials were issued, no background service was installed and
no production rollback is needed. Preserve unrelated dirty worktree changes.
Do not use a whole-file Git reset to undo these small changes.
