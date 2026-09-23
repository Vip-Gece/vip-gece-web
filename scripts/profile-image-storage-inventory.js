#!/usr/bin/env node
"use strict";

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const repoRoot = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const storageRoot = path.resolve(
  process.argv[3] ||
  process.env.CUSTOMER_PROFILE_IMAGE_DIR ||
  "/var/lib/vip-gece/customer-profile-images"
);
const retiredHost = "hofblpqaxzhybozavtaz.supabase.co";

function clean(value) {
  return String(value || "").trim();
}

function imageFileName(value) {
  const match = clean(value).match(
    /^\/media\/customer-profile\/[^/]+\/[^/]+\/([a-f0-9-]{36}\.(?:jpg|png|webp))$/i
  );
  return match ? match[1].toLowerCase() : "";
}

function directoryFiles(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^[a-f0-9-]{36}\.(?:jpg|png|webp)$/i.test(entry.name))
      .map((entry) => {
        const filePath = path.join(directory, entry.name);
        const stat = fs.statSync(filePath);
        return {
          name: entry.name.toLowerCase(),
          sha256: crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
          bytes: stat.size,
          modified_at: stat.mtime.toISOString()
        };
      });
  } catch {
    return [];
  }
}

function storageDirectories() {
  const rows = [];
  for (const scopeEntry of fs.readdirSync(storageRoot, { withFileTypes: true })) {
    if (!scopeEntry.isDirectory()) continue;
    const scopePath = path.join(storageRoot, scopeEntry.name);
    for (const profileEntry of fs.readdirSync(scopePath, { withFileTypes: true })) {
      if (!profileEntry.isDirectory()) continue;
      rows.push({
        scope: scopeEntry.name,
        profile_id: profileEntry.name,
        files: directoryFiles(path.join(scopePath, profileEntry.name))
      });
    }
  }
  return rows;
}

async function main() {
  const repo = require(path.join(repoRoot, "src", "data", "postgresProfilesRepo.js"));
  const profiles = await repo.getPostgresProfiles();
  const directories = storageDirectories();
  const byProfileId = new Map();

  for (const directory of directories) {
    const current = byProfileId.get(directory.profile_id) || [];
    current.push(directory);
    byProfileId.set(directory.profile_id, current);
  }

  const rows = profiles.map((profile) => {
    const images = Array.isArray(profile.images) ? profile.images : [];
    const referencedFiles = new Set(images.map(imageFileName).filter(Boolean));
    const diskDirectories = byProfileId.get(String(profile.id)) || [];
    const diskFiles = diskDirectories.flatMap((directory) => directory.files);
    const retiredRemote = images.filter((image) => {
      try {
        return new URL(clean(image)).hostname.toLowerCase() === retiredHost;
      } catch {
        return false;
      }
    }).length;

    return {
      id: String(profile.id),
      slug: clean(profile.slug),
      name: clean(profile.name),
      database_images: images.length,
      retired_remote_images: retiredRemote,
      referenced_local_images: referencedFiles.size,
      disk_images: diskFiles.length,
      unreferenced_disk_images: diskFiles.filter((file) => !referencedFiles.has(file.name)).length,
      disk_scopes: diskDirectories.map((directory) => directory.scope).sort()
    };
  });

  const knownIds = new Set(rows.map((row) => row.id));
  const retiredHashOwners = new Map();
  for (const profile of profiles) {
    for (const image of Array.isArray(profile.images) ? profile.images : []) {
      try {
        const parsed = new URL(clean(image));
        if (parsed.hostname.toLowerCase() !== retiredHost) continue;
        const fileName = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).at(-1) || "");
        const match = fileName.match(/^([a-f0-9]{64})\.(?:jpg|jpeg|png|webp)$/i);
        if (!match) continue;
        retiredHashOwners.set(match[1].toLowerCase(), {
          profile_id: String(profile.id),
          slug: clean(profile.slug),
          name: clean(profile.name)
        });
      } catch {
        // Ignore non-URL values; they cannot identify a retired storage object.
      }
    }
  }
  const knownHashesByProfile = new Map(
    profiles.map((profile) => {
      const diskFiles = (byProfileId.get(String(profile.id)) || []).flatMap(
        (directory) => directory.files
      );
      return [String(profile.id), new Set(diskFiles.map((file) => file.sha256))];
    })
  );
  const unmatchedDirectories = directories
    .filter((directory) => !knownIds.has(directory.profile_id))
    .map((directory) => ({
      scope: directory.scope,
      profile_id: directory.profile_id,
      disk_images: directory.files.length,
      bytes: directory.files.reduce((sum, file) => sum + file.bytes, 0),
      first_modified_at: directory.files.map((file) => file.modified_at).sort()[0] || "",
      last_modified_at: directory.files.map((file) => file.modified_at).sort().at(-1) || "",
      retired_reference_matches: directory.files
        .map((file) => ({ sha256: file.sha256, owner: retiredHashOwners.get(file.sha256) }))
        .filter((row) => row.owner)
        .map((row) => row.owner),
      exact_duplicates_with_active_profiles: [...knownHashesByProfile.entries()]
        .map(([profileId, hashes]) => ({
          profile_id: profileId,
          count: directory.files.filter((file) => hashes.has(file.sha256)).length
        }))
        .filter((row) => row.count > 0)
    }));
  const totals = {
    profile_count: rows.length,
    database_images: rows.reduce((sum, row) => sum + row.database_images, 0),
    retired_remote_images: rows.reduce((sum, row) => sum + row.retired_remote_images, 0),
    referenced_local_images: rows.reduce((sum, row) => sum + row.referenced_local_images, 0),
    matched_disk_images: rows.reduce((sum, row) => sum + row.disk_images, 0),
    matched_unreferenced_disk_images: rows.reduce(
      (sum, row) => sum + row.unreferenced_disk_images,
      0
    ),
    unmatched_directory_images: unmatchedDirectories.reduce(
      (sum, row) => sum + row.disk_images,
      0
    ),
    disk_images: directories.reduce((sum, row) => sum + row.files.length, 0)
  };

  console.log(JSON.stringify({ repo_root: repoRoot, storage_root: storageRoot, totals, profiles: rows, unmatched_directories: unmatchedDirectories }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
