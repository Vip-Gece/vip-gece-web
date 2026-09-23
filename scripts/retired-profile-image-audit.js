#!/usr/bin/env node
"use strict";

const path = require("path");

const repoRoot = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const retiredHost = "hofblpqaxzhybozavtaz.supabase.co";
const concurrency = 2;
const intervalMs = 450;
let nextRequestAt = 0;

function clean(value) {
  return String(value || "").trim();
}

function isRetiredUrl(value) {
  try {
    return new URL(clean(value)).hostname.toLowerCase() === retiredHost;
  } catch {
    return false;
  }
}

async function waitForSlot() {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextRequestAt);
  nextRequestAt = scheduledAt + intervalMs;
  if (scheduledAt > now) {
    await new Promise((resolve) => setTimeout(resolve, scheduledAt - now));
  }
}

async function check(url) {
  await waitForSlot();
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        "User-Agent": "VIP-Gece-Retired-Image-Audit/1.0"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000)
    });
    const body = Buffer.from(await response.arrayBuffer());
    const isImage = clean(response.headers.get("content-type")).toLowerCase().startsWith("image/");
    return {
      ok: response.ok && isImage && body.length > 0,
      status: response.status,
      is_image: isImage,
      bytes: body.length
    };
  } catch (error) {
    return { ok: false, status: 0, is_image: false, bytes: 0, error: clean(error?.message || error) };
  }
}

async function mapConcurrent(items, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function main() {
  const repo = require(path.join(repoRoot, "src", "data", "postgresProfilesRepo.js"));
  const profiles = await repo.getPostgresProfiles();
  const candidates = profiles.flatMap((profile) =>
    (Array.isArray(profile.images) ? profile.images : [])
      .filter(isRetiredUrl)
      .map((url) => ({ slug: clean(profile.slug), name: clean(profile.name), url }))
  );
  const checks = await mapConcurrent(candidates, async (candidate) => ({
    ...candidate,
    result: await check(candidate.url)
  }));
  const grouped = new Map();
  for (const checkRow of checks) {
    const key = `${checkRow.slug}\u0000${checkRow.name}`;
    const row = grouped.get(key) || {
      slug: checkRow.slug,
      name: checkRow.name,
      checked: 0,
      working: 0,
      broken: 0,
      statuses: {}
    };
    row.checked += 1;
    row.working += checkRow.result.ok ? 1 : 0;
    row.broken += checkRow.result.ok ? 0 : 1;
    const status = String(checkRow.result.status);
    row.statuses[status] = (row.statuses[status] || 0) + 1;
    grouped.set(key, row);
  }

  const statuses = {};
  for (const checkRow of checks) {
    const status = String(checkRow.result.status);
    statuses[status] = (statuses[status] || 0) + 1;
  }
  console.log(JSON.stringify({
    checked_at: new Date().toISOString(),
    retired_host: retiredHost,
    profile_count: grouped.size,
    checked: checks.length,
    working: checks.filter((row) => row.result.ok).length,
    broken: checks.filter((row) => !row.result.ok).length,
    statuses,
    profiles: [...grouped.values()]
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
