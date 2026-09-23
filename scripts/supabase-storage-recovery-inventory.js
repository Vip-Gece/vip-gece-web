#!/usr/bin/env node
"use strict";

const path = require("path");

const repoRoot = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const { query } = require(path.join(repoRoot, "src", "data", "postgresClient.js"));
const { getPostgresProfiles } = require(path.join(repoRoot, "src", "data", "postgresProfilesRepo.js"));
const retiredHost = "hofblpqaxzhybozavtaz.supabase.co";

function retiredFileName(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (parsed.hostname.toLowerCase() !== retiredHost) return "";
    return decodeURIComponent(parsed.pathname.split("/").filter(Boolean).at(-1) || "");
  } catch {
    return "";
  }
}

async function main() {
  const profiles = await getPostgresProfiles();
  const owners = new Map();
  for (const profile of profiles) {
    for (const image of Array.isArray(profile.images) ? profile.images : []) {
      const fileName = retiredFileName(image);
      if (!fileName) continue;
      owners.set(fileName, {
        profile_id: String(profile.id),
        slug: String(profile.slug || ""),
        name: String(profile.name || "")
      });
    }
  }
  const fileNames = [...owners.keys()];
  const buckets = await query(`
    select bucket_id, count(*)::bigint as object_count
    from storage.objects
    group by bucket_id
    order by bucket_id
  `);
  const matches = await query(`
    select
      bucket_id,
      name,
      created_at,
      updated_at,
      coalesce((metadata ->> 'size')::bigint, 0) as bytes
    from storage.objects
    where regexp_replace(name, '^.*/', '') = any($1::text[])
    order by bucket_id, name
  `, [fileNames]);

  console.log(JSON.stringify({
    missing_file_count: fileNames.length,
    buckets: buckets.rows.map((row) => ({ ...row, object_count: Number(row.object_count) })),
    matched_object_count: matches.rows.length,
    matches: matches.rows.map((row) => ({
      ...row,
      bytes: Number(row.bytes || 0),
      owner: owners.get(row.name.split("/").at(-1)) || null
    }))
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
