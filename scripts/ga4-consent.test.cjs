"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { publicPage, validConfig, consentAllowed } = require("../public/js/ga4-consent.js");

test("measurement requires an exact own-origin match and a new valid GA4 ID", () => {
  assert.equal(validConfig("G-X8JQG6QHRZ", "https://vip-gece.site", "https://vip-gece.site"), true);
  for (const id of ["G-MGGWKPN1KH", "G-DF04MCZGRF", "G-X8JQG6QHRZ&evil=1", "GT-INVALID"]) {
    assert.equal(validConfig(id, "https://vip-gece.site", "https://vip-gece.site"), false);
  }
  assert.equal(validConfig("G-X8JQG6QHRZ", "https://vip-gece.online", "https://vip-gece.site"), false);
});

function browserFixture(pathname = "/", extra = {}) {
  const elements = [];
  const scripts = [];
  const storage = new Map();
  const cookies = [];
  const element = (tag) => {
    const node = { tag, children: [], hidden: false, addEventListener(name, fn) { this[name] = fn; }, append(...nodes) { this.children.push(...nodes); }, setAttribute() {}, focus() {} };
    elements.push(node);
    return node;
  };
  const location = { origin: "https://vip-gece.site", hostname: "vip-gece.site", pathname, search: "?email=private@example.invalid&token=secret", hash: "#private", reloads: 0, reload() { this.reloads++; } };
  const document = {
    currentScript: { dataset: { ga4Id: "G-X8JQG6QHRZ", ga4Origin: location.origin } },
    createElement: element, body: element("body"), head: { appendChild(node) { scripts.push(node); } },
    get cookie() { return "_ga=old; vg_ga4_ga=old; session=keep"; }, set cookie(value) { cookies.push(value); }
  };
  const context = {
    document, location, navigator: { userAgent: "Mozilla Chrome/153", ...extra }, window: {},
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    Date, Set, Map, Number
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../public/js/ga4-consent.js"), "utf8"), context);
  return { ...context, scripts, elements, cookies };
}

test("no Google request before consent or after rejection; acceptance emits one sanitized page view", () => {
  const f = browserFixture("/profil/private-name");
  const accept = f.elements.find(e => e.textContent === "\u0130zin ver");
  const reject = f.elements.find(e => e.textContent === "Reddet");
  assert.equal(f.scripts.length, 0);
  assert.equal(f.window.dataLayer, undefined);
  reject.click();
  assert.equal(f.scripts.length, 0);
  accept.click();
  accept.click();
  assert.equal(f.scripts.length, 1);
  assert.equal(f.scripts[0].src, "https://www.googletagmanager.com/gtag/js?id=G-X8JQG6QHRZ");
  const queue = f.window.dataLayer.map(args => Array.from(args));
  const views = queue.filter(args => args[0] === "event" && args[1] === "page_view");
  assert.equal(views.length, 1);
  assert.equal(views[0][2].page_location, "https://vip-gece.site/profil/");
  assert.equal(views[0][2].page_referrer, "");
  assert.doesNotMatch(JSON.stringify(queue), /private-name|private@example|token=|secret|9017|8509/);
  const config = queue.find(args => args[0] === "config")[2];
  assert.equal(config.send_page_view, false);
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
  reject.click();
  assert.equal(f.window["ga-disable-G-X8JQG6QHRZ"], true);
  assert.equal(f.location.reloads, 1);
  assert.ok(f.cookies.every(c => !c.startsWith("session=")));
});

test("bots, private pages, global privacy control and DNT cannot start a Google tag", () => {
  for (const [path, extra] of [["/nr-ops-91x", {}], ["/", { userAgent: "Googlebot" }], ["/", { globalPrivacyControl: true }], ["/", { doNotTrack: "1" }]]) {
    const f = browserFixture(path, extra);
    f.elements.find(e => e.textContent === "\u0130zin ver")?.click();
    assert.equal(f.scripts.length, 0);
    assert.equal(f.window.dataLayer, undefined);
  }
});

test("private, recovery and unknown paths cannot be measured", () => {
  for (const path of ["/nr-ops-91x", "/vg-panel-91x", "/m-panel/token", "/musteri", "/sifre-yenile", "/api/admin", "/unknown-secret"]) {
    assert.equal(publicPage(path), null, path);
  }
});

test("profile identifiers, contact numbers and query tokens are excluded", () => {
  assert.deepEqual(publicPage("/profil/example-private-name"), { path: "/profil/", title: "Profil" });
  assert.equal(publicPage("/istanbul-escort").path, "/istanbul-escort");
  assert.equal(publicPage("/" ).path, "/");
  assert.equal(publicPage("/detay.html").path, "/profil/");
});

test("consent must be affirmative, fresh and compatible with privacy signals", () => {
  const now = Date.now();
  const yes = { version: 1, choice: "accepted", at: now };
  assert.equal(consentAllowed(yes, now, false), true);
  assert.equal(consentAllowed(yes, now, true), false);
  assert.equal(consentAllowed({ ...yes, choice: "rejected" }, now, false), false);
  assert.equal(consentAllowed({ ...yes, at: now - 181 * 86400000 }, now, false), false);
  assert.equal(consentAllowed({ ...yes, at: now + 1000 }, now, false), false);
  assert.equal(consentAllowed(null, now, false), false);
});

test("server only trusts the configured analytics root, never an injected destination", () => {
  const previous = { id: process.env.GA4_MEASUREMENT_ID, origin: process.env.GA4_PUBLIC_ORIGIN };
  process.env.GA4_MEASUREMENT_ID = "G-X8JQG6QHRZ";
  process.env.GA4_PUBLIC_ORIGIN = "https://vip-gece.site";
  try {
    const { appendGa4 } = require("../src/services/ga4PublicService");
    const { securePublicHtml } = require("../src/services/publicHtmlSecurityService");
    const approved = securePublicHtml(appendGa4("<html><body>Keep page</body></html>"));
    assert.match(approved.html, /data-ga4-id="G-X8JQG6QHRZ"/);
    assert.match(approved.html, /ga4-consent\.js\?v=[a-f0-9]{24}" integrity="sha384-/);
    assert.match(approved.policy, /script-src 'strict-dynamic'/);
    assert.doesNotMatch(approved.policy, /script-src[^;]*unsafe-/);
    for (const attrs of ['data-ga4-id="G-AAAAAAAAAA" data-ga4-origin="https://vip-gece.site"', 'data-ga4-id="G-X8JQG6QHRZ" data-ga4-origin="https://other.invalid"']) {
      const injected = securePublicHtml(`<script src="/public/js/ga4-consent.js" ${attrs}></script>`);
      assert.match(injected.policy, /script-src 'none'/);
    }
  } finally {
    for (const [key, value] of [["GA4_MEASUREMENT_ID", previous.id], ["GA4_PUBLIC_ORIGIN", previous.origin]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
