"use strict";

const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "../..");
const SITE_URL = process.env.SITE_URL || "https://vip-gece.site";
const PORT = Number(process.env.PORT || 3000);
const GOOGLE_ANALYTICS_MEASUREMENT_ID = process.env.GOOGLE_ANALYTICS_MEASUREMENT_ID || "G-MGGWKPN1KH";

function cleanGoogleSiteVerificationCode(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const contentMatch = raw.match(/\bcontent=["']([^"']+)["']/i);
  const tagMatch = raw.match(/^google-site-verification:\s*(.+)$/i);
  return String(contentMatch?.[1] || tagMatch?.[1] || raw).trim();
}

const GOOGLE_SITE_VERIFICATION_CODE = cleanGoogleSiteVerificationCode(
  process.env.GOOGLE_SITE_VERIFICATION_CODE ||
  process.env.GOOGLE_SITE_VERIFICATION ||
  process.env.GOOGLE_SEARCH_CONSOLE_VERIFICATION_CODE ||
  process.env.GSC_VERIFICATION_CODE
);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function hasSupabaseEnv() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

module.exports = {
  ROOT_DIR,
  SITE_URL,
  PORT,
  GOOGLE_ANALYTICS_MEASUREMENT_ID,
  GOOGLE_SITE_VERIFICATION_CODE,
  requireEnv,
  hasSupabaseEnv
};
