# VIP-GECE.site runtime repair evidence

Checked at: 2026-10-02 18:18-18:21 Europe/Istanbul

## Symptom

- Public `https://vip-gece.site/` returned Cloudflare `502`.
- Nginx was healthy, but the local upstream `127.0.0.1:3003` was not listening.
- PM2 showed `vip-gece-site` in a restart/waiting loop.

## Root Cause

The production runtime rejected startup because `ANALYTICS_EVENT_PROOF_SECRET`
was shorter than the production minimum. The secret value was never printed,
stored in this document, or committed.

## Repair

- Backed up `/var/www/vip-gece-site/.env` on the server before changing it.
- Generated a new 64-character secret on the server.
- Replaced only `ANALYTICS_EVENT_PROOF_SECRET` in `/var/www/vip-gece-site/.env`.
- Restarted `vip-gece-site` with PM2 and saved the PM2 process list.
- Re-ran the local systemd healthcheck.

## Verified Result

- PM2 process: `vip-gece-site` online as `deploy`.
- Local upstream: `127.0.0.1:3003` listening.
- Local readiness: `/api/ready` returned `{"status":"ready"}`.
- Public readiness: `https://vip-gece.site/api/ready` returned HTTP `200`.
- Public homepage: `https://vip-gece.site/` returned HTTP `200`.
- Public robots meta: `index, follow, max-image-preview:large`.
- `robots.txt` allows crawl and lists both sitemap files.
- `npm run cloudflare-cache-check -- --attempts=2 --wait-ms=500` passed with public HTML cache ready and private files dynamic.
