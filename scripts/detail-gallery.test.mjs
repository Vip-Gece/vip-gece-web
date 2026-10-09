import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const origin = "https://vip-gece.site";
const fixture = {
  id: "gallery-fixture",
  slug: "gallery-fixture",
  name: "Gallery fixture",
  city: "Istanbul",
  district: "Istanbul Geneli",
  is_active: true,
  description: "Fixture description",
  images: [
    `${origin}/media/customer-profile/gallery/first.jpg`,
    "/media/customer-profile/gallery/second.jpg",
    "/media/profile-image/fixture.signature?width=1600&quality=80&resize=cover"
  ]
};

class Element {
  children = [];
  dataset = {};
  attributes = new Map();
  handlers = new Map();
  scrolls = 0;
  classList = { toggle() {}, add() {}, remove() {} };
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  removeAttribute(name) { this.attributes.delete(name); delete this[name]; }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, handler) { this.handlers.set(name, handler); }
  scrollIntoView() { this.scrolls++; }
  focus() { this.focused = true; }
}

async function loadGallery() {
  const main = new Element();
  const thumbs = new Element();
  const document = {
    createElement: () => new Element(),
    getElementById: (id) => ({ detailMainImage: main, detailThumbs: thumbs }[id] || null),
    querySelectorAll: () => thumbs.children
  };
  const context = vm.createContext({ document, URL, window: { location: { origin } } });
  const modules = new Map();
  async function load(file) {
    if (modules.has(file)) return modules.get(file);
    const module = new vm.SourceTextModule(await readFile(new URL(`../public/js/detail/${file}`, import.meta.url), "utf8"), { context });
    modules.set(file, module);
    await module.link(async (specifier) => {
      if (specifier.startsWith("./utils.js?")) return load("utils.js");
      const exports = specifier.includes("metadata.js")
        ? { categoryRows: () => [], getNearbyDistricts: () => [] }
        : {
          buildQuickCategoryLinks: () => [],
          cSlug: (value) => String(value || "").toLowerCase().replace(/\s+/g, "-"),
          clean: (value) => String(value ?? "").trim(),
          profileDistrictName: (profile) => profile.district,
          sortProfiles: (profiles) => profiles
        };
      return new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      }, { context });
    });
    return module;
  }
  const view = await load("view.js");
  await view.evaluate();
  return { main, thumbs, view: view.namespace, utils: modules.get("utils.js").namespace };
}

test("only owned profile routes receive supported image variants", async () => {
  const { utils } = await loadGallery();
  for (const source of fixture.images.slice(0, 2)) {
    const url = new URL(utils.optimizedImageUrl(source, { width: 240, quality: 68 }), origin);
    assert.equal(url.search, "?width=240&quality=68");
    assert.equal(url.origin, origin);
    assert.equal(utils.optimizedImageSrcset(source).split(", ").length, 4);
  }
  assert.equal(utils.optimizedImageUrl(fixture.images[2], { width: 240, quality: 68 }), "/media/profile-image/fixture.signature?width=240&quality=68&resize=contain");
  const customer = fixture.images[0] + "?resize=cover&obsolete=yes#old";
  assert.equal(new URL(utils.optimizedImageUrl(customer, { width: 999, quality: 99 }), origin).search, "?width=960&quality=76");
  for (const source of ["https://foreign.example/media/customer-profile/one.jpg", "//foreign.example/media/profile-image/fixture.signature", "/logo.png.webp?v=keep", "//"]) {
    assert.equal(utils.optimizedImageUrl(source), source);
    assert.equal(utils.optimizedImageSrcset(source), "");
  }
  assert.equal(utils.optimizedImageUrl("javascript:alert(1)"), "");
  assert.equal(utils.optimizedImageSrcset(""), "");
});

test("hydration keeps thumbnails small and main images responsive without moving the viewport", async () => {
  const { main, thumbs, view } = await loadGallery();
  const before = JSON.stringify(fixture);
  view.renderPrimaryDetail(fixture);
  assert.equal(thumbs.children.length, fixture.images.length);
  for (const button of thumbs.children) {
    const image = button.children[0];
    const url = new URL(image.src, origin);
    assert.equal(url.searchParams.get("width"), "240");
    assert.equal(url.searchParams.get("quality"), "68");
    assert.equal(image.width, 240);
    assert.equal(image.height, 300);
    assert.equal(button.scrolls, 0);
  }
  assert.match(main.src, /first\.jpg\?width=960&quality=76$/);
  assert.match(main.srcset, /first\.jpg\?width=360&quality=76 360w/);
  assert.match(main.sizes, /900px/);
  assert.equal(main.fetchPriority, "high");
  thumbs.children[1].handlers.get("click")();
  assert.match(main.src, /second\.jpg\?width=960&quality=76$/);
  assert.match(main.srcset, /second\.jpg\?width=480&quality=76 480w/);
  assert.equal(thumbs.children[1].getAttribute("aria-pressed"), "true");
  assert.equal(thumbs.children[0].getAttribute("aria-pressed"), "false");
  let prevented = false;
  thumbs.children[1].handlers.get("keydown")({ key: "End", preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.ok(thumbs.children[2].focused);
  assert.match(main.src, /fixture\.signature\?width=960&quality=76&resize=contain$/);
  assert.equal(JSON.stringify(fixture), before, "profile records and originals are unchanged");
  view.renderPrimaryDetail({ ...fixture, images: ["/logo.png.webp"] });
  assert.equal(main.src, "/logo.png.webp");
  assert.equal(main.srcset, undefined);
  assert.equal(main.sizes, undefined);
});

test("server and client agree on the first main-image candidates and thumbnail variants", async () => {
  const require = createRequire(import.meta.url);
  const { SITE_URL } = require("../src/config/env");
  const { renderProfileDetailHtml } = require("../src/services/render/detailRenderer");
  const { parse } = require("parse5");
  const profile = { ...fixture, images: fixture.images.map((source) => source.replace(origin, SITE_URL)) };
  const nodes = [];
  const visit = (node) => { if (node.tagName === "img") nodes.push(node); for (const child of node.childNodes || []) visit(child); };
  visit(parse(renderProfileDetailHtml(profile, [profile])));
  const attrs = (node) => Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
  const main = nodes.map(attrs).find((node) => node.id === "detailMainImage");
  assert.equal(main.fetchpriority, "high");
  assert.equal(main.width, "960");
  assert.equal(main.srcset.split(", ").length, 4);
  assert.match(main.srcset, /first\.jpg\?width=360&quality=76 360w/);
  for (const thumb of nodes.map(attrs).filter((node) => node.class === "detail-thumb")) {
    assert.equal(new URL(thumb.src, origin).searchParams.get("width"), "240");
    assert.equal(new URL(thumb.src, origin).searchParams.get("quality"), "68");
  }
  const client = await loadGallery();
  client.view.renderPrimaryDetail(fixture);
  assert.equal(client.main.srcset, main.srcset);
  assert.equal(client.main.sizes, main.sizes);
});

test("the entry point and changed descendants have fresh cache versions", async () => {
  for (const file of ["detail-final.js", "detail/index.js", "detail/view.js"]) {
    const code = await readFile(new URL(`../public/js/${file}`, import.meta.url), "utf8");
    assert.match(code, /20261009-gallery1/);
    assert.doesNotMatch(code, /(?:detail\/index|\.\/utils|\.\/view)\.js\?v=202607/);
  }
});
