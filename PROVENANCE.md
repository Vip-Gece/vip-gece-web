# VIP-GECE clean production source

This working tree was reconstructed on 2026-08-10 from the verified live runtime artifact rather than from the quarantined external-disk checkout.

- Verified source commit: `07629f5168dc9d54fd2a9364bfc249f06eda8b95`
- Verified runtime archive SHA-256: `2285b3fe430b0857f6cc59ecc2c28b4d196a32833021be87160f94c316d9de6a`
- Local evidence archive: `forensics/baselines/07629f5-2285b3fe/runtime.tar.gz` in the parent workspace
- Reconstructed production tree: reviewed isolated production source tree.

The old external repository history, generated dependency trees, Finder metadata, sockets, build outputs, and editor artifacts were intentionally not imported. Any later source recovery must be reviewed and selected file by file before it enters this tree.

The verified live runtime archive intentionally omitted native application source trees that are required by the repository contracts. `mobile-admin` and `mobile-customer-native` were therefore recovered from the previously isolated `vip-gece-final-verify-9136f96` tree after all of the following checks:

- the selected app trees matched the protected local Git copy (excluding generated build/dependency directories);
- the customer app also matched the externally scanned copy;
- targeted high-severity secret and OWASP scans returned no findings;
- no generated build directories, dependency trees, Finder metadata, or Gradle caches were copied.

The verified runtime contained a minified `public/js/detail/index.js` artifact while the
matching readable source was still present in the protected local Git copy. The readable
source was restored only after confirming that its module imports and behavior matched the
runtime artifact, including the current `view.js?v=20260729-conversion1` dependency.

After recovery, the admin wrapper was hardened to use only the SSH loopback endpoint. Its
Android network policy denies cleartext globally and permits it solely for `127.0.0.1` and
`localhost`; public VIP-GECE domains are not present in the native wrapper configuration.

The runtime archive also omitted repository documentation required by package and evidence
contracts. The documentation tree was recovered from the same isolated
`vip-gece-final-verify-9136f96` source used for the native apps. The only selected newer
external-disk record is `docs/external/backlink-tracker-vip-gece.csv` (SHA-256
`d06cf7488b57ca0b6d797e87fb6e06d8324e22aa1ad2963319cf17e72b7d8641`), which was reviewed
as data and accepted only after the backlink evidence contract passed. It records seven
pending editorial contacts and zero independently verified publications; it must not be
presented as proof of acquired backlinks.

One additional external-disk document was accepted as reviewed historical evidence rather
than executable source: the production deployment chain (SHA-256
`f90a3d705c4f8c605417ad73652c16ca77a327f03051485f3c812b7be8e4e232`).

The Supabase CLI configuration and two database migrations were recovered only after a
file-by-file review of the quarantined external tree. They contained no credentials, and the
migration bodies matched the corresponding reviewed `ops/postgres` sources before security
hardening. The analytics table is now protected with row-level security and explicit
`REVOKE ALL` statements for `public`, `anon`, and `authenticated`; only the trusted server
database connection is permitted to use it. Repository contracts verify that the migration
and operational SQL remain identical and that browser-facing Data API roles receive no
table grant.

`WORKLIST.md` was recovered as historical planning evidence from the isolated
`vip-gece-final-verify-9136f96` source after its SHA-256
`f85332edb0b985446bf5d88c6fd87d2ed457ae23249509f83579d143c35fbbd6` matched both the
protected local Git copy and an independent clean worktree. Its checked items are not
treated as current live proof unless a present-day contract or deployment record verifies
the same claim.
