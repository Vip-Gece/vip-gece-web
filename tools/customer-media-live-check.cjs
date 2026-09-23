"use strict";

// Real loopback HTTP, Postgres and Storage acceptance using disposable, never-published fixtures.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
if (!root.startsWith("/var/tmp/vip-gece-android-capture-")) throw new Error("Isolated server test tree required");
const digest = value => crypto.createHash("sha256").update(value).digest("hex");

async function main() {
  const production = require("dotenv").parse(await fs.readFile("/var/www/vip-gece-site/.env"));
  if (new URL(production.DATABASE_URL).hostname !== "db.rklydqhknkhcydoijmlq.supabase.co" ||
      new URL(production.SUPABASE_URL).hostname !== "rklydqhknkhcydoijmlq.supabase.co") throw new Error("Unexpected target");
  const scratch = await fs.mkdtemp(path.join(path.dirname(root), "media-acceptance-"));
  await fs.chmod(scratch, 0o700);
  Object.assign(process.env, {
    NODE_ENV: "production", DATABASE_URL: production.DATABASE_URL,
    DATABASE_SSL: "true", DATABASE_SSL_REJECT_UNAUTHORIZED: "true",
    DATABASE_SSL_CA_FILE: "/var/www/vip-gece-site/current/server/certs/supabase-root-2021-ca.crt",
    DATABASE_SLOW_QUERY_MS: "30000", SUPABASE_URL: production.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: production.SUPABASE_SERVICE_ROLE_KEY,
    CUSTOMER_ACCOUNT_STORE_BACKEND: "postgres", CUSTOMER_MOBILE_ENABLED: "true",
    CUSTOMER_GATEWAY_ORIGIN_SECRET: crypto.randomBytes(48).toString("hex"),
    CUSTOMER_MOBILE_SESSION_SECRET: crypto.randomBytes(48).toString("hex"),
    CUSTOMER_ACCESS_SESSION_SECRET: crypto.randomBytes(48).toString("hex"),
    ANALYTICS_EVENT_PROOF_SECRET: crypto.randomBytes(48).toString("hex"),
    PROFILE_IMAGE_PROXY_SECRET: crypto.randomBytes(48).toString("hex"),
    CUSTOMER_PROFILE_STORAGE_MODE: "server-original-supabase",
    CUSTOMER_PROFILE_ORIGINAL_DIR: path.join(scratch, "originals"),
    CUSTOMER_PROFILE_IMAGE_DIR: path.join(scratch, "local-images")
  });
  const express = require("express");
  const sharp = require("sharp");
  const database = require("../src/data/postgresClient");
  const service = require("../src/services/customerMobileAccountService");
  const images = require("../src/services/customerProfileImageService");
  const archive = require("../src/services/profileOriginalArchiveService");
  const storage = require("../src/data/supabaseClient").getSupabaseServiceClient().storage.from("images");
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const owners = ids.map(id => `customer:${id}`);
  const uploadId = crypto.randomUUID();
  const accountScope = digest(owners[0]).slice(0, 32);
  const proof = { passed: [], cleanup_verified: false, physical_device: false, deployed_gateway: false };
  const profileSnapshot = async () => (await database.query("select count(*)::int as count, md5(coalesce(string_agg(md5(row_to_json(p)::text), '' order by id::text), '')) as digest from public.profiles p")).rows[0];
  const baseline = await profileSnapshot();
  const accountBaseline = (await database.query("select id, md5(data::text) as digest from private.customer_accounts order by id")).rows;
  let server, objectKey, completed = false;
  try {
    await images.assertCustomerProfileImageStorageReady();
    const app = express();
    app.use(express.json({ limit: "64kb" }));
    app.use(require("../src/routes/customerMobileRoutes").createCustomerMobileRouter());
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => server.once("listening", resolve).once("error", reject));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (method, route, token, body, type = "application/json") => {
      const response = await fetch(origin + "/api/customer/mobile" + route, {
        method, headers: { "Content-Type": type, "X-Customer-Origin-Secret": process.env.CUSTOMER_GATEWAY_ORIGIN_SECRET,
          "X-Customer-Client-IP": "127.0.0.1", "X-Upload-Id": uploadId, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body), signal: AbortSignal.timeout(90000)
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      return { status: response.status, type: response.headers.get("content-type"),
        body: response.headers.get("content-type")?.includes("application/json") ? JSON.parse(bytes) : bytes };
    };
    const tokens = [];
    for (const id of ids) {
      const email = `acceptance-${id}@example.invalid`, password = crypto.randomBytes(24).toString("base64url");
      const replacement = crypto.randomBytes(24).toString("base64url");
      await service.upsertCustomerMobileAccount(id, { email, password, auto_publish: false, max_profiles: 2 });
      const login = await request("POST", "/login", "", { identifier: email, password });
      assert.equal(login.status, 200);
      const token = login.body.session.token;
      const beforeChange = await request("GET", "/bootstrap", token);
      assert.equal(beforeChange.status, 403);
      assert.equal(beforeChange.body.code, "PASSWORD_CHANGE_REQUIRED");
      const change = await request("POST", "/password", token, { current_password: password, new_password: replacement });
      assert.equal(change.status, 200);
      assert.equal((await request("GET", "/bootstrap", token)).status, 401);
      tokens.push(change.body.session.token);
    }
    proof.passed.push("http_login_mandatory_password_change_session_revocation");
    const created = await request("POST", "/profiles", tokens[0], { name: "Acceptance Fixture" });
    assert.equal(created.status, 201);
    const profile = created.body.profile;
    assert.equal(profile.is_live, false);
    const route = `/profiles/${profile.id}`;
    assert.equal((await request("GET", route, tokens[1])).status, 404);
    assert.equal((await request("PUT", route, tokens[1], { name: "Other fixture" })).status, 404);
    assert.equal((await request("GET", "/bootstrap", tokens[1])).body.profiles.length, 0);
    proof.passed.push("own_draft_creation_cross_fixture_read_write_denied");
    const original = await sharp({ create: { width: 96, height: 64, channels: 3, background: { r: 30, g: 120, b: 90 } } }).png().toBuffer();
    objectKey = `profiles/customer/${accountScope}/${profile.id}/${uploadId}.jpg`;
    const upload = await request("POST", route + "/images", tokens[0], original, "image/png");
    assert.equal(upload.status, 201);
    assert.equal(upload.body.original_saved, true);
    assert.equal(upload.body.upload_id, uploadId);
    assert.equal(upload.body.profile.images.length, 1);
    const retry = await request("POST", route + "/images", tokens[0], original, "image/png");
    assert.equal(retry.status, 201);
    assert.equal(retry.body.profile.images.length, 1);
    const directory = path.join(process.env.CUSTOMER_PROFILE_ORIGINAL_DIR, accountScope, profile.id, uploadId);
    assert.deepEqual(await archive.privateRead(path.join(directory, "original.bin")), original);
    const manifest = JSON.parse(await archive.privateRead(path.join(directory, "manifest.json")));
    assert.equal(manifest.original.sha256, digest(original));
    const downloaded = await storage.download(objectKey);
    assert.equal(downloaded.error, null);
    const derivative = Buffer.from(await downloaded.data.arrayBuffer());
    assert.equal(digest(derivative), manifest.derivative.sha256);
    assert.equal((await sharp(derivative).metadata()).format, "jpeg");
    proof.passed.push("byte_exact_server_original_verified_supabase_jpeg_idempotent_retry");
    const photo = await request("GET", route + "/images/0", tokens[0]);
    assert.equal(photo.status, 200);
    assert.ok(photo.type.startsWith("image/jpeg"));
    assert.equal((await request("GET", route + "/images/0", tokens[1])).status, 404);
    proof.passed.push("authenticated_photo_delivery_other_fixture_denied");
    const backup = path.join(scratch, "backup"), restored = path.join(scratch, "restored");
    await fs.cp(process.env.CUSTOMER_PROFILE_ORIGINAL_DIR, backup, { recursive: true, errorOnExist: true, force: false });
    await fs.cp(backup, restored, { recursive: true, errorOnExist: true, force: false });
    const removed = await storage.remove([objectKey]);
    assert.equal(removed.error, null);
    const recovered = await archive.createOriginalImageStorage({ root: () => restored, sanitize: images.sanitizeCustomerProfileImage })
      .recover({ accountScope, profileId: profile.id, uploadId });
    assert.equal(recovered.originalSaved, true);
    assert.equal(digest(await archive.privateRead(path.join(restored, accountScope, profile.id, uploadId, "original.bin"))), digest(original));
    const finalCopy = await storage.download(objectKey);
    assert.equal(finalCopy.error, null);
    assert.equal(digest(Buffer.from(await finalCopy.data.arrayBuffer())), manifest.derivative.sha256);
    proof.passed.push("restore_from_separate_archive_copy_recreates_verified_storage_object");
    const active = (await database.query("select count(*)::int as count from public.profiles where owner_user_id=any($1::text[]) and is_active=true", [owners])).rows[0];
    assert.equal(active.count, 0);
    completed = true;
  } finally {
    if (server) { const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closed; }
    if (objectKey) {
      const removed = await storage.remove([objectKey]);
      assert.equal(removed.error, null, "Fixture remote object cleanup failed");
      const listed = await storage.list(path.posix.dirname(objectKey), { search: path.posix.basename(objectKey) });
      assert.equal(listed.error, null);
      assert.equal(listed.data.length, 0);
    }
    await database.transaction(async client => {
      await client.query("delete from public.profiles where owner_user_id=any($1::text[])", [owners]);
      await client.query("delete from private.customer_accounts where id=any($1::text[]) and email=any($2::text[])", [ids, ids.map(id => `acceptance-${id}@example.invalid`)]);
    });
    assert.deepEqual(await profileSnapshot(), baseline, "Existing profile baseline changed");
    assert.deepEqual((await database.query("select id, md5(data::text) as digest from private.customer_accounts order by id")).rows, accountBaseline);
    const resolved = await fs.realpath(scratch);
    if (resolved !== scratch || !resolved.startsWith(path.dirname(root) + "/media-acceptance-")) throw new Error("Unexpected scratch cleanup target");
    await fs.rm(resolved, { recursive: true });
    proof.cleanup_verified = true;
    proof.completed = completed;
    await fs.writeFile(path.join(root, "customer-media-live-proof.json"), JSON.stringify(proof, null, 2));
    console.log(JSON.stringify(proof));
  }
}
main().catch(error => { console.error(JSON.stringify({ failed: true, type: error.name, code: error.code || null,
  frames: String(error.stack || "").split("\n").slice(1, 5),
  message: error.name === "AssertionError" ? error.message : undefined })); process.exitCode = 1; });
