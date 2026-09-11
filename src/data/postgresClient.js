"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { ROOT_DIR } = require("../config/env");

let pool = null;

function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

function getSlowQueryThresholdMs() {
  const value = Number.parseInt(process.env.DATABASE_SLOW_QUERY_MS || "1000", 10);
  return Number.isFinite(value) && value >= 100 ? Math.min(value, 30_000) : 1000;
}

function getPoolMax() {
  const value = Number.parseInt(process.env.DATABASE_POOL_MAX || "3", 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 10) : 3;
}

function shouldUseSsl() {
  return process.env.DATABASE_SSL !== "false";
}

function shouldVerifySslCertificate() {
  return process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false";
}

function defaultDatabaseSslCaFile() {
  try {
    const hostname = new URL(process.env.DATABASE_URL || "").hostname.toLowerCase();
    if (hostname.endsWith(".supabase.com") || hostname.endsWith(".supabase.co")) {
      return path.join(ROOT_DIR, "server", "certs", "supabase-root-2021-ca.crt");
    }
  } catch {
    // Non-URL connection settings must opt into a CA file explicitly.
  }
  return "";
}

function databaseSslCa() {
  const configuredPath = String(process.env.DATABASE_SSL_CA_FILE || defaultDatabaseSslCaFile()).trim();
  if (!configuredPath) return undefined;

  const filePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(ROOT_DIR, configuredPath);
  const ca = fs.readFileSync(filePath, "utf8");
  if (!ca.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----")) {
    throw new Error("DATABASE_SSL_CA_FILE geçerli bir PEM sertifikası içermiyor.");
  }
  return ca;
}

function databaseSslConfig() {
  if (!shouldUseSsl()) return false;

  const rejectUnauthorized = shouldVerifySslCertificate();
  const ca = rejectUnauthorized ? databaseSslCa() : undefined;
  return ca ? { rejectUnauthorized, ca } : { rejectUnauthorized };
}

function databaseConnectionString() {
  const raw = String(process.env.DATABASE_URL || "").trim();
  if (!raw) return "";

  const parsed = new URL(raw);
  for (const key of [...parsed.searchParams.keys()]) {
    const normalized = key.toLowerCase();
    if (normalized === "uselibpqcompat" || normalized.startsWith("ssl")) {
      parsed.searchParams.delete(key);
    }
  }
  return parsed.toString();
}

function summarizeSql(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function getPool() {
  if (pool) return pool;

  if (!hasDatabaseUrl()) {
    return null;
  }

  pool = new Pool({
    connectionString: databaseConnectionString(),
    max: getPoolMax(),
    allowExitOnIdle: true,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    query_timeout: 8_000,
    ssl: databaseSslConfig()
  });

  pool.on("error", (error) => {
    console.error("Postgres pool error:", error.message);
  });

  return pool;
}

async function query(text, params = []) {
  const activePool = getPool();

  if (!activePool) {
    throw new Error("DATABASE_URL env eksik");
  }

  const started = Date.now();

  try {
    return await activePool.query(text, params);
  } finally {
    const duration = Date.now() - started;
    const threshold = getSlowQueryThresholdMs();

    if (duration >= threshold) {
      console.warn(`Postgres slow query: ${duration}ms ${summarizeSql(text)}`);
    }
  }
}

async function transaction(callback) {
  const activePool = getPool();
  if (!activePool) throw new Error("DATABASE_URL env eksik");

  const client = await activePool.connect();
  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  databaseConnectionString,
  databaseSslConfig,
  hasDatabaseUrl,
  query,
  transaction
};
