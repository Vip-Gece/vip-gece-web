# Hetzner Production Configuration

Canonical infrastructure files for the VIP GECE Hetzner origin at
`159.69.146.114`. The public site remains protected by Cloudflare and the
origin accepts HTTP traffic only from Cloudflare address ranges.

Systemd timers provide a five-minute local readiness check and a daily local
backup of the application, customer images, configuration, and Postgres
database. Local backups are root-only, retained for 30 days, and must be
combined with an independent off-server backup for disaster recovery.

The active Nginx route is `/etc/nginx/snippets/vip-gece-route.conf`.
`nginx-route-maintenance.conf` serves the public `503` maintenance page;
`nginx-route-normal.conf` proxies public traffic to the application. Always
run `nginx -t` before reloading Nginx after switching the route file.

SSH hardening has two levels:

- `sshd-hardening.conf` keeps password login off and allows only SSH public keys.
- `sshd-fido-u2f-hardening.conf` requires both a valid SSH public key and a
  registered FIDO/U2F touch through PAM.

Do not enable FIDO/U2F SSH hardening without an active Hetzner console or a
second already-open root session. First install `libpam-u2f pamu2fcfg`, enroll
the hardware key into `/etc/security/u2f_keys`, then run
`VIP_GECE_FIDO_APPLY=I_UNDERSTAND_LOCKOUT_RISK ./install-ssh-fido-u2f-hardening.sh`.
After reload, open a brand-new SSH session and confirm the FIDO prompt works
before closing the old session. `sudo-fido-u2f.example` is optional and should
only be enabled after SSH FIDO login is proven working.
