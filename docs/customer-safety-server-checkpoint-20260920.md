# Isolated server safety verification - 2026-09-20

## Outcome

LAB_VERIFIED: all 29 selected account, session and original-image archive tests
passed on the owned Hetzner server under Node v22.23.2, as the unprivileged
`deploy` user. This was a temporary test run, not a production deployment or
Android build. No APK was produced and no customer account was created.

The earlier local checkpoint remains at
`customer-account-safety-checkpoint-20260920.md`.

## Isolation and provenance

- SSH used the existing `vip-gece-hetzner` alias, batch mode and strict existing
  host-key verification. No key or SSH policy was changed.
- Temporary directory: `/tmp/vip-gece-customer-safety.EcQlly2J`, owned by deploy.
- Only selected source/tests and their static load-time dependencies were
  transferred; no production `.env`, account database or customer images.
- Test process environment was cleared with `env -i`. HOME and TMPDIR pointed
  to the temporary area. Database calls and Supabase Storage were mocked by
  the existing tests. HTTP checks used loopback with an ephemeral port.
- Existing server dependencies were referenced through a temporary symlink;
  no dependency install or live dependency mutation occurred.
- Source archive SHA256:
  `670f4720c31e54b083e4a39c09630bc007255422ec2ec50c631355cfeec9b1be`.
- Additional static dependencies archive SHA256:
  `3e241e19b25cab3c8d3f6d693421f68d05d5cab08e081e8b7c8291a471247278`.
- Both transfer hashes matched. All six source hashes from
  `customer-account-safety-20260920.sha256` also matched on the server.

## Test runs

1. The first run failed during the first-login suite setup because its renderer
   dependency loads `public/css/home-render.min.css`. That file was not in the
   minimal transfer. The renderer also needs the brand banner asset at import
   time. These two existing files were added, without changing production code.
   The failed setup also revealed that the existing suite cleanup expects the
   HTTP server to exist; this was a test-harness limitation, not a live error.
2. The final run used Node's test runner with concurrency 1, a 180-second
   process timeout, and the four test files named by `customer-safety:contract`.
   Result: exit 0, 29 tests, 29 passed, 0 failed, 0 skipped; 5.48 seconds.
3. Unlike the prior Windows run, the archive tests exercised their Linux mode
   assertions for the temporary archive files/directories. This verifies only
   those fixtures, not production directory permissions.

## Cleanup and live process comparison

The temporary node_modules symlink was verified and removed first. The exact
temporary directory was checked against its real path and then removed.
Removal was verified. All test processes had completed before cleanup.

The following values matched before and after the test run:

- Release: `/var/www/vip-gece-site/releases/20260914-autoindex-v1`.
- PM2 application: `vip-gece-site`, status `online`, PID `208061`.
- PM2 uptime marker: `1789379706865`.
- Live customer account service SHA256:
  `89624c1a4e5ee5760beb640e1149de6f827c95ccf43c465ab2622fa0a2e077a4`.

These observations establish no process restart or change to the measured
live source/release during this work; they are not a full filesystem audit.

## Explicit limits

No production deployment, database migration, gateway activation, MRS account,
automatic publication permission, APK build/signing, physical FIDO ceremony,
live tenant isolation test or real-customer backup restore was performed.
The commercial sexual-service publication functionality is outside assistance
scope. Passing these tests does not imply a complete or defect-free app.
