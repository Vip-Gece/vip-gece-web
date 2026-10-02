# Cloudflare Post-Deploy Evidence - vip-gece.site and vip-gece.online

Checked at: 2026-09-30 20:45-20:52 Europe/Istanbul

## Token Handling

- Created a Cloudflare API token through the authenticated Chrome session.
- Token scope summary confirmed in Cloudflare UI:
  - `All zones - Zone Settings:Edit, DNS:Edit, Cache Purge:Purge, Config Rules:Edit, Zone:Read`
- Token value is not stored in this document, repo, logs, or shell history by design.
- Local token file:
  - `~/.config/vip-gece-cloudflare/cloudflare.token`
  - permissions: `0600`

## Applied Zones

- `vip-gece.site`
- `vip-gece.online`

Both zones were verified as active Free Website zones through Cloudflare API.

## Applied Settings

For both zones:

- SSL mode: `strict`
- Always Use HTTPS: `on`
- Automatic HTTPS Rewrites: `on`
- Minimum TLS: `1.2`
- TLS 1.3: `on`
- Brotli: `on`
- HTTP/3: `on`
- IPv6: `on`
- Browser Integrity Check: `off`
- Security level: `medium`
- WebSockets: `on`
- Early Hints: `on`
- Rocket Loader: `off`
- Mirage: `off`
- HSTS: enabled
  - max age: `31536000`
  - include subdomains: `true`
  - preload: `false`
  - nosniff: `true`
- Cloudflare Web Analytics/RUM injection rule: off through `vip_gece_disable_rum`
- Full zone cache purge: completed

Bot management API returned `403 Authentication error` on the Free Website zones and was safely skipped by the script.

## Live Checks

- `http://vip-gece.site` resolves through Cloudflare and lands on `https://vip-gece.site/`.
- `https://vip-gece.site` returns `server: cloudflare`, `cf-cache-status: HIT`, and HSTS.
- `http://vip-gece.online` resolves through Cloudflare and lands on `https://vip-gece.online/`.
- `https://vip-gece.online` returns `server: cloudflare` and HSTS.

Robots/noindex check:

- `vip-gece.site` homepage: `noindex=false`, `nofollow=false`, robots meta is `index, follow, max-image-preview:large`.
- `vip-gece.online` homepage: `noindex=false`, `nofollow=false`, robots meta is `follow, index`.
- `/robots.txt` on both domains allows crawling and exposes sitemaps.

## Local Verification

Passed:

- `npm run cloudflare-cache-check -- --attempts=2 --wait-ms=500`
- `npm run domain-role:contract`
- `npm run check`
