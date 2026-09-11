"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT_DIR } = require("../config/env");
const {
  verifyCustomerMobileUpdate
} = require("./customerMobileUpdateManifest");
const {
  CUSTOMER_CONFIG_PUBLIC_KEY_PATH
} = require("./customerMobileConfigService");

const CUSTOMER_UPDATE_MANIFEST_PATH = path.join(
  ROOT_DIR,
  "public",
  "downloads",
  "vip-gece-customer-latest.json"
);

function customerMobileUpdateManifest() {
  if (!fs.existsSync(CUSTOMER_UPDATE_MANIFEST_PATH)) return null;
  const manifest = JSON.parse(fs.readFileSync(CUSTOMER_UPDATE_MANIFEST_PATH, "utf8"));
  const publicKey = fs.readFileSync(CUSTOMER_CONFIG_PUBLIC_KEY_PATH, "utf8");
  if (!verifyCustomerMobileUpdate(manifest, publicKey)) {
    throw new Error("Native müşteri APK manifest imzası geçersiz.");
  }
  return { ...manifest, ok: true };
}

module.exports = {
  CUSTOMER_UPDATE_MANIFEST_PATH,
  customerMobileUpdateManifest
};
