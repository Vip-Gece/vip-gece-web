"use strict";

const crypto = require("crypto");
const { constants: fsConstants } = require("fs");
const { access, lstat, mkdir, readFile, rename, writeFile } = require("fs/promises");
const path = require("path");
const { ROOT_DIR } = require("../config/env");
const {
  applyProfileCreateDefaults,
  applyProfileUpdateDefaults,
  assertProfileUpdatePublishable,
  firstFreeSlot,
  isProfilePublishable
} = require("../services/profileDefaults");

const PROFILE_WRITE_COLUMNS = new Set([
  "name",
  "card_label",
  "images",
  "age",
  "height",
  "weight",
  "description",
  "type",
  "is_featured",
  "is_active",
  "vip_slot",
  "normal_slot",
  "slug",
  "seo_title",
  "seo_description",
  "seo_keywords",
  "is_sponsored",
  "display_priority",
  "tags",
  "city",
  "district",
  "expires_at",
  "is_lifetime",
  "duration_days",
  "package_type",
  "vip_level",
  "priority_order",
  "phone",
  "whatsapp",
  "telegram",
  "owner_user_id"
]);

let profileWriteQueue = Promise.resolve();

function useLocalCustomerProfiles() {
  return process.env.CUSTOMER_PROFILE_STORE_BACKEND === "json";
}

function profileStorePath() {
  if (process.env.CUSTOMER_PROFILE_STORE_PATH) {
    return process.env.CUSTOMER_PROFILE_STORE_PATH;
  }
  if (process.env.NODE_ENV === "production") {
    return "/var/lib/vip-gece/customer-mobile-profiles.json";
  }
  return path.join(ROOT_DIR, ".data", "customer-mobile-profiles.json");
}

function profileWriteEntries(payload = {}) {
  return Object.entries(payload).filter(([key]) => PROFILE_WRITE_COLUMNS.has(key));
}

function invalidStoreError() {
  return Object.assign(new Error("Customer profile store is invalid."), {
    status: 503,
    code: "CUSTOMER_PROFILE_STORE_INVALID"
  });
}

function validateProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw invalidStoreError();
  }
  if (
    typeof profile.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(profile.id) ||
    typeof profile.owner_user_id !== "string" ||
    !profile.owner_user_id.trim() ||
    (profile.images !== undefined && !Array.isArray(profile.images)) ||
    (profile.is_active !== undefined && typeof profile.is_active !== "boolean")
  ) {
    throw invalidStoreError();
  }
  if (Array.isArray(profile.images) && profile.images.some((image) => typeof image !== "string")) {
    throw invalidStoreError();
  }
}

function validateProfileStore(store) {
  if (!store || typeof store !== "object" || Array.isArray(store) ||
      (store.version !== undefined && store.version !== 1) || !Array.isArray(store.profiles)) {
    throw invalidStoreError();
  }
  const ids = new Set();
  for (const profile of store.profiles) {
    validateProfile(profile);
    if (ids.has(profile.id)) throw invalidStoreError();
    ids.add(profile.id);
  }
  return store;
}

async function assertCustomerMobileProfileStorageReady() {
  if (!useLocalCustomerProfiles()) return;

  const filePath = profileStorePath();
  const directoryPath = path.dirname(filePath);
  await mkdir(directoryPath, { recursive: true, mode: 0o700 });
  const directory = await lstat(directoryPath);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o077) !== 0
  ) {
    throw new Error("Customer profile storage root is not a safe directory.");
  }
  await access(directoryPath, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);

  try {
    const file = await lstat(filePath);
    if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) !== 0) {
      throw new Error("Customer profile store is not a safe private file.");
    }
    await readProfileStore();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function readProfileStore() {
  try {
    const parsed = JSON.parse(await readFile(profileStorePath(), "utf8"));
    return validateProfileStore(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, profiles: [] };
    const wrapped = new Error("Customer profile store could not be read safely.");
    wrapped.status = 503;
    wrapped.cause = error;
    throw wrapped;
  }
}

async function writeProfileStore(store) {
  validateProfileStore(store);
  const filePath = profileStorePath();
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

async function mutateProfileStore(callback) {
  const operation = profileWriteQueue.then(async () => {
    const store = await readProfileStore();
    const result = await callback(store);
    await writeProfileStore(store);
    return result;
  });
  profileWriteQueue = operation.catch(() => {});
  return operation;
}

function normalizeProfileLimit(value) {
  if (value === 0 || value === "0") return 0;
  const parsed = Number.parseInt(value, 10);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 10, 50));
}

function byOwner(store, ownerUserId) {
  const owner = String(ownerUserId || "").trim();
  return store.profiles
    .filter((profile) => profile.owner_user_id === owner)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

async function listCustomerProfiles(ownerUserId) {
  return byOwner(await readProfileStore(), ownerUserId);
}

async function getCustomerProfileById(profileId, ownerUserId) {
  const id = String(profileId || "").trim();
  if (!id) return null;
  const store = await readProfileStore();
  return store.profiles.find((profile) => profile.id === id && profile.owner_user_id === ownerUserId) || null;
}

async function createCustomerProfile(ownerUserId, payload = {}, profileLimit = 10) {
  const owner = String(ownerUserId || "").trim();
  if (!owner) {
    const error = new Error("Müşteri sahipliği gerekli.");
    error.status = 400;
    throw error;
  }
  const limit = normalizeProfileLimit(profileLimit);
  return mutateProfileStore(async (store) => {
    const owned = byOwner(store, owner);
    if (limit !== 0 && owned.length >= limit) {
      const error = new Error(`Profil sınırına ulaşıldı (${limit}).`);
      error.code = "PROFILE_LIMIT_REACHED";
      error.status = 409;
      error.limit = limit;
      error.used = owned.length;
      throw error;
    }

    const now = new Date().toISOString();
    const normalized = applyProfileCreateDefaults({
      ...payload,
      owner_user_id: owner,
      is_active: false
    }, store.profiles);
    const profile = {
      ...Object.fromEntries(profileWriteEntries(normalized)),
      id: crypto.randomUUID(),
      owner_user_id: owner,
      images: Array.isArray(normalized.images) ? normalized.images : [],
      is_active: false,
      created_at: now,
      updated_at: now
    };
    store.profiles.push(profile);
    return profile;
  });
}

async function updateCustomerProfile(profileId, ownerUserId, payload = {}) {
  const id = String(profileId || "").trim();
  const owner = String(ownerUserId || "").trim();
  if (!id || !owner) return null;
  return mutateProfileStore(async (store) => {
    const index = store.profiles.findIndex((profile) => profile.id === id && profile.owner_user_id === owner);
    if (index < 0) return null;
    const current = store.profiles[index];
    let nextPayload = applyProfileUpdateDefaults(
      Object.fromEntries(profileWriteEntries(payload).filter(([key]) => key !== "owner_user_id")),
      current
    );
    let entries = profileWriteEntries(nextPayload).filter(([key]) => key !== "owner_user_id");
    if (!entries.length) return current;
    assertProfileUpdatePublishable(current, nextPayload);

    if (current.is_active !== true && nextPayload.is_active === true) {
      const profileType = String(nextPayload.type || current.type || "").toLowerCase() === "normal"
        ? "normal"
        : "vip";
      const slotField = profileType === "normal" ? "normal_slot" : "vip_slot";
      const otherSlotField = profileType === "normal" ? "vip_slot" : "normal_slot";
      const activeProfiles = store.profiles.filter((profile) => profile.id !== id && profile.is_active === true);
      const requestedSlot = Number(nextPayload[slotField]);
      const occupied = new Set(activeProfiles.flatMap((profile) => [
        Number(profile.vip_slot) || 0,
        Number(profile.normal_slot) || 0
      ]));
      const slot = Number.isInteger(requestedSlot) && requestedSlot > 0 && !occupied.has(requestedSlot)
        ? requestedSlot
        : firstFreeSlot(activeProfiles, profileType);
      nextPayload = {
        ...nextPayload,
        [slotField]: slot,
        [otherSlotField]: null,
        priority_order: slot,
        display_priority: slot
      };
      entries = profileWriteEntries(nextPayload).filter(([key]) => key !== "owner_user_id");
    }

    const updated = {
      ...current,
      ...Object.fromEntries(entries),
      owner_user_id: owner,
      updated_at: new Date().toISOString()
    };
    store.profiles[index] = updated;
    return updated;
  });
}

async function mutateCustomerProfileImages(profileId, ownerUserId, mutation) {
  const id = String(profileId || "").trim();
  const owner = String(ownerUserId || "").trim();
  if (!id || !owner) return null;
  return mutateProfileStore(async (store) => {
    const index = store.profiles.findIndex((profile) => profile.id === id && profile.owner_user_id === owner);
    if (index < 0) return null;
    const current = store.profiles[index];
    const images = Array.isArray(current.images)
      ? current.images.map((image) => String(image || "").trim()).filter(Boolean)
      : [];
    const nextImages = mutation(images);
    const nextIsActive = current.is_active === true &&
      isProfilePublishable({ ...current, images: nextImages });
    const updated = {
      ...current,
      images: nextImages,
      is_active: nextIsActive,
      updated_at: new Date().toISOString()
    };
    store.profiles[index] = updated;
    return updated;
  });
}

async function appendCustomerProfileImage(profileId, ownerUserId, imageUrl, maxImages = 12) {
  const limit = Math.max(1, Math.min(Number.parseInt(maxImages, 10) || 12, 12));
  return mutateCustomerProfileImages(profileId, ownerUserId, (images) => {
    if (images.includes(imageUrl)) return images;
    if (images.length >= limit) {
      const error = new Error(`Bir profilde en fazla ${limit} görsel olabilir.`);
      error.status = 409;
      throw error;
    }
    return [...images, imageUrl];
  });
}

async function removeCustomerProfileImage(profileId, ownerUserId, imageUrl) {
  return mutateCustomerProfileImages(profileId, ownerUserId, (images) => {
    if (!images.includes(imageUrl)) {
      const error = new Error("Profil görseli bulunamadı.");
      error.status = 404;
      throw error;
    }
    return images.filter((image) => image !== imageUrl);
  });
}

module.exports = {
  appendCustomerProfileImage,
  assertCustomerMobileProfileStorageReady,
  createCustomerProfile,
  getCustomerProfileById,
  listCustomerProfiles,
  profileStorePath,
  removeCustomerProfileImage,
  updateCustomerProfile,
  useLocalCustomerProfiles
};
