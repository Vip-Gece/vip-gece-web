import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { parse } = require("parse5");

const settingsPath = join(tmpdir(), `vip-gece-seo-policy-contract-${process.pid}.json`);
process.env.SITE_SETTINGS_STORE_PATH = settingsPath;

const { DEFAULT_SITE_SETTINGS, readSiteSettingsSync } = require("../src/services/siteSettingsService");
const { renderHomeHtml } = require("../src/services/render/homeRenderer");
const { renderCategoryHtml } = require("../src/services/render/landingRenderer");
const { renderProfileDetailHtml } = require("../src/services/render/detailRenderer");
const {
  renderCategoriesHubHtml,
  renderContactHtml,
  renderListingsHubHtml
} = require("../src/services/render/hubRenderers");

function findNode(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.childNodes || []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function attribute(node, name) {
  return node?.attrs?.find((item) => item.name === name)?.value || "";
}

function headMeta(head, key, value) {
  const node = findNode(head, (item) =>
    item.tagName === "meta" && attribute(item, key) === value
  );
  return attribute(node, "content");
}

const policy = readFileSync(new URL("../guven-ve-politikalar.html", import.meta.url), "utf8");
assert.match(policy, /yalnızca 18 yaş ve üzeri/i);
assert.match(policy, /Profil bilgileri ilan sahipleri veya yetkili hesapları tarafından sağlanır/i);
assert.match(policy, /bir profil ve ilan dizinidir/i);
assert.match(policy, /bilgileri bağımsız olarak kontrol etmelidir/i);

const rendered = parse(renderHomeHtml([]));
const head = findNode(rendered, (node) => node.tagName === "head");
assert.ok(head, "home head must render");

const description = headMeta(head, "name", "description");
assert.equal(description, DEFAULT_SITE_SETTINGS.home_description);
assert.equal(headMeta(head, "property", "og:description"), description);
assert.equal(headMeta(head, "name", "twitter:description"), description);
assert.match(description, /ilanlarını ilçe ve kategoriye göre inceleyin/i);
assert.doesNotMatch(description, /doğrulanmış|garantili|resm[iî] onaylı/i);

const sampleProfile = {
  id: "seo-copy-test",
  name: "Örnek",
  slug: "ornek",
  city: "İstanbul",
  district: "Şişli",
  images: [],
  is_active: true
};
const publicViews = [
  renderCategoryHtml("dragos-escort", []),
  renderListingsHubHtml([]),
  renderCategoriesHubHtml([]),
  renderContactHtml([]),
  renderProfileDetailHtml(sampleProfile, [])
];
for (const html of publicViews) {
  assert.ok(html, "public view must render");
  assert.doesNotMatch(html, /normal yazım, halk dili, ilan sitesi ve resmi ilan aramalarını/i);
}

try {
  writeFileSync(settingsPath, JSON.stringify({
    home_description: "İstanbul'daki güncel VIP escort profil ilanlarını doğrulanmış konum ve dolu kategori bağlantılarıyla sunar."
  }));
  assert.equal(readSiteSettingsSync().home_description, DEFAULT_SITE_SETTINGS.home_description);
  const migrated = parse(renderHomeHtml([]));
  const migratedHead = findNode(migrated, (node) => node.tagName === "head");
  assert.equal(headMeta(migratedHead, "name", "description"), DEFAULT_SITE_SETTINGS.home_description);
  assert.equal(headMeta(migratedHead, "property", "og:description"), DEFAULT_SITE_SETTINGS.home_description);
  assert.equal(headMeta(migratedHead, "name", "twitter:description"), DEFAULT_SITE_SETTINGS.home_description);

  const customDescription = "İstanbul ilanlarını ilçe ve kategoriye göre karşılaştırın; profil detaylarını inceleyin.";
  writeFileSync(settingsPath, JSON.stringify({ home_description: customDescription }));
  assert.equal(readSiteSettingsSync().home_description, customDescription);
} finally {
  rmSync(settingsPath, { force: true });
}

console.log("site SEO copy aligns with the published platform and profile-information policy");
