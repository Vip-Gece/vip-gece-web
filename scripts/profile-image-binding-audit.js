#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const dns = require("node:dns/promises");

const repoRoot = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const configuredEnv = process.env.DOTENV_CONFIG_PATH;
if (configuredEnv) {
  require(path.join(repoRoot, "node_modules/dotenv")).config({ path: configuredEnv, override: true });
}
const { query } = require(path.join(repoRoot, "src/data/postgresClient"));
const { profileWithUsableImages } = require(path.join(repoRoot, "src/data/profilesRepo"));
const { getProfileSlug } = require(path.join(repoRoot, "src/utils/profile"));
const sharp = require(path.join(repoRoot, "node_modules/sharp"));
const storageRoot = path.resolve(process.env.CUSTOMER_PROFILE_IMAGE_DIR || "/var/lib/vip-gece/customer-profile-images");
const origin = new URL(process.env.PROFILE_AUDIT_ORIGIN || "http://127.0.0.1:3003");

function hostname(value) {
  try { return new URL(value).hostname; } catch { return ""; }
}

async function probe(url, decodeImage = false) {
  const attempts = [];
  for (let index = 0; index < 2; index++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: decodeImage ? "image/*" : "application/json", "User-Agent": "VIP-Gece-Binding-Audit/1.0" },
        signal: AbortSignal.timeout(15_000)
      });
      const body = Buffer.from(await response.arrayBuffer());
      const result = { status: response.status, bytes: body.length, content_type: response.headers.get("content-type") || "" };
      if (!response.ok && result.content_type.startsWith("application/json")) {
        try {
          const payload = JSON.parse(body.toString("utf8"));
          result.error = String(payload.message || payload.error || payload.code || "").slice(0, 200);
        } catch { /* Status and content type still identify the failed response. */ }
      }
      if (decodeImage && response.ok) {
        const metadata = await sharp(body).metadata();
        await sharp(body).stats();
        result.width = metadata.width;
        result.height = metadata.height;
        result.format = metadata.format;
      }
      result.ok = response.ok && body.length > 0 && (!decodeImage || Boolean(result.width && result.height));
      attempts.push(result);
      if (result.ok || response.status < 500) return { ...result, attempts };
    } catch (error) {
      attempts.push({ status: 0, ok: false, error: error.cause?.code || error.code || error.message });
    }
  }
  return { ...attempts.at(-1), attempts };
}

async function main() {
  const { rows } = await query("select id, name, slug, city, district, images, is_active from public.profiles order by id");
  const { rows: storage } = await query("select (select count(*)::int from storage.buckets) as buckets, (select count(*)::int from storage.objects) as objects");
  const apiResponse = await fetch(new URL("/api/v1/public/profiles", origin), { signal: AbortSignal.timeout(15_000) });
  if (!apiResponse.ok) throw new Error(`Public API status ${apiResponse.status}`);
  const live = await apiResponse.json();
  const liveBySlug = new Map(live.profiles.map((profile) => [profile.slug, profile]));
  const result = {
    checked_at: new Date().toISOString(),
    configuration: {
      release: fs.realpathSync(repoRoot),
      database_host: hostname(process.env.DATABASE_URL),
      supabase_host: hostname(process.env.SUPABASE_URL),
      supabase_profile_fallback: process.env.VIP_GECE_ALLOW_SUPABASE_PROFILE_DATA === "true",
      allowed_image_hosts: String(process.env.PROFILE_IMAGE_ALLOWED_HOSTS || "").split(",").filter(Boolean),
      storage_root: storageRoot,
      origin: origin.href
    },
    storage: storage[0],
    remote_sources: [],
    profiles: [],
    totals: { profiles: rows.length, db_image_references: 0, local_source_images: 0, local_source_errors: 0, origin_image_errors: 0, remote_image_references: 0, fallback_profiles: 0 }
  };
  const remoteSamples = new Map();
  for (const profile of rows) {
    const images = Array.isArray(profile.images) ? profile.images : [];
    const canonicalSlug = getProfileSlug(profile);
    const published = liveBySlug.get(canonicalSlug);
    const projected = profileWithUsableImages(profile);
    const row = { id: profile.id, name: profile.name, stored_slug: profile.slug, slug: canonicalSlug, active: profile.is_active, db_images: images.length, published_images: published?.images?.length || 0, fallback: published?.images?.some((image) => image.startsWith("/logo.png.webp")) || false, publication_matches_runtime: JSON.stringify(projected.images) === JSON.stringify(published?.images), images: [] };
    if (row.fallback) result.totals.fallback_profiles++;
    for (const image of images) {
      result.totals.db_image_references++;
      if (image.startsWith("/media/customer-profile/")) {
        result.totals.local_source_images++;
        const relative = image.slice("/media/customer-profile/".length);
        const target = path.resolve(storageRoot, relative);
        const record = { source: image, storage: target };
        try {
          if (!target.startsWith(storageRoot + path.sep)) throw new Error("Image path is outside storage");
          const stat = fs.lstatSync(target);
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Image is not a regular file");
          const meta = await sharp(target).metadata();
          await sharp(target).stats();
          record.file = { ok: true, bytes: stat.size, width: meta.width, height: meta.height, format: meta.format };
        } catch (error) {
          record.file = { ok: false, error: error.code || error.message };
          result.totals.local_source_errors++;
        }
        record.origin = await probe(new URL(image, origin), true);
        if (!record.origin.ok) result.totals.origin_image_errors++;
        record.variant = await probe(new URL(image + "?width=320&quality=72", origin), true);
        if (!record.variant.ok) result.totals.origin_image_errors++;
        row.images.push(record);
      } else {
        result.totals.remote_image_references++;
        const host = hostname(image);
        if (host && !remoteSamples.has(host)) remoteSamples.set(host, image);
        row.images.push({ source: image, kind: "remote" });
      }
    }
    result.profiles.push(row);
    console.error(JSON.stringify({ profile_id: profile.id, processed: result.profiles.length, profiles: rows.length }));
  }
  for (const [host, sample] of remoteSamples) {
    const remote = { host };
    try { remote.dns = { ok: true, addresses: await dns.resolve4(host) }; }
    catch (error) { remote.dns = { ok: false, code: error.code }; }
    remote.original_source = await probe(sample, true);
    if (process.env.SUPABASE_URL && hostname(process.env.SUPABASE_URL) !== host) {
      const replacement = new URL(sample);
      replacement.host = new URL(process.env.SUPABASE_URL).host;
      remote.same_object_on_current_project = await probe(replacement, true);
    }
    result.remote_sources.push(remote);
  }
  result.ready = await probe(new URL("/api/ready", origin));
  result.ok = result.totals.local_source_errors === 0 && result.totals.origin_image_errors === 0 && result.totals.fallback_profiles === 0 && result.remote_sources.every((source) => source.original_source.ok);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
