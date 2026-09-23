#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const repoRoot = process.argv[2] || "/var/www/vip-gece-site/current";
const backupRoot = "/var/backups/vip-gece";
const { parse: parsePgArray } = require(path.join(repoRoot, "node_modules/postgres-array"));
const wantedIds = new Set(Array.from({ length: 12 }, (_, i) => String(i + 2)).concat(["79", "80", "81", "82", "83", "84"]));

// Decode only the documented PostgreSQL COPY text escapes; no dump SQL is executed.
function copyText(value) {
  if (value === "\\N") return null;
  const escapes = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\" };
  return value.replace(/\\([0-7]{1,3}|x[0-9a-f]{1,2}|.)/gi, (_, escaped) => {
    if (/^[0-7]{1,3}$/.test(escaped)) return String.fromCharCode(parseInt(escaped, 8));
    if (/^x[0-9a-f]{1,2}$/i.test(escaped)) return String.fromCharCode(parseInt(escaped.slice(1), 16));
    return escapes[escaped] ?? escaped;
  });
}

function profileRows(dump) {
  const sql = execFileSync("pg_restore", ["--data-only", "--schema=public", "--table=profiles", "--file=-", dump], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 20_000 });
  let columns = null;
  const rows = [];
  for (const line of sql.split(/\r?\n/)) {
    if (line.startsWith("COPY public.profiles (")) {
      columns = line.slice("COPY public.profiles (".length).split(") FROM stdin;")[0].split(", ");
    } else if (line === "\\.") {
      columns = null;
    } else if (columns) {
      const values = line.split("\t").map(copyText);
      if (values.length !== columns.length) throw new Error("Unexpected profile COPY field count");
      const row = Object.fromEntries(columns.map((column, i) => [column, values[i]]));
      rows.push({ id: row.id, name: row.name, slug: row.slug, images: row.images ? parsePgArray(row.images) : [] });
    }
  }
  if (!rows.length) throw new Error("No profile COPY records found");
  return rows;
}

const result = { checked_at: new Date().toISOString(), backup_root: backupRoot, database_backups: [], image_backups: [] };
for (const file of fs.readdirSync(backupRoot).sort()) {
  if (/^database-\d{8}T\d{6}Z\.dump$/.test(file)) {
    try {
      const rows = profileRows(path.join(backupRoot, file));
      const selected = rows.filter((row) => wantedIds.has(row.id));
      const signature = crypto.createHash("sha256").update(JSON.stringify(selected)).digest("hex");
      result.database_backups.push({ file, profiles: rows.length, signature, selected });
    } catch (error) {
      result.database_backups.push({ file, error: error.message.split("\n")[0] });
    }
  } else if (/^images-\d{8}T\d{6}Z\.tar\.gz$/.test(file)) {
    try {
      const listing = execFileSync("tar", ["-tzf", path.join(backupRoot, file)], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 20_000 });
      const files = listing.split("\n").filter((name) => /\.(?:jpg|jpeg|webp|png)$/i.test(name));
      result.image_backups.push({ file, image_files: files.length, paths_sha256: crypto.createHash("sha256").update(files.sort().join("\n")).digest("hex"), paths: files });
    } catch (error) {
      result.image_backups.push({ file, error: error.message.split("\n")[0] });
    }
  }
}
console.log(JSON.stringify(result, null, 2));
