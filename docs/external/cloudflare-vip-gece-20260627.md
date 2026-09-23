# VIP GECE Cloudflare Pass - 2026-06-27

Scope: `vip-gece.com` only. UNSSCORE zones were not touched.

Cloudflare zone:

- Zone name: `vip-gece.com`
- Zone id: `6cf7084baa8c98340aa415c4c470cb5b`
- Account id: `d968b65ad015333070f524d06ac0ee30`

Applied via Cloudflare API:

- `_domainconnect.vip-gece.com` changed from proxied to DNS-only.
- `email.vip-gece.com` changed from proxied to DNS-only.
- Temporary `/robots.txt` Worker route test was removed after verification because Cloudflare injected a managed robots directive after the Worker response.

Applied via Cloudflare dashboard:

- The Cloudflare-managed robots signal switch was changed from enabled to disabled.
- This removed the managed non-standard robots line from live `/robots.txt`.

Verified live:

- `vip-gece.com` resolves through Cloudflare proxied A records.
- `_domainconnect.vip-gece.com` resolves to `_domainconnect.gd.domaincontrol.com`.
- `email.vip-gece.com` resolves to `mailgun.org`.
- TLS is served as TLS 1.3 through Cloudflare.
- Live SEO audit remains `ok=true` with `246` sitemap URLs.
- Live `/robots.txt` no longer contains Cloudflare-managed non-standard directives.

2026-06-28 Search Console follow-up:

- Search Console still showed an old `https://www.vip-gece.com/robots.txt` sample from `2026-06-21 03:55` with a stale non-standard robots line.
- Current live verification no longer reproduces that file. The `www` and `http` robots variants all redirect/follow to the clean canonical robots file:
  - `https://vip-gece.com/robots.txt` -> final `https://vip-gece.com/robots.txt`, status `200`, no stale managed directive.
  - `https://www.vip-gece.com/robots.txt` -> final `https://vip-gece.com/robots.txt`, status `200`, no stale managed directive.
  - `http://vip-gece.com/robots.txt` -> final `https://vip-gece.com/robots.txt`, status `200`, no stale managed directive.
  - `http://www.vip-gece.com/robots.txt` -> final `https://vip-gece.com/robots.txt`, status `200`, no stale managed directive.
- `npm run live-seo-audit -- --site=https://vip-gece.com --strict` now checks these robots variants explicitly so stale `www` robots content or a future Cloudflare injection returns a failing audit.

Resolved blocker:

- Cloudflare previously injected a managed non-standard robots block into `/robots.txt`.
- Semrush flags that non-standard directive as a robots format error.
- This is not coming from the repository `robots.txt`, the Node app, or the origin server.
- A Worker route cannot override it because the Cloudflare managed content is appended after the Worker response.
- Dashboard action was completed on 2026-06-27, but Semrush monthly crawl quota was exhausted, so Semrush could not refresh the report immediately.

API limitations observed:

- DNS read/write is available.
- Workers read/write is available.
- Zone settings read/write returned authorization errors.
- Cache purge returned authorization errors.
- Ruleset list is readable, but ruleset detail/write returned authorization errors.

## HTML Cache Rule Status

Origin headers are ready for Cloudflare HTML caching:

- Public HTML responses should keep browser cache conservative with `Cache-Control: public, max-age=0, must-revalidate, no-transform`.
- Public HTML responses should expose shared-cache intent with `CDN-Cache-Control: public, max-age=300, stale-while-revalidate=86400`.
- Private or operator-facing files such as `/config.js` and `/admin.js` must remain `no-store` / `private` and must not be edge-cached.

Current live state after the 2026-06-28 Cloudflare cache rule deploy:

- Cloudflare now reports public HTML as edge-cached.
- The one-time account API token was verified through the account token endpoint; the token value was not printed or stored.
- Existing `http_request_cache_settings` rules were preserved, and `VIP GECE public HTML cache` was added for public GET/HEAD HTML routes.
- Custom cache key override was rejected by plan entitlement, so the deployed rule uses standard cache eligibility with edge TTL `300` seconds and browser TTL respecting origin.
- 2026-06-28 `npm run cloudflare-cache-check -- --strict --attempts=4 --wait-ms=900` result: `public_origin_ready=true`, `cloudflare_html_cache_ready=true`, `cloudflare_cache_rule_needed=false`, `private_cache_safe=true`.
- Repeated public probes for `/`, `/kategoriler`, and `/istanbul-escort` returned `HIT` / `UPDATING`.
- Private probes for `/config.js` and `/admin.js` remained `DYNAMIC` with defensive cache headers.
- Live `/` response includes `Cache-Control: public, max-age=0, must-revalidate, no-transform`, which Cloudflare documents as disabling JavaScript Detections injection for affected responses.

Historical pre-rule state:

- Cloudflare previously reported public HTML as `cf-cache-status: DYNAMIC`.
- This meant the origin was prepared, but a Cloudflare Cache Rule was still needed.
- 2026-06-27T02:48:03Z `npm run cloudflare-cache-check -- --json` result: `public_origin_ready=true`, `cloudflare_html_cache_ready=false`, `cloudflare_cache_rule_needed=true`, `private_cache_safe=true`.
- Repeated public probes for `/`, `/kategoriler`, and `/istanbul-escort` returned `DYNAMIC,DYNAMIC,DYNAMIC`.
- Private probes for `/config.js` and `/admin.js` returned defensive cache headers: `no-store, no-cache, must-revalidate, private`.

2026-06-28 PageSpeed follow-up:

- `npm run pagespeed-api-audit` is now wired for Google `runPagespeed` and falls back to Lighthouse when this shell has no usable `PAGESPEED_API_KEY` or quota.
- Latest live fallback scores after cache rule + `no-transform` deploy are mobile `87/100/96/100` and desktop `83/100/96/100` for Performance/Accessibility/Best Practices/SEO.
- Latest local staging fallback scores are mobile `97/100/96/100` and desktop `99/100/96/100`, so the app-side runtime path is healthy.
- Best Practices recovered to `96`, matching the earlier local/staging target.
- Remaining Google REST API limitation is quota only: PageSpeed REST returns `429`, and the local Lighthouse fallback writes proof.

Deployed rule shape for `vip-gece.com` only:

- Rule name: `VIP GECE public HTML cache`
- Match request method: `GET` or `HEAD`
- Match hostname: `vip-gece.com` or `www.vip-gece.com`
- Include paths: public HTML routes such as `/`, `/anasayfa`, `/kategoriler`, `/bolgeler`, `/ilanlar`, `/iletisim`, `/*-escort`, and profile/category public pages.
- Exclude paths: `/api/*`, `/config.js`, `/admin.js`, `/admin.css`, `/vg-panel-91x*`, `/assets/*`, `/images/*`, `/uploads/*`, `/robots.txt`, `/sitemap.xml`, and verification files.
- Cache eligibility: cache eligible / cache everything for the matched HTML routes.
- Edge TTL: `300` seconds.
- Browser TTL: respect origin headers.
- Respect origin `CDN-Cache-Control` and `Cloudflare-CDN-Cache-Control` where dashboard options expose that choice.

Verification command:

```bash
npm run cloudflare-cache-check -- --strict
```

Completed result after the deployed rule:

- `public_origin_ready=true`
- `cloudflare_html_cache_ready=true`
- public HTML `cf-cache-status` contains `HIT`, `REVALIDATED`, `STALE`, or `UPDATING` on repeated probes.
- `private_cache_safe=true`

Reference docs:

- Cloudflare Cache Rules: https://developers.cloudflare.com/cache/how-to/cache-rules/
- Cloudflare cache responses: https://developers.cloudflare.com/cache/concepts/cache-responses/
- Cloudflare cache-control behavior: https://developers.cloudflare.com/cache/concepts/cache-control/

## 2026-09-12 vip-gece.site HTTPS Edge Verification

Cloudflare zone read:

- Zone: `vip-gece.site`
- Zone id: `d03cc4b65d00081a68689b7f941e08da`
- Status: `active`
- Plan: `Free Website`
- DNS apex: proxied `A 159.69.146.114`, proxied `AAAA 2a01:4f8:1c16:55c3::1`
- DNS www: proxied `A 159.69.146.114`, proxied `AAAA 2a01:4f8:1c16:55c3::1`
- DNS preview: proxied `A 159.69.146.114`

Cloudflare transport/security settings read from API:

- `ssl=strict`
- `always_use_https=on`
- `automatic_https_rewrites=on`
- `min_tls_version=1.2`
- `tls_1_3=on`
- `http3=on`
- `brotli=on`
- `ipv6=on`
- `browser_check=off`
- `security_level=medium`
- `websockets=on`
- `early_hints=on`
- `rocket_loader=off`
- `mirage=off`

Live external redirect proof:

- `http://vip-gece.site/` returns `301` with `location=https://vip-gece.site/` from `server=cloudflare`.
- `http://www.vip-gece.site/` returns `301` with `location=https://www.vip-gece.site/` from `server=cloudflare`.
- Following `http://vip-gece.site/` finishes at `https://vip-gece.site/` with HTTP `200`, `server=cloudflare`, and HSTS `max-age=31536000; includeSubDomains`.
- Following `http://www.vip-gece.site/` finishes at `https://vip-gece.site/` with HTTP `200`, `server=cloudflare`, and HSTS `max-age=31536000; includeSubDomains`.
- `https://www.vip-gece.site/` returns `301` to `https://vip-gece.site/`.

Rules read:

- Cloudflare Page Rules: none.
- Dynamic redirect ruleset has one active www-to-apex `301` rule and no rule redirecting HTTPS to HTTP.
- Maintenance firewall rule exists but is disabled.
- Cloudflare Managed Free Ruleset is enabled.

Sitemap/SEO proof:

- `npm run live-seo-audit -- --site=https://vip-gece.site --strict` returned `ok=true`, `routes_checked=16`, `sitemap urls=267`, findings `none`.
- `https://vip-gece.site/sitemap.xml` returned `267` URLs and `bad_count=0`; every sitemap URL starts with `https://vip-gece.site/`.
- Robots variants for `https`, `http`, `www`, and apex all finish at the clean HTTPS apex robots URL.

API write limitation observed:

- The connected Cloudflare plugin can read the zone/settings but PATCH returned `9109 Unauthorized to access requested resource`.
- The local `.env` account token verifies as active, but `node -r dotenv/config scripts/cloudflare-vip-gece-post-deploy.mjs` returned `PATCH /zones/d03cc4b65d00081a68689b7f941e08da/settings/ssl: HTTP 403 Unauthorized to access requested resource`.
- No Cloudflare mutation was applied in this pass because both available Cloudflare credentials lack settings write permission.
- The requested HTTP-to-HTTPS behavior was already active and was confirmed live.
