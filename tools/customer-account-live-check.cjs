"use strict";

// Creates only disposable private account fixtures. Never reads customer passwords or edits profiles.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
if (!root.startsWith("/var/tmp/vip-gece-android-capture-")) throw new Error("Run only in the isolated server test tree");
const production = require("dotenv").parse(fs.readFileSync("/var/www/vip-gece-site/.env"));
if (new URL(production.DATABASE_URL).hostname !== "db.rklydqhknkhcydoijmlq.supabase.co") throw new Error("Unexpected database");
Object.assign(process.env, {
  NODE_ENV: "production", DATABASE_URL: production.DATABASE_URL,
  DATABASE_SSL: "true", DATABASE_SSL_REJECT_UNAUTHORIZED: "true",
  DATABASE_SSL_CA_FILE: "/var/www/vip-gece-site/current/server/certs/supabase-root-2021-ca.crt",
  DATABASE_SLOW_QUERY_MS: "30000", CUSTOMER_ACCOUNT_STORE_BACKEND: "postgres",
  CUSTOMER_GATEWAY_URL: "https://customer-api.vip-gece.site",
  CUSTOMER_MOBILE_SESSION_SECRET: process.env.CUSTOMER_MOBILE_SESSION_SECRET || crypto.randomBytes(48).toString("base64url")
});
const database = require("../src/data/postgresClient");
const service = require("../src/services/customerMobileAccountService");

async function reopened() {
  const input = JSON.parse(fs.readFileSync(0, "utf8"));
  const login = await service.authenticateCustomerMobile(input.email, input.password, input.accessToken);
  assert.equal(login?.account.id, input.id);
  assert.equal(login.account.must_change_password, false);
  console.log(JSON.stringify({ persisted_across_process: true }));
}

async function main() {
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const email = `acceptance-${ids[0]}@example.invalid`;
  const secondEmail = `acceptance-${ids[1]}@example.invalid`;
  const passwords = [crypto.randomBytes(24).toString("base64url"), crypto.randomBytes(24).toString("base64url")];
  const proof = { passed: [], cleanup_verified: false, public_profiles_modified: false };
  const baseline = (await database.query("select id, md5(data::text) as digest from private.customer_accounts order by id")).rows;
  const profilesBefore = (await database.query("select count(*)::int as count, md5(coalesce(string_agg(md5(row_to_json(p)::text), '' order by id::text), '')) as digest from public.profiles p")).rows[0];
  try {
    const created = await service.upsertCustomerMobileAccount(ids[0], { email, password: passwords[0], label: "Disposable acceptance fixture", auto_publish: false, max_profiles: 2 });
    assert.equal(created.must_change_password, true);
    assert.equal(Object.hasOwn(created, "password_hash"), false);
    const second = await service.upsertCustomerMobileAccount(ids[1], { email: secondEmail, password: passwords[0], auto_publish: false, max_profiles: 2 });
    assert.notEqual(service.ownerUserId(created), service.ownerUserId(second));
    await service.assertCustomerMobileAccountStorageReady();
    proof.passed.push("real_postgres_create_readiness_account_identity");
    const initial = await service.authenticateCustomerMobile(email, passwords[0]);
    assert.equal(initial.account.id, ids[0]);
    assert.equal(initial.account.must_change_password, true);
    const changed = await service.changeCustomerMobilePassword(`Bearer ${initial.session.token}`, passwords[0], passwords[1]);
    assert.equal(changed.account.must_change_password, false);
    assert.equal(await service.requireCustomerMobileSession(`Bearer ${initial.session.token}`), null);
    assert.equal(await service.authenticateCustomerMobile(email, passwords[0]), null);
    const account = await service.requireCustomerMobileSession(`Bearer ${changed.session.token}`);
    assert.equal(account.id, ids[0]);
    proof.passed.push("mandatory_password_change_old_session_and_password_revocation");
    const child = spawnSync(process.execPath, [__filename, "--reopen"], {
      cwd: root, env: process.env, encoding: "utf8", timeout: 30000,
      input: JSON.stringify({ id: ids[0], email, password: passwords[1] }), maxBuffer: 1024 * 1024
    });
    assert.equal(child.status, 0, "Separate process persistence check failed");
    assert.equal(JSON.parse(child.stdout).persisted_across_process, true);
    proof.passed.push("real_separate_process_persistence");
    const firstLink = await service.issueCustomerMobileAccessLink(ids[0]);
    const firstToken = new URL(firstLink.access_url).hash.slice(1);
    assert.ok(await service.authenticateCustomerMobile(email, passwords[1]) === null);
    assert.ok(await service.requireCustomerMobileSession(`Bearer ${changed.session.token}`) === null);
    const linked = await service.authenticateCustomerMobile("", passwords[1], firstToken);
    assert.equal(linked.account.id, ids[0]);
    const secondLink = await service.issueCustomerMobileAccessLink(ids[0]);
    const accessToken = new URL(secondLink.access_url).hash.slice(1);
    assert.ok(await service.authenticateCustomerMobile("", passwords[1], firstToken) === null);
    assert.ok(await service.requireCustomerMobileSession(`Bearer ${linked.session.token}`) === null);
    const persisted = spawnSync(process.execPath, [__filename, "--reopen"], {
      cwd: root, env: process.env, encoding: "utf8", timeout: 30000,
      input: JSON.stringify({ id: ids[0], email: "", password: passwords[1], accessToken }), maxBuffer: 1024 * 1024
    });
    assert.equal(persisted.status, 0, "Access link persistence check failed");
    assert.equal(JSON.parse(persisted.stdout).persisted_across_process, true);
    proof.passed.push("hashed_access_link_rotation_and_separate_process_login");
    await Promise.all([
      service.upsertCustomerMobileAccount(ids[0], { label: "Concurrent acceptance fixture" }),
      service.upsertCustomerMobileAccount(ids[0], { max_profiles: 3 })
    ]);
    const concurrent = await service.getCustomerMobileAccount(ids[0]);
    assert.equal(concurrent.label, "Concurrent acceptance fixture");
    assert.equal(concurrent.max_profiles, 3);
    proof.passed.push("concurrent_partial_updates_preserve_both_fields");
    const stored = (await database.query("select data from private.customer_accounts where id=$1", [ids[0]])).rows[0].data;
    assert.ok(stored.password_hash.startsWith("pbkdf2_sha256$"));
    for (const password of passwords) assert.ok(!JSON.stringify(stored).includes(password));
    assert.ok(!JSON.stringify(stored).includes(accessToken));
    assert.ok(!JSON.stringify(stored).includes(firstToken));
    await service.upsertCustomerMobileAccount(ids[0], { enabled: false });
    assert.ok(await service.authenticateCustomerMobile("", passwords[1], accessToken) === null);
    assert.equal(await service.authenticateCustomerMobile(email, passwords[1]), null);
    assert.equal(await service.requireCustomerMobileSession(`Bearer ${changed.session.token}`), null);
    proof.passed.push("hashed_credentials_disabled_account_revokes_sessions");
    const acl = (await database.query("select relrowsecurity, has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access, has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE') as authenticated_access from pg_class where oid='private.customer_accounts'::regclass")).rows[0];
    assert.deepEqual(acl, { relrowsecurity: true, anon_access: false, authenticated_access: false });
    proof.passed.push("rls_enabled_no_public_client_table_grants");
  } finally {
    await database.query("delete from private.customer_accounts where (id=$1 and email=$2) or (id=$3 and email=$4)", [ids[0], email, ids[1], secondEmail]);
    const after = (await database.query("select id, md5(data::text) as digest from private.customer_accounts order by id")).rows;
    assert.deepEqual(after, baseline, "Private account baseline changed");
    const profilesAfter = (await database.query("select count(*)::int as count, md5(coalesce(string_agg(md5(row_to_json(p)::text), '' order by id::text), '')) as digest from public.profiles p")).rows[0];
    assert.deepEqual(profilesAfter, profilesBefore, "Public profile baseline changed during test");
    proof.cleanup_verified = true;
    fs.writeFileSync(path.join(root, "customer-account-live-proof.json"), JSON.stringify(proof, null, 2));
    console.log(JSON.stringify(proof));
  }
}
(process.argv.includes("--reopen") ? reopened() : main()).catch(error => {
  console.error(JSON.stringify({ failed: true, type: error.name, code: error.code || null }));
  process.exitCode = 1;
});
