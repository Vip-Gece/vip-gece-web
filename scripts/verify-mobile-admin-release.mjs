import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { normalizeDigest, verifyManifestSignature } = require("../src/services/mobileReleaseManifest");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "downloads", "vip-gece-admin-latest.json"), "utf8"));
const publicKey = fs.readFileSync(
  path.join(ROOT, "mobile-admin", "android", "app", "src", "main", "res", "raw", "vip_gece_update_public_key.pem"),
  "utf8"
);

function fail(message) {
  throw new Error(message);
}

function artifactPath(url) {
  const relative = String(url).replace(/^\/+/, "").replace(/^public\//, "public/");
  return path.join(ROOT, relative);
}

function verifyArtifact(label, data) {
  const filePath = artifactPath(data.apk_url);
  const body = fs.readFileSync(filePath);
  const digest = crypto.createHash("sha256").update(body).digest("hex");
  if (digest !== normalizeDigest(data.sha256)) fail(`${label} SHA-256 mismatch`);
  if (body.length !== Number(data.size_bytes)) fail(`${label} size mismatch`);
  return filePath;
}

function latestBuildTool(name) {
  const root = path.join(os.homedir(), "Library", "Android", "sdk", "build-tools");
  const versions = fs.readdirSync(root).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const tool = path.join(root, versions.at(-1), name);
  if (!fs.existsSync(tool)) fail(`${name} not found`);
  return tool;
}

function apkMetadata(filePath) {
  const aapt = latestBuildTool("aapt");
  const apksigner = latestBuildTool("apksigner");
  const badging = execFileSync(aapt, ["dump", "badging", filePath], { encoding: "utf8" });
  const packageLine = badging.split("\n").find((line) => line.startsWith("package:")) || "";
  const certs = execFileSync(apksigner, ["verify", "--print-certs", filePath], { encoding: "utf8" });
  return {
    packageName: packageLine.match(/name='([^']+)'/)?.[1],
    versionCode: Number(packageLine.match(/versionCode='([^']+)'/)?.[1]),
    certificate: normalizeDigest(certs.match(/certificate SHA-256 digest: ([a-f0-9]+)/i)?.[1])
  };
}

if (!verifyManifestSignature(manifest, publicKey)) fail("manifest signature invalid");
if (manifest.platform !== "android") fail("manifest platform invalid");
if (Number(manifest.rollback?.version_code) <= Number(manifest.version_code)) fail("rollback version must be monotonic");

for (const [label, data] of [["candidate", manifest], ["rollback", manifest.rollback]]) {
  const filePath = verifyArtifact(label, data);
  const metadata = apkMetadata(filePath);
  if (metadata.packageName !== manifest.package_name) fail(`${label} package mismatch`);
  if (metadata.versionCode !== Number(data.version_code)) fail(`${label} version mismatch`);
  if (metadata.certificate !== normalizeDigest(manifest.release_certificate_sha256)) fail(`${label} certificate mismatch`);
}

console.log("Mobile admin release contract verified: signature, hashes, sizes, package, versions, certificate.");
