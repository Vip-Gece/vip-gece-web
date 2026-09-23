"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const svc = require("../src/services/customerMobileAccountService");

let directory;
let saved;
beforeEach(async () => {
  saved = { ...process.env };
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "customer-account-safety-"));
  process.env.NODE_ENV = "test";
  process.env.CUSTOMER_ACCOUNT_STORE_BACKEND = "json";
  process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH = path.join(directory, "accounts.json");
  process.env.CUSTOMER_MOBILE_SESSION_SECRET = crypto.randomBytes(48).toString("hex");
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

async function account(extra = {}) {
  const password = crypto.randomBytes(24).toString("base64url");
  const created = await svc.upsertCustomerMobileAccount("", {
    email: `${crypto.randomUUID()}@example.invalid`, password, ...extra
  });
  const login = await svc.authenticateCustomerMobile(created.email, password);
  return { created, password, auth: `Bearer ${login.session.token}` };
}

test("login requires a nonempty string identifier", async () => {
  const a = await account();
  for (const identifier of [undefined, null, "", "   ", {}, [], 42]) {
    const result = await svc.authenticateCustomerMobile(identifier, a.password);
    assert.ok(result === null, "invalid identifier must not authenticate");
  }
});

test("valid email and username login remain case insensitive", async () => {
  const a = await account({ username: "fixture-user" });
  for (const identifier of [a.created.email.toUpperCase(), " Fixture-User "]) {
    const result = await svc.authenticateCustomerMobile(identifier, a.password);
    assert.ok(result?.account.id === a.created.id);
    assert.equal(result.account.must_change_password, true);
    assert.equal(Object.hasOwn(result.account, "password_hash"), false);
  }
});

test("corrupt account containers fail closed and are never replaced", async () => {
  for (const invalid of [null, [], {}, { accounts: {} }, { accounts: null }, { version: 2, accounts: [] }]) {
    const original = JSON.stringify(invalid);
    await fs.writeFile(process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH, original);
    await assert.rejects(svc.listCustomerMobileAccounts(), { status: 503 });
    await assert.rejects(svc.upsertCustomerMobileAccount("", {
      email: "fixture@example.invalid", password: crypto.randomBytes(24).toString("hex")
    }), { status: 503 });
    assert.equal(await fs.readFile(process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH, "utf8"), original);
  }
});

test("invalid and duplicate account records are rejected without dropping data", async () => {
  await account();
  const original = JSON.parse(await fs.readFile(process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH, "utf8"));
  const valid = original.accounts[0];
  for (const records of [[null], [{}], [valid, valid], [valid, { ...valid, id: crypto.randomUUID() }]]) {
    await fs.writeFile(process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH, JSON.stringify({ version: 1, accounts: records }));
    await assert.rejects(svc.listCustomerMobileAccounts(), { status: 503 });
  }
});

test("unknown storage backend cannot silently select a different account store", async () => {
  await account();
  const original = await fs.readFile(process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH);
  process.env.CUSTOMER_ACCOUNT_STORE_BACKEND = "invalid-backend";
  await assert.rejects(svc.listCustomerMobileAccounts(), { status: 503 });
  await assert.rejects(svc.upsertCustomerMobileAccount("", {
    email: "fixture@example.invalid", password: crypto.randomBytes(24).toString("hex")
  }), { status: 503 });
  assert.ok(original.equals(await fs.readFile(process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH)));
});

test("disabling then re-enabling an account does not revive its old session", async () => {
  const a = await account();
  await svc.upsertCustomerMobileAccount(a.created.id, { enabled: false });
  assert.ok(await svc.requireCustomerMobileSession(a.auth) === null);
  assert.ok(await svc.authenticateCustomerMobile(a.created.email, a.password) === null);
  await svc.upsertCustomerMobileAccount(a.created.id, { enabled: true });
  assert.ok(await svc.requireCustomerMobileSession(a.auth) === null);
  assert.ok(await svc.authenticateCustomerMobile(a.created.email, a.password));
});

test("concurrent password changes rotate only once and revoke the previous session", async () => {
  const a = await account();
  const results = await Promise.allSettled(Array.from({ length: 2 }, () =>
    svc.changeCustomerMobilePassword(a.auth, a.password, crypto.randomBytes(24).toString("hex"))));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.status, 401);
  assert.ok(await svc.requireCustomerMobileSession(a.auth) === null);
  const rotated = results.find(result => result.status === "fulfilled").value;
  assert.equal(rotated.account.must_change_password, false);
  assert.ok(await svc.requireCustomerMobileSession(`Bearer ${rotated.session.token}`));
});

test("public account output excludes stored secrets and unknown fields", async () => {
  const a = await account();
  const store = JSON.parse(await fs.readFile(process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH, "utf8"));
  store.accounts[0].internal_note = "private fixture";
  await fs.writeFile(process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH, JSON.stringify(store));
  const visible = await svc.getCustomerMobileAccount(a.created.id);
  for (const field of ["password_hash", "session_version", "internal_note"]) {
    assert.equal(Object.hasOwn(visible, field), false);
  }
});
