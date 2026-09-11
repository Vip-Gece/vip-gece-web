# VIP Gece Türkiye edge readiness probe

This component records whether the configured VIP Gece edge is reachable from
the Mac's normal Türkiye network path. It does not decide target health and it
cannot change DNS, Cloudflare, redirects, or gateway state.

## Evidence semantics

The client follows no redirects and clears proxy environment variables. For an
observation to have `edge_reachable: true`, all of these must be true:

- curl completed with TLS certificate and hostname verification enabled;
- the effective URL is the exact allowlisted HTTPS readiness URL;
- no redirect was followed;
- the HTTP status is `200` or `403`;
- the expected `Server: cloudflare` header matched;
- a syntactically valid `CF-Ray` header was present.

Requests identify themselves with the fixed synthetic-browser user agent
`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 VIPGeceReadiness/1.0`.
The `VIPGeceReadiness/1.0` suffix makes the probe transparent. It is not
Googlebot and does not claim Google or verified-crawler identity; the private
header token remains the authorization control.

A `200` response is separately parsed. `contract_ok` is true only when its JSON
body is exactly one object field, `{ "status": "ready" }`. A Cloudflare `403`
can prove edge reachability, but it never proves application or target health.
The domain gateway must later combine fresh Türkiye edge evidence with a
separate localhost-origin `/api/ready` `200` result.

`vip-gece-online` is intentionally disabled in the example configuration.

## Cloudflare edge contract

Each enabled target zone must keep these custom WAF rules in this order:

1. `vip-gece-readiness-probe-skip-v1` accepts only the exact target host,
   `GET /api/ready`, and the private `X-VIP-Gece-Probe-Token` value. Its skip
   action bypasses the remaining custom rules and Bot Fight Mode for that one
   request.
2. `vip-gece-readiness-deny-v1` blocks the exact target host and
   `/api/ready` path when an earlier trusted skip did not accept the request.

Consequently, the authenticated probe receives the exact `200` readiness
contract, while an unverified client with a missing or invalid token receives
`403`. The localhost-origin readiness request never traverses Cloudflare and
continues to use the exact one-field JSON contract.

Rotate a disclosed probe token without a monitoring gap:

1. temporarily allow both the old and new values in the exact skip rule on
   every target zone;
2. atomically replace the Mac's private token file and verify a fresh delivered
   snapshot with a distinct nonce;
3. narrow every skip rule to the new value only;
4. verify the new value receives `200` and a missing or invalid value receives
   `403`, then destroy the old private value.

Never put either value in API output, command arguments, logs, plist files,
repository files, or screenshots.

## Trust boundaries

- The repository contains no private key, token, or secret header value.
- The Cloudflare probe token is stored outside the repository in one absolute,
  non-symlink regular file owned by the probe user with mode `0400` or `0600`.
  The file contains exactly 32-128 printable ASCII characters with no
  whitespace or trailing newline.
- curl reads the authentication header from a temporary `0600` file inside the
  probe's `0700` work directory. The token is never placed in curl's process
  arguments, the JSON report, or probe output.
- The Mac uses a dedicated Ed25519 key and a dedicated pinned known-hosts file.
- SSH is outbound only, non-interactive, and requests the fixed `submit-v1`
  command.
- The server key must be restricted to the ingest command. The ingest user has
  no sudo access and no forwarding or TTY capability.
- The server validates a root-owned exact target allowlist. The SSH identity is
  the attestation boundary; the client cannot select arbitrary URLs or IDs.
- A single atomic snapshot contains all enabled targets. Partial snapshots are
  rejected.
- Server receipt time, not file mtime or client time alone, controls freshness.

Recommended `authorized_keys` entry:

```text
restrict,command="/usr/bin/timeout 10s /usr/local/libexec/vip-gece-probe-ingest --probe-id=tr-mac-01" ssh-ed25519 PUBLIC_KEY tr-mac-01
```

Recommended `/etc/ssh/sshd_config.d/70-vip-gece-probe.conf`:

```text
Match User vipprobe
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PermitTTY no
    DisableForwarding yes
    X11Forwarding no
    PermitTunnel no
    PermitUserEnvironment no
```

The deployed forced command should include the fixed paths:

```text
/usr/bin/timeout 10s /usr/local/libexec/vip-gece-probe-ingest \
  --probe-id=tr-mac-01 \
  --config=/etc/vip-gece-domain-gateway/probe-targets.json \
  --spool=/var/lib/vip-gece-domain-gateway/probes/tr-mac-01/latest.json
```

The ingest process requires `SSH_ORIGINAL_COMMAND=submit-v1`.

## Mac installation contract

Copy `probe.sh` and an edited `targets.example.json` outside the repository:

```text
/Library/Application Support/VIPGece/TurkeyProbe/probe.sh
/Library/Application Support/VIPGece/TurkeyProbe/targets.json
```

Keep the dedicated files outside the repository:

```text
/Users/LOCAL_MAC_USER/.ssh/vip_gece_turkey_probe_ed25519       mode 0600
/Users/LOCAL_MAC_USER/.ssh/vip_gece_turkey_probe_known_hosts  mode 0600 or 0644
/Users/LOCAL_MAC_USER/.config/vip-gece/probe-http-token        mode 0400 or 0600
```

Set `VIP_PROBE_HTTP_TOKEN_FILE` to that absolute token-file path. Create the
file without a trailing newline and never put the token value in the plist:

```sh
umask 077
mkdir -p "$HOME/.config/vip-gece"
chmod 700 "$HOME/.config/vip-gece"
IFS= read -r -s -p 'Probe token: ' VIP_PROBE_TOKEN_INPUT
printf '\n'
printf %s "$VIP_PROBE_TOKEN_INPUT" >"$HOME/.config/vip-gece/probe-http-token"
unset VIP_PROBE_TOKEN_INPUT
chmod 600 "$HOME/.config/vip-gece/probe-http-token"
```

Install the edited plist as a root-owned `0644` LaunchDaemon. It runs every
300 seconds while the Mac is awake. It deliberately keeps no offline queue: if
the Mac or SSH path is unavailable, no new snapshot arrives and the existing
one becomes stale.

The probe must run without VPN, proxy, Private Relay, or an alternate encrypted
DNS path if it is intended to measure ordinary Türkiye reachability.

Validate without making a request:

```sh
bash probe.sh --validate-config targets.json
```

Print a secret-free report without SSH delivery:

```sh
VIP_PROBE_HTTP_TOKEN_FILE=/absolute/path/to/probe-http-token \
  bash probe.sh --report-only targets.json
```

`--validate-config` deliberately does not require or read the token because it
makes no network request. Both normal delivery and `--report-only` fail closed
before any request when the token path or file does not pass validation.

## Server spool

Recommended layout:

```text
/etc/vip-gece-domain-gateway/probe-targets.json
/var/lib/vip-gece-domain-gateway/probes/tr-mac-01/latest.json
```

The config must be root-owned and not group/world writable. The spool directory
should be setgid `2750`, owned by the ingest user and a read-only group shared
with the domain monitor. The snapshot is written `0640` using a same-directory
temporary file, file `fsync`, atomic `rename`, and directory `fsync`.

The ingest defaults are:

- input maximum: 32 KiB;
- input timeout: 10 seconds;
- maximum client-to-server age: 120 seconds;
- maximum future clock skew: 30 seconds;
- nonce: exactly 32 lowercase hexadecimal characters.

An identical retry of the current nonce is idempotent and does not refresh
`received_at`. A nonce conflict, out-of-order timestamp, stale report, unknown
target, disabled target, URL mismatch, schema mismatch, symlink, or unsafe file
mode is rejected with a fixed error code. Raw payloads and raw network errors
are never logged.

The later gateway reader must expire a snapshot after 420 seconds and count
three distinct accepted nonces for three-sample hysteresis. Re-reading the same
snapshot must never increment a health counter.

## Verification

```sh
cd ops/turkey-readiness-probe
npm run check
npm test
```
