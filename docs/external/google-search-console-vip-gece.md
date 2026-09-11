# VIP GECE Google Search Console Automation

## 2026-07-25 vip-gece.site continuity update

- Production property: `sc-domain:vip-gece.site`
- Runtime mode: `active`
- Credential type: OAuth `authorized_user`, stored outside the release with
  mode `0600`
- The authorized-user refresh-token exchange no longer requests a different
  per-call scope. It uses the scope already granted to the refresh token, which
  prevents `invalid_scope` on read-only Search Console operations without
  asking for broader access.
- Live API proof:
  - both `https://vip-gece.site/sitemap.xml` and
    `https://vip-gece.site/image-sitemap.xml` are listed with zero errors and
    zero warnings;
  - Search Analytics responds successfully;
  - URL Inspection for `https://vip-gece.site/` returns `PASS`,
    `INDEXING_ALLOWED`, `SUCCESSFUL` and `ALLOWED`;
  - Google reports the root as submitted and indexed.
- The previous `sc-domain:vip-gece.com` property records the domain move to
  `vip-gece.site`.

The sections below retain the earlier `vip-gece.com` deployment history.

- Date: 2026-06-28T07:40:57Z
- Production URL: https://vip-gece.com
- Runtime status: deployed, credential mode `active`
- Deployed package SHA: `1aea9be0c0568773d7fe13ceb14063bda3ef7b7ab040b944cb6362692191c43c`
- Remote release: `/var/www/vip-gece-staging/releases/1aea9be0c0568773d7fe13ceb14063bda3ef7b7ab040b944cb6362692191c43c`
- Production rollback: `/var/www/ESKI_ROLLBACK_YOLU_KALDIRILDI-20260628T073510Z`

## What Was Wired

- `src/services/googleSearchConsoleService.js` provides native service-account JWT and OAuth `authorized_user` refresh-token flows with no extra `googleapis` dependency.
- Admin Tools now exposes a single `Search Eşzamanla` button.
- One click posts to `POST /api/admin/google/sync` with `inspectAllSitemapUrls: true`, submits both sitemaps, extracts URLs from the generated `sitemap.xml`, and sends the first 40 sitemap URLs to URL Inspection with concurrency `4`. The backend still has a protected 300 URL hard limit for manual/admin runs.
- Admin API routes are now available behind admin auth:
  - `GET /api/admin/google/status`
  - `GET /api/admin/google/sitemaps`
  - `POST /api/admin/google/sitemaps`
  - `POST /api/admin/google/inspect`
  - `POST /api/admin/google/search-analytics`
  - `POST /api/admin/google/sync`
- Mobile/admin bootstrap exposes the same Google status without exposing secrets.
- `npm run contracts` now checks that GSC status output is secret-safe, sitemap endpoint encoding is correct, default inspection URLs include the new category pages, sitemap `<loc>` extraction supports full-site sync, the one-click admin button exists, and risky channels such as cloaking/link schemes/Indexing API abuse stay out of the fast-discovery plan.
- `npm run env-contract` now validates GSC env shape when GSC is enabled.
- `npm run verify-package` now requires the GSC service in the runtime package.

## Production Result

Current production GSC runtime status:

```json
{"configured":true,"enabled":true,"mode":"active","site_url":"sc-domain:vip-gece.com","credential_type":"authorized_user","credential_source":"authorized_user_json_file","sitemap_count":2}
```

No secret values were printed or stored.

## Activation Env

Production is active with a secret-safe OAuth `authorized_user` credential at `/var/lib/vip-gece/google-search-console-credential.json` and `.env` pointing at it. Both files are owned by `ESKI_KULLANICI_ADI_KALDIRILDI` and mode `600`.

Supported credential shapes for future rotation:

```sh
GOOGLE_SEARCH_CONSOLE_ENABLED=true
GOOGLE_SEARCH_CONSOLE_SITE_URL=sc-domain:vip-gece.com

# Option A: authorized_user JSON path
GOOGLE_SEARCH_CONSOLE_CREDENTIAL_JSON_PATH=/secure/path/application_default_credentials.json

# Option B: authorized_user JSON inline
GOOGLE_SEARCH_CONSOLE_CREDENTIAL_JSON={...}

# Option C: service account JSON path
GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON_PATH=/secure/path/service-account.json

# Option D: service account JSON inline
GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON={...}

# Option E: service account pieces
GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL=service-account@example.iam.gserviceaccount.com
GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY_PATH=/secure/path/private-key.pem
```

The same aliases work with `GSC_ENABLED`, `GSC_SITE_URL`, `GSC_CREDENTIAL_JSON_PATH`, `GSC_CREDENTIAL_JSON`, `GSC_SERVICE_ACCOUNT_JSON`, `GSC_CLIENT_EMAIL`, and `GSC_PRIVATE_KEY`.

The Google identity behind the credential must have access to the `sc-domain:vip-gece.com` Search Console property before sync can work.

## Secure Install Helper

When a Search Console service-account or authorized-user JSON is available, install it without printing secret values:

```sh
sudo -n -u ESKI_KULLANICI_ADI_KALDIRILDI bash -lc 'cd /var/www/ESKI_UYGULAMA_YOLU_KALDIRILDI && node scripts/install-gsc-credential.mjs < /secure/local/google-credential.json'
pm2 restart ESKI_UYGULAMA_ADI_KALDIRILDI --update-env
```

Expected status after install and permission grant:

```sh
cd /var/www/ESKI_UYGULAMA_YOLU_KALDIRILDI
node -e 'require("dotenv").config(); const { searchConsoleStatus } = require("./src/services/googleSearchConsoleService"); console.log(JSON.stringify(searchConsoleStatus()));'
```

The result should show `configured:true`, `enabled:true`, and `mode:"active"`.

## Fast Discovery Flow

When credentials are active:

1. Submit `https://vip-gece.com/sitemap.xml`.
2. Submit `https://vip-gece.com/image-sitemap.xml`.
3. Inspect the first 40 generated sitemap URLs when `Search Eşzamanla` is pressed. The priority default list remains available for direct/default sync calls:
   - `/`
   - `/istanbul-escort`
   - `/kategoriler`
   - `/ilanlar`
   - `/sisli-escort`
   - `/vip-escort`
   - `/esmer-escort`
   - `/sarisin-escort`
   - `/kumral-escort`
   - `/zayif-escort`
   - `/balik-etli-escort`
   - `/kapali-escort`
4. Query Search Analytics for query/page/date tracking after Google starts reporting the new crawl state.

This is intentionally clean: no cloaking, no doorway/spam pages, no link schemes, and no Indexing API abuse for ordinary public pages.

## Official Google Notes

- Search Console API supports Search Analytics, Sitemaps, Sites, and URL Inspection services.
- Sitemaps can be submitted through Search Console or the Search Console API, but submission is a crawl hint, not an indexing guarantee.
- URL Inspection API returns Google index status for the indexed version of a URL; it is not a live indexability test.
- Indexing API is limited to `JobPosting` or `BroadcastEvent` in `VideoObject` use cases, so it is not used for VIP GECE public profile/category pages.

Reference URLs:

- https://developers.google.com/webmaster-tools/v1/api_reference_index
- https://developers.google.com/webmaster-tools/v1/sitemaps/submit
- https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
- https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- https://developers.google.com/search/apis/indexing-api/v3/quickstart

## Verification

- `npm run check` passed after OAuth `authorized_user`, timeout, and concurrency support.
- `SITE_URL=https://vip-gece.com SMOKE_BASE_URL=http://127.0.0.1:3105 EXPECTED_SITE_URL=https://vip-gece.com npm run contracts` passed.
- `SMOKE_BASE_URL=http://127.0.0.1:3105 npm run smoke` passed.
- Secure installer self-test passed with temporary env + credential files, both mode `600`.
- `npm run package-staging && npm run verify-package` passed with SHA `1aea9be0c0568773d7fe13ceb14063bda3ef7b7ab040b944cb6362692191c43c`.
- Production deploy verified `/var/www/ESKI_UYGULAMA_YOLU_KALDIRILDI/scripts/install-gsc-credential.mjs` exists and PM2 is online.
- Production `runDiscoverySync({ inspectAllSitemapUrls:true, inspectLimit:40, inspectConcurrency:4 })` returned `submitted_count=2`, `requested=248`, `inspected=40`, `failed=0`, `PASS=15`, `NEUTRAL=25`, `elapsed_ms=66040`.
- Live `npm run live-seo-audit -- --site=https://vip-gece.com --strict` returned `ok=true`, `routes_checked=11`, `sitemap_urls=248`.
- Live `npm run full-sitemap-seo-audit -- --site=https://vip-gece.com --strict --concurrency=8` returned `248/248`, `failing_count=0`.
- Live `npm run cloudflare-cache-check -- --strict --attempts=4 --wait-ms=900` returned `cloudflare_html_cache_ready=true` and `private_cache_safe=true`.
