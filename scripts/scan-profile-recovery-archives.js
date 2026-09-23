#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ARCHIVE_RE = /\.(?:7z|rar|zip|tar|tgz|tbz2?|txz|gz|bz2|xz)$/i;
const EXCLUDED_DIRECTORY_NAMES = new Set([
  "$recycle.bin",
  ".git",
  "node_modules",
  "system volume information",
  "adli_emanet",
  "kanitlar",
  "03 kurtarma ve delil",
  "02 cihaz yedekleri",
  "forensik-20260812",
  "mesaj_kanitlari_20260801-02"
]);

function parseArgs() {
  const args = process.argv.slice(2);
  const inventoryPath = args.shift();
  const depthArg = args.find((value) => value.startsWith("max-depth:"));
  const maxDepth = depthArg ? Number.parseInt(depthArg.slice("max-depth:".length), 10) : Infinity;
  const roots = args.filter((value) => !value.startsWith("max-depth:")).map((value) => {
    if (!value.startsWith("base64:")) return value;
    return Buffer.from(value.slice("base64:".length), "base64").toString("utf8");
  });
  if (!inventoryPath || roots.length === 0) {
    throw new Error(
      "Usage: node scripts/scan-profile-recovery-archives.js <inventory.json> <root> [root...]"
    );
  }
  return {
    inventoryPath: path.resolve(inventoryPath),
    roots: roots.map((root) => path.resolve(root)),
    maxDepth: Number.isInteger(maxDepth) && maxDepth >= 0 ? maxDepth : Infinity
  };
}

function buildNeedles(inventoryPath) {
  const payload = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  const needles = new Map();
  for (const profile of Array.isArray(payload.profiles) ? payload.profiles : []) {
    for (const fileName of Array.isArray(profile.file_names) ? profile.file_names : []) {
      needles.set(String(fileName).toLowerCase(), {
        kind: "missing_file_name",
        profile_id: String(profile.id || ""),
        slug: String(profile.slug || ""),
        name: String(profile.name || ""),
        value: String(fileName)
      });
    }
  }
  needles.set("hofblpqaxzhybozavtaz.supabase.co", {
    kind: "retired_supabase_host",
    value: "hofblpqaxzhybozavtaz.supabase.co"
  });
  return needles;
}

function walkArchives(roots, maxDepth) {
  const queue = roots.map((root) => ({ directory: root, depth: 0 }));
  const archives = [];
  const stats = { directories: 0, files: 0, read_errors: 0 };
  while (queue.length) {
    const { directory, depth } = queue.pop();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
      stats.directories += 1;
    } catch {
      stats.read_errors += 1;
      continue;
    }
    if (stats.directories % 500 === 0) {
      console.error(JSON.stringify({ phase: "walk", ...stats, archives: archives.length }));
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (depth < maxDepth && !EXCLUDED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) {
          queue.push({ directory: target, depth: depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      stats.files += 1;
      if (!ARCHIVE_RE.test(entry.name)) continue;
      try {
        const stat = fs.statSync(target);
        archives.push({ path: target, size: stat.size, mtime: stat.mtime.toISOString() });
      } catch {
        stats.read_errors += 1;
      }
    }
  }
  return { archives, stats };
}

function scanArchive(sevenZip, archive, needles) {
  return new Promise((resolve) => {
    const compoundTar = /\.(?:tar\.gz|tgz|tar\.bz2|tbz2?|tar\.xz|txz)$/i.test(archive.path);
    const extractor = compoundTar ? spawn(sevenZip, ["x", "-so", archive.path], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    }) : null;
    const child = spawn(
      sevenZip,
      compoundTar ? ["l", "-ttar", "-si", "-slt", "-ba"] : ["l", "-slt", "-ba", archive.path],
      { windowsHide: true, stdio: [compoundTar ? "pipe" : "ignore", "pipe", "pipe"] }
    );
    if (extractor) extractor.stdout.pipe(child.stdin);
    const found = new Map();
    let tail = "";
    let stderr = "";
    let listingBytes = 0;

    child.stdout.on("data", (chunk) => {
      listingBytes += chunk.length;
      const text = (tail + chunk.toString("utf8")).toLowerCase();
      for (const [needle, owner] of needles) {
        if (text.includes(needle)) found.set(needle, owner);
      }
      tail = text.slice(-2048);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4096) stderr += chunk.toString("utf8");
    });
    if (extractor) {
      extractor.stderr.on("data", (chunk) => {
        if (stderr.length < 4096) stderr += chunk.toString("utf8");
      });
      extractor.on("error", (error) => {
        if (stderr.length < 4096) stderr += error.message;
        child.stdin.destroy(error);
      });
    }
    child.on("error", (error) => {
      resolve({ ...archive, exit_code: null, error: error.message, listing_bytes: listingBytes, matches: [] });
    });
    child.on("close", (code) => {
      resolve({
        ...archive,
        exit_code: code,
        error: code === 0 ? null : stderr.trim().slice(0, 1000),
        listing_bytes: listingBytes,
        matches: [...found.values()]
      });
    });
  });
}

async function main() {
  const { inventoryPath, roots, maxDepth } = parseArgs();
  const sevenZip = process.env.SEVEN_ZIP || "C:\\Program Files\\7-Zip\\7z.exe";
  if (!fs.existsSync(sevenZip)) throw new Error(`7-Zip not found: ${sevenZip}`);
  const needles = buildNeedles(inventoryPath);
  const { archives, stats } = walkArchives(roots, maxDepth);
  const result = {
    inventory: inventoryPath,
    roots,
    max_depth: Number.isFinite(maxDepth) ? maxDepth : null,
    walk: stats,
    archive_count: archives.length,
    archive_bytes: archives.reduce((sum, archive) => sum + archive.size, 0),
    archives_scanned: 0,
    archive_errors: 0,
    matches: [],
    archives: []
  };

  for (const archive of archives.sort((a, b) => a.path.localeCompare(b.path))) {
    const scanned = await scanArchive(sevenZip, archive, needles);
    result.archives_scanned += 1;
    if (scanned.error) result.archive_errors += 1;
    if (scanned.matches.length) result.matches.push(scanned);
    result.archives.push(scanned);
    if (result.archives_scanned % 25 === 0 || scanned.matches.length) {
      console.error(JSON.stringify({
        phase: "archive_listing",
        archives_scanned: result.archives_scanned,
        archive_count: archives.length,
        archive_errors: result.archive_errors,
        matches: result.matches.length,
        current: archive.path
      }));
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
