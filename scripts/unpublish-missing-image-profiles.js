#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const repoRoot = process.argv[2] || "/var/www/vip-gece-site/current";
const apply = process.argv.includes("--apply");
const expectedHost = "hofblpqaxzhybozavtaz.supabase.co";
const ids = Array.from({ length: 12 }, (_, index) => String(index + 2));
require(path.join(repoRoot, "node_modules/dotenv")).config({
  path: process.env.DOTENV_CONFIG_PATH || "/var/www/vip-gece-site/.env",
  override: true,
  quiet: true
});
const { transaction } = require(path.join(repoRoot, "src/data/postgresClient"));

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function preserved(row) {
  const { images, is_active, updated_at, ...fields } = row;
  return fields;
}

function isRetiredImage(image) {
  try {
    const url = new URL(image);
    return url.protocol === "https:" && url.hostname === expectedHost &&
      url.pathname.startsWith("/storage/v1/object/public/images/");
  } catch {
    return false;
  }
}

async function main() {
  assert.equal(new URL(process.env.DATABASE_URL).hostname, "db.rklydqhknkhcydoijmlq.supabase.co");
  const report = await transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock($1::bigint)", [98173041]);
    // Lock the small inventory so unrelated-row preservation is checked atomically.
    const before = (await client.query("select * from public.profiles order by id for update")).rows;
    const selected = before.filter((row) => ids.includes(String(row.id)));
    assert.equal(selected.length, 12, "Expected all twelve preserved profile records");
    assert.equal(selected.every((row) => row.is_active && row.images.length && row.images.every(isRetiredImage)), true,
      "A target changed or has a different image source; refusing to clear it");
    assert.equal(selected.reduce((count, row) => count + row.images.length, 0), 41);
    const result = {
      checked_at: new Date().toISOString(), mode: apply ? "apply" : "dry-run",
      selected_profiles: selected.map((row) => ({
        id: row.id, name: row.name, description_sha256: digest(row.description),
        description_characters: [...String(row.description || "")].length,
        preserved_fields_sha256: digest(preserved(row)), previous_images: row.images.length
      }))
    };
    if (!apply) return result;

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `/var/backups/vip-gece/manual-profile-unpublish-${stamp}.json`;
    const body = JSON.stringify({ created_at: new Date().toISOString(), reason: "User requested unpublication without deleting descriptions", profiles: selected }, null, 2);
    const fd = fs.openSync(backupPath, "wx", 0o600);
    try {
      fs.writeFileSync(fd, body, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    assert.equal(fs.readFileSync(backupPath, "utf8"), body);
    const updated = await client.query(
      "update public.profiles set is_active = false, images = '{}'::text[], updated_at = now() where id = any($1::bigint[]) returning id",
      [ids]
    );
    assert.equal(updated.rowCount, 12);
    const after = (await client.query("select * from public.profiles order by id")).rows;
    assert.equal(after.length, before.length);
    for (let index = 0; index < before.length; index += 1) {
      const oldRow = before[index];
      const newRow = after[index];
      if (ids.includes(String(oldRow.id))) {
        assert.deepEqual(preserved(newRow), preserved(oldRow), `Profile ${oldRow.id} details changed`);
        assert.equal(newRow.is_active, false);
        assert.deepEqual(newRow.images, []);
      } else {
        assert.deepEqual(newRow, oldRow, `Unrelated profile ${oldRow.id} changed`);
      }
    }
    return {
      ...result, backup_path: backupPath,
      backup_sha256: crypto.createHash("sha256").update(body).digest("hex"),
      total_profiles: after.length, unpublished: updated.rowCount,
      active_profiles: after.filter((row) => row.is_active).length,
      descriptions_preserved: true, other_fields_preserved: true, unrelated_profiles_unchanged: true
    };
  });
  console.log(JSON.stringify({ ...report, committed: apply }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
