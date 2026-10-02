# VIP GECE Site Category Link Audit - 2026-10-02

## Scope

- Domain: `https://vip-gece.site`
- Git commit: `9b0086a` plus the follow-up brand `sameAs` metadata change in this evidence run
- Live release: `/var/www/vip-gece-site/releases/20261002T1848Z-brand-sameas-9b0086aa`
- Previous release: `/var/www/vip-gece-site/releases/20261002T1842Z-category-links-9b0086aa`
- PM2 app: `vip-gece-site`, running as `deploy`

## Changes

- Removed the category-hub filter that hid indexable category pages with no active profile match.
- Kept sitemap-visible category pages reachable from the public category hub.
- Updated category copy so it no longer claims only filled categories are listed.
- Added `npm run full-sitemap-content-audit` to crawl every sitemap HTML URL and check visible text, text/html ratio, placeholder leakage, missing image alt text, and broken images.
- Added backend-visible Schema.org `Organization.sameAs` and `WebSite.sameAs` metadata from `vip-gece.site` to `https://vip-gece.online/`.

## Verification

| Check | Result |
| --- | --- |
| Public homepage | `200` |
| Public `/api/ready` | `200` |
| Live internal link graph | `ok=true`, `sitemap_urls=262`, `unreachable_from_home=0`, `orphan_no_inbound=0`, `cannot_reach_home=0` |
| Live full sitemap SEO audit | `ok=true`, `checked_urls=262`, `failing_count=0` |
| Live full sitemap content audit | `ok=true`, `pages=262`, `broken_images=0`, `missing_alt_pages=0`, `unique_images=55` |
| Live structured data relation | Homepage JSON-LD exposes `Organization.sameAs=["https://vip-gece.online/"]` and `WebSite.sameAs=["https://vip-gece.online/"]` |
| Local syntax check | `npm run check` passed |
| Structured-data contract | `242 landings and 3 hubs avoid unsupported Carousel markup`; .site to .online `sameAs` assertions passed |

## Notes

- Initial deployment validation used the wrong internal port (`3000`) and triggered the guarded rollback path before public activation was accepted.
- The corrected activation used the runtime port `3003`; health checks passed and `current` now points to the new release.
- `vip-gece.online` is a separate Next/Vinext live surface; it did not expose JSON-LD in the checked homepage HTML during this run.
- No secret values were printed or stored in this evidence file.
