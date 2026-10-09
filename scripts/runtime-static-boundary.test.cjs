"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { allowOnlyRuntimeStatic, blockPrivateArtifacts } = require("../src/middleware/security");

function inspect(originalUrl, method = "GET") {
  const result = { allowed: false, status: null };
  const response = {
    status(code) { result.status = code; return this; },
    send() { return this; }
  };
  const request = { method, originalUrl, url: originalUrl };
  blockPrivateArtifacts(request, response, () => {
    allowOnlyRuntimeStatic(request, response, () => { result.allowed = true; });
  });
  return result;
}

test("known public HTML aliases reach canonical redirects despite case or trailing slashes", () => {
  for (const method of ["GET", "HEAD"]) {
    for (const path of ["/INDEX.HTML/", "/index.html/", "/ILANLAR.HTML/", "/ILETISIM.HTML/?utm_source=test", "/BOLGE.HTML/", "/KATEGORI-LANDING.HTML/"]) {
      assert.deepEqual(inspect(path, method), { allowed: true, status: null }, path);
    }
    assert.deepEqual(inspect("/GUVEN-VE-POLITIKALAR.HTML/", method), { allowed: true, status: null });
  }
});

test("public HTML alias canonicalization works through the complete HTTP middleware stack", async () => {
  const { createApp } = require("../src/app");
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const method of ["GET", "HEAD"]) {
      for (const [requestPath, target] of [
        ["/INDEX.HTML/", "/"],
        ["/INDEX.HTML/?utm_source=regression", "/?utm_source=regression"],
        ["/ILANLAR.HTML/", "/ilanlar"],
        ["/GUVEN-VE-POLITIKALAR.HTML/", "/guven-ve-politikalar"]
      ]) {
        const response = await fetch(base + requestPath, { method, redirect: "manual" });
        assert.equal(response.status, 301, requestPath);
        const location = new URL(response.headers.get("location"), base);
        assert.equal(location.pathname + location.search, target, requestPath);
        await response.arrayBuffer();
      }
    }
    for (const requestPath of ["/UNKNOWN.HTML/", "/customer-panel.html/", "/VG-PANEL-91X.HTML/", "/.ENV", "/INDEX.HTML.BAK/"]) {
      const response = await fetch(base + requestPath, { redirect: "manual" });
      assert.equal(response.status, 404, requestPath);
      await response.arrayBuffer();
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("normalizing legacy HTML aliases does not expose arbitrary or private files", () => {
  for (const path of ["/UNKNOWN.HTML/", "/customer-panel.html/", "/VG-PANEL-91X.HTML/", "/SRC/APP.JS/", "/.git/config", "/.ENV", "/PACKAGE.JSON/", "/INDEX.HTML.BAK/"]) {
    const result = inspect(path);
    assert.equal(result.allowed, false, path);
    assert.equal(result.status, 404, path);
  }
});
