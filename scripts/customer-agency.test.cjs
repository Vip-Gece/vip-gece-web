"use strict";
const { test, before, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const db = require("../src/data/postgresClient");
let used = 51;
let stored = [];
let mutations = [];
const client = { async query(sql, params = []) {
  if (sql.includes("private.customer_accounts") && sql.startsWith("select")) return { rows: stored.map(data => ({ data: structuredClone(data) })) };
  if (sql.includes("insert into private.customer_accounts")) {
    const data = JSON.parse(params[3]);
    stored = stored.filter(a => a.id !== data.id).concat(data);
    return { rows: [] };
  }
  if (sql.includes("count(*)")) return { rows: [{ count: used }] };
  if (sql.includes("insert into public.profiles")) return { rows: [{ id: "new-profile", name: "Draft", images: [], owner_user_id: "customer:agency", is_active: false }] };
  return { rows: [] };
} };
mock.method(db, "hasDatabaseUrl", () => true);
mock.method(db, "transaction", callback => callback(client));
mock.method(db, "query", (sql, params) => client.query(sql, params));
const repo = require("../src/data/postgresProfilesRepo");
const createProfile = repo.createCustomerPostgresProfile;
let profile = { id: "owned", name: "Fixture", slug: "fixture", description: "Test", images: ["https://example.invalid/test.jpg"], is_active: false };
mock.method(repo, "updateCustomerPostgresProfile", async (id, owner, payload) => {
  mutations.push({ id, owner, payload });
  if (id !== profile.id || owner !== "customer:agency") return null;
  profile = { ...profile, ...payload };
  return profile;
});
mock.method(repo, "listCustomerPostgresProfiles", async () => Array.from({ length: 51 }, () => profile));
const svc = require("../src/services/customerMobileAccountService");
const saved = { ...process.env };
let dir;
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "vip-agency-"));
  process.env.NODE_ENV = "test";
  process.env.CUSTOMER_ACCOUNT_STORE_BACKEND = "json";
  process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH = path.join(dir, "accounts.json");
});
after(async () => {
  mock.restoreAll();
  await fs.rm(dir, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});
test("only explicit zero is unlimited; legacy account limits remain bounded", () => {
  assert.equal(svc.normalizeProfileLimit(0), 0);
  assert.equal(svc.normalizeProfileLimit("0"), 0);
  for (const value of [null, undefined, "", false, -1, "invalid"]) assert.ok(svc.normalizeProfileLimit(value) > 0);
  assert.equal(svc.normalizeProfileLimit(500), 50);
});
test("admin-created agency persists unlimited quota and auto publication", async () => {
  const account = await svc.upsertCustomerMobileAccount("agency", {
    email: "agency@example.invalid", password: crypto.randomBytes(24).toString("hex"), max_profiles: 0, auto_publish: true
  });
  assert.equal(account.max_profiles, 0);
  assert.equal(account.auto_publish, true);
  assert.equal(account.must_change_password, true);
  const updated = await svc.upsertCustomerMobileAccount(account.id, { label: "Agency" });
  assert.equal(updated.max_profiles, 0);
  assert.equal(updated.auto_publish, true);
  const bootstrap = await svc.customerMobileBootstrap(updated);
  assert.equal(bootstrap.quota.unlimited, true);
  assert.equal(bootstrap.quota.remaining, null);
  assert.equal(bootstrap.quota.used, 51);
});
test("creation exceeds fifty only for explicit unlimited quota", async () => {
  await assert.rejects(createProfile("customer:agency", { name: "Draft" }, 50), { code: "PROFILE_LIMIT_REACHED" });
  assert.ok(await createProfile("customer:agency", { name: "Draft" }, 0));
  await assert.rejects(createProfile("customer:agency", { name: "Draft" }, null), { code: "PROFILE_LIMIT_REACHED" });
});
test("auto publication remains owner-scoped and respects explicit unpublish", async () => {
  mutations = [];
  profile.is_active = false;
  const result = await svc.updateCustomerMobileProfile({ id: "agency", auto_publish: true }, "owned", { description: "Updated" });
  assert.equal(result.is_live, true);
  assert.ok(mutations.every(m => m.owner === "customer:agency"));
  assert.equal(await svc.updateCustomerMobileProfile({ id: "other", auto_publish: true }, "owned", {}), null);
  const unpublished = await svc.updateCustomerMobileProfile({ id: "agency", auto_publish: true }, "owned", { is_active: false });
  assert.equal(unpublished.is_live, false);
  profile.images = [];
  assert.equal((await svc.updateCustomerMobileProfile({ id: "agency", auto_publish: true }, "owned", {})).is_live, false);
});
test("postgres account backend persists account without using local JSON", async () => {
  process.env.CUSTOMER_ACCOUNT_STORE_BACKEND = "postgres";
  const account = await svc.upsertCustomerMobileAccount("agency-db", { email: "db@example.invalid", password: crypto.randomBytes(24).toString("hex"), max_profiles: 0, auto_publish: true });
  assert.equal(account.max_profiles, 0);
  assert.equal(stored.length, 1);
  assert.ok(stored[0].password_hash);
  assert.equal(Object.hasOwn((await svc.listCustomerMobileAccounts())[0], "password_hash"), false);
  process.env.CUSTOMER_ACCOUNT_STORE_BACKEND = "json";
});
