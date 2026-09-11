"use strict";

const crypto = require("crypto");

function normalizeDigest(value) {
  return String(value || "").toLowerCase().replace(/[^a-f0-9]/g, "");
}

function canonicalManifest(manifest) {
  const rollback = manifest?.rollback || {};
  return [
    Number(manifest?.manifest_version),
    String(manifest?.app || ""),
    String(manifest?.package_name || ""),
    Number(manifest?.version_code),
    String(manifest?.version_name || ""),
    String(manifest?.apk_url || ""),
    normalizeDigest(manifest?.sha256),
    Number(manifest?.size_bytes),
    String(Boolean(manifest?.mandatory)),
    normalizeDigest(manifest?.release_certificate_sha256),
    String(manifest?.health_url || "/api/health"),
    Number(rollback.version_code),
    String(rollback.apk_url || ""),
    normalizeDigest(rollback.sha256),
    Number(rollback.size_bytes)
  ].join("\n");
}

function verifyManifestSignature(manifest, publicKey) {
  if (!manifest || Number(manifest.manifest_version) !== 1) return false;
  if (manifest.app !== "vip-gece-admin" || manifest.package_name !== "com.vipgece.admin") return false;
  if (!manifest.signature || !publicKey) return false;

  return crypto.verify(
    "RSA-SHA256",
    Buffer.from(canonicalManifest(manifest), "utf8"),
    publicKey,
    Buffer.from(String(manifest.signature), "base64")
  );
}

module.exports = {
  canonicalManifest,
  normalizeDigest,
  verifyManifestSignature
};
