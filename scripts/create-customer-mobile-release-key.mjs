import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const javaHome = String(process.env.JAVA_HOME || "").trim();
if (!javaHome) {
  throw new Error("JAVA_HOME is required.");
}

const secretsDir = join(homedir(), ".codex", ".secrets");
const keyStorePath = join(secretsDir, "vip-gece-customer-release.jks");
const propertiesPath = join(secretsDir, "vip-gece-customer-release.properties");
const keyAlias = "vipgececustomer";

if (existsSync(keyStorePath) || existsSync(propertiesPath)) {
  throw new Error("Customer release signing files already exist; refusing to overwrite them.");
}

mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
const storePassword = randomBytes(36).toString("base64url");
const keyPassword = randomBytes(36).toString("base64url");
const keytool = join(javaHome, "bin", "keytool");
const result = spawnSync(
  keytool,
  [
    "-genkeypair",
    "-noprompt",
    "-keystore",
    keyStorePath,
    "-storetype",
    "JKS",
    "-alias",
    keyAlias,
    "-keyalg",
    "RSA",
    "-keysize",
    "3072",
    "-sigalg",
    "SHA256withRSA",
    "-validity",
    "10000",
    "-dname",
    "CN=VIP Gece Customer, O=VIP Gece, C=TR",
    "-storepass:env",
    "VIP_CUSTOMER_STORE_PASSWORD",
    "-keypass:env",
    "VIP_CUSTOMER_KEY_PASSWORD"
  ],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      VIP_CUSTOMER_STORE_PASSWORD: storePassword,
      VIP_CUSTOMER_KEY_PASSWORD: keyPassword
    }
  }
);

if (result.status !== 0) {
  throw new Error(`keytool failed with status ${result.status}.`);
}

chmodSync(keyStorePath, 0o600);
writeFileSync(
  propertiesPath,
  [
    `storeFile=${keyStorePath}`,
    `storePassword=${storePassword}`,
    `keyAlias=${keyAlias}`,
    `keyPassword=${keyPassword}`,
    ""
  ].join("\n"),
  { encoding: "utf8", mode: 0o600, flag: "wx" }
);
chmodSync(propertiesPath, 0o600);

console.log(JSON.stringify({
  ok: true,
  keyStorePath,
  propertiesPath
}));
