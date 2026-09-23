# VIP Gece domain gateway

## 2026-09-12 status: retired

The old-domain migration/failover plan is cancelled. `vip-gece.com` is a
blocked legacy host and must not be used as a 301 source for `vip-gece.site`.
`vip-gece.online` is reserved for a separate fresh second site, not as a
standby mirror for the current `.site` deployment. Keep this package in
observe-only archival mode unless a new, separately approved runbook replaces
it.

This package contains a fail-closed loopback redirect gateway and an opt-in
Cloudflare failover monitor for the old VIP Gece domain. The shipped state is:

- `vip-gece.site`: enabled primary.
- `vip-gece.online`: disabled standby.
- monitor mode: `observe`.
- apply arming: disabled.

It does not provision DNS, create Cloudflare tokens, or contain credentials.

## Safety contract

- `server.js` binds only to `127.0.0.1:3004`.
- A redirect destination is an enabled target ID from the root-owned
  `targets.json`; it never comes from the request.
- The original path and query are retained. Absolute-form, scheme-relative,
  backslash-host, fragment, control-character, CRLF, and oversized request
  targets are rejected.
- State version 3 carries the SHA-256 `config_hash` and the identity of the
  last consumed Türkiye sample. The gateway securely
  reloads `targets.json` on every request and returns `503` if config and state
  do not match.
- Enabling `vip-gece-online` requires an `activation_attestation` observed
  within 30 minutes. Its stable infrastructure/content fields are bound into
  `config_hash`; the renewable `observed_at` timestamp is excluded from that
  state identity. Passive gateway and monitor loads continue to validate every
  static attestation invariant but do not turn an expired lease into a `503` or
  fatal monitor exit. Freshness is revalidated at the switch decision, before
  the journal is written, immediately before Cloudflare PATCH, and after the
  mutation. The attestation pins the exact target and primary IDs, expected
  and observed `brett.ns.cloudflare.com` /
  `perla.ns.cloudflare.com` pair, active Cloudflare zone, strict TLS,
  `https://vip-gece.site` canonical primary, and equal primary/standby
  manifest SHA-256, exactly 27 listed and indexable profile URLs,
  exactly 267 inventory-backed sitemap URLs,
  and GA4 ID `G-MGGWKPN1KH`.
- Missing, symlinked, writable, oversized, malformed, or poisoned state returns
  `503`, `Cache-Control: no-store`, and `X-Robots-Tag: noindex, nofollow`.
- The monitor reads only
  `/var/lib/vip-gece-domain-gateway/probes/tr-mac-01/latest.json`, checks the
  expected probe/config identity, exact enabled target set and readiness URLs,
  schema, internally consistent Cloudflare evidence, canonical payload hash,
  secure file mode/owner (when configured), and server receipt freshness.
- A snapshot expires 420 seconds after `received_at`. Missing, stale,
  malformed, future, hash-mismatched, replay-conflicting, or out-of-order
  evidence fails closed without advancing any health counter.
- A target success is counted only when the fresh Türkiye request reaches
  Cloudflare and returns public `200` with the exact readiness contract, while
  the separate loopback request to `http://127.0.0.1:3003/api/ready` also
  returns `200` with exactly `{"status":"ready"}`.
- A Cloudflare `403` proves only edge identity. It is indeterminate and moves
  neither the success nor failure counter, even when loopback readiness is
  healthy. A public `200` with an invalid readiness contract is rejected.
- The one loopback readiness URL is valid only while every enabled domain
  fronts this same Target App/origin. The monitor shares that result with the
  standby only while its equal-content activation attestation remains fresh.
  An expired standby lease is indeterminate and failover-ineligible; it cannot
  stop the active redirect or terminate passive monitoring.
- Missing state is not recreated until the primary passes that complete
  two-source observation. Each accepted nonce is consumed at most once, so
  restarts or repeated reads cannot manufacture the 3/3 hysteresis.
- A `pending-switch.json` journal is written and fsynced before Cloudflare is
  changed. While it exists, the gateway returns `503`. The next monitor start
  reconciles the exact remote redirect with the journal before running probes.
  Lease expiry cannot block that deterministic recovery because the journal was
  created only after a fresh decision check; static config binding and the
  exact remote rule are still revalidated.
- State, journal, lock, and monitor-health writes use mode `0600`, atomic rename,
  file fsync, and parent-directory fsync.
- The lock contains a random nonce, PID, and inode identity. A live owner is
  never displaced merely because the mtime is old. A dead stale lock is moved
  to a unique quarantine name before replacement.
- Probe URLs are an exact HTTPS allowlist. All DNS answers must be public and
  are pinned into TLS. Redirects are not followed. DNS plus HTTP share one
  total deadline; response errors, aborts, premature close, slow-drip bodies,
  and oversized bodies fail the evidence instead of crashing the process.
- Automatic failover requires three consecutive primary failures and three
  consecutive standby successes. Automatic failback is disabled.
- Cloudflare apply validates the exact zone name, zone/ruleset/rule IDs, rule
  `ref`, host filter expression, current redirect target, status `301`, and
  query preservation before PATCH. The standby activation attestation and
  config hash are revalidated immediately before PATCH and again after the
  mutation; a post-update mismatch triggers CAS-like rollback and preserves
  the pending journal.
- The updater performs a second preflight read. Rollback occurs only while the
  remote rule is still byte-equivalent to this monitor's desired patch, so a
  later concurrent operator edit is not overwritten by rollback. This is a
  client-side, CAS-like guard, not atomic server-side compare-and-swap.
- Monitor-cycle errors write `monitor-health.json` as `degraded`, emit bounded
  and deduplicated error details, and retry after the normal loop interval
  without exiting into PM2's restart limit. Startup identity failures still
  exit with status 78.

## Evidence status: observe gateway deployed, external Türkiye probe pending

The isolated gateway and monitor run on the production VPS in `observe` mode
with apply arming disabled. The `vipprobe` ingest account, owner-pinned spool
directory, root-owned allowlist and ingest executable are prepared, but no
external probe key, forced SSH key entry, scheduler or fresh snapshot is
installed yet. Until an independent Türkiye-hosted probe delivers valid
distinct-nonce samples, the monitor remains degraded, no state is created and
the loopback gateway returns fail-closed `503`.

The existing application VPS is outside Türkiye and must not be treated as the
Türkiye evidence source. A Mac probe may be useful for manual diagnostics, but
it does not satisfy the requested computer-independent 24/7 contract.

Apply remains locked because `vip-gece-online` is still a disabled standby.
Do not enable it or load a Cloudflare mutation token until registrar delegation,
Cloudflare zone activation, edge TLS, origin strict TLS, mirrored content and
analytics, the protected readiness contract, the independent Türkiye probe and
several distinct samples have all passed.

Keep both of these values unchanged until the separately reviewed Türkiye
evidence layer and the readiness channel pass live tests:

```text
DOMAIN_GATEWAY_MODE=observe
DOMAIN_GATEWAY_APPLY_ARMED=0
```

`apply` refuses to start unless `DOMAIN_GATEWAY_APPLY_ARMED=1`.

## Required OS and PM2 isolation

Do not run this package in the existing website user's PM2 daemon. The
Cloudflare mutation process must not share a UID with internet-facing
application code.

Example Linux preparation:

```sh
sudo useradd --system \
  --user-group \
  --home-dir /var/lib/vip-gece-domain-gateway \
  --create-home \
  --shell /usr/sbin/nologin \
  vipgateway

sudo groupadd --system vip-gece-probe
sudo useradd --system \
  --home-dir /var/lib/vip-gece-probe \
  --create-home \
  --shell /bin/sh \
  --gid vip-gece-probe \
  vipprobe
sudo usermod -aG vip-gece-probe vipgateway

sudo install -d -o vipgateway -g vip-gece-probe -m 0710 \
  /var/lib/vip-gece-domain-gateway
sudo install -d -o root -g vip-gece-probe -m 0750 \
  /var/lib/vip-gece-domain-gateway/probes
sudo install -d -o vipprobe -g vip-gece-probe -m 2750 \
  /var/lib/vip-gece-domain-gateway/probes/tr-mac-01
sudo install -d -o root -g root -m 0755 \
  /etc/vip-gece-domain-gateway
sudo install -o vipgateway -g vipgateway -m 0600 /dev/null \
  /etc/vip-gece-domain-gateway/cloudflare.token
sudo install -o root -g root -m 0644 \
  ./ops/turkey-readiness-probe/targets.example.json \
  /etc/vip-gece-domain-gateway/probe-targets.json
```

Pin the spool owner in the monitor environment to the numeric value returned
by `id -u vipprobe` as `DOMAIN_GATEWAY_EXTERNAL_PROBE_OWNER_UID`. Do not add
`vipprobe` to the `vipgateway` group; it needs only its forced ingest command
and write access to the probe spool. Its real `/bin/sh` login shell is required
for `sshd` to execute the forced command; interactive use remains disabled by
the `restrict,command=...` authorized-key options and the `Match User vipprobe`
SSH policy documented in `../turkey-readiness-probe/README.md`.

Use absolute executable paths in the forced command so delivery does not
depend on the SSH session `PATH`:

```text
restrict,command="/usr/bin/timeout 10s /usr/bin/node /usr/local/libexec/vip-gece-probe-ingest --probe-id=tr-mac-01 --config=/etc/vip-gece-domain-gateway/probe-targets.json --spool=/var/lib/vip-gece-domain-gateway/probes/tr-mac-01/latest.json" ssh-ed25519 PUBLIC_KEY tr-mac-01
```

Install the code as root-owned and non-writable by `vipgateway`. The
`targets.json` owner check is pinned to UID 0 by the PM2 config.

Start a separate PM2 daemon:

```sh
sudo -u vipgateway env \
  PM2_HOME=/var/lib/vip-gece-domain-gateway/.pm2 \
  DOMAIN_GATEWAY_EXTERNAL_PROBE_OWNER_UID="$(id -u vipprobe)" \
  pm2 start /opt/vip-gece/domain-gateway/ecosystem.config.cjs

sudo -u vipgateway env \
  PM2_HOME=/var/lib/vip-gece-domain-gateway/.pm2 \
  pm2 save
```

The entire dedicated PM2 daemon runs as `vipgateway`; the app entries do not
request a second `uid`/`gid` transition (PM2 only permits that from a root
daemon). Both Node entrypoints independently verify their effective OS username
at startup and fail closed if it is not `vipgateway`.

For boot persistence, install the supplied `pm2-vipgateway.service`. It runs
`pm2-runtime` in the foreground as `vipgateway`, so systemd supervises the real
process instead of trusting a user-owned forking PID file. The unit hard-codes
`observe`, `APPLY_ARMED=0`, the external probe owner UID, loopback-only gateway
binding, and a read-only system sandbox with write access limited to the
gateway state directory.

### Lock recovery

A process crash during the very small stale-lock takeover window can leave
`monitor.lock.takeover` behind. This is intentionally fail-closed: subsequent
monitor cycles report `LOCKED` instead of guessing that no mutation is active.

Do not delete the state or pending journal. First stop the monitor, verify that
no `vip-gece-domain-monitor` process is running, and inspect
`pending-switch.json`. If a pending journal exists, preserve it and restart the
monitor so the Cloudflare rule can be reconciled. Only when no monitor process
and no pending journal exist may an operator remove the exact stale
`monitor.lock.takeover` file, then restart in `observe` mode. Never use a
recursive or wildcard deletion in the state directory.

## Cloudflare prerequisites

The token file must contain one token and a trailing newline is optional. Never
put the token in an environment variable, PM2 config, `targets.json`, state,
journal, logs, or the repository.

Use a token restricted to `vip-gece.com` with only the exact permissions needed
to read the zone and edit its rulesets. The public website user must not be
able to read the token file.

Before apply can be armed:

1. Establish an exclusive Cloudflare change window for this rule. The Rulesets
   API does not expose a documented conditional `PATCH` for this operation, so
   a dashboard/API edit in the narrow interval between the final preflight and
   the monitor's `PATCH` could be overwritten. Do not allow any other actor to
   edit this ruleset while apply is armed.
2. Pin the existing dynamic redirect rule's exact `ref` in
   `CLOUDFLARE_EXPECTED_RULE_REF`. The live rule has no operator-assigned
   reference, so Cloudflare returns its immutable public rule ID as `ref`.
   Do not delete/recreate the working 301 merely to rename that reference.
3. Confirm its exact host expression is:

   ```text
   (http.host in {"vip-gece.com" "www.vip-gece.com"})
   ```

4. Confirm its current target expression is:

   ```text
   concat("https://vip-gece.site", http.request.uri.path)
   ```

5. Confirm status `301`, query preservation, enabled state, zone ID, ruleset ID,
   and rule ID. Any mismatch makes apply exit before PATCH.

## Activation runbook

1. Keep `vip-gece-online` disabled until DNS, Cloudflare proxying, TLS, content,
   analytics, `/api/ready`, and the Türkiye evidence source have all passed.
   Enable it only with the exact, fresh `activation_attestation` described in
   the safety contract; disabled targets must not carry one.
2. Start in `observe`; confirm the snapshot is owner-pinned and no older than
   420 seconds, then wait for `state.json` and inspect several distinct-nonce
   `monitor-health.json` cycles.
3. Proxy only the intended old-domain Nginx vhost to `127.0.0.1:3004`. Never
   expose port 3004.
4. Deploy `targets.json` atomically as root when enabling a standby. The gateway
   hot reloads it; the monitor rebases state to the new config hash before the
   gateway can redirect with that config.
5. Verify the Türkiye edge request is not a spoofed Googlebot request and that
   the loopback readiness response is the exact one-field JSON contract.
6. Renew and atomically install the full activation attestation immediately
   before the approved change window. This package has no attestation refresher;
   an expired lease keeps redirects available but cannot authorize failover.
7. After an explicit operator approval, arm and apply only the monitor:

   ```sh
   sudo -u vipgateway env \
     PM2_HOME=/var/lib/vip-gece-domain-gateway/.pm2 \
     DOMAIN_GATEWAY_MODE=apply \
     DOMAIN_GATEWAY_APPLY_ARMED=1 \
     DOMAIN_GATEWAY_EXTERNAL_PROBE_OWNER_UID="$(id -u vipprobe)" \
     pm2 restart /opt/vip-gece/domain-gateway/ecosystem.config.cjs \
       --only vip-gece-domain-monitor --update-env
   ```

8. After any switch, inspect the canonical domain, exact legacy redirects,
   Search Console, Analytics, TLS, state, journal absence, monitor health, and
   Cloudflare audit logs. Failback remains a manual operation.
9. Return the monitor to `observe` and disarm it after the approved window.

## Verification

Run with Node 20 or newer:

```sh
cd ops/domain-gateway
npm test
node --check core.js
node --check server.js
node --check monitor.js
node --check ecosystem.config.cjs
```

Tests cover redirect safety, fail-closed bootstrap and journal behavior,
config-hash hot reload, SSRF/private DNS, total probe deadlines, response
errors, slow-drip handling, Türkiye snapshot identity/hash/freshness/target
binding, exact localhost readiness, distinct-nonce 3/3 hysteresis,
nonce/inode lock ownership, Cloudflare identity/current-target validation,
full-result verification, CAS-like rollback, concurrent operator edits,
pending-journal reconciliation, private secret files, persistent monitor-error
retries, and PM2 user isolation.
