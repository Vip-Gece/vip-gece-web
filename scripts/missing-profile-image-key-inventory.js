#!/usr/bin/env node
"use strict";

const path = require("path");

const repoRoot = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const retiredHost = "hofblpqaxzhybozavtaz.supabase.co";

function missingKey(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.hostname.toLowerCase() !== retiredHost) return "";
    return decodeURIComponent(parsed.pathname.split("/").filter(Boolean).at(-1) || "");
  } catch {
    return "";
  }
}

async function main() {
  const repo = require(path.join(repoRoot, "src", "data", "postgresProfilesRepo.js"));
  const profiles = await repo.getPostgresProfiles();
  const rows = profiles
    .map((profile) => ({
      id: String(profile.id),
      slug: String(profile.slug || ""),
      name: String(profile.name || ""),
      file_names: (Array.isArray(profile.images) ? profile.images : [])
        .map(missingKey)
        .filter(Boolean)
    }))
    .filter((profile) => profile.file_names.length > 0);
  console.log(JSON.stringify({ profile_count: rows.length, image_count: rows.reduce((sum, row) => sum + row.file_names.length, 0), profiles: rows }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
