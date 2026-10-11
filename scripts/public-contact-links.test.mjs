import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { parse } from "parse5";

const contactIds = ["phoneBtn", "whatsappBtn", "telegramBtn"];

function elements(html, tagName) {
  const found = [];
  function visit(node) {
    if (node.tagName === tagName) {
      found.push(Object.fromEntries(node.attrs.map(({ name, value }) => [name, value])));
    }
    for (const child of node.childNodes || []) visit(child);
  }
  visit(parse(html));
  return found;
}

function checkContacts(html) {
  const anchors = elements(html, "a");
  for (const anchor of anchors) {
    const rel = (anchor.rel || "").toLowerCase().split(/\s+/);
    assert.ok(!rel.includes("nofollow"), "public profile links must remain without nofollow");
  }
  for (const id of contactIds) {
    const matches = anchors.filter((anchor) => anchor.id === id);
    assert.equal(matches.length, 1, `${id} remains a single contact action`);
    const anchor = matches[0];
    const rel = new Set((anchor.rel || "").toLowerCase().split(/\s+/).filter(Boolean));
    assert.ok(!rel.has("nofollow"), `${id} must not qualify public contact links as nofollow`);
    if (anchor.target === "_blank") {
      assert.ok(rel.has("noopener"), `${id} must isolate its new browsing context`);
    }
  }
  return anchors;
}

test("the public template has followable contact links and safe new tabs", async () => {
  checkContacts(await readFile(new URL("../detay.html", import.meta.url), "utf8"));
});

test("public page and shared-component templates never reintroduce nofollow links", async () => {
  const privateFiles = new Set(["vg-panel-91x.html", "customer-panel.html", "customer-password-reset.html"]);
  for (const directory of [new URL("../", import.meta.url), new URL("../public/components/", import.meta.url)]) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".html") || privateFiles.has(entry.name)) continue;
      const html = await readFile(new URL(entry.name, directory), "utf8");
      for (const anchor of elements(html, "a")) {
        const rel = (anchor.rel || "").toLowerCase().split(/\s+/);
        assert.ok(!rel.includes("nofollow"), `${entry.name} must not reintroduce public nofollow links`);
      }
    }
  }
});

test("server rendering preserves contact URLs and profile records without nofollow", () => {
  const require = createRequire(import.meta.url);
  const { renderProfileDetailHtml } = require("../src/services/render/detailRenderer");
  const profile = {
    id: "contact-fixture",
    slug: "contact-fixture",
    name: "Contact fixture",
    city: "Istanbul",
    district: "Istanbul Geneli",
    is_active: true,
    whatsapp: "12025550123",
    images: []
  };
  const before = JSON.stringify(profile);
  const anchors = checkContacts(renderProfileDetailHtml(profile, [profile]));
  const whatsapp = anchors.find((anchor) => anchor.id === "whatsappBtn");
  const href = new URL(whatsapp.href);
  assert.equal(href.origin, "https://wa.me");
  assert.equal(href.pathname, `/${profile.whatsapp}`);
  assert.ok(href.searchParams.get("text").includes(profile.name));
  assert.equal(whatsapp["data-ssr-contact"], "true");
  assert.equal(JSON.stringify(profile), before);
});

test("private panels retain their independent indexing protections", async () => {
  for (const file of ["vg-panel-91x.html", "customer-panel.html", "customer-password-reset.html"]) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const robots = elements(html, "meta").find((meta) => meta.name === "robots");
    const directives = new Set(robots.content.toLowerCase().split(/\s*,\s*/));
    assert.ok(directives.has("noindex"), `${file} must remain non-indexable`);
    assert.ok(directives.has("nofollow"), `${file} must retain its private crawl rule`);
  }
});
