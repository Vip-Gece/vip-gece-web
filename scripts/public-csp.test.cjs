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

test("private HTML opts out of edge modification without changing API cache policy", () => {
  const { setNoStore, setPrivateHtmlCache } = require("../src/utils/cacheHeaders");
  const headers = new Map([
    ["CDN-Cache-Control", "public, max-age=600"],
    ["Cloudflare-CDN-Cache-Control", "public, max-age=600"]
  ]);
  const res = {
    setHeader: (name, value) => headers.set(name, value),
    removeHeader: (name) => headers.delete(name)
  };
  setPrivateHtmlCache(res);
  assert.match(headers.get("Cache-Control"), /no-store/);
  assert.match(headers.get("Cache-Control"), /private/);
  assert.match(headers.get("Cache-Control"), /no-transform/);
  assert.equal(headers.get("Pragma"), "no-cache");
  assert.equal(headers.has("CDN-Cache-Control"), false);
  assert.equal(headers.has("Cloudflare-CDN-Cache-Control"), false);
  setPrivateHtmlCache(res);
  assert.equal(headers.get("Cache-Control").split("no-transform").length, 2);
  setNoStore(res);
  assert.doesNotMatch(headers.get("Cache-Control"), /no-transform/);
});

test("customer HTML remains unchanged and invalid access still fails closed", async () => {
  const express = require("express");
  const service = require("../src/services/customerAccessService");
  const originalLookup = service.findCustomerAccessByToken;
  service.findCustomerAccessByToken = async (token) => token === "cache-contract-valid" ? { id: "fixture" } : null;
  let createCustomerAccessRouter;
  try {
    ({ createCustomerAccessRouter } = require("../src/routes/customerAccessRoutes"));
  } finally {
    service.findCustomerAccessByToken = originalLookup;
  }
  const app = express();
  app.use(createCustomerAccessRouter());
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [pathname, file] of [
      ["/m-panel/cache-contract-valid", "customer-panel.html"],
      ["/sifre-yenile", "customer-password-reset.html"]
    ]) {
      const response = await fetch(`${base}${pathname}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("cache-control"), /no-store/);
      assert.match(response.headers.get("cache-control"), /no-transform/);
      assert.equal(response.headers.get("cdn-cache-control"), null);
      assert.equal(await response.text(), fs.readFileSync(path.join(__dirname, "..", file), "utf8"));
    }
    const denied = await fetch(`${base}/m-panel/cache-contract-invalid`);
    assert.equal(denied.status, 404);
    assert.match(denied.headers.get("cache-control"), /no-store/);
    assert.doesNotMatch(denied.headers.get("cache-control"), /no-transform/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  const nginx = fs.readFileSync(path.join(__dirname, "../ops/hetzner/nginx-vip-gece.conf"), "utf8");
  const panelStart = nginx.indexOf("server_name panel.vip-gece.site;");
  assert.match(nginx.slice(0, panelStart), /add_header Cache-Control "private, no-store, max-age=0" always;/);
  assert.match(nginx.slice(panelStart),
    /add_header Cache-Control "private, no-store, max-age=0, no-transform" always;/);
});
