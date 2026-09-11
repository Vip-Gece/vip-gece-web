"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT_DIR } = require("../config/env");
const { verifyCustomerMobileConfig } = require("./customerMobileConfigManifest");

const CUSTOMER_CONFIG_PATH = path.join(
  ROOT_DIR,
  "public",
  "downloads",
  "vip-gece-customer-config.json"
);
const CUSTOMER_CONFIG_PUBLIC_KEY_PATH = path.join(
  ROOT_DIR,
  "public",
  "downloads",
  "vip-gece-customer-config-public.pem"
);

function customerMobileConfig() {
  const config = JSON.parse(fs.readFileSync(CUSTOMER_CONFIG_PATH, "utf8"));
  const publicKey = fs.readFileSync(CUSTOMER_CONFIG_PUBLIC_KEY_PATH, "utf8");
  if (!verifyCustomerMobileConfig(config, publicKey)) {
    throw new Error("Native müşteri yapılandırma imzası geçersiz.");
  }

  const expiresAt = Date.parse(config.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("Native müşteri yapılandırmasının süresi dolmuş.");
  }
  return { ...config, ok: true };
}

module.exports = {
  CUSTOMER_CONFIG_PATH,
  CUSTOMER_CONFIG_PUBLIC_KEY_PATH,
  customerMobileConfig
};
