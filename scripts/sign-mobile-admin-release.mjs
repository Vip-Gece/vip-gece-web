import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { canonicalManifest } = require("../src/services/mobileReleaseManifest");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const downloads = path.join(ROOT, "public", "downloads");
const candidatePath = path.join(downloads, "vip-gece-admin-latest.apk");
const rollbackPath = path.join(downloads, "vip-gece-admin-rollback-1.2.0.apk");
const manifestPath = path.join(downloads, "vip-gece-admin-latest.json");
const privateKeyPath = process.env.VIP_GECE_UPDATE_PRIVATE_KEY ||
  path.join(os.homedir(), ".codex", ".secrets", "vip-gece-update-manifest-private.pem");

function artifact(filePath) {
  const body = fs.readFileSync(filePath);
  return {
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
    size_bytes: body.length
  };
}

const candidate = artifact(candidatePath);
const rollback = artifact(rollbackPath);
const manifest = {
  manifest_version: 1,
  ok: true,
  app: "vip-gece-admin",
  platform: "android",
  package_name: "com.vipgece.admin",
  version_name: "1.2.0",
  version_code: 5,
  build_label: "20260716-signed-api-updater",
  apk_url: "/public/downloads/vip-gece-admin-latest.apk",
  ...candidate,
  mandatory: false,
  release_certificate_sha256: "6753a6386bd7f6e7166e66b5358c466dbd9d555e1693dd8ae233b6184bb686cf",
  health_url: "/api/health",
  rollback: {
    version_name: "1.1.1-rollback",
    version_code: 6,
    apk_url: "/public/downloads/vip-gece-admin-rollback-1.2.0.apk",
    ...rollback
  },
  release_notes: "Imzali API guncellemesi, arka plan indirme, APK hash ve sertifika dogrulamasi, saglik testi ve otomatik rollback eklendi.",
  updated_at: new Date().toISOString()
};

const privateKey = fs.readFileSync(privateKeyPath, "utf8");
manifest.signature = crypto.sign(
  "RSA-SHA256",
  Buffer.from(canonicalManifest(manifest), "utf8"),
  privateKey
).toString("base64");

const tempPath = `${manifestPath}.tmp-${process.pid}`;
fs.writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
fs.renameSync(tempPath, manifestPath);
console.log(`Signed Android release manifest: versionCode=${manifest.version_code}, bytes=${manifest.size_bytes}`);
