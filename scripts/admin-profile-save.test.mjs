import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import vm from "node:vm";

const profiles = ["a", "b"].map(id => ({ id, name: `Fixture ${id}`, slug: `fixture-${id}`, images: [`/media/${id}.jpg`], is_active: true }));
const file = (type = "image/jpeg", size = 100) => ({ name: "fixture", type, size });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function harness(respond = () => ({ image_url: "/media/upload.jpg" })) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      let value = "";
      const el = { id, files: [], children: [], options: [], disabled: false, checked: false, dataset: {},
        classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {},
        appendChild(child) { this.children.push(child); this.options.push(child); },
        addEventListener() {}, querySelectorAll() { return [...elements.values()].filter(item => item !== this); }
      };
      Object.defineProperty(el, "value", { get: () => value, set: next => { value = next; if (id === "imageFiles" && next === "") el.files = []; } });
      elements.set(id, el);
    }
    return elements.get(id);
  };
  const calls = [];
  const document = { documentElement: { dataset: { adminRole: "full_admin" } },
    getElementById: element, createElement: () => element(randomUUID()), dispatchEvent() {}
  };
  let accountsLoaded = true;
  const context = vm.createContext({ document, URL, crypto: { randomUUID }, Event,
    window: { SITE_CONFIG: { supabaseUrl: "https://fixture.invalid", supabaseAnonKey: "fixture-public",
    }, supabase: { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "fixture-only" } } }) } }) } },
    scrollTo() {}, confirm: () => true, console: { error() {} },
    fetch: async (url, options = {}) => {
      calls.push({ url, ...options });
      const payload = url === "/api/v1/admin/profiles" && !options.method ? { profiles } : await respond(url, options, calls);
      return { ok: true, text: async () => JSON.stringify(payload ?? {}) };
    }
  });
  const shared = new vm.SourceTextModule(await readFile(new URL("../public/js/admin/shared.js", import.meta.url), "utf8"), { context });
  await shared.link(() => { throw new Error("unexpected dependency"); });
  await shared.evaluate();
  shared.namespace.setAllProfiles(profiles);
  const customers = new vm.SyntheticModule(["areCustomerAccountsLoaded", "getCustomerAccountLabel"], function () {
    this.setExport("areCustomerAccountsLoaded", () => accountsLoaded);
    this.setExport("getCustomerAccountLabel", () => "");
  }, { context });
  const module = new vm.SourceTextModule(await readFile(new URL("../public/js/admin/profiles.js", import.meta.url), "utf8"), { context });
  await module.link(specifier => specifier.includes("shared.js") ? shared : customers);
  await module.evaluate();
  element("durationInfo").disabled = true;
  module.namespace.editProfile("a");
  return { api: module.namespace, element, calls, setAccountsLoaded(value) { accountsLoaded = value; } };
}

test("switching profiles clears pending files, including when reopening the same profile", async () => {
  const h = await harness();
  h.element("imageFiles").files = [file()];
  h.api.editProfile("b");
  assert.equal(h.element("imageFiles").files.length, 0);
  await h.api.saveProfile();
  assert.equal(h.calls.filter(c => c.url.includes("profile-images")).length, 0);
  const write = h.calls.find(c => c.method === "PUT");
  assert.deepEqual(JSON.parse(write.body).images, ["/media/b.jpg"]);
});

test("upload failure is handled, leaves the form intact, and restores disabled states", async () => {
  const h = await harness(() => { throw new Error("fixture network failure"); });
  h.element("imageFiles").files = [file()];
  await h.api.saveProfile();
  assert.match(h.element("panelStatus").textContent, /fixture network failure/);
  assert.equal(h.element("panelStatus").className, "status err");
  assert.equal(h.element("imageFiles").files.length, 1);
  assert.equal(h.element("editId").value, "a");
  assert.equal(h.element("saveProfileBtn").disabled, false);
  assert.equal(h.element("durationInfo").disabled, true);
  assert.equal(h.calls.filter(c => c.method === "PUT").length, 0);
});

test("unsupported, empty and oversized files fail before any upload or profile write", async () => {
  for (const bad of [file("image/gif"), file(""), file("image/jpeg", 0), file("image/png", 8 * 1024 * 1024 + 1)]) {
    const h = await harness();
    h.element("imageFiles").files = [file(), bad];
    await h.api.saveProfile();
    assert.equal(h.calls.length, 0);
    assert.equal(h.element("panelStatus").className, "status err");
  }
});

test("double save is serialized and profile switching/cancelling is blocked while saving", async () => {
  const gate = deferred();
  const h = await harness(async url => { if (url.includes("profile-images")) { await gate.promise; return { image_url: "/media/upload.jpg" }; } });
  h.element("imageFiles").files = [file()];
  const first = h.api.saveProfile();
  const second = h.api.saveProfile();
  assert.equal(h.element("saveProfileBtn").disabled, true);
  h.api.editProfile("b");
  h.api.clearProfileForm();
  assert.equal(h.element("editId").value, "a");
  gate.resolve();
  await first; await second;
  assert.equal(h.calls.filter(c => c.url.includes("profile-images")).length, 1);
  assert.equal(h.calls.filter(c => c.method === "PUT").length, 1);
  assert.equal(JSON.parse(h.calls.find(c => c.method === "PUT").body).name, "Fixture a");
  assert.equal(h.element("saveProfileBtn").disabled, false);
  assert.equal(h.element("editId").value, "");
});

test("failed saves reuse successful uploads and stable upload IDs on retry", async () => {
  let failWrite = true;
  const h = await harness((url, options) => {
    if (options.method === "PUT" && failWrite) throw new Error("fixture write failure");
    if (url.includes("profile-images")) return { image_url: "/media/upload.jpg" };
  });
  h.element("imageFiles").files = [file()];
  await h.api.saveProfile();
  failWrite = false;
  await h.api.saveProfile();
  const uploads = h.calls.filter(c => c.url.includes("profile-images"));
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].headers["x-upload-id"], /^[a-f0-9-]{36}$/);
  assert.deepEqual(JSON.parse(h.calls.filter(c => c.method === "PUT").at(-1).body).images, ["/media/a.jpg", "/media/upload.jpg"]);
});

test("missing image URL is an upload failure, not a successful save", async () => {
  const h = await harness(() => ({}));
  h.element("imageFiles").files = [file()];
  await h.api.saveProfile();
  assert.equal(h.element("panelStatus").className, "status err");
  assert.equal(h.calls.filter(c => c.method === "PUT").length, 0);
});

test("unknown account state and blank names cannot upload files", async () => {
  const h = await harness();
  h.element("imageFiles").files = [file()];
  h.setAccountsLoaded(false);
  await h.api.saveProfile();
  h.setAccountsLoaded(true);
  h.element("name").value = "";
  await h.api.saveProfile();
  assert.equal(h.calls.length, 0);
});

test("all admin consumers share a single version of the customer-account module", async () => {
  for (const file of ["index.js", "profiles.js", "analytics.js"]) {
    const source = await readFile(new URL(`../public/js/admin/${file}`, import.meta.url), "utf8");
    assert.deepEqual([...source.matchAll(/\.\/customers\.js\?v=([^"']+)/g)].map(match => match[1]), ["20261011-save-safety1"]);
  }
});
