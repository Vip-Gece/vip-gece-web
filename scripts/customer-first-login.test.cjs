"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
let dir, server, base;
const saved = { ...process.env };
const svc = require("../src/services/customerMobileAccountService");
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "vip-password-test-"));
  process.env.NODE_ENV = "test";
  process.env.CUSTOMER_ACCOUNT_STORE_BACKEND = "json";
  process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH = path.join(dir, "accounts.json");
  process.env.CUSTOMER_MOBILE_SESSION_SECRET = crypto.randomBytes(48).toString("hex");
  process.env.CUSTOMER_MOBILE_ENABLED = "true";
  const app = express(); app.use(express.json());
  app.use(require("../src/routes/customerMobileRoutes").createCustomerMobileRouter());
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = "http://127.0.0.1:" + server.address().port + "/api/customer/mobile";
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});
async function account() {
  const email = crypto.randomUUID() + "@example.invalid";
  const password = crypto.randomBytes(24).toString("base64url");
  const created = await svc.upsertCustomerMobileAccount("", { email, password });
  const login = await svc.authenticateCustomerMobile(email, password);
  return { email, password, created, login, auth: "Bearer " + login.session.token };
}
const protectedRoutes = [
  ["/bootstrap", "GET"],
  ["/analytics/daily", "GET"],
  ["/profiles/1/analytics", "GET"],
  ["/profiles/1", "GET"],
  ["/profiles/1/preview", "GET"],
  ["/profiles", "POST"],
  ["/profiles/1", "PUT"],
  ["/profiles/1/images/0", "GET"],
  ["/profiles/1/images", "POST"],
  ["/profiles/1/images", "DELETE"],
  ["/support/sessions", "POST"],
  ["/support/sessions/1", "GET"],
  ["/support/sessions/1/snapshot", "POST"],
  ["/support/sessions/1", "DELETE"]
];
test("first login cannot read profiles or mutate them before mandatory password change", async () => {
  const a = await account();
  assert.equal(a.created.must_change_password, true);
  for (const [route, method] of protectedRoutes) {
    const res = await fetch(base + route, { method, headers: { authorization: a.auth } });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "PASSWORD_CHANGE_REQUIRED");
    assert.match(res.headers.get("cache-control"), /no-store/);
  }
});

test("all protected customer routes require a session before touching data", async () => {
  for (const [route, method] of protectedRoutes) {
    const response = await fetch(base + route, { method });
    assert.equal(response.status, 401, `${method} ${route}`);
    assert.match(response.headers.get("cache-control"), /no-store/);
    await response.arrayBuffer();
  }
});

test("customer account management endpoints require separate administrator authentication", async () => {
  const origin = new URL(base).origin;
  for (const [route, method] of [
    ["/api/v1/admin/customer-accounts", "GET"],
    ["/api/v1/admin/customer-accounts", "POST"],
    ["/api/v1/admin/customer-accounts/fixture", "PUT"],
    ["/api/v1/admin/customer-accounts/fixture/access-link", "POST"]
  ]) {
    const response = await fetch(origin + route, { method });
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control"), /no-store/);
    await response.arrayBuffer();
  }
});
test("password rotation validates old password and revokes previous sessions", async () => {
  const a = await account();
  const newPassword = crypto.randomBytes(24).toString("base64url");
  await assert.rejects(svc.changeCustomerMobilePassword(a.auth, "wrong", newPassword), { status: 401 });
  await assert.rejects(svc.changeCustomerMobilePassword(a.auth, a.password, "short"), { status: 400 });
  await assert.rejects(svc.changeCustomerMobilePassword(a.auth, a.password, a.password), { status: 400 });
  const response = await fetch(base + "/password", { method: "POST", headers: { authorization: a.auth, "content-type": "application/json" },
    body: JSON.stringify({ current_password: a.password, new_password: newPassword }) });
  assert.equal(response.status, 200);
  const rotated = await response.json();
  assert.equal(rotated.account.must_change_password, false);
  assert.equal(await svc.requireCustomerMobileSession(a.auth), null);
  assert.equal(await svc.authenticateCustomerMobile(a.email, a.password), null);
  assert.ok(await svc.requireCustomerMobileSession("Bearer " + rotated.session.token));
});
test("HTTP link login preserves mandatory password change and rejects revoked links", async () => {
  process.env.CUSTOMER_GATEWAY_URL = "https://customer.example.invalid";
  const a = await account();
  const issued = await svc.issueCustomerMobileAccessLink(a.created.id);
  const accessToken = new URL(issued.access_url).hash.slice(1);
  const request = () => fetch(base + "/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: "", password: a.password, access_token: accessToken })
  });
  const response = await request();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const login = await response.json();
  assert.equal(login.account.id, a.created.id);
  const protectedResponse = await fetch(base + "/bootstrap", { headers: { authorization: "Bearer " + login.session.token } });
  assert.equal(protectedResponse.status, 403);
  assert.equal((await protectedResponse.json()).code, "PASSWORD_CHANGE_REQUIRED");
  await svc.issueCustomerMobileAccessLink(a.created.id);
  const rejected = await request();
  assert.equal(rejected.status, 401);
  await rejected.arrayBuffer();
});
test("admin reset requires another password change and cannot be overridden by supplied flag", async () => {
  const a = await account();
  await svc.changeCustomerMobilePassword(a.auth, a.password, crypto.randomBytes(24).toString("base64url"));
  const updated = await svc.upsertCustomerMobileAccount(a.created.id, { password: crypto.randomBytes(24).toString("base64url"), must_change_password: false });
  assert.equal(updated.must_change_password, true);
});
test("disabled customer access and missing production gateway proof fail closed", async () => {
  process.env.CUSTOMER_MOBILE_ENABLED = "false";
  assert.equal((await fetch(base + "/login", { method: "POST" })).status, 404);
  process.env.CUSTOMER_MOBILE_ENABLED = "true";
  process.env.NODE_ENV = "production";
  process.env.CUSTOMER_GATEWAY_ORIGIN_SECRET = crypto.randomBytes(32).toString("hex");
  assert.equal((await fetch(base + "/login", { method: "POST" })).status, 404);
  assert.equal((await fetch(base + "/login", { method: "POST", headers: { "x-customer-origin-secret": "fake" } })).status, 404);
  process.env.NODE_ENV = "test";
});
