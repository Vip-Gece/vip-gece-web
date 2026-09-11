import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hardeningSql = await readFile(
  new URL("../ops/postgres/002-supabase-security-hardening.sql", import.meta.url),
  "utf8"
);
const analyticsSql = await readFile(
  new URL("../ops/postgres/001-analytics-events.sql", import.meta.url),
  "utf8"
);
const analyticsMigration = await readFile(
  new URL(
    "../supabase/migrations/20260806000100_analytics_events.sql",
    import.meta.url
  ),
  "utf8"
);
const migrationSql = await readFile(
  new URL(
    "../supabase/migrations/20260806000200_security_hardening.sql",
    import.meta.url
  ),
  "utf8"
);

assert.equal(analyticsMigration, analyticsSql);
assert.equal(migrationSql, hardeningSql);

assert.match(
  analyticsSql,
  /alter table public\.analytics_events\s+enable row level security/i
);
assert.match(
  analyticsSql,
  /revoke all on table public\.analytics_events from public/i
);
assert.match(
  analyticsSql,
  /revoke all on table public\.analytics_events from anon/i
);
assert.match(
  analyticsSql,
  /revoke all on table public\.analytics_events from authenticated/i
);
assert.doesNotMatch(
  analyticsSql,
  /grant\s+(?:select|insert|update|delete|all)[^;]*\b(?:anon|authenticated)\b/i
);

assert.match(hardeningSql, /to_regprocedure\('public\.rls_auto_enable\(\)'\)/);
assert.match(
  hardeningSql,
  /revoke execute on function public\.rls_auto_enable\(\) from public/i
);
assert.match(
  hardeningSql,
  /revoke execute on function public\.rls_auto_enable\(\) from anon/i
);
assert.match(
  hardeningSql,
  /revoke execute on function public\.rls_auto_enable\(\) from authenticated/i
);
assert.match(
  hardeningSql,
  /revoke execute on function public\.rls_auto_enable\(\) from service_role/i
);
assert.doesNotMatch(hardeningSql, /grant\s+execute/i);

console.log("Supabase security hardening contract passed");
