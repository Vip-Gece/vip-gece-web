#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const hashContents = args.includes("--hash");
const positional = args.filter((arg) => !arg.startsWith("--"));
const inventoryPath = path.resolve(positional.shift() || "");
const roots = positional.map((value) => path.resolve(value));
const excludedDirectoryNames = new Set([
  "$recycle.bin",
  "system volume information",
  "windows",
  "program files",
  "program files (x86)",
  "programdata",
  "node_modules",
  ".git"
]);
const imageExtension = /\.(?:avif|gif|jpe?g|png|webp)$/i;

function wantedFiles() {
  const payload = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  const rows = [];
  for (const profile of Array.isArray(payload.profiles) ? payload.profiles : []) {
    for (const fileName of Array.isArray(profile.file_names) ? profile.file_names : []) {
      rows.push({
        file_name: String(fileName).toLowerCase(),
        sha256: String(fileName).replace(/\.[^.]+$/, "").toLowerCase(),
        profile_id: String(profile.id || ""),
        slug: String(profile.slug || ""),
        name: String(profile.name || "")
      });
    }
  }
  return rows;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const digest = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(digest.digest("hex")));
  });
}

async function main() {
  const wanted = wantedFiles();
  const byName = new Map(wanted.map((row) => [row.file_name, row]));
  const byHash = new Map(wanted.map((row) => [row.sha256, row]));
  const queue = [...roots];
  const result = {
    inventory: inventoryPath,
    roots,
    hash_contents: hashContents,
    directories_scanned: 0,
    files_scanned: 0,
    image_files_hashed: 0,
    read_errors: 0,
    matches: []
  };

  while (queue.length) {
    const directory = queue.pop();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
      result.directories_scanned += 1;
      if (result.directories_scanned % 500 === 0) {
        console.error(JSON.stringify({
          progress: true,
          directories_scanned: result.directories_scanned,
          files_scanned: result.files_scanned,
          image_files_hashed: result.image_files_hashed,
          matches: result.matches.length,
          pending_directories: queue.length
        }));
      }
    } catch {
      result.read_errors += 1;
      continue;
    }

    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!excludedDirectoryNames.has(entry.name.toLowerCase())) queue.push(target);
        continue;
      }
      if (!entry.isFile()) continue;
      result.files_scanned += 1;

      const nameMatch = byName.get(entry.name.toLowerCase());
      if (nameMatch) {
        result.matches.push({ match: "file_name", path: target, owner: nameMatch });
      }
      if (!hashContents || !imageExtension.test(entry.name)) continue;

      try {
        const stat = fs.statSync(target);
        if (stat.size < 1 || stat.size > 25 * 1024 * 1024) continue;
        const hash = await sha256File(target);
        result.image_files_hashed += 1;
        const hashMatch = byHash.get(hash);
        if (hashMatch) {
          result.matches.push({ match: "sha256", path: target, owner: hashMatch });
        }
      } catch {
        result.read_errors += 1;
      }
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
