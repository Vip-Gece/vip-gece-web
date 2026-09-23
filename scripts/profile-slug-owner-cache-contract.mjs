import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const clientPath = require.resolve("../src/data/postgresClient");
let calls = 0;
let read = async () => ({ rows: [{ id: "9", slug: "reserved", is_active: false }] });
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: {
  hasDatabaseUrl: () => true,
  query: async (sql) => {
    calls += 1;
    assert.match(sql, /select id, name, card_label, slug, city, district, is_active/);
    assert.doesNotMatch(sql, /where is_active|description|phone|images/i);
    return read();
  }
} };
const { getPostgresProfileSlugOwners: lookup, clearPostgresProfileCache: clear } = require("../src/data/postgresProfilesRepo");
const failures = [];
let assertions = 0;
async function check(name, action) {
  assertions += 1;
  try { await action(); } catch (error) { failures.push({ name, error: error.message }); }
}
await check("concurrent reads share one query and retain inactive owners", async () => {
  const rows = await Promise.all([lookup(), lookup(), lookup()]);
  assert.equal(calls, 1);
  assert.equal(rows[0][0].is_active, false);
  await lookup();
  assert.equal(calls, 1);
});
await check("publication writes invalidate ownership together with public rows", async () => {
  clear();
  await lookup();
  assert.equal(calls, 2);
});
await check("database failure does not reuse stale ownership", async () => {
  clear();
  read = async () => { throw new Error("database unavailable"); };
  await assert.rejects(lookup(), /database unavailable/);
});
await check("an invalidated in-flight lookup cannot repopulate the cache", async () => {
  let finish;
  read = () => new Promise((resolve) => { finish = resolve; });
  const pending = lookup();
  clear();
  finish({ rows: [{ id: "old" }] });
  await assert.rejects(pending, /ownership changed/);
  read = async () => ({ rows: [{ id: "new" }] });
  assert.equal((await lookup())[0].id, "new");
});
await check("malformed database result fails closed", async () => {
  clear();
  read = async () => ({ rows: null });
  await assert.rejects(lookup(), /ownership is unavailable/);
});
console.log(JSON.stringify({ ok: !failures.length, assertions, failures }, null, 2));
process.exitCode = failures.length ? 1 : 0;
