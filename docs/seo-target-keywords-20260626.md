# VIP GECE SEO Target Keywords

Date: 2026-06-26
Updated: 2026-07-05
Scope: Istanbul escort hub + 39 Istanbul district escort landings + 188 neighborhood/semt escort landings
Primary target queries: 40
Total SEO clusters: 228

## Ranking Objective

Primary objective: Rank VIP GECE for the 40 non-brand service queries below.
Secondary objective: Use 188 semt-level pages as long-tail local intent support for the same Istanbul + district authority graph.

- Success target: top 5 organic result for each query.
- Aggressive target: top 1 organic result where competition and authority allow it.
- Non-goal: ranking for `MRS Escort` or other brand-only searches is not the main SEO objective.
- Tool lane: Semrush / Google Search Console / live SERP checks track ranking progress. Brand24 is only a mention and reputation radar.

## Hub Query

1. istanbul escort

## District Queries

1. adalar escort
2. arnavutköy escort
3. ataşehir escort
4. avcılar escort
5. bağcılar escort
6. bahçelievler escort
7. bakırköy escort
8. başakşehir escort
9. bayrampaşa escort
10. beşiktaş escort
11. beykoz escort
12. beylikdüzü escort
13. beyoğlu escort
14. büyükçekmece escort
15. çatalca escort
16. çekmeköy escort
17. esenler escort
18. esenyurt escort
19. eyüpsultan escort
20. fatih escort
21. gaziosmanpaşa escort
22. güngören escort
23. kadıköy escort
24. kağıthane escort
25. kartal escort
26. küçükçekmece escort
27. maltepe escort
28. pendik escort
29. sancaktepe escort
30. sarıyer escort
31. silivri escort
32. sultanbeyli escort
33. sultangazi escort
34. şile escort
35. şişli escort
36. tuzla escort
37. ümraniye escort
38. üsküdar escort
39. zeytinburnu escort

## Implementation Contract

- `/istanbul-escort` is the city hub for `istanbul escort`.
- Every district query maps to `/{district-slug}-escort`.
- Every semt query maps to its own `/{semt-slug}-escort` alias landing and keeps a parent district relationship.
- `landingAliasRows()` returns exactly 188 active semt aliases.
- `seoClusterRows()` returns exactly 228 local rows: the Istanbul hub, 39 district targets, and 188 semt targets.
- Profile trait/category landings such as `/esmer-escort`, `/sarisin-escort`, `/kumral-escort`, `/zayif-escort`, `/balik-etli-escort`, and `/kapali-escort` are separate category targets. They are not district or semt clusters and must not increase the 228 local SEO cluster count.
- `npm run contracts` checks the 228-row target list, sitemap presence, exact district metadata phrases, semt signals, and internal semt intent links.
- Every district and semt landing keeps all active profiles visible, but profile order is not cloned; local demand intent changes deterministic ordering per landing.
- Public copy must not expose internal words such as hub, landing architecture, SEO chain, viewport, or internal strategy notes.

## Execution Priorities

1. Make every target page indexable, canonical, internally linked, and present in sitemap.
2. Ensure every target page has a distinct title, description, H1, intro, FAQ, nearby district links, and active profile/listing content.
3. Treat the 40 hub/district queries as primary rank-tracking targets, then monitor the 188 semt queries through Google Search Console, live SERP checks, and Semrush batches where quota allows.
4. Strengthen authority with relevant backlinks, citations, profile freshness, and internal links from home, Istanbul hub, district pages, semt pages, category pages, and profile pages.
5. Rework pages with weak impressions/click-through or positions outside top 5 before expanding to lower-priority keyword combinations.

## Query Variant Policy

Target variants are tracked in three buckets. The site must not add hidden text, hidden links, cloaked copy, or keyword stuffing blocks for any bucket.

### Bucket A - Primary visible targets

These are allowed in titles, descriptions, H1/H2, visible intro copy, card labels, structured data keywords, internal links, and sitemaps where the page actually matches the intent.

- `{area} escort`
- `{area} vip escort`
- `{area} escort ilanları`
- `{area} escort profilleri`
- `{area} escort numarası`
- `{area} escort telefon`
- `{category} escort`
- `{area} {category} escort`

Examples:

- `istanbul escort`
- `fatih escort`
- `taksim escort`
- `şişli vip escort`
- `esmer escort`
- `kadıköy sarışın escort`

### Bucket B - Tracking-only rough-language variants

These can be tracked in GSC/SERP reports because users may search them, but they must not be injected as hidden copy or unnatural visible copy.

- `{area} orospu`
- `{area} orospu numarası`
- `{area} orospu telefon`
- `{area} escort orospu`

If a rough-language query starts receiving impressions, the response is not hidden keyword stuffing. The response is to improve the matching public landing with clearer legitimate service wording, stronger internal links, profile freshness, and backlinks.

### Bucket C - Phone/number variants

Phone/number variants are valid only when the page has real contact intent and the contact surface is visible to users.

- `{area} escort numara`
- `{area} escort numarası`
- `{area} escort telefon`
- `{area} escort whatsapp`

These variants should route to real profile/category/list pages, not to fake doorway pages.

## Variant Implementation Guardrails

- Do not use `display:none`, zero-size text, same-color text, offscreen keyword blocks, or bot-only copy.
- Do not create duplicate pages that differ only by one rough-language keyword.
- Do not put rough-language variants into public UI unless there is a deliberate editorial decision.
- Do not add unsupported claims or fake location/phone data.
- Use GSC/SERP tracking for discovery; use visible page quality, internal linking, schema correctness, profile freshness, and backlinks for ranking work.
