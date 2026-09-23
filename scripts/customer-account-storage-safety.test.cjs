"use strict";

const { test, beforeEach, afterEach, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const database = require("../src/data/postgresClient");

let records, writes, databaseError, directory, saved;
async function query(sql, params = []) {
  if (databaseError) throw databaseError;
  if (sql.startsWith("select pg_advisory_xact_lock")) return { rows: [] };
  if (sql.startsWith("select data from private.customer_accounts")) {
    return { rows: records.map(data => ({ data: structuredClone(data) })) };
  }
  if (sql.includes("insert into private.customer_accounts")) {
    writes += 1;
    const data = JSON.parse(params[3]);
    records = records.filter(record => record.id !== data.id).concat(data);
    return { rows: [] };
  }
  throw new Error("Unexpected database statement in isolated account fixture.");
}
mock.method(database, "query", query);
mock.method(database, "transaction", async callback => {
  const snapshot = structuredClone(records);
  try { return await callback({ query }); }
  catch (error) { records = snapshot; throw error; }
});
const svc = require("../src/services/customerMobileAccountService");

beforeEach(async () => {
  saved = { ...process.env };
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "customer-storage-safety-"));
  process.env.NODE_ENV = "test";
  process.env.CUSTOMER_ACCOUNT_STORE_BACKEND = "postgres";
  process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH = path.join(directory, "accounts.json");
  process.env.CUSTOMER_MOBILE_SESSION_SECRET = crypto.randomBytes(48).toString("hex");
  records = [];
  writes = 0;
  databaseError = null;
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});
after(() => mock.restoreAll());

test("postgres adapter fixture preserves hashed credentials without a JSON side store", async () => {
  const password = crypto.randomBytes(24).toString("hex");
  const created = await svc.upsertCustomerMobileAccount("", { email: "fixture@example.invalid", password });
  assert.equal(writes, 1);
  assert.ok(records[0].password_hash.startsWith("pbkdf2_sha256$"));
  assert.ok(!JSON.stringify(records).includes(password));
  const listed = await svc.listCustomerMobileAccounts();
  assert.equal(listed[0].id, created.id);
  assert.equal(Object.hasOwn(listed[0], "password_hash"), false);
  await svc.assertCustomerMobileAccountStorageReady();
  await assert.rejects(fs.access(process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH), { code: "ENOENT" });
});

test("postgres adapter fixture rejects corrupt records before readiness or mutation", async () => {
  records = [null];
  await assert.rejects(svc.listCustomerMobileAccounts(), { status: 503 });
  await assert.rejects(svc.assertCustomerMobileAccountStorageReady(), { status: 503 });
  await assert.rejects(svc.upsertCustomerMobileAccount("", {
    email: "fixture@example.invalid", password: crypto.randomBytes(24).toString("hex")
  }), { status: 503 });
  assert.equal(writes, 0);
  assert.deepEqual(records, [null]);
});

test("database failure never falls back to an available JSON account store", async () => {
  await fs.writeFile(process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH, JSON.stringify({ version: 1, accounts: [] }));
  const original = await fs.readFile(process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH);
  databaseError = Object.assign(new Error("Database fixture unavailable"), { code: "FIXTURE_UNAVAILABLE" });
  await assert.rejects(svc.listCustomerMobileAccounts(), { code: "FIXTURE_UNAVAILABLE" });
  await assert.rejects(svc.upsertCustomerMobileAccount("", {
    email: "fixture@example.invalid", password: crypto.randomBytes(24).toString("hex")
  }), { code: "FIXTURE_UNAVAILABLE" });
  assert.equal(writes, 0);
  assert.ok(original.equals(await fs.readFile(process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH)));
});
