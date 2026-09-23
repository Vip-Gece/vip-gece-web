"use strict";
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const svc = require("../src/services/customerMobileAccountService");
let directory, saved;
beforeEach(async () => {
  saved = { ...process.env };
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "customer-access-link-"));
  Object.assign(process.env, {
    NODE_ENV: "test", CUSTOMER_ACCOUNT_STORE_BACKEND: "json",
    CUSTOMER_MOBILE_ACCOUNT_STORE_PATH: path.join(directory, "accounts.json"),
    CUSTOMER_MOBILE_SESSION_SECRET: crypto.randomBytes(48).toString("hex"),
    CUSTOMER_GATEWAY_URL: "https://customer.example.invalid"
  });
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});
async function fixture() {
  const password = crypto.randomBytes(24).toString("base64url");
  const account = await svc.upsertCustomerMobileAccount("", {
    email: `${crypto.randomUUID()}@example.invalid`, password
  });
  return { account, password };
}
const tokenOf = issued => new URL(issued.access_url).hash.slice(1);
test("issued link is opaque, hash-only at rest, and still requires the password", async () => {
  const { account, password } = await fixture();
  const issued = await svc.issueCustomerMobileAccessLink(account.id);
  const url = new URL(issued.access_url), token = tokenOf(issued);
  assert.equal(url.origin, process.env.CUSTOMER_GATEWAY_URL);
  assert.equal(url.pathname, "/access");
  assert.equal(url.search, "");
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await svc.authenticateCustomerMobile("", "", token), null);
  assert.equal(await svc.authenticateCustomerMobile("", "wrong-password", token), null);
  assert.equal(await svc.authenticateCustomerMobile(account.email, password), null);
  const login = await svc.authenticateCustomerMobile("", password, token);
  assert.equal(login.account.id, account.id);
  assert.equal(login.account.must_change_password, true);
  const disk = await fs.readFile(process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH, "utf8");
  assert.equal(disk.includes(token), false);
  const publicJson = JSON.stringify(await svc.listCustomerMobileAccounts());
  assert.equal(publicJson.includes("access_link_hash"), false);
  assert.equal(publicJson.includes(token), false);
  assert.equal(issued.account.has_access_link, true);
});
test("rotation revokes the previous link and sessions, including after password change", async () => {
  const { account, password } = await fixture();
  const first = await svc.issueCustomerMobileAccessLink(account.id);
  const login = await svc.authenticateCustomerMobile("", password, tokenOf(first));
  const nextPassword = crypto.randomBytes(24).toString("base64url");
  const changed = await svc.changeCustomerMobilePassword(`Bearer ${login.session.token}`, password, nextPassword);
  const second = await svc.issueCustomerMobileAccessLink(account.id);
  assert.notEqual(tokenOf(first), tokenOf(second));
  assert.equal(await svc.authenticateCustomerMobile("", nextPassword, tokenOf(first)), null);
  assert.equal(await svc.requireCustomerMobileSession(`Bearer ${changed.session.token}`), null);
  const next = await svc.authenticateCustomerMobile("", nextPassword, tokenOf(second));
  assert.equal(next.account.must_change_password, false);
});
test("a link cannot select another account or authenticate a disabled account", async () => {
  const a = await fixture(), b = await fixture();
  const issued = await svc.issueCustomerMobileAccessLink(a.account.id);
  const token = tokenOf(issued);
  assert.equal(await svc.authenticateCustomerMobile(b.account.email, a.password, token), null);
  assert.equal(await svc.authenticateCustomerMobile("", b.password, token), null);
  await svc.upsertCustomerMobileAccount(a.account.id, { enabled: false });
  assert.equal(await svc.authenticateCustomerMobile("", a.password, token), null);
});
test("malformed tokens do not fall back to legacy email login", async () => {
  const { account, password } = await fixture();
  for (const token of [null, {}, [], 42, "", "x".repeat(44), "x".repeat(42) + "/"]) {
    assert.ok(await svc.authenticateCustomerMobile(account.email, password, token) === null);
  }
  assert.equal((await svc.authenticateCustomerMobile(account.email, password)).account.id, account.id);
});
test("invalid public gateway configuration cannot revoke an existing link", async () => {
  const { account, password } = await fixture();
  const issued = await svc.issueCustomerMobileAccessLink(account.id);
  for (const origin of ["", "http://customer.example.invalid", "https://user:pass@customer.example.invalid", "https://customer.example.invalid/a", "https://customer.example.invalid/?q=x", "https://customer.example.invalid/#fragment", "https://127.0.0.1", "https://localhost", "https://fixture.supabase.co", "https://customer.example.invalid:8443"]) {
    process.env.CUSTOMER_GATEWAY_URL = origin;
    await assert.rejects(svc.issueCustomerMobileAccessLink(account.id), { status: 503 });
  }
  assert.ok(await svc.authenticateCustomerMobile("", password, tokenOf(issued)));
});
test("corrupted stored link hashes fail closed instead of restoring email-only login", async () => {
  const { account, password } = await fixture();
  const file = process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH;
  const original = JSON.parse(await fs.readFile(file, "utf8"));
  for (const invalid of ["", null, false, {}, "not-a-hash"]) {
    original.accounts[0].access_link_hash = invalid;
    await fs.writeFile(file, JSON.stringify(original));
    await assert.rejects(svc.authenticateCustomerMobile(account.email, password), { status: 503 });
    await assert.rejects(svc.issueCustomerMobileAccessLink(account.id), { status: 503 });
  }
});
test("issuing a link for an unknown ID cannot create an account", async () => {
  await fixture();
  await assert.rejects(svc.issueCustomerMobileAccessLink(crypto.randomUUID()), { status: 404 });
  assert.equal((await svc.listCustomerMobileAccounts()).length, 1);
});
