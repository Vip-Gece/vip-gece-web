import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OLD_PROJECT_REF = ["uncvtv", "dardrvtmjjjnqq"].join("");
const CURRENT_PROJECT_REF = "hofblpqaxzhybozavtaz";

async function source(relativePath) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

const config = await source("supabase/config.toml");
assert.match(config, /^project_id\s*=\s*"vip-gece"$/m);
assert.match(config, /^major_version\s*=\s*17$/m);
assert.match(config, /^site_url\s*=\s*"https:\/\/vip-gece\.site"$/m);
assert.match(config, /^enable_signup\s*=\s*false$/m);
assert.match(config, /^enable_anonymous_sign_ins\s*=\s*false$/m);

const analyticsSource = await source("ops/postgres/001-analytics-events.sql");
const analyticsMigration = await source(
  "supabase/migrations/20260806000100_analytics_events.sql"
);
assert.equal(analyticsMigration, analyticsSource);

const hardeningSource = await source(
  "ops/postgres/002-supabase-security-hardening.sql"
);
const hardeningMigration = await source(
  "supabase/migrations/20260806000200_security_hardening.sql"
);
assert.equal(hardeningMigration, hardeningSource);

let oldRefMatches = "";
try {
  oldRefMatches = execFileSync(
    "git",
    ["grep", "-I", "-n", "--", OLD_PROJECT_REF],
    { cwd: ROOT, encoding: "utf8" }
  );
} catch (error) {
  if (error.status !== 1) throw error;
}
assert.equal(oldRefMatches, "", "Old Supabase project ref remains in tracked source");

const currentRefMatches = execFileSync(
  "git",
  ["grep", "-I", "-n", "--", CURRENT_PROJECT_REF],
  { cwd: ROOT, encoding: "utf8" }
);
assert.notEqual(currentRefMatches, "", "Current Supabase project ref is undocumented");
console.log("Supabase integration contract passed");
