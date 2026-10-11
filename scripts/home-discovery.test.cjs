const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { parse } = require('parse5');
const { renderHomeHtml } = require('../src/services/render/homeRenderer');
const { renderProfileDetailHtml } = require('../src/services/render/detailRenderer');

function nodes(html, predicate) {
  const found = [];
  function visit(node) {
    if (predicate(node)) found.push(node);
    for (const child of node.childNodes || []) visit(child);
  }
  visit(parse(html));
  return found;
}
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
const profiles = Array.from({ length: 16 }, (_, index) => ({
  id: `discovery-${index}`, slug: `discovery-${index}`, name: `Profile ${index}`,
  city: 'Istanbul', district: 'Istanbul Geneli', is_active: true, type: 'vip',
  vip_slot: index + 1, images: index % 2 ? ['/logo.png.webp'] : [], age: 25,
  description: 'A short profile description.'
}));

test('all SSR profile cards remain discoverable without a script-driven reveal', () => {
  const original = JSON.stringify(profiles);
  const html = renderHomeHtml(profiles);
  const cards = nodes(html, n => n.tagName === 'a' && attr(n, 'class') === 'selected-card');
  assert.equal(cards.length, profiles.length);
  assert.deepEqual(cards.map(n => attr(n, 'href')).sort(), profiles.map(p => `/profil/${p.slug}`).sort());
  assert.doesNotMatch(html, /content-visibility\s*:\s*hidden/);
  assert.match(html, /content-visibility\s*:\s*auto/);
  assert.equal(JSON.stringify(profiles), original);
});

test('SSR-only CSS does not bundle absent legacy hero panels', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/css/home-render.min.css'), 'utf8');
  assert.doesNotMatch(css, /\.hero-brand-(?:plate|fallback|caption)/);
  for (const selector of ['.selected-card', '.selected-image-wrap', '.story-fallback', '.mobile-nav']) {
    assert.ok(css.includes(selector), `CSS preserves ${selector}, including missing-image states`);
  }
});

test('short descriptions get a policy explanation without modifying stored profile data', () => {
  const profile = profiles[0];
  const before = JSON.stringify(profile);
  const html = renderProfileDetailHtml(profile, profiles);
  assert.match(html, /data-short-profile-policy/);
  assert.match(html, /href="\/guven-ve-politikalar"/);
  assert.equal(JSON.stringify(profile), before);
  const longer = { ...profile, description: Array(40).fill('Description').join(' ') };
  assert.doesNotMatch(renderProfileDetailHtml(longer, profiles), /data-short-profile-policy/);
});
