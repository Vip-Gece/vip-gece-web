"use strict";

const crypto = require("crypto");
const { constants: fsConstants } = require("fs");
const { access, lstat, mkdir, readFile, rename, writeFile } = require("fs/promises");
const path = require("path");
const { ROOT_DIR } = require("../config/env");
const { hasDatabaseUrl } = require("../data/postgresClient");
const {
  appendCustomerPostgresProfileImage,
  createCustomerPostgresProfile,
  getCustomerPostgresProfileById,
  listCustomerPostgresProfiles,
  removeCustomerPostgresProfileImage,
  updateCustomerPostgresProfile
} = require("../data/postgresProfilesRepo");
const {
  isProfilePublishable,
  profilePublicationMissingFields
} = require("./profileDefaults");
const {
  buildCustomerProfileThumbnailUrl
} = require("./customerProfileImageService");
const { buildProfileImageProxyUrl } = require("./profileImageProxyService");
const { cleanText } = require("../utils/input");
const { safeSlug } = require("../utils/text");

const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_BYTES = 32;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_VERSION = "customer-mobile-v1";
const MAX_PROFILE_LIMIT = 50;

let localSessionSecret = null;
let storeWriteQueue = Promise.resolve();

function accountStorePath() {
  if (process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH) {
    return process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH;
  }
  if (process.env.NODE_ENV === "production") {
    return "/var/lib/vip-gece/customer-mobile-accounts.json";
  }
  return path.join(ROOT_DIR, ".data", "customer-mobile-accounts.json");
}

async function assertCustomerMobileAccountStorageReady() {
  const filePath = accountStorePath();
  const directoryPath = path.dirname(filePath);
  await mkdir(directoryPath, { recursive: true, mode: 0o700 });

  const directory = await lstat(directoryPath);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o077) !== 0
  ) {
    throw new Error("Customer account storage root is not a safe directory.");
  }
  await access(directoryPath, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);

  try {
    const file = await lstat(filePath);
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      (file.mode & 0o077) !== 0
    ) {
      throw new Error("Customer account store is not a safe private file.");
    }
    await readAccountStore();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function defaultProfileLimit() {
  const configured = Number.parseInt(process.env.CUSTOMER_DEFAULT_PROFILE_LIMIT || "10", 10);
  return Math.max(1, Math.min(Number.isFinite(configured) ? configured : 10, MAX_PROFILE_LIMIT));
}

function normalizeEmail(value) {
  return cleanText(value, 180).toLowerCase();
}

function normalizeUsername(value) {
  return cleanText(value, 40).toLowerCase();
}

function normalizeProfileLimit(value, fallback = defaultProfileLimit()) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, MAX_PROFILE_LIMIT));
}

function hashPassword(password, salt = crypto.randomBytes(18).toString("base64url")) {
  const digest = crypto
    .pbkdf2Sync(String(password || ""), salt, PASSWORD_ITERATIONS, PASSWORD_BYTES, "sha256")
    .toString("base64url");
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${salt}$${digest}`;
}

function verifyPassword(password, encoded) {
  const [algorithm, rawIterations, salt, expected] = String(encoded || "").split("$");
  const iterations = Number.parseInt(rawIterations, 10);
  if (
    algorithm !== "pbkdf2_sha256" ||
    !Number.isFinite(iterations) ||
    iterations < 100_000 ||
    !salt ||
    !expected
  ) {
    return false;
  }

  const actual = crypto
    .pbkdf2Sync(String(password || ""), salt, iterations, PASSWORD_BYTES, "sha256")
    .toString("base64url");
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function sessionSecret() {
  const configured = String(
    process.env.CUSTOMER_MOBILE_SESSION_SECRET ||
    process.env.CUSTOMER_ACCESS_SESSION_SECRET ||
    ""
  );
  if (configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("CUSTOMER_MOBILE_SESSION_SECRET must contain at least 32 characters in production.");
  }
  if (!localSessionSecret) localSessionSecret = crypto.randomBytes(48).toString("base64url");
  return localSessionSecret;
}

function signSession(account) {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = {
    account_id: account.id,
    email: account.email,
    session_version: Math.max(1, Number.parseInt(account.session_version, 10) || 1),
    expires_at: expiresAt
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", sessionSecret())
    .update(`${SESSION_VERSION}.${body}`)
    .digest("base64url");
  return {
    token: `${SESSION_VERSION}.${body}.${signature}`,
    expires_at: new Date(expiresAt).toISOString()
  };
}

function verifySessionToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== SESSION_VERSION) return null;

  const [version, body, signature] = parts;
  const expected = crypto
    .createHmac("sha256", sessionSecret())
    .update(`${version}.${body}`)
    .digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (
      !payload ||
      !payload.account_id ||
      !payload.email ||
      Number(payload.expires_at || 0) <= Date.now()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

async function readAccountStore() {
  try {
    const parsed = JSON.parse(await readFile(accountStorePath(), "utf8"));
    return {
      version: 1,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : []
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, accounts: [] };
    const wrapped = new Error("Customer mobile account store could not be read safely.");
    wrapped.status = 503;
    wrapped.cause = error;
    throw wrapped;
  }
}

async function writeAccountStore(store) {
  const filePath = accountStorePath();
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

async function mutateAccountStore(callback) {
  const operation = storeWriteQueue.then(async () => {
    const store = await readAccountStore();
    const result = await callback(store);
    await writeAccountStore(store);
    return result;
  });
  storeWriteQueue = operation.catch(() => {});
  return operation;
}

function publicAccount(account) {
  return {
    id: account.id,
    label: account.label || "",
    email: account.email,
    username: account.username || "",
    owner_user_id: ownerUserId(account),
    enabled: account.enabled !== false,
    max_profiles: normalizeProfileLimit(account.max_profiles),
    password_updated_at: account.password_updated_at || "",
    created_at: account.created_at || "",
    updated_at: account.updated_at || ""
  };
}

function ownerUserId(account) {
  return `customer:${account.id}`;
}

async function listCustomerMobileAccounts() {
  const store = await readAccountStore();
  return store.accounts.map(publicAccount);
}

async function getCustomerMobileAccount(accountId) {
  const id = cleanText(accountId, 80);
  if (!id) return null;
  const store = await readAccountStore();
  const account = store.accounts.find((item) => item.id === id);
  return account ? publicAccount(account) : null;
}

async function upsertCustomerMobileAccount(accountId, body = {}) {
  return mutateAccountStore(async (store) => {
    const id = cleanText(accountId, 80) || crypto.randomUUID();
    const index = store.accounts.findIndex((item) => item.id === id);
    const current = index >= 0 ? store.accounts[index] : null;
    const email = normalizeEmail(body.email ?? current?.email);
    const username = normalizeUsername(body.username ?? current?.username);
    const hasPassword = Object.prototype.hasOwnProperty.call(body, "password");
    if (hasPassword && typeof body.password !== "string") {
      const error = new Error("Müşteri şifresi metin olmalıdır.");
      error.status = 400;
      throw error;
    }
    const password = hasPassword ? body.password : "";
    const now = new Date().toISOString();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const error = new Error("Geçerli müşteri e-posta adresi gerekli.");
      error.status = 400;
      throw error;
    }
    if (
      username &&
      !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)
    ) {
      const error = new Error("Kullanıcı adı 3-40 karakter olmalı; harf, rakam, nokta, tire ve alt çizgi kullanılabilir.");
      error.status = 400;
      throw error;
    }
    const duplicate = store.accounts.find((item) => (
      item.id !== id &&
      (
        item.email === email ||
        (username && item.username === username) ||
        (username && item.email === username) ||
        (item.username && item.username === email)
      )
    ));
    if (duplicate) {
      const error = new Error("Bu e-posta veya kullanıcı adı başka bir müşteri hesabına bağlı.");
      error.status = 409;
      throw error;
    }
    if (password && (password.length < 8 || password.length > 1024)) {
      const error = new Error("Müşteri şifresi 8-1024 karakter olmalıdır.");
      error.status = 400;
      throw error;
    }
    if (!current && !password) {
      const error = new Error("İlk kayıt için en az 8 karakterli şifre gerekli.");
      error.status = 400;
      throw error;
    }

    const enabled = body.enabled === undefined
      ? current?.enabled !== false
      : body.enabled === true;
    const invalidatesSessions = Boolean(
      password ||
      current && current.enabled !== false && !enabled
    );
    const sessionVersion = Math.max(
      1,
      Number.parseInt(current?.session_version, 10) || 1
    ) + (invalidatesSessions ? 1 : 0);

    const account = {
      ...(current || {}),
      id,
      label: cleanText(body.label ?? current?.label, 120),
      email,
      username,
      enabled,
      max_profiles: normalizeProfileLimit(body.max_profiles, current?.max_profiles),
      password_hash: password ? hashPassword(password) : current?.password_hash,
      session_version: sessionVersion,
      password_updated_at: password ? now : (current?.password_updated_at || ""),
      created_at: current?.created_at || now,
      updated_at: now
    };

    if (index >= 0) store.accounts[index] = account;
    else store.accounts.push(account);
    return publicAccount(account);
  });
}

async function authenticateCustomerMobile(identifier, password) {
  if (typeof password !== "string" || password.length > 1024) return null;
  const normalizedIdentifier = normalizeEmail(identifier);
  const store = await readAccountStore();
  const account = store.accounts.find(
    (item) =>
      item.enabled !== false &&
      (
        item.email === normalizedIdentifier ||
        normalizeUsername(item.username) === normalizedIdentifier
      )
  );
  if (!account || !verifyPassword(password, account.password_hash)) return null;
  return {
    session: signSession(account),
    account: publicAccount(account)
  };
}

function bearerToken(authorization) {
  return String(authorization || "").match(/^Bearer\s+(\S+)$/i)?.[1] || "";
}

async function requireCustomerMobileSession(authorization) {
  const session = verifySessionToken(bearerToken(authorization));
  if (!session) return null;

  const store = await readAccountStore();
  const account = store.accounts.find(
    (item) =>
      item.enabled !== false &&
      item.id === session.account_id &&
      item.email === session.email &&
      Math.max(1, Number.parseInt(item.session_version, 10) || 1) ===
        Math.max(1, Number.parseInt(session.session_version, 10) || 1)
  );
  return account || null;
}

function customerProfileView(profile) {
  const complete = isProfilePublishable(profile);
  const images = Array.isArray(profile.images) ? profile.images : [];
  const coverImage = typeof images[0] === "string" ? images[0] : "";
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
    images,
    cover_thumbnail_url: coverImage
      ? coverImage.startsWith("/media/customer-profile/")
        ? buildCustomerProfileThumbnailUrl(coverImage, 240)
        : buildProfileImageProxyUrl(
            coverImage,
            { width: 240, quality: 68, resize: "cover" }
          )
      : "",
    phone: profile.phone || "",
    whatsapp: profile.whatsapp || "",
    telegram: profile.telegram || "",
    is_complete: complete,
    is_live: profile.is_active === true && complete,
    state: profile.is_active === true && complete ? "live" : complete ? "ready" : "draft",
    missing_fields: complete ? [] : profilePublicationMissingFields(profile),
    updated_at: profile.updated_at || null
  };
}

async function customerMobileBootstrap(account) {
  if (!hasDatabaseUrl()) {
    const error = new Error("Profil servisi geçici olarak kullanılamıyor.");
    error.status = 503;
    throw error;
  }

  const profiles = await listCustomerPostgresProfiles(ownerUserId(account));
  const limit = normalizeProfileLimit(account.max_profiles);
  const ready = profiles.filter(isProfilePublishable).length;
  const live = profiles.filter(
    (profile) => profile.is_active === true && isProfilePublishable(profile)
  ).length;
  return {
    account: publicAccount(account),
    quota: {
      limit,
      used: profiles.length,
      remaining: Math.max(0, limit - profiles.length),
      ready,
      live
    },
    profiles: profiles.map(customerProfileView)
  };
}

async function createCustomerMobileProfile(account, payload = {}) {
  const name = cleanText(payload.name, 120);
  if (!name) {
    const error = new Error("Profil oluşturmak için isim gerekli.");
    error.status = 400;
    throw error;
  }
  const slugBase = safeSlug(name) || "profil";
  const slug = `${slugBase}-${crypto.randomBytes(4).toString("hex")}`;
  const created = await createCustomerPostgresProfile(
    ownerUserId(account),
    {
      ...payload,
      name,
      slug,
      is_active: false
    },
    normalizeProfileLimit(account.max_profiles)
  );
  return customerProfileView(created);
}

async function updateCustomerMobileProfile(account, profileId, payload = {}) {
  const id = cleanText(profileId, 140);
  if (!id) return null;
  const updated = await updateCustomerPostgresProfile(id, ownerUserId(account), payload);
  return updated ? customerProfileView(updated) : null;
}

async function appendCustomerMobileProfileImage(
  account,
  profileId,
  imageUrl,
  maxImages = 12
) {
  const id = cleanText(profileId, 140);
  if (!id) return null;
  const updated = await appendCustomerPostgresProfileImage(
    id,
    ownerUserId(account),
    imageUrl,
    maxImages
  );
  return updated ? customerProfileView(updated) : null;
}

async function removeCustomerMobileProfileImage(account, profileId, imageUrl) {
  const id = cleanText(profileId, 140);
  if (!id) return null;
  const updated = await removeCustomerPostgresProfileImage(
    id,
    ownerUserId(account),
    imageUrl
  );
  return updated ? customerProfileView(updated) : null;
}

async function getCustomerMobileProfile(account, profileId) {
  const id = cleanText(profileId, 140);
  if (!id) return null;
  const profile = await getCustomerPostgresProfileById(id, ownerUserId(account));
  return profile ? customerProfileView(profile) : null;
}

async function getCustomerMobileProfilePreview(account, profileId) {
  const id = cleanText(profileId, 140);
  if (!id) return null;

  const ownerId = ownerUserId(account);
  const profile = await getCustomerPostgresProfileById(id, ownerId);
  if (!profile) return null;

  return {
    profile,
    profiles: await listCustomerPostgresProfiles(ownerId)
  };
}

module.exports = {
  appendCustomerMobileProfileImage,
  assertCustomerMobileAccountStorageReady,
  authenticateCustomerMobile,
  createCustomerMobileProfile,
  customerMobileBootstrap,
  getCustomerMobileAccount,
  getCustomerMobileProfile,
  getCustomerMobileProfilePreview,
  listCustomerMobileAccounts,
  normalizeProfileLimit,
  ownerUserId,
  publicAccount,
  removeCustomerMobileProfileImage,
  requireCustomerMobileSession,
  updateCustomerMobileProfile,
  upsertCustomerMobileAccount
};
