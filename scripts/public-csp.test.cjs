"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("parse5");
const { securePublicHtml, scriptIntegrity } = require("../src/services/publicHtmlSecurityService");
const { buildStrictPublicCsp } = require("../src/middleware/security");

function scripts(html) {
  const nodes = [];
  function visit(node) {
    if (node.tagName === "script") nodes.push(node);
    for (const child of node.childNodes || []) visit(child);
  }
  visit(parse(html));
  return nodes;
}

test("fixed external roots have matching SRI, content versions and a strict policy", () => {
  const roots = ["deferred-css", "components-loader", "category-final", "detail-final", "home-render"];
  for (const name of roots) {
    const source = fs.readFileSync(path.join(__dirname, `../public/js/${name}.js`));
    const result = securePublicHtml(`<script defer src="/public/js/${name}.js?v=old" onload="evil()"></script>`);
    const attributes = Object.fromEntries(scripts(result.html)[0].attrs.map(({ name, value }) => [name, value]));
    assert.equal(attributes.integrity, scriptIntegrity(source));
    assert.match(attributes.src, new RegExp(`^/public/js/${name}\\.js\\?v=[a-f0-9]{24}$`));
    assert.equal(attributes.crossorigin, "anonymous");
    assert.equal(attributes.defer, "");
    assert.equal(attributes.onload, undefined);
    assert.ok(result.policy.includes(`'${attributes.integrity}'`));
    assert.match(result.policy, /script-src 'strict-dynamic'/);
    assert.match(result.policy, /base-uri 'none'/);
    assert.match(result.policy, /script-src-attr 'none'/);
    assert.doesNotMatch(result.policy, /script-src[^;]*(?:'self'|https:|'unsafe-inline'|'unsafe-eval')/);
    assert.match(result.policy, /require-trusted-types-for 'script'/);
  }
});

test("dynamic configuration is not implicitly trusted on server-rendered public pages", () => {
  const html = '<script src="/config.js?v=old"></script>';
  const result = securePublicHtml(html);
  assert.equal(result.html, html);
  assert.match(result.policy, /script-src 'none'/);
});

test("unknown inline, external, relative, protocol-relative and SVG scripts never receive trust", () => {
  for (const html of [
    '<script>window.evil=true</script>',
    '<script src="/unknown.js"></script>',
    '<script src="https://example.invalid/public/js/deferred-css.js"></script>',
    '<script src="//example.invalid/public/js/deferred-css.js"></script>',
    '<script src="public/js/deferred-css.js"></script>',
    '<script src="/public/js/../js/deferred-css.js"></script>',
    '<script src="/public/js/deferred-css.js#fragment"></script>',
    '<svg><script href="/public/js/deferred-css.js"></script></svg>'
  ]) {
    const result = securePublicHtml(html);
    assert.equal(result.html, html);
    assert.match(result.policy, /script-src 'none'/);
    assert.doesNotMatch(result.policy, /sha384-/);
  }
});

test("comments, template contents and JSON-LD remain data, not trusted executable roots", () => {
  const html = '<!-- <script src="/public/js/deferred-css.js"></script> -->' +
    '<template><script src="/public/js/deferred-css.js"></script></template>' +
    '<script type="application/ld+json">{"name":"fixture"}</script>';
  const result = securePublicHtml(html);
  assert.equal(result.html, html);
  assert.match(result.policy, /script-src 'none'/);
});

test("module graphs use a trusted fixed loader; non-script bytes and cached output are preserved", () => {
  const html = '<!doctype html><title>Fixture</title><main data-id="92">Keep content</main>' +
    '<script type="module" src="/public/js/detail-final.js?v=old"></script>';
  const first = securePublicHtml(html);
  assert.deepEqual(securePublicHtml(html), first);
  assert.ok(first.html.startsWith(html.slice(0, html.indexOf("<script"))));
  assert.match(first.html, /<script defer data-public-module="detail"/);
  assert.match(first.html, /src="\/public\/js\/public-modules.js\?v=[a-f0-9]{24}"/);
  const loaderHash = scriptIntegrity(fs.readFileSync(path.join(__dirname, "../public/js/public-modules.js")));
  assert.ok(first.policy.includes(`'${loaderHash}'`));
  assert.notEqual(scriptIntegrity("version-one"), scriptIntegrity("version-two"));
});

test("policy builder rejects unvalidated directives and duplicate hashes", () => {
  const hash = scriptIntegrity("fixture");
  const policy = buildStrictPublicCsp([hash, hash]);
  assert.equal(policy.split(hash).length, 2);
  assert.throws(() => buildStrictPublicCsp(["sha384-invalid; script-src *"]));
});
