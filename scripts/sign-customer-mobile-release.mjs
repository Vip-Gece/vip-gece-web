import crypto from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  canonicalCustomerMobileUpdate,
  normalizeDigest
} = require("../src/services/customerMobileUpdateManifest");

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const sourceApk = path.resolve(args.get("--apk") || "");
const versionCode = Number.parseInt(args.get("--version-code") || "", 10);
const versionName = String(args.get("--version-name") || "").trim();
const certificate = normalizeDigest(args.get("--certificate-sha256"));
const mandatoryValue = String(args.get("--mandatory") ?? "true").trim().toLowerCase();
const releaseNotes = String(
  args.get("--release-notes") ||
  "VIP Gece müşteri paneli kullanım ve güvenlik iyileştirmeleri."
).trim();
if (!sourceApk || !Number.isInteger(versionCode) || versionCode < 1 || !versionName) {
  throw new Error("--apk, --version-code ve --version-name gerekli.");
}
if (certificate.length !== 64) {
  throw new Error("--certificate-sha256 tam SHA-256 sertifika özeti olmalı.");
}
if (!["true", "false"].includes(mandatoryValue)) {
  throw new Error("--mandatory yalnız true veya false olabilir.");
}
if (!releaseNotes || releaseNotes.length > 500) {
  throw new Error("--release-notes 1 ile 500 karakter arasında olmalı.");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privateKeyPath = process.env.VIP_GECE_CUSTOMER_CONFIG_PRIVATE_KEY ||
  path.join(os.homedir(), ".codex", ".secrets", "vip-gece-customer-config-private.pem");
const downloads = path.join(root, "public", "downloads");
const safeVersionName = versionName.replace(/[^a-zA-Z0-9._-]/g, "-");
const apkUrl = String(
  args.get("--apk-url") ||
  `/public/downloads/vip-gece-customer-${safeVersionName}-${versionCode}.apk`
).trim();
if (!/^\/public\/downloads\/vip-gece-customer-[a-zA-Z0-9._-]+\.apk$/.test(apkUrl)) {
  throw new Error("--apk-url yalnız versioned VIP Gece APK yolu olabilir.");
}

const targetApk = path.join(root, apkUrl.slice(1));
const latestApk = path.join(downloads, "vip-gece-customer-latest.apk");
const targetManifest = path.join(downloads, "vip-gece-customer-latest.json");
if (path.dirname(targetApk) !== downloads) {
  throw new Error("--apk-url downloads klasörü dışına çıkamaz.");
}

await mkdir(downloads, { recursive: true });
const uniqueSuffix = `${process.pid}.${Date.now()}.tmp`;
const temporaryApk = `${targetApk}.${uniqueSuffix}`;
const temporaryLatestApk = `${latestApk}.${uniqueSuffix}`;
const temporaryManifest = `${targetManifest}.${uniqueSuffix}`;
let apkBytes;
let apkStat;

try {
  await copyFile(sourceApk, temporaryApk);
  await chmod(temporaryApk, 0o644);
  apkBytes = await readFile(temporaryApk);
  apkStat = await stat(temporaryApk);
  await rename(temporaryApk, targetApk);

  await copyFile(targetApk, temporaryLatestApk);
  await chmod(temporaryLatestApk, 0o644);
  await rename(temporaryLatestApk, latestApk);
} finally {
  await rm(temporaryApk, { force: true });
  await rm(temporaryLatestApk, { force: true });
}

const manifest = {
  manifest_version: 1,
  app: "vip-gece-customer",
  package_name: "com.vipgece.customer",
  version_code: versionCode,
  version_name: versionName,
  apk_url: apkUrl,
  sha256: crypto.createHash("sha256").update(apkBytes).digest("hex"),
  size_bytes: apkStat.size,
  release_certificate_sha256: certificate,
  mandatory: mandatoryValue === "true",
  release_notes: releaseNotes
};
manifest.signature = crypto.sign(
  "RSA-SHA256",
  Buffer.from(canonicalCustomerMobileUpdate(manifest), "utf8"),
  await readFile(privateKeyPath, "utf8")
).toString("base64");

try {
  await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  await rename(temporaryManifest, targetManifest);
} finally {
  await rm(temporaryManifest, { force: true });
}
console.log(`Signed customer APK release: ${versionName} (${versionCode})`);
