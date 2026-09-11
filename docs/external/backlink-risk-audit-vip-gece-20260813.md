# VIP GECE Backlink Risk Audit — 2026-08-13

## Scope and source

- Canonical target: `https://vip-gece.site/`
- Checked database: Turkey (`tr`)
- External source: Apify actor `pro100chok/semrush-scraper`, run
  `rGoFdjr4w2Y18imX4`
- Run result: succeeded with one dataset row; recorded cost `$0.015`
- Account limit used for this run: `$0.10` maximum cost
- Important limitation: this is a third-party Semrush-style scraper, not a
  direct Semrush API export and not Google Search Console data. Its findings
  must be cross-checked in Search Console before any destructive SEO action.

## Observed baseline

| Signal | Observed value |
|---|---:|
| Authority score | 0 |
| Organic traffic | 0 |
| Organic keywords | 0 |
| LLM visibility / mentions / cited pages | 0 / 0 / 0 |
| Backlinks | 453 |
| Referring domains | 41 |
| Follow / nofollow | 184 / 269 |
| Link power / naturalness / health | 0 / 0 / 0 |

The backlink count is not evidence of useful authority. The same dataset
reports no measurable organic visibility and scores link quality at zero.

## High-risk patterns

- `208` backlinks across `20` domains use an anchor advertising a Telegram
  account for SEO backlinks, PBNs, traffic boosts and link indexing.
- `182` backlinks from one domain have an empty anchor.
- `21` backlinks across two domains use an automated English anchor promising
  rapid ranking and traffic growth through guest posting.
- The sample set includes `grow-your.website` and
  `fiverr-seo-for-small-businesses.site`. The sampled links are marked
  `nofollow`, but their anchors and surrounding copy are characteristic of
  automated link spam rather than independent editorial citations.
- The external source returned no organic competitors and no organic keyword
  rows for the Turkey database.

## Decision

Do not count these links as acquired backlinks, do not imitate their anchor
pattern, and do not buy or extend the network. Do not upload a disavow list
from this third-party dataset alone.

Google states that most sites do not need the disavow tool and that it should
be used only when there is both a considerable amount of artificial or
low-quality linking and a manual action, or a strong likelihood of one. Google
also warns that incorrect use can harm Search performance. The next gate is:

1. Check the `vip-gece.site` Search Console Manual actions report.
2. Export the Search Console Links report and compare linking domains and
   anchors with this external sample.
3. If no manual action exists, retain this as a monitoring baseline and let
   Google's spam systems ignore the network.
4. If a manual action exists or the same network is confirmed at serious scale
   in Search Console, make a narrow domain-level candidate list, attempt
   removal where practical, review every candidate, and obtain owner approval
   immediately before uploading a replacement disavow file.

Official references:

- <https://support.google.com/webmasters/answer/2648487>
- <https://support.google.com/webmasters/answer/9049606>
- <https://support.google.com/webmasters/answer/9044175>

No token, cookie, signed dataset URL or account secret is stored in this file.

## 2026-08-29 follow-up

- Google's documented Search Console API resources remain Search Analytics,
  Sitemaps, Sites and URL Inspection. The Manual Actions and Links reports are
  authenticated Search Console UI surfaces and cannot be replaced by the
  project's existing API credential or index-monitor script.
- No independent editorial publication was found in the seven pending outreach
  sources. The direct `websitelaunches.com/site/vip-gece.site` directory record
  is now HTTP 200 with two `rel="nofollow noopener"` links to the canonical
  home page, but it is not evidence that the sampled spam network is trusted.
- No disavow file was generated or uploaded. The decision gate at lines 56-64
  remains unchanged until the owner UI confirms the Manual Actions state and a
  fresh Links report export can be compared domain by domain.

Additional official API reference:

- <https://developers.google.com/webmaster-tools/v1/api_reference_index>
