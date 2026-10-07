"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const express = require("express");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const { securePublicHtml } = require("../src/services/publicHtmlSecurityService");

process.env.NODE_ENV = "test";
process.env.ENABLE_DEMO_PROFILES = "true";
process.env.VIP_GECE_PRIVATE_PANELS_ENABLED = "true";
process.env.VIP_GECE_PRIVATE_PANEL_HOSTS = "127.0.0.1";
for (const key of ["DATABASE_URL", "SUPABASE_DB_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
  delete process.env[key];
}
const { createApp } = require("../src/app");
const { ROOT_DIR } = require("../src/config/env");

async function main() {
  const app = express();
  const fixture = '<!doctype html><title>CSP negative fixture</title>' +
    '<script defer src="/public/js/deferred-css.js"></script>' +
    '<script>window.untrustedInline=true</script>' +
    '<script src="/untrusted.js"></script>' +
    '<button id="untrusted-handler" onclick="window.untrustedHandler=true">Test</button>' +
    '<base href="https://example.invalid/">';
  app.get("/csp-fixture", (req, res) => {
    const secured = securePublicHtml(fixture);
    res.setHeader("Content-Security-Policy", secured.policy);
    res.type("html").send(secured.html);
  });
  app.get("/untrusted.js", (req, res) => res.type("js").send("window.untrustedExternal=true"));
  app.use(createApp());
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "vip-site-csp-browser-"));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL });
    const context = await browser.newContext({ userAgent: "HeadlessChrome CSP contract", viewport: { width: 1366, height: 900 } });
    await context.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        window.cspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
      });
    });
    const page = await context.newPage();
    await page.goto(`${base}/csp-fixture`);
    await page.locator("#untrusted-handler").click();
    await page.waitForFunction(() => ["script-src-elem", "script-src-attr", "base-uri"]
      .every((directive) => window.cspViolations.some((event) => event.directive === directive)));
    const negative = await page.evaluate(() => ({
      trustedRoot: window.vipGeceTrustedTypesReady,
      inline: Boolean(window.untrustedInline),
      external: Boolean(window.untrustedExternal),
      handler: Boolean(window.untrustedHandler),
      base: document.baseURI,
      violations: window.cspViolations
    }));
    assert.equal(negative.trustedRoot, true);
    assert.equal(negative.inline, false);
    assert.equal(negative.external, false);
    assert.equal(negative.handler, false);
    assert.equal(negative.base, `${base}/csp-fixture`);
    for (const directive of ["script-src-elem", "script-src-attr", "base-uri"]) {
      assert.ok(negative.violations.some((entry) => entry.directive === directive), directive);
    }

    const results = [];
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const profiles = await (await fetch(`${base}/api/v1/public/profiles`)).json();
    const detailPath = `/profil/${profiles.profiles[0].slug}`;
    for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const pathname of ["/", "/istanbul-escort", detailPath]) {
        const scriptsLoaded = [];
        const observe = (response) => {
          if (response.url().includes("/public/js/")) scriptsLoaded.push({ url: new URL(response.url()).pathname, status: response.status() });
        };
        page.on("response", observe);
        const response = await page.goto(`${base}${pathname}`, { waitUntil: "networkidle" });
        const state = await page.evaluate(() => ({
          config: Boolean(window.SITE_CONFIG),
          trustedRoot: Boolean(window.vipGeceTrustedTypesReady),
          violations: window.cspViolations,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1
        }));
        assert.equal(response.status(), 200);
        assert.match(response.headers()["cache-control"], /no-transform/);
        assert.match(response.headers()["cloudflare-cdn-cache-control"], /max-age=600/);
        assert.equal(state.config, false, `${pathname}: SSR must not reintroduce dynamic configuration`);
        assert.equal(state.trustedRoot, true);
        assert.deepEqual(state.violations, []);
        assert.equal(state.overflow, false);
        if (pathname === "/istanbul-escort") {
          assert.ok(scriptsLoaded.some((entry) => entry.url === "/public/js/landing/index.js" && entry.status === 200));
        }
        if (pathname === detailPath) {
          assert.ok(scriptsLoaded.some((entry) => entry.url === "/public/js/detail/index.js" && entry.status === 200));
        }
        await page.screenshot({ path: path.join(output, `${viewport.width}-${pathname.replace(/\W/g, "_") || "home"}.png`) });
        results.push({ pathname, viewport: viewport.width, ...state });
        page.off("response", observe);
      }
    }
    const admin = await fetch(`${base}/vg-panel-91x`);
    assert.equal(admin.status, 200);
    assert.match(admin.headers.get("content-security-policy"), /script-src 'self'/);
    assert.doesNotMatch(admin.headers.get("content-security-policy"), /strict-dynamic/);
    assert.match(admin.headers.get("cache-control"), /no-store/);
    assert.match(admin.headers.get("cache-control"), /no-transform/);
    assert.equal(await admin.text(), await fs.readFile(path.join(ROOT_DIR, "vg-panel-91x.html"), "utf8"));
    const reset = await fetch(`${base}/sifre-yenile`);
    assert.equal(reset.status, 200);
    assert.equal(await reset.text(), await fs.readFile(path.join(ROOT_DIR, "customer-password-reset.html"), "utf8"));
    assert.match(reset.headers.get("cache-control"), /no-store/);
    assert.match(reset.headers.get("cache-control"), /no-transform/);
    await page.goto(`${base}/sifre-yenile`, { waitUntil: "networkidle" });
    assert.equal(await page.locator("#invalid").isVisible(), true);
    assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
    const resetToken = "x".repeat(43);
    let submissions = 0;
    await page.route("**/api/customer/password-reset/start", (route) => {
      assert.equal(route.request().postDataJSON().token, resetToken);
      return route.fulfill({ json: { ok: true, label: "<img src=x onerror=alert(1)>", email_masked: "t***@example.invalid" } });
    });
    await page.route("**/api/customer/password-reset", (route) => {
      assert.equal(route.request().postDataJSON().token, resetToken);
      assert.equal(route.request().postDataJSON().new_password, "contract-password-0001");
      submissions += 1;
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto(`${base}/health`);
    await page.goto(`${base}/sifre-yenile#${resetToken}`, { waitUntil: "networkidle" });
    await page.locator("#form").waitFor({ state: "visible" });
    assert.equal(await page.locator("#who img").count(), 0);
    await page.locator("#newPassword").fill("short");
    await page.locator("#newPasswordAgain").fill("short");
    await page.locator("#submitBtn").click();
    assert.match(await page.locator("#msg").innerText(), /8 karakter/);
    assert.equal(submissions, 0);
    await page.locator("#newPassword").fill("contract-password-0001");
    await page.locator("#newPasswordAgain").fill("different-password");
    await page.locator("#submitBtn").click();
    assert.match(await page.locator("#msg").innerText(), /eşleşmiyor/);
    assert.equal(submissions, 0);
    await page.locator("#newPasswordAgain").fill("contract-password-0001");
    await page.locator("#submitBtn").click();
    await page.locator("#done").waitFor({ state: "visible" });
    assert.equal(submissions, 1);
    assert.equal(await page.evaluate(() => location.hash), "");
    assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
    const firstHome = await fetch(`${base}/`);
    const secondHome = await fetch(`${base}/`);
    assert.equal(firstHome.headers.get("content-security-policy"), secondHome.headers.get("content-security-policy"));
    assert.equal(firstHome.headers.get("etag"), secondHome.headers.get("etag"));
    assert.equal(await firstHome.text(), await secondHome.text());
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ negative, results, errors, adminUnchanged: true, resetMatchesTemplate: true, resetMockedFlowPassed: true }, null, 2));
    console.log(JSON.stringify({ ok: true, pages: results.length, blockedUntrustedScripts: true, output }));
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
