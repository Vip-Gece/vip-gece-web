import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  canonicalCustomerMobileConfig
} = require("../src/services/customerMobileConfigManifest");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privateKeyPath = process.env.VIP_GECE_CUSTOMER_CONFIG_PRIVATE_KEY ||
  path.join(os.homedir(), ".codex", ".secrets", "vip-gece-customer-config-private.pem");
const outputPath = path.join(
  root,
  "public",
  "downloads",
  "vip-gece-customer-config.json"
);

const now = new Date();
const expiresAt = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);
const apiOrigins = [
  "https://vip-gece.site"
];
const config = {
  config_version: 1,
  revision: now.toISOString().replace(/\D/g, "").slice(0, 14),
  issued_at: now.toISOString(),
  expires_at: expiresAt.toISOString(),
  canonical_origin: "https://vip-gece.site",
  api_origins: apiOrigins,
  config_mirrors: apiOrigins.map((origin) => `${origin}/api/mobile/customer/config`),
  ready_path: "/api/ready",
  login_path: "/api/customer/mobile/login",
  update_manifest_path: "/api/mobile/customer/update",
  support_enabled: true
};
config.signature = crypto
  .sign(
    "RSA-SHA256",
    Buffer.from(canonicalCustomerMobileConfig(config), "utf8"),
    await readFile(privateKeyPath, "utf8")
  )
  .toString("base64");

await mkdir(path.dirname(outputPath), { recursive: true });
const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o644 });
await rename(temporaryPath, outputPath);
console.log(`Signed customer mobile config: ${config.revision}`);
