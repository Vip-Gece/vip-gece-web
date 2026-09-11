"use strict";

const crypto = require("crypto");

function normalizeDigest(value) {
  return String(value || "").toLowerCase().replace(/[^a-f0-9]/g, "");
}

function canonicalCustomerMobileUpdate(manifest) {
  return [
    Number(manifest?.manifest_version),
    String(manifest?.app || ""),
    String(manifest?.package_name || ""),
    Number(manifest?.version_code),
    String(manifest?.version_name || ""),
    String(manifest?.apk_url || ""),
    normalizeDigest(manifest?.sha256),
    Number(manifest?.size_bytes),
    normalizeDigest(manifest?.release_certificate_sha256),
    String(manifest?.mandatory === true),
    String(manifest?.release_notes || "")
  ].join("\n");
}

function verifyCustomerMobileUpdate(manifest, publicKey) {
  if (!manifest || Number(manifest.manifest_version) !== 1) return false;
  if (manifest.app !== "vip-gece-customer") return false;
  if (manifest.package_name !== "com.vipgece.customer") return false;
  if (!manifest.signature || !publicKey) return false;
  return crypto.verify(
    "RSA-SHA256",
    Buffer.from(canonicalCustomerMobileUpdate(manifest), "utf8"),
    publicKey,
    Buffer.from(String(manifest.signature), "base64")
  );
}

module.exports = {
  canonicalCustomerMobileUpdate,
  normalizeDigest,
  verifyCustomerMobileUpdate
};
