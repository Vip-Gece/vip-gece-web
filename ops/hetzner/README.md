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
