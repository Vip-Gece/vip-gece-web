"use strict";

const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "../..");
const SITE_URL = process.env.SITE_URL || "https://vip-gece.site";
const PORT = Number(process.env.PORT || 3000);

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
  requireEnv,
  hasSupabaseEnv
};
