"use strict";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const BUCKET = "images";
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MIME_EXTENSIONS = new Map([
  ["image/avif", "avif"],
  ["image/gif", "gif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} env eksik`);
  return value;
}

function normalizedOrigin(value, name) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.pathname !== "/") {
    throw new Error(`${name} yalniz https origin olmali`);
  }
  return parsed.origin;
}

function serviceHeaders(serviceKey, extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...extra
  };
}

function sourceImageUrl(value, sourceOrigin) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.origin === sourceOrigin &&
      parsed.pathname.startsWith("/storage/v1/object/public/")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

async function databaseClient(databaseUrl) {
  const ca = await readFile(path.join(ROOT_DIR, "server/certs/supabase-root-2021-ca.crt"), "utf8");
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: true, ca },
    connectionTimeoutMillis: 8_000,
    statement_timeout: 15_000,
    query_timeout: 20_000
  });
  await client.connect();
  return client;
}

async function ensurePublicBucket(targetOrigin, serviceKey) {
  const response = await fetch(`${targetOrigin}/storage/v1/bucket/${BUCKET}`, {
    headers: serviceHeaders(serviceKey),
    signal: AbortSignal.timeout(15_000)
  });
  if (response.ok) {
    const bucket = await response.json();
    if (bucket?.public !== true) {
      throw new Error(`Hedef ${BUCKET} bucket public degil`);
    }
    return;
  }
  const errorBody = await response.json().catch(() => null);
  const missingBucket = response.status === 404 ||
    errorBody?.code === "NoSuchBucket" ||
    String(errorBody?.statusCode || "") === "404";
  if (!missingBucket) {
    throw new Error(`Hedef bucket denetimi HTTP ${response.status}`);
  }

  const createResponse = await fetch(`${targetOrigin}/storage/v1/bucket`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: true,
      file_size_limit: MAX_IMAGE_BYTES,
      allowed_mime_types: [...MIME_EXTENSIONS.keys()]
    }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!createResponse.ok) {
    throw new Error(`Hedef bucket olusturma HTTP ${createResponse.status}`);
  }
}

async function downloadImage(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Kaynak gorsel HTTP ${response.status}`);

  const mime = String(response.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const extension = MIME_EXTENSIONS.get(mime);
  if (!extension) throw new Error(`Desteklenmeyen gorsel MIME: ${mime || "empty"}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`Gorsel boyutu gecersiz: ${bytes.length}`);
  }
  return { bytes, extension, mime };
}

async function uploadImage({ bytes, extension, mime }, targetOrigin, serviceKey) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  const objectPath = `vip-gece/profiles/migrated/${digest}.${extension}`;
  const response = await fetch(`${targetOrigin}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: "POST",
    headers: serviceHeaders(serviceKey, {
      "Content-Type": mime,
      "x-upsert": "true"
    }),
    body: bytes,
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Hedef gorsel yukleme HTTP ${response.status}`);
  return `${targetOrigin}/storage/v1/object/public/${BUCKET}/${objectPath}`;
}

async function verifyPublicImage(url) {
  const response = await fetch(url, {
    headers: { Range: "bytes=0-63" },
    signal: AbortSignal.timeout(20_000)
  });
  const mime = String(response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!response.ok || !MIME_EXTENSIONS.has(mime)) {
    throw new Error(`Hedef public gorsel dogrulamasi HTTP ${response.status} MIME ${mime || "empty"}`);
  }
}

async function main() {
  const databaseUrl = requiredEnv("DATABASE_URL");
  const sourceOrigin = normalizedOrigin(requiredEnv("SOURCE_SUPABASE_ORIGIN"), "SOURCE_SUPABASE_ORIGIN");
  const targetOrigin = normalizedOrigin(requiredEnv("SUPABASE_URL"), "SUPABASE_URL");
  const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (sourceOrigin === targetOrigin) throw new Error("Kaynak ve hedef Supabase origin ayni olamaz");
  if (serviceKey.length < 32) throw new Error("SUPABASE_SERVICE_ROLE_KEY gecersiz gorunuyor");

  const client = await databaseClient(databaseUrl);
  try {
    const { rows: profiles } = await client.query(
      "select id, images from public.profiles order by id"
    );
    const candidates = profiles.flatMap((profile) =>
      (Array.isArray(profile.images) ? profile.images : [])
        .map((image, index) => ({
          id: profile.id,
          image,
          index,
          source: sourceImageUrl(image, sourceOrigin)
        }))
        .filter((item) => item.source)
    );
    const uniqueSources = [...new Map(candidates.map((item) => [item.source.href, item.source])).values()];

    console.log(JSON.stringify({
      mode: APPLY ? "apply" : "dry-run",
      profiles: profiles.length,
      source_image_references: candidates.length,
      unique_source_images: uniqueSources.length
    }));
    if (!APPLY || !candidates.length) return;

    await ensurePublicBucket(targetOrigin, serviceKey);
    const replacements = new Map();
    let migrated = 0;
    for (const source of uniqueSources) {
      const downloaded = await downloadImage(source);
      const targetUrl = await uploadImage(downloaded, targetOrigin, serviceKey);
      await verifyPublicImage(targetUrl);
      replacements.set(source.href, targetUrl);
      migrated += 1;
      console.log(`ok migrated ${migrated}/${uniqueSources.length}`);
    }

    await client.query("begin");
    try {
      for (const profile of profiles) {
        const original = Array.isArray(profile.images) ? profile.images : [];
        const images = original.map((image) => {
          const source = sourceImageUrl(image, sourceOrigin);
          return source ? replacements.get(source.href) : image;
        });
        if (images.every((image, index) => image === original[index])) continue;

        const result = await client.query(
          "update public.profiles set images = $1::text[], updated_at = now() where id = $2 and images is not distinct from $3::text[]",
          [images, profile.id, original]
        );
        if (result.rowCount !== 1) throw new Error("Profil gorsel dizisi eszamanli olarak degisti");
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }

    const { rows: verification } = await client.query(
      "select count(*)::int as remaining from public.profiles, unnest(coalesce(images, array[]::text[])) image where image like $1",
      [`${sourceOrigin}%`]
    );
    if (verification[0]?.remaining !== 0) {
      throw new Error(`Kaynak Supabase gorsel baglantisi kaldi: ${verification[0]?.remaining}`);
    }
    console.log(JSON.stringify({ ok: true, migrated_unique_images: migrated, remaining_source_links: 0 }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
