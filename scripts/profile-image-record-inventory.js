#!/usr/bin/env node
"use strict";

const path = require("path");

const repoRoot = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const retiredHosts = new Set([
  "hofblpqaxzhybozavtaz.supabase.co",
  ...String(process.env.PROFILE_IMAGE_RETIRED_HOSTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
]);

function clean(value) {
  return String(value || "").trim();
}

function classifyImage(value) {
  const image = clean(value);
  if (!image) return "empty";
  if (image.startsWith("/logo.png.webp")) return "fallback";
  if (image.startsWith("/media/customer-profile/")) return "customer_profile";
  if (image.startsWith("/media/customer-upload/")) return "customer_upload";

  try {
    const parsed = new URL(image);
    if (retiredHosts.has(parsed.hostname.toLowerCase())) return "retired_remote";
    return "remote";
  } catch {
    return image.startsWith("/") ? "local" : "invalid";
  }
}

async function main() {
  const repo = require(path.join(repoRoot, "src", "data", "postgresProfilesRepo.js"));
  const profiles = await repo.getPostgresProfiles();
  const rows = profiles.map((profile) => {
    const images = Array.isArray(profile.images) ? profile.images : [];
    const kinds = images.map(classifyImage);
    const counts = {};
    for (const kind of kinds) counts[kind] = (counts[kind] || 0) + 1;

    return {
      slug: clean(profile.slug),
      name: clean(profile.name),
      active: profile.is_active === true,
      image_count: images.length,
      ...counts
    };
  });

  const totals = rows.reduce(
    (result, row) => {
      result.image_count += row.image_count;
      for (const key of [
        "customer_profile",
        "customer_upload",
        "retired_remote",
        "remote",
        "local",
        "fallback",
        "empty",
        "invalid"
      ]) {
        result[key] += Number(row[key] || 0);
      }
      return result;
    },
    {
      profile_count: rows.length,
      image_count: 0,
      customer_profile: 0,
      customer_upload: 0,
      retired_remote: 0,
      remote: 0,
      local: 0,
      fallback: 0,
      empty: 0,
      invalid: 0
    }
  );

  console.log(JSON.stringify({ repo_root: repoRoot, totals, profiles: rows }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
