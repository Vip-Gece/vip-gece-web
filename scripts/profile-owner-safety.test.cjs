"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

function validator({ account = null, current = null, database = true, accountError } = {}) {
  const context = { module: { exports: {} }, require(name) {
    if (name.endsWith("postgresClient")) return { hasDatabaseUrl: () => database };
    if (name.endsWith("postgresProfilesRepo")) return { getPostgresProfileById: async () => current };
    if (name.endsWith("customerMobileAccountService")) return { getCustomerMobileAccount: async () => {
      if (accountError) throw accountError;
      return account;
    } };
    throw new Error(`unexpected dependency: ${name}`);
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/services/profileOwnerService"), "utf8"), context);
  return context.module.exports.validateProfileOwner;
}

test("unchanged orphan ownership becomes management-owned without altering public fields", async () => {
  const payload = { owner_user_id: "customer:deleted", name: "Fixture", images: ["/media/fixture.jpg"], whatsapp: "fixture" };
  const before = { ...payload };
  await validator({ current: { id: "1", owner_user_id: payload.owner_user_id } })(payload, "1");
  assert.deepEqual(payload, { ...before, owner_user_id: null });
});

test("missing owners cannot be newly assigned, transferred, or restored", async () => {
  for (const [id, current] of [["", null], ["1", null], ["1", { owner_user_id: null }], ["1", { owner_user_id: "customer:other" }]]) {
    const payload = { owner_user_id: "customer:deleted" };
    await assert.rejects(validator({ current })(payload, id), { status: 400 });
    assert.equal(payload.owner_user_id, "customer:deleted");
  }
});

test("account-store errors do not detach owners", async () => {
  const payload = { owner_user_id: "customer:existing" };
  const error = Object.assign(new Error("fixture unavailable"), { status: 503 });
  await assert.rejects(validator({ current: { owner_user_id: payload.owner_user_id }, accountError: error })(payload, "1"), error);
  assert.equal(payload.owner_user_id, "customer:existing");
});

test("valid owners retain quota information and require PostgreSQL", async () => {
  const account = { owner_user_id: "customer:valid", max_profiles: 10 };
  const payload = { owner_user_id: account.owner_user_id };
  assert.equal(await validator({ account })(payload, "1"), account);
  await assert.rejects(validator({ account, database: false })(payload, "1"), { status: 503 });
});

test("absent and explicitly empty owners stay safe; malformed owners are not normalized", async () => {
  for (const payload of [{ name: "fixture" }, { owner_user_id: null }, { owner_user_id: "" }]) {
    await validator()(payload);
    assert.ok(!Object.hasOwn(payload, "owner_user_id") || payload.owner_user_id === null);
  }
  await assert.rejects(validator({ current: { owner_user_id: "invalid" } })({ owner_user_id: "invalid" }, "1"), { status: 400 });
});

async function maintenanceFixture({ accounts = [], failRead = false, rows = [] } = {}) {
  let queries = [], cleared = 0, reads = 0;
  const context = { module: { exports: {} }, require(name) {
    if (name.endsWith("postgresClient")) return {
      hasDatabaseUrl: () => true,
      transaction: async callback => callback({ query: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.startsWith("update")) return { rows: rows.filter(row =>
          row.owner_user_id === "" || row.owner_user_id?.startsWith("customer:") && !params[0].includes(row.owner_user_id)) };
        return { rows: [] };
      } })
    };
    if (name.endsWith("postgresProfilesRepo")) return { clearPostgresProfileCache: () => cleared++ };
    if (name.endsWith("customerMobileAccountService")) return { listCustomerMobileAccounts: async () => {
      reads++;
      if (failRead) throw new Error("unavailable fixture store");
      return accounts;
    } };
    throw new Error(name);
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/services/profileOwnerService"), "utf8"), context);
  return { run: context.module.exports.reconcileOrphanProfileOwners, result: () => ({ queries, cleared, reads }) };
}

test("periodic reconciliation includes active and inactive orphans, retaining valid and disabled-account ownership", async () => {
  const rows = [{ id: 1, owner_user_id: "customer:deleted", is_active: true },
    { id: 2, owner_user_id: "customer:deleted-two", is_active: false },
    { id: 3, owner_user_id: "customer:valid" }, { id: 4, owner_user_id: "customer:disabled" },
    { id: 5, owner_user_id: null }, { id: 6, owner_user_id: "" }];
  const f = await maintenanceFixture({ rows, accounts: [{ owner_user_id: "customer:valid" }, { owner_user_id: "customer:disabled", enabled: false }] });
  assert.deepEqual(Array.from(await f.run()), [1, 2, 6]);
  const { queries, cleared, reads } = f.result();
  assert.equal(reads, 2);
  assert.equal(cleared, 1);
  assert.match(queries[0].sql, /pg_advisory_xact_lock/);
  assert.match(queries[1].sql, /^update public\.profiles set owner_user_id = null/);
  assert.doesNotMatch(queries[1].sql, /set[^\n]*(?:name|images|whatsapp|is_active)/);
});

test("maintenance never writes or clears caches if the account store is unavailable", async () => {
  const f = await maintenanceFixture({ failRead: true });
  await assert.rejects(f.run(), /unavailable/);
  assert.equal(f.result().queries.length, 0);
  assert.equal(f.result().cleared, 0);
});
