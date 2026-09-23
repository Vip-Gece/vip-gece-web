"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");
const { createOriginalImageStorage, immutableWrite } = require("../src/services/profileOriginalArchiveService");
const { sanitizeCustomerProfileImage } = require("../src/services/customerProfileImageService");

let root, source;
const oldUrl = process.env.SUPABASE_URL;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vip-original-test-"));
  process.env.SUPABASE_URL = "https://fixture.supabase.co";
  source = await sharp({ create: { width: 2300, height: 1400, channels: 3, background: "#168878" } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
});
after(async () => {
  if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
  await fs.rm(root, { recursive: true, force: true });
});

function fixture(options = {}) {
  const objects = new Map();
  const flags = { fail: false, corrupt: false, badUrl: false };
  const bucket = {
    async upload(key, body) {
      if (flags.fail) return { error: { status: 503 } };
      if (objects.has(key)) return { error: { status: 409 } };
      objects.set(key, Buffer.from(body));
      return { error: null };
    },
    async download(key) {
      if (!objects.has(key)) return { error: { status: 404 } };
      return { data: new Blob([flags.corrupt ? Buffer.from("corrupt") : objects.get(key)]) };
    },
    getPublicUrl(key) { return { data: { publicUrl: `https://${flags.badUrl ? "wrong" : "fixture"}.supabase.co/storage/v1/object/public/images/${key}` } }; }
  };
  const directory = path.join(root, crypto.randomUUID());
  const storage = createOriginalImageStorage({ root: () => directory,
    client: () => ({ storage: { from: (name) => { assert.equal(name, "images"); return bucket; } } }),
    sanitize: sanitizeCustomerProfileImage, ...options });
  const request = { accountScope: "owner-1", profileId: "profile-1", uploadId: crypto.randomUUID(), body: source };
  const uploadDir = path.join(directory, request.accountScope, request.profileId, request.uploadId);
  return { storage, request, uploadDir, objects, flags, directory };
}

test("retains byte-exact source; publishes bounded, oriented derivative without EXIF", async () => {
  const f = fixture();
  const result = await f.storage.publish(f.request);
  assert.deepEqual(await fs.readFile(path.join(f.uploadDir, "original.bin")), source);
  assert.equal(result.originalSaved, true);
  assert.equal(f.objects.size, 1);
  const metadata = await sharp([...f.objects.values()][0]).metadata();
  assert.ok(metadata.width < metadata.height);
  assert.ok(metadata.height <= 2048);
  assert.equal(metadata.exif, undefined);
  assert.ok(result.size <= 2500000);
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(f.uploadDir)).mode & 0o077, 0);
    assert.equal((await fs.stat(path.join(f.uploadDir, "original.bin"))).mode & 0o077, 0);
  }
});

test("same upload ID is idempotent including concurrent retries", async () => {
  const f = fixture();
  const results = await Promise.all([f.storage.publish(f.request), f.storage.publish(f.request)]);
  assert.equal(results[0].publicPath, results[1].publicPath);
  assert.equal(f.objects.size, 1);
  assert.equal((await f.storage.publish(f.request)).publicPath, results[0].publicPath);
  assert.ok(!(await fs.readdir(f.uploadDir)).some(n => n.endsWith(".tmp")));
});

test("same upload ID with different bytes conflicts without overwriting original", async () => {
  const f = fixture();
  await f.storage.publish(f.request);
  await assert.rejects(f.storage.publish({ ...f.request, body: Buffer.from("different") }), { code: "IMAGE_UPLOAD_ID_CONFLICT" });
  assert.deepEqual(await fs.readFile(path.join(f.uploadDir, "original.bin")), source);
});

test("remote outage preserves original and supports recovery without re-encoding", async () => {
  const f = fixture();
  f.flags.fail = true;
  await assert.rejects(f.storage.publish(f.request));
  assert.deepEqual(await fs.readFile(path.join(f.uploadDir, "original.bin")), source);
  f.flags.fail = false;
  await f.storage.recover(f.request);
  f.objects.clear();
  const recovered = await f.storage.recover(f.request);
  assert.equal(recovered.originalSaved, true);
  assert.equal(f.objects.size, 1);
});

test("missing storage configuration still preserves original but never reports success", async () => {
  const f = fixture({ client: () => null });
  await assert.rejects(f.storage.publish(f.request), { code: "IMAGE_STORAGE_NOT_CONFIGURED" });
  assert.deepEqual(await fs.readFile(path.join(f.uploadDir, "original.bin")), source);
});

test("unverified remote bytes and cross-project URLs are rejected", async () => {
  const f = fixture();
  f.flags.corrupt = true;
  await assert.rejects(f.storage.publish(f.request), { code: "IMAGE_STORAGE_HASH_MISMATCH" });
  f.flags.corrupt = false;
  f.flags.badUrl = true;
  await assert.rejects(f.storage.recover(f.request), { code: "INVALID_IMAGE_STORAGE_URL" });
  await assert.rejects(fs.access(path.join(f.uploadDir, "uploaded.json")));
});

test("link journal requires verified matching upload", async () => {
  const f = fixture();
  await assert.rejects(f.storage.markLinked({ ...f.request, publicPath: "bad" }));
  const stored = await f.storage.publish(f.request);
  await assert.rejects(f.storage.markLinked({ ...f.request, publicPath: "bad" }), { code: "IMAGE_LINK_CONFLICT" });
  await f.storage.markLinked({ ...f.request, publicPath: stored.publicPath });
  assert.equal(JSON.parse(await fs.readFile(path.join(f.uploadDir, "linked.json"))).publicPath, stored.publicPath);
});

test("invalid image never reaches storage or original file", async () => {
  const f = fixture();
  await assert.rejects(f.storage.publish({ ...f.request, body: Buffer.from("not an image") }));
  assert.equal(f.objects.size, 0);
  await assert.rejects(fs.access(path.join(f.uploadDir, "original.bin")));
});

test("path traversal and non-UUID request IDs fail closed", async () => {
  const f = fixture();
  for (const bad of [{ profileId: "../outside" }, { accountScope: "../owner" }, { uploadId: "../123" }]) {
    await assert.rejects(f.storage.publish({ ...f.request, ...bad }), { code: "INVALID_IMAGE_UPLOAD_ID" });
  }
  assert.equal(f.objects.size, 0);
});

test("partial archive write fails; original remains available and no remote write occurs", async () => {
  const f = fixture({ write: async (file, body) => {
    if (file.endsWith("display.jpg")) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    return immutableWrite(file, body);
  } });
  await assert.rejects(f.storage.publish(f.request), { code: "ENOSPC" });
  assert.deepEqual(await fs.readFile(path.join(f.uploadDir, "original.bin")), source);
  assert.equal(f.objects.size, 0);
});

test("immutable writer never replaces existing content and removes temporary files", async () => {
  const dir = await fs.mkdtemp(path.join(root, "writer-"));
  const file = path.join(dir, "value");
  await immutableWrite(file, Buffer.from("first"));
  await assert.rejects(immutableWrite(file, Buffer.from("second")), { code: "IMAGE_UPLOAD_ID_CONFLICT" });
  assert.deepEqual(await fs.readdir(dir), ["value"]);
});

test("backup copy restores a verified upload, source tampering prevents recovery", async () => {
  const f = fixture();
  await f.storage.publish(f.request);
  const backup = path.join(root, crypto.randomUUID());
  await fs.cp(f.directory, backup, { recursive: true });
  const relative = path.relative(f.directory, f.uploadDir);
  assert.deepEqual(await fs.readFile(path.join(backup, relative, "original.bin")), source);
  await fs.writeFile(path.join(f.uploadDir, "original.bin"), "tampered");
  await assert.rejects(f.storage.recover(f.request), { code: "ORIGINAL_IMAGE_HASH_MISMATCH" });
});
