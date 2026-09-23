"use strict";

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { ROOT_DIR } = require("../config/env");
const { getSupabaseServiceClient } = require("../data/supabaseClient");

const BUCKET = "images";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = (body) => crypto.createHash("sha256").update(body).digest("hex");

function archiveRoot() {
  const configured = String(process.env.CUSTOMER_PROFILE_ORIGINAL_DIR || "").trim();
  const root = configured ? path.resolve(configured) : process.env.NODE_ENV === "production"
    ? "/var/lib/vip-gece/customer-profile-originals"
    : path.join(ROOT_DIR, ".data", "customer-profile-originals");
  if (process.env.NODE_ENV === "production" && (root === ROOT_DIR || root.startsWith(ROOT_DIR + path.sep))) {
    throw new Error("Original image archive must be outside the application root.");
  }
  return root;
}

function storageError(code, status = 503) {
  return Object.assign(new Error(code), { code, status });
}

function parts(accountScope, profileId, uploadId) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(accountScope || "") ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(profileId || "") || !UUID.test(uploadId || "")) {
    throw storageError("INVALID_IMAGE_UPLOAD_ID", 400);
  }
  return [accountScope, profileId, uploadId];
}

async function privateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
    throw storageError("UNSAFE_ORIGINAL_ARCHIVE");
  }
}

async function privateRead(file, maxBytes = 8 * 1024 * 1024) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes ||
      (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
    throw storageError("UNSAFE_ARCHIVE_OBJECT");
  }
  return fs.readFile(file);
}

async function syncDirectory(directory) {
  if (process.platform === "win32") return;
  const handle = await fs.open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

// A synced temporary file is linked, never overwritten. Concurrent retries
// either see the complete existing object or atomically publish their own copy.
async function immutableWrite(file, body) {
  const temporary = file + "." + crypto.randomUUID() + ".tmp";
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(body);
      await handle.sync();
    } finally { await handle.close(); }
    try { await fs.link(temporary, file); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const stored = await privateRead(file);
    if (!stored.equals(body)) throw storageError("IMAGE_UPLOAD_ID_CONFLICT", 409);
    await syncDirectory(path.dirname(file));
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

function createOriginalImageStorage({
  root = archiveRoot,
  client = getSupabaseServiceClient,
  sanitize,
  write = immutableWrite
}) {
  if (typeof sanitize !== "function") throw new Error("Image sanitizer required.");

  async function directoryFor(accountScope, profileId, uploadId) {
    const segments = parts(accountScope, profileId, uploadId);
    let directory = root();
    await privateDirectory(directory);
    for (const segment of segments) {
      directory = path.join(directory, segment);
      await privateDirectory(directory);
    }
    return directory;
  }

  async function publish({ accountScope, profileId, body, uploadId = crypto.randomUUID() }) {
    parts(accountScope, profileId, uploadId);
    if (!Buffer.isBuffer(body) || body.length > 8 * 1024 * 1024) throw storageError("INVALID_IMAGE_BODY", 400);
    const directory = await directoryFor(accountScope, profileId, uploadId);
    let existing;
    try { existing = JSON.parse(await privateRead(path.join(directory, "manifest.json"), 16384)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing) {
      if (hash(body) !== existing.original.sha256) throw storageError("IMAGE_UPLOAD_ID_CONFLICT", 409);
      return recover({ accountScope, profileId, uploadId });
    }
    const sanitized = await sanitize(body);
    const original = { sha256: hash(body), bytes: body.length, ...sanitized.source };
    const objectKey = `profiles/customer/${accountScope}/${profileId}/${uploadId}.jpg`;
    const manifest = {
      version: 1, uploadId, accountScope, profileId, original,
      derivative: { sha256: hash(sanitized.body), bytes: sanitized.body.length,
        width: sanitized.width, height: sanitized.height, contentType: sanitized.contentType,
        bucket: BUCKET, objectKey }
    };

    await write(path.join(directory, "original.bin"), body);
    await write(path.join(directory, "display.jpg"), sanitized.body);
    await write(path.join(directory, "manifest.json"), Buffer.from(JSON.stringify(manifest)));
    return transfer(directory, manifest, sanitized.body);
  }

  async function transfer(directory, manifest, body) {
    const supabase = client();
    if (!supabase) throw storageError("IMAGE_STORAGE_NOT_CONFIGURED");
    const { objectKey, contentType, width, height } = manifest.derivative;
    const storage = supabase.storage.from(BUCKET);
    const { error } = await storage.upload(objectKey, body, {
      contentType, cacheControl: "31536000", upsert: false
    });
    if (error && ![400, 409].includes(Number(error.statusCode || error.status))) throw error;
    // Also verifies duplicate retries and ambiguous upload outcomes, not just a URL string.
    const downloaded = await storage.download(objectKey);
    if (downloaded.error || !downloaded.data) throw downloaded.error || storageError("IMAGE_STORAGE_VERIFICATION_FAILED");
    if (downloaded.data.size > 3 * 1024 * 1024) throw storageError("IMAGE_STORAGE_HASH_MISMATCH");
    const remote = Buffer.from(await downloaded.data.arrayBuffer());
    if (hash(remote) !== manifest.derivative.sha256) throw storageError("IMAGE_STORAGE_HASH_MISMATCH");
    const publicPath = storage.getPublicUrl(objectKey)?.data?.publicUrl;
    const tenant = new URL(String(process.env.SUPABASE_URL || ""));
    const publicUrl = new URL(publicPath);
    if (publicUrl.protocol !== "https:" || publicUrl.origin !== tenant.origin ||
        publicUrl.pathname !== `/storage/v1/object/public/${BUCKET}/${objectKey}` ||
        publicUrl.search || publicUrl.hash) throw storageError("INVALID_IMAGE_STORAGE_URL");
    await write(path.join(directory, "uploaded.json"), Buffer.from(JSON.stringify({ publicPath, sha256: manifest.derivative.sha256 })));
    return {
      uploadId: manifest.uploadId, publicPath, filePath: path.join(directory, "display.jpg"),
      contentType, size: body.length, width, height, originalSaved: true
    };
  }

  async function markLinked({ accountScope, profileId, uploadId, publicPath }) {
    const directory = await directoryFor(accountScope, profileId, uploadId);
    const uploaded = JSON.parse(await privateRead(path.join(directory, "uploaded.json"), 16384));
    if (uploaded.publicPath !== publicPath) throw storageError("IMAGE_LINK_CONFLICT", 409);
    await write(path.join(directory, "linked.json"), Buffer.from(JSON.stringify({ publicPath })));
  }

  async function recover({ accountScope, profileId, uploadId }) {
    const directory = await directoryFor(accountScope, profileId, uploadId);
    const manifest = JSON.parse(await privateRead(path.join(directory, "manifest.json"), 16384));
    if (manifest.accountScope !== accountScope || manifest.profileId !== profileId || manifest.uploadId !== uploadId) {
      throw storageError("IMAGE_ARCHIVE_BINDING_MISMATCH");
    }
    const body = await privateRead(path.join(directory, "original.bin"));
    if (hash(body) !== manifest.original.sha256) throw storageError("ORIGINAL_IMAGE_HASH_MISMATCH");
    const display = await privateRead(path.join(directory, "display.jpg"));
    if (hash(display) !== manifest.derivative.sha256 || manifest.derivative.bucket !== BUCKET ||
        manifest.derivative.objectKey !== `profiles/customer/${accountScope}/${profileId}/${uploadId}.jpg`) {
      throw storageError("DERIVATIVE_IMAGE_HASH_MISMATCH");
    }
    return transfer(directory, manifest, display);
  }

  return { publish, markLinked, recover };
}

module.exports = { archiveRoot, createOriginalImageStorage, immutableWrite, privateRead, privateDirectory };
