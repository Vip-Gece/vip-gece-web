# VIP GECE External SEO Audit Proof

## 2026-08-13 owner Semrush-analyzer refresh

- Tool/source: owner-installed Semrush analyzer skill using Apify actor `outspoken_platter/semrush-scraper-free`.
- Domain run: `x38kuAyn7mHIFzlg0`; dataset `RNlaTxODvaqHf7YDG`; cost reported by Apify: `$0.007248186549752951`.
- Domain-metric boundary: the run returned `metrics_available=false` with the explicit notice that Semrush did not expose domain metrics to the unauthenticated run. Authority, organic keyword, traffic or Moz values are therefore not claimed from this source.
- Technical audit run: `7Z6D164MQYi4YccT2`; dataset `8OZ0Sl1dBniWeK4mD`; cost reported by Apify: `$0.003257766360013021`.
- Live home result: final HTTP `200`, actor-observed response time `1582 ms`, exact canonical `https://vip-gece.site/`, `index, follow, max-image-preview:large`, language `tr`, one H1, title length `41`, meta-description length `107`, `61` internal links, `33` images and `0` images missing alt text.
- Social/schema result: Open Graph and Twitter large-image metadata were present. Three parseable JSON-LD blocks were found: `Organization`, `WebSite` and `CollectionPage`.
- Current strict first-party checks remain stronger than the one-page actor sample: production smoke passed, strict live SEO passed, sitemap inventory is `267`, profiles are `27 public / 27 home / 27 indexable / 0 SEO-only`, and the permanent structured-data audit previously passed `267/267` URLs.
- Interpretation: the actor confirms the live homepage technical SEO surface, but it does not provide current Semrush authority or organic visibility metrics without authenticated Semrush exposure.

## 2026-07-28 migration continuity

- Current canonical production target: `https://vip-gece.site/`
- Current live sitemap inventory: `267` URLs.
- Historical `.com` audit evidence below is intentionally retained. Exact
  permanent redirects carry old URL visits to the matching `.site` paths;
  editable high-value external links should be updated directly to `.site`.
- Backlink acquisition is not complete: only live source URLs count as
  published, and index status requires independent Search Console or live
  index evidence.

- Date: 2026-06-28T00:06:11Z
- Tool/source: Lighthouse CLI 13.4.0 live production crawl plus VIP GECE live sitemap SEO audit; Google PageSpeed Insights API is wired through `npm run pagespeed-api-audit`, with local Lighthouse fallback when no usable REST key/quota is available.
- Account/workspace: Local Codex audit workspace, no third-party account secret used.
- Project/domain: vip-gece.com
- Report/export reference: `output/external-audits/vip-gece-lighthouse-live-20260627.json` SHA256 `b09699f4bcc48df5fddbca788e3b5089ce5d16c0d7b391e2c76f2bb06014f370`; `output/external-audits/vip-gece-pagespeed-api-latest.json`; `docs/external/pagespeed-api-vip-gece.md`; `npm run live-seo-audit -- --strict`; `npm run full-sitemap-seo-audit -- --strict --concurrency=8`
- Audit scope: Live `https://vip-gece.com/` Lighthouse SEO, accessibility, best-practices, performance categories; document title, meta description, HTTP status, crawlable links, indexing permission, canonical and `www/http/https` robots variants, hreflang, structured data audit presence, live robots/sitemap checks, and full sitemap crawl of 247 URLs including `/esmer-escort`.
- Main findings: SEO-critical audits passed for title, meta description, HTTP status, descriptive links, crawlable anchors, indexability, valid robots.txt, hreflang, canonical, representative routes, and all `247` sitemap URLs. Current live robots variants all final-resolve to `https://vip-gece.com/robots.txt` without the stale robots directive previously shown in Search Console's 2026-06-21 `www` sample. After the home runtime optimization, local staging strict PageSpeed/Lighthouse fallback returned mobile `97/100/96/100` and desktop `99/100/96/100` for Performance/Accessibility/Best Practices/SEO. After the Cloudflare cache rule + `no-transform` production deploy, latest live production fallback returned mobile `87/100/96/100` and desktop `83/100/96/100`; Cloudflare public HTML cache is proven with `cf-cache-status: HIT`, and private `/config.js` / `/admin.js` remain `DYNAMIC`.
- Next actions: Provide a usable `PAGESPEED_API_KEY` only if official Google REST scores are required instead of the current Lighthouse fallback proof.
- Owner confirmation: Codex completed this live audit under the user instruction `devam` on 2026-06-27; no secrets, tokens, cookies, or credentials were stored in this proof.

No secrets included.
