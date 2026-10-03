# Cloudflare Legacy Host Evidence - vip-gece.com

Checked at: 2026-10-03 21:30 Europe/Istanbul

## Decision

- `vip-gece.com -> vip-gece.site` migration remains cancelled.
- `vip-gece.com` and `www.vip-gece.com` must not redirect to `vip-gece.site`.
- The legacy `.com` host is closed with `410 Gone` and `X-Robots-Tag: noindex, nofollow, noarchive`.

## Changes Applied

- Cloudflare DNS for `vip-gece.com` was moved from the stale OVH origin to the current Hetzner origin:
  - `A vip-gece.com -> 159.69.146.114`, proxied
  - `A www.vip-gece.com -> 159.69.146.114`, proxied
  - `AAAA vip-gece.com -> 2a01:4f8:1c16:55c3::1`, proxied
  - `AAAA www.vip-gece.com -> 2a01:4f8:1c16:55c3::1`, proxied
- A Let's Encrypt certificate was issued for `vip-gece.com` and `www.vip-gece.com`.
  - Certificate path: `/etc/letsencrypt/live/vip-gece.com/fullchain.pem`
  - Expiry: 2027-01-01
- Nginx now serves the legacy `.com` host over HTTP and HTTPS without forwarding to `.site`.
- Cloudflare `.com` settings were aligned:
  - SSL: `strict`
  - Always Use HTTPS: `on`
  - Automatic HTTPS Rewrites: `on`
  - Minimum TLS: `1.2`
  - TLS 1.3, Brotli, HTTP/3, IPv6, WebSockets, Early Hints: `on`
  - Browser Integrity Check, Rocket Loader, Mirage: `off`
  - Security level: `medium`
  - HSTS enabled without subdomain include or preload
- Cloudflare cache for the `.com` zone was purged.

## External Probe Results

Global external probes showed:

- `http://vip-gece.com/` returns `301` to `https://vip-gece.com/`.
- `https://vip-gece.com/` returns `410 Gone` with `X-Robots-Tag: noindex, nofollow, noarchive`.
- `https://www.vip-gece.com/` returns `410 Gone` with `X-Robots-Tag: noindex, nofollow, noarchive`.
- No HTTPS timeout remained in the tested probes.

Unaffected checks after the change:

- `https://vip-gece.site/` returned `200`.
- `https://www.vip-gece.site/` returned `301 -> https://vip-gece.site/`.
- `https://vip-gece.online/` returned `200`.
- `https://www.vip-gece.online/` returned `301 -> https://vip-gece.online/`.
- `https://vip-gece.site/api/ready` returned `200`.
- `https://vip-gece.online/api/ready` returned `200`.
