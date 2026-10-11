# .site progressive discovery checks - 2026-10-11

## Scope

This change targets only `vip-gece.site`. The other independent sites are not
modified. It does not promise indexing, rankings, perfect scores or a refreshed
Semrush report.

## Fixes and pre-deployment evidence

- Below-fold server-rendered cards used `content-visibility:hidden` until a
  script revealed them. The rule now uses native `auto` with the existing
  intrinsic size. Chrome with JavaScript disabled reads all 16 cards instead of
  only the first 10, at both 1366x900 and 390x844.
- The critical CSS builder scans the actual rendered markup, including an
  empty inventory and missing-image states, rather than unused legacy hero
  source branches. The generated asset decreases from 34,651 to 25,625 bytes.
  A second build produces the same file hash.
- CSS-only visual checks preserve all computed styles for visible elements
  and their pseudo-elements, plus first-ten-card geometry, at both widths.
  Screenshots stay inside the measured identical-CSS control variation;
  they are not claimed to be byte-identical. No overflow or broken images
  are detected in this focused check.
- Short profile descriptions get a visible, linked explanation of the
  platform's published information-source and safety policy. This does not
  change profile records or add fabricated biographical claims. Word-count
  thresholds are audit heuristics, not Google indexing requirements.
- Three focused regression tests, the isolated smoke/contracts review,
  11 public-CSP/runtime-boundary tests, four gallery tests and the source
  secret scan pass before deployment.

## Separate owner-directed account operation

The owner explicitly superseded the earlier instruction to preserve Leyla
Ajans's account. Its active customer account was deleted on 2026-10-11. A
previously valid signed session no longer resolves. The linked Melek profile
and its seven images remain; only its WhatsApp field and database-managed
modification timestamp changed, to the existing contact ending 9017. Other
profiles and the remaining account are unchanged. The +57 announcement
configuration is unchanged. This operation does not erase historical backups.

## Outstanding external verification

The existing free Semrush crawl quota is exhausted; its old warning is not
marked cleared. The valid pre-change Lighthouse mobile run scores 88 for
performance and 100 for accessibility, best practices and SEO, with no run
warnings. A post-deployment run is required before claiming improvement.

Raw local evidence is held outside the source tree under
`/Users/o-neo/Documents/Vip-Gece-GSC-Kontrol-2026-10-09/site/`, including
`home-css-review/proof.json`, `gallery-review.log`, and the account-removal
proof. No credentials or raw session tokens are included here.

## Production verification

- Source commit `bdfb67c` was promoted at `2026-10-11T10:09:48.800Z` to
  `/var/www/vip-gece-site/releases/20261011-home-discovery-bdfb67c`.
- Canary and promoted-release checks pass. The 16 public profile records
  match the post-account-operation baseline. Production environment and
  sibling process IDs are unchanged; unauthenticated private APIs remain
  hidden with their private robots rules.
- Cloudflare purged only 18 changed `.site` URLs. No other zone was changed.
- Fresh strict SEO and content/image audits check all 262 sitemap URLs:
  zero findings within those checks, zero broken images and zero missing
  image alternatives. Homepage HTML is 80,803 bytes rather than 89,830;
  the audit's text/HTML ratio is 5%, not a fresh Semrush verdict. Irem's page
  now contains 268 words and passes the existing content heuristic.
- Live Chrome checks on 19 routes at desktop and mobile widths total
  38 passes, with no page errors, failed requests, CSP violations, overflow,
  broken images or public nofollow anchors detected.
- Live Chrome with JavaScript disabled confirms all 16 homepage cards are
  readable at both widths, independently of the captured-markup comparison.
- The valid post-deployment Lighthouse 13.4.0 mobile run at
  `2026-10-11T10:12:07.823Z` scores 100 in each of performance,
  accessibility, best practices and SEO, with no run warnings. FCP and LCP
  are 1.3 seconds, Speed Index 1.5 seconds, TBT 0 ms and CLS 0. This is one
  laboratory run, not proof of perfect real-user performance or indexing.
- The live Melek contact points to `wa.me/16135099017`, and all seven images
  remain. The earlier signed session is rejected after account deletion.

Evidence: `home-discovery-deployment-proof-bdfb67c.json`,
`seo-discovery-after-20261011.json`, `content-discovery-after-20261011.json`,
`browser-after-discovery/result.json`, `live-nojs-after-20261011.json`,
and `home-mobile-after-20261011.json` in the local evidence directory.
