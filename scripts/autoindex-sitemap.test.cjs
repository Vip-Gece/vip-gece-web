"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSitemapXml } = require("../src/services/sitemapService");
const { parseSitemapEntries } = require("../src/services/gscIndexSelectionService");
const { selectIndexNowUrls, buildIndexNowPayload, submitIndexNowBatch } = require("../src/services/indexNowService");
const site = "https://vip-gece.site";
const fixture = { id: "test-time", name: "Test", slug: "test-time", city: "Istanbul", district: "Sisli", is_active: true, updated_at: "2026-09-14T08:00:00Z", images: ["/test.jpg"] };
test("same-day profile edits are visible to Google sitemap and IndexNow diff", () => {
  const before = parseSitemapEntries(buildSitemapXml([fixture]), site);
  const after = parseSitemapEntries(buildSitemapXml([{ ...fixture, updated_at: "2026-09-14T09:15:00Z" }]), site);
  const previous = selectIndexNowUrls({ site, entries: before });
  const changes = selectIndexNowUrls({ site, entries: after, previousState: { sitemap_lastmods: previous.currentMap } });
  assert.ok(changes.changedUrls.includes(site + "/profil/test-time"));
  assert.equal(after.find(row => row.url.endsWith("/profil/test-time")).lastmod, "2026-09-14T09:15:00.000Z");
});
test("unchanged pages are not resubmitted; removed public pages are notified", () => {
  const entries = [{ url: site + "/", lastmod: "2026-09-14T08:00:00Z" }];
  assert.equal(selectIndexNowUrls({ site, entries, previousState: { sitemap_lastmods: { [site + "/"]: entries[0].lastmod } } }).urls.length, 0);
  assert.deepEqual(selectIndexNowUrls({ site, entries, previousState: { sitemap_lastmods: { [site + "/"]: entries[0].lastmod, [site + "/profil/retired"]: "2026-09-13" } } }).removedUrls, [site + "/profil/retired"]);
});
test("private, authenticated, foreign and token-query URLs cannot be submitted", () => {
  const urls = ["/", "/api/customer/mobile/login", "/vg-panel-91x", "/m-panel/secret", "/customer-panel.html", "/profil/test?token=private"]
    .map(p => site + p).concat("https://other.test/");
  assert.deepEqual(buildIndexNowPayload({ site, key: "fixture-indexnow-123456", urls }).urlList, [site + "/"]);
});
test("draft profiles excluded, missing dates do not become fabricated fresh dates", () => {
  const xml = buildSitemapXml([{ ...fixture, is_active: false }, { ...fixture, id: "missing-date", slug: "missing-date", updated_at: "invalid" }]);
  const entries = parseSitemapEntries(xml, site);
  assert.ok(!entries.some(e => e.url.endsWith("/profil/test-time")));
  assert.equal(entries.find(e => e.url.endsWith("/profil/missing-date")).lastmod, "");
});
test("IndexNow rejection remains failure, never reported as indexed", async () => {
  await assert.rejects(submitIndexNowBatch({ site, key: "fixture-indexnow-123456", urls: [site + "/"],
    fetchImpl: async () => new Response("rate limit", { status: 429 }) }), /429/);
});
