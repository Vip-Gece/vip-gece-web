# VIP GECE PageSpeed API Runbook

- Date: 2026-06-28T03:06:11+03:00
- Official API: `GET https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed`
- Project/domain: `https://vip-gece.com/`
- Local command: `npm run pagespeed-api-audit -- --site=https://vip-gece.com/ --strategy=mobile --strategy=desktop --category=performance --category=accessibility --category=best-practices --category=seo --locale=tr`
- Optional API key env: `PAGESPEED_API_KEY`
- Summary output: `output/external-audits/vip-gece-pagespeed-api-latest.json`
- PageSpeed API raw outputs: `output/external-audits/vip-gece.com-pagespeed-mobile-raw.json`, `output/external-audits/vip-gece.com-pagespeed-desktop-raw.json`
- Lighthouse fallback raw outputs: `output/external-audits/vip-gece.com-pagespeed-lighthouse-mobile-raw.json`, `output/external-audits/vip-gece.com-pagespeed-lighthouse-desktop-raw.json`
- Current no-key result: Google PageSpeed API currently has no usable key/quota from this shell; the command falls back to local Lighthouse automatically and still writes proof.
- Latest local staging fallback: mobile Performance `97`, Accessibility `100`, Best Practices `96`, SEO `100`; desktop Performance `99`, Accessibility `100`, Best Practices `96`, SEO `100`.
- Latest live fallback after Cloudflare cache rule + `no-transform`: mobile Performance `87`, Accessibility `100`, Best Practices `96`, SEO `100`; desktop Performance `83`, Accessibility `100`, Best Practices `96`, SEO `100`.
- Current live status: command is working and fallback proof is passing with `ok=true`; Cloudflare public HTML cache is proven with `cf-cache-status: HIT`, and Best Practices recovered to `96`.
- Remaining limitation: Google PageSpeed REST itself still returns quota `429` from this shell, so official REST scores require a usable `PAGESPEED_API_KEY`; fallback proof remains valid and repeatable without exposing a key.

Strict mode example:

```sh
PAGESPEED_API_KEY=... npm run pagespeed-api-audit -- --strict
```

No secrets included.

## 2026-09-11 vip-gece.site PageSpeed Follow-up

- Source evidence: user-supplied PageSpeed HTML for `https://vip-gece.site/` plus live post-deploy HTML checks.
- Attached PageSpeed HTML summary: Performance `99`, Accessibility `100`, Best Practices `96`, SEO `100`; main actionable opportunity was Google Analytics `unused-javascript` with about `72 KiB` estimated savings.
- Fix deployed: `/public/js/google-analytics.js?v=20260911-pagespeed1` queues GA4 immediately but defers the remote `googletagmanager.com/gtag/js` transport until post-load idle timeout, user interaction, visibility hide, or pagehide.
- Live verification: plain `https://vip-gece.site/` returned HTTP `200`, new GA tag present, old GA tag absent, no embedded remote `gtag.js` URL in HTML, `0` empty headings, and exactly one H1.
- Current REST limitation: `npm run pagespeed-api-audit -- --site=https://vip-gece.site` hit PageSpeed REST quota `429`; local Lighthouse fallback could not run in this shell because `npx` was unavailable. This is a measurement-tool limitation, not a live-site failure.
