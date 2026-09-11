# VIP GECE vip-gece.site Production Cutover Proof

- Initial stage date: 2026-07-24
- Last verified: 2026-07-26
- Status: `LIVE`
- Production URL: `https://vip-gece.site`
- Origin: `ESKI_ORIGIN_IP_KALDIRILDI` (legacy proof snapshot; do not use as a current deployment target)
- Current release: `/var/www/vip-gece-site/releases/20260726T131549Z-mobile-order-fixed`
- Latest release delta SHA-256: `e67c4cb5c0d77fdc2638a56feb5295e15d1ba773aceef98f788a27aa68e7d67e`
- Current symlink: `/var/www/vip-gece-site/current`
- PM2 process: `vip-gece-site`
- Runtime port: `3003`

## Live application and SEO

- PM2 is online and `GET http://127.0.0.1:3003/health` returns the production
  health contract.
- Superseded `ESKI_UYGULAMA_ADI_KALDIRILDI:3000` and `unsscore-vip:3002` processes were removed
  from the saved PM2 process list after confirming that no Nginx route or
  established connection used them. Their source and rollback directories were
  retained.
- `GET http://127.0.0.1:3003/api/ready` returns exactly
  `{"status":"ready"}`.
- The public profile API contains 20 publishable profiles.
- The home page no longer renders the `VIP Vitrin` block. The animated
  `Son Eklenenler` rail is followed immediately by the 20-card
  `Secili Profiller` grid; mobile keeps five columns and the configured
  50-slot ceiling.
- The old large profile-discovery hero is absent. At 390 x 844 the public edge
  renders the new 1540 x 483 horizontal VIP Gece banner, hides the random/search
  action row and duplicate brand text, keeps five selected-card columns, and has
  no horizontal viewport overflow or browser-console error.
- `sitemap.xml` contains 41 canonical URLs. `image-sitemap.xml` contains 20 URL
  entries and 65 image entries.
- The root canonical and both robots sitemap references use
  `https://vip-gece.site`.
- The live page emits GA4 measurement ID `G-DF04MCZGRF` through the local
  analytics bootstrap. A real Chrome runtime check observed the local bootstrap,
  the Google `gtag.js` asset, the `gtag` function and the matching `config`
  event in `dataLayer`; the Google asset returned HTTP 200.
- A real-browser audit loaded every current sitemap URL and passed `41/41`
  checks for title, description, exact canonical, indexability, H1, Open Graph
  and JSON-LD.
- Cloudflare intentionally blocks untrusted automation at the edge, so a
  generic CLI crawl can return 403. This is not accepted as SEO proof; the
  origin contract, browser page load, Search Console API and verified-bot path
  are checked separately.

## Cloudflare and TLS

- The zone is active on `brett.ns.cloudflare.com` and
  `perla.ns.cloudflare.com`.
- SSL mode is `Full (strict)`.
- A 2026-07-26 authenticated, read-only Cloudflare dashboard check also showed
  `vip-gece.online` as `Active` with `Full (strict)` encryption.
- Universal edge TLS is active; the origin uses the hostname-valid
  `/etc/letsencrypt/live/vip-gece.site` certificate.
- Always Use HTTPS, minimum TLS 1.2, TLS 1.3 and Automatic HTTPS Rewrites are
  enabled.
- Custom WAF rules allow only the authenticated Türkiye readiness request to
  `/api/ready`, allow verified Google GET/HEAD traffic, block verified
  non-Google bots and obvious unverified automation, and deny unauthenticated
  public readiness requests.

## Search Console continuity

- Production status is `active` for `sc-domain:vip-gece.site` using the
  root-protected authorized-user credential file.
- The 2026-07-25 OAuth refresh hotfix stopped adding a different scope to an
  authorized-user refresh-token exchange. The refresh token's existing grant
  is now used unchanged.
- The Search Console API lists both `https://vip-gece.site/sitemap.xml` and
  `https://vip-gece.site/image-sitemap.xml` as downloaded on 2026-07-26, not
  pending, with zero errors and zero warnings.
- URL Inspection for `https://vip-gece.site/` returns `PASS`,
  `INDEXING_ALLOWED`, `SUCCESSFUL` and `ALLOWED`; Google reports the page as
  submitted and indexed, with both the user and Google canonical set to
  `https://vip-gece.site/`.
- Both `vip-gece.site` and `vip-gece.com` are owner properties. The current
  90-day Search Analytics snapshot still attributes 3,681 clicks and 179,780
  impressions to `.com`, while `.site` has not yet accumulated impressions.
- Google still selects `.com/` as the canonical for the old root despite its
  `.site/` user canonical and exact 301. The technical migration is complete,
  but Google's canonical adoption is still in progress and must not be reported
  as finished.

## Old-domain redirect proof

- `vip-gece.com` and `www.vip-gece.com` redirect permanently to
  `https://vip-gece.site` while preserving path and query.
- The current 41-URL sitemap plus three support paths produce 44 paths. The
  2026-07-26 audit checked HTTPS/HTTP plus apex/www and passed `176/176` exact
  redirects with zero failures.
- The pre-migration inventory was independently reconstructed as 257 sitemap
  paths plus three support paths: four static pages, 39 district pages, 188
  neighborhood aliases, 14 category pages and 12 historical profile pages.
  Rechecking that 260-path inventory on 2026-07-26 passed `1040/1040` exact
  redirects with zero failures, including paths no longer present in the
  smaller current sitemap.
- Türkiye ISP DNS interception can prevent local users from reaching the old
  domain before TLS. Independent DoH resolves the real Cloudflare records, and
  the production server receives the expected 301 from the Cloudflare path.

## Unsscore separation

- `unsscore.com` serves the original static UNSSCORE release from
  `/var/www/unsscore-site/current`.
- The live Nginx configuration SHA-256 and root `index.html` SHA-256 exactly
  match the pre-migration archive
  `/var/backups/vip-gece-migration/unsscore-pre-vip-20260724T170151Z.tar.gz`.
- The origin root returns 200 with valid TLS and the UNSSCORE title; VIP markers
  are absent. `/profil/test`, `/profiller`, `/kategoriler`, `/api/ready` and the
  VIP admin path return 404.

## Admin management and first-party analytics

- The full-admin panel provides site settings, profile create/edit/delete and
  ordering, publish state, media, SEO fields, ownership assignment, customer
  account creation/update, username/e-mail/password rotation and per-customer
  quota.
- Customer passwords are not returned to the browser. A password change rotates
  the customer's session version and invalidates older sessions.
- Admin analytics reads the production event ledger instead of fixture totals.
  The 2026-07-26 seven-day snapshot contained 422 profile views and 153 contact
  actions across three sources and 19 profiles. Coverage is marked `partial`
  because first-party tracking began inside the selected seven-day interval.
- Site-wide and per-profile analytics, channel totals, daily series, source
  breakdown, top profiles and Search Console query/page/date reporting are
  available in the admin panel. All admin analytics, site settings and customer
  account endpoints return 401 without authentication.

## Gateway and Türkiye probe

- `pm2-vipgateway.service` is enabled and active under the isolated
  `vipgateway` user.
- `vip-gece-domain-gateway` and `vip-gece-domain-monitor` are online with zero
  systemd restarts.
- The deployed gateway, monitor, server and probe-ingest files match the
  hardened repository version. The enabled standby is bound to activation
  attestation and config hash
  `bdaffd5596856d86a05fb146176a9c9331bdd83714d564cc743ea2368f26d2a9`.
- The gateway keeps the full path and query in its 301 response.
- The latest accepted Türkiye observation reached both `.site` and `.online`
  through Cloudflare with valid TLS and hostname verification, a Cloudflare
  server header and CF-Ray, no redirect, HTTP 200 and the exact readiness JSON
  contract.
- State version 3 was safely rebased after the freshness hardening. The latest
  cycle records one fresh success for `.site` and zero for the stale-attestation
  `.online` standby; old 3/3 history cannot cross a stale probe or renewed
  attestation generation. Monitor mode remains `observe`; automatic Cloudflare
  mutation is deliberately unarmed.
- The deployment retained a dated rollback copy, rebased the state after the
  config change, consumed three distinct Türkiye nonces and left no pending
  switch journal.
- Source verification passes 43 gateway tests and 30 Türkiye-probe tests.
- The gateway and monitor themselves are VPS-hosted and boot-persistent. The
  Türkiye observation producer is still the Mac LaunchAgent `tr-mac-01`; it
  stops producing fresh samples when the Mac is off. True computer-independent
  Türkiye monitoring therefore still requires a separately supplied Türkiye
  VPS or runner.

## Standby-domain gate

- `vip-gece.online` is delegated to the exact Cloudflare pair
  `brett.ns.cloudflare.com` / `perla.ns.cloudflare.com`; multiple recursive
  resolvers and both Google and Cloudflare DoH agree.
- Its Google Trust Services edge certificate is hostname-valid through
  2026-10-23. The standby serves the same 20 public profiles, 41 sitemap URLs,
  exact `/api/ready` contract and content manifest as `.site`; canonical URLs
  remain on the `.site` primary.
- `.online` is enabled as the gateway/probe standby, but the monitor remains in
  `observe` with apply arming off and no mutation token installed. No automatic
  Cloudflare redirect mutation is allowed until a continuously available
  Türkiye probe and a fresh activation attestation are present at the switch
  decision.
- Search Console currently reports the `.online` property as
  `siteUnverifiedUser`; it is not claimed as verified or as a separate canonical
  indexing target.

No credential, token, private key or private probe-header value is included in
this proof.
