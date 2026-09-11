"use strict";

const crypto = require("crypto");
const { mkdir, readFile, rename, writeFile } = require("fs/promises");
const path = require("path");
const { ROOT_DIR } = require("../config/env");
const { getSupabaseServiceClient } = require("../data/supabaseClient");
const { hasDatabaseUrl, query } = require("../data/postgresClient");
const {
  clearPostgresProfileCache,
  updatePostgresProfile
} = require("../data/postgresProfilesRepo");
const {
  applyProfileUpdateDefaults,
  assertProfileUpdatePublishable
} = require("./profileDefaults");
const { cleanText } = require("../utils/input");
const { getProfileSlug } = require("../utils/profile");

const HASH_ITERATIONS = 120_000;
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const SESSION_VERSION = "v1";
const ACCESS_TOKEN_BYTES = 24;

let runtimeSessionSecret = null;
let accessWriteQueue = Promise.resolve();

function allowSupabaseProfileData() {
  return process.env.VIP_GECE_ALLOW_SUPABASE_PROFILE_DATA === "true";
}

function accessStorePath() {
  if (process.env.CUSTOMER_ACCESS_STORE_PATH) {
    return process.env.CUSTOMER_ACCESS_STORE_PATH;
  }

  if (process.env.NODE_ENV === "production") {
    return "/var/lib/vip-gece/customer-access.json";
  }

  return path.join(ROOT_DIR, ".data", "customer-access.json");
}

function publicBaseUrl(req) {
  const fromEnv = String(process.env.SITE_URL || "").replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  return `${req.protocol}://${req.get("host")}`;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function normalizeEmail(value) {
  return cleanText(value, 180).toLowerCase();
}

function hashPassword(password, salt = randomToken(18)) {
  const digest = crypto.pbkdf2Sync(String(password || ""), salt, HASH_ITERATIONS, 32, "sha256").toString("base64url");
  return `pbkdf2_sha256$${HASH_ITERATIONS}$${salt}$${digest}`;
}

function verifyPassword(password, passwordHash) {
  const parts = String(passwordHash || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;

  const iterations = Number.parseInt(parts[1], 10);
  const salt = parts[2];
  const expected = parts[3];
  if (!Number.isFinite(iterations) || !salt || !expected) return false;

  const digest = crypto.pbkdf2Sync(String(password || ""), salt, iterations, 32, "sha256").toString("base64url");
  const digestBuffer = Buffer.from(digest);
  const expectedBuffer = Buffer.from(expected);
  return digestBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(digestBuffer, expectedBuffer);
}

function sessionSecret() {
  const configuredSecret = String(process.env.CUSTOMER_ACCESS_SESSION_SECRET || "");
  if (configuredSecret.length >= 32) return configuredSecret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("CUSTOMER_ACCESS_SESSION_SECRET must contain at least 32 characters in production.");
  }
  if (!runtimeSessionSecret) runtimeSessionSecret = randomToken(48);
  return runtimeSessionSecret;
}

function signSessionPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", sessionSecret())
    .update(body)
    .digest("base64url");
  return `${SESSION_VERSION}.${body}.${signature}`;
}

function verifySessionToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== SESSION_VERSION) return null;

  const [, body, signature] = parts;
  const expected = crypto
    .createHmac("sha256", sessionSecret())
    .update(body)
    .digest("base64url");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload || Number(payload.expires_at || 0) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function readAccessStore() {
  try {
    const raw = await readFile(accessStorePath(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      records: Array.isArray(parsed.records) ? parsed.records : []
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, records: [] };
    const wrapped = new Error("Customer access store could not be read safely.");
    wrapped.status = 503;
    wrapped.cause = error;
    throw wrapped;
  }
}

async function writeAccessStore(store) {
  const filePath = accessStorePath();
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await rename(tmpPath, filePath);
}

async function mutateAccessStore(callback) {
  const operation = accessWriteQueue.then(async () => {
    const store = await readAccessStore();
    const result = await callback(store);
    await writeAccessStore(store);
    return result;
  });
  accessWriteQueue = operation.catch(() => {});
  return operation;
}

function publicAccessRecord(record, req) {
  const token = record.access_token || "";
  const link = token ? `${publicBaseUrl(req)}/m-panel/${encodeURIComponent(token)}` : "";
  return {
    profile_id: record.profile_id,
    email: record.email || "",
    enabled: record.enabled !== false,
    access_token: token,
    access_link: link,
    created_at: record.created_at || "",
    updated_at: record.updated_at || ""
  };
}

async function getCustomerAccessForProfile(profileId, req) {
  const store = await readAccessStore();
  const record = store.records.find((item) => String(item.profile_id) === String(profileId));
  return record ? publicAccessRecord(record, req) : null;
}

async function upsertCustomerAccess(profileId, body, req) {
  return mutateAccessStore(async (store) => {
    const now = new Date().toISOString();
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const error = new Error("Geçerli müşteri email adresi gerekli.");
      error.status = 400;
      throw error;
    }

    const index = store.records.findIndex((item) => String(item.profile_id) === String(profileId));
    const current = index >= 0 ? store.records[index] : null;

    if (!current && !password) {
      const error = new Error("İlk müşteri erişimi için şifre gerekli.");
      error.status = 400;
      throw error;
    }

    const record = {
      ...(current || {}),
      profile_id: cleanText(profileId, 140),
      email,
      enabled: body.enabled !== false,
      access_token: body.regenerate_link || !current?.access_token ? randomToken(ACCESS_TOKEN_BYTES) : current.access_token,
      password_hash: password ? hashPassword(password) : current.password_hash,
      created_at: current?.created_at || now,
      updated_at: now
    };

    if (index >= 0) {
      store.records[index] = record;
    } else {
      store.records.push(record);
    }

    return publicAccessRecord(record, req);
  });
}

async function findCustomerAccessByToken(accessToken) {
  const token = cleanText(accessToken, 180);
  if (!token) return null;
  const store = await readAccessStore();
  return store.records.find((item) => item.access_token === token && item.enabled !== false) || null;
}

async function authenticateCustomer(accessToken, email, password) {
  const record = await findCustomerAccessByToken(accessToken);
  if (!record) return null;
  if (normalizeEmail(email) !== record.email) return null;
  if (!verifyPassword(password, record.password_hash)) return null;

  const expiresAt = Date.now() + SESSION_TTL_MS;
  return {
    token: signSessionPayload({
      profile_id: record.profile_id,
      access_token: record.access_token,
      email: record.email,
      expires_at: expiresAt
    }),
    expires_at: new Date(expiresAt).toISOString()
  };
}

async function requireCustomerSession(accessToken, authorization) {
  const token = String(authorization || "").match(/^Bearer\s+(\S+)$/i)?.[1] || "";
  const session = verifySessionToken(token);
  if (!session || session.access_token !== accessToken) return null;
  const record = await findCustomerAccessByToken(accessToken);
  if (!record || String(record.profile_id) !== String(session.profile_id) || record.email !== session.email) return null;
  return session;
}

async function getProfileById(profileId) {
  if (hasDatabaseUrl()) {
    const { rows } = await query("select * from public.profiles where id = $1 limit 1", [profileId]);
    if (rows[0]) return rows[0];
  }

  const supabase = getSupabaseServiceClient();

  if (supabase && allowSupabaseProfileData()) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", profileId)
      .single();

    if (!error && data) return data;
  }

  return null;
}

function visibleCustomerProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    name: profile.name || "",
    card_label: profile.card_label || "",
    age: profile.age || "",
    height: profile.height || "",
    weight: profile.weight || "",
    city: profile.city || "",
    district: profile.district || "",
    description: profile.description || "",
    images: Array.isArray(profile.images) ? profile.images : [],
    phone: profile.phone || "",
    whatsapp: profile.whatsapp || "",
    telegram: profile.telegram || "",
    public_path: `/profil/${getProfileSlug(profile)}`
  };
}

function assertCustomerImageSubset(currentProfile, payload) {
  if (!Object.prototype.hasOwnProperty.call(payload || {}, "images")) return;

  const currentImages = new Set(
    (Array.isArray(currentProfile?.images) ? currentProfile.images : [])
      .map((image) => String(image || "").trim())
      .filter(Boolean)
  );
  const requestedImages = Array.isArray(payload.images) ? payload.images : [];
  if (requestedImages.every((image) => currentImages.has(String(image || "").trim()))) return;

  const error = new Error("Yeni görseller yalnız güvenli yükleme alanından eklenebilir.");
  error.status = 403;
  throw error;
}

async function updateCustomerProfile(profileId, payload) {
  const supabase = getSupabaseServiceClient();
  const currentProfile = await getProfileById(profileId);
  if (!currentProfile) {
    const error = new Error("Profil bulunamadı.");
    error.status = 404;
    throw error;
  }
  assertCustomerImageSubset(currentProfile, payload);
  const updatePayload = {
    ...applyProfileUpdateDefaults(payload, currentProfile),
    updated_at: new Date().toISOString()
  };

  if (hasDatabaseUrl()) {
    return updatePostgresProfile(profileId, updatePayload);
  }

  if (supabase && allowSupabaseProfileData()) {
    assertProfileUpdatePublishable(currentProfile, updatePayload);

    const { data, error } = await supabase
      .from("profiles")
      .update(updatePayload)
      .eq("id", profileId)
      .select("*")
      .single();

    if (error) {
      const err = new Error("Profil güncellenemedi.");
      err.status = 400;
      err.cause = error;
      throw err;
    }

    clearPostgresProfileCache();
    return data;
  }

  const error = new Error("Profil kaydı için veritabanı bağlantısı gerekli.");
  error.status = 503;
  throw error;
}

module.exports = {
  assertCustomerImageSubset,
  authenticateCustomer,
  findCustomerAccessByToken,
  getCustomerAccessForProfile,
  getProfileById,
  requireCustomerSession,
  upsertCustomerAccess,
  updateCustomerProfile,
  visibleCustomerProfile
};
