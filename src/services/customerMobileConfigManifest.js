"use strict";

const crypto = require("crypto");

function normalizedOrigins(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").replace(/\/+$/, ""));
}

function canonicalCustomerMobileConfig(config) {
  return [
    Number(config?.config_version),
    String(config?.revision || ""),
    String(config?.issued_at || ""),
    String(config?.expires_at || ""),
    String(config?.canonical_origin || ""),
    normalizedOrigins(config?.api_origins).join(","),
    normalizedOrigins(config?.config_mirrors).join(","),
    String(config?.ready_path || ""),
    String(config?.login_path || ""),
    String(config?.update_manifest_path || ""),
    String(config?.support_enabled === true)
  ].join("\n");
}

function verifyCustomerMobileConfig(config, publicKey) {
  if (!config || Number(config.config_version) !== 1) return false;
  if (!config.signature || !publicKey) return false;
  return crypto.verify(
    "RSA-SHA256",
    Buffer.from(canonicalCustomerMobileConfig(config), "utf8"),
    publicKey,
    Buffer.from(String(config.signature), "base64")
  );
}

module.exports = {
  canonicalCustomerMobileConfig,
  normalizedOrigins,
  verifyCustomerMobileConfig
};
