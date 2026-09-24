"use strict";

// Müşteri uygulaması FCM cihaz token kayıt defteri (güncelleme duyuruları için).
// Konum: production -> /var/lib/vip-gece/customer-device-tokens.json (600)
//        test       -> .data/customer-device-tokens.json

const fs = require("fs/promises");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "../..");
const MAX_TOKENS = 5000;

function storePath() {
  if (process.env.CUSTOMER_DEVICE_TOKENS_PATH) return process.env.CUSTOMER_DEVICE_TOKENS_PATH;
  if (process.env.NODE_ENV === "production") return "/var/lib/vip-gece/customer-device-tokens.json";
  return path.join(ROOT_DIR, ".data", "customer-device-tokens.json");
}

let writeQueue = Promise.resolve();

function validPayload(payload) {
  return Boolean(payload && payload.version === 1 && Array.isArray(payload.tokens));
}

async function readStore() {
  try {
    const raw = await fs.readFile(storePath(), "utf8");
    const parsed = JSON.parse(raw);
    return validPayload(parsed) ? parsed : { version: 1, tokens: [] };
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, tokens: [] };
    throw error;
  }
}

async function writeStore(store) {
  const file = storePath();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600).catch(() => {});
}

async function registerCustomerDeviceToken(token, platform = "android", appVersion = "") {
  const value = String(token || "").trim();
  if (value.length < 20 || value.length > 4096) {
    throw Object.assign(new Error("Geçersiz cihaz token'ı."), { status: 400 });
  }

  const operation = writeQueue.then(async () => {
    const store = await readStore();
    const now = new Date().toISOString();
    const existing = store.tokens.find((item) => item.token === value);
    if (existing) {
      existing.platform = String(platform || existing.platform || "android").slice(0, 24);
      existing.app_version = String(appVersion || existing.app_version || "").slice(0, 24);
      existing.updated_at = now;
    } else {
      store.tokens.push({
        token: value,
        platform: String(platform || "android").slice(0, 24),
        app_version: String(appVersion || "").slice(0, 24),
        created_at: now,
        updated_at: now
      });
      if (store.tokens.length > MAX_TOKENS) {
        store.tokens = store.tokens.slice(store.tokens.length - MAX_TOKENS);
      }
    }
    await writeStore(store);
    return { count: store.tokens.length };
  });

  writeQueue = operation.catch(() => {});
  return operation;
}

async function listCustomerDeviceTokens() {
  const store = await readStore();
  return store.tokens.slice();
}

module.exports = { registerCustomerDeviceToken, listCustomerDeviceTokens };
