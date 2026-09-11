"use strict";

const { hasDatabaseUrl, query, transaction } = require("./postgresClient");
const {
  applyProfileCreateDefaults,
  applyProfileUpdateDefaults,
  assertProfileUpdatePublishable,
  firstFreeSlot,
  isProfilePublishable
} = require("../services/profileDefaults");

function boundedCacheMs(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

const PROFILE_CACHE_TTL_MS = boundedCacheMs("PROFILE_CACHE_TTL_MS", 300_000, 5_000, 300_000);
const PROFILE_CACHE_STALE_MAX_MS = boundedCacheMs(
  "PROFILE_CACHE_STALE_MAX_MS",
  Math.min(600_000, PROFILE_CACHE_TTL_MS + 120_000),
  PROFILE_CACHE_TTL_MS,
  600_000
);

let profileCache = {
  rows: null,
  expiresAt: 0,
  fetchedAt: 0
};
let profileCacheGeneration = 0;
let profileCacheRefresh = null;

const PUBLIC_PROFILE_COLUMNS = [
  "id",
  "created_at",
  "updated_at",
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
  "telegram"
].join(",");

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

function clearPostgresProfileCache() {
  profileCacheGeneration += 1;
  profileCache = {
    rows: null,
    expiresAt: 0,
    fetchedAt: 0
  };
  profileCacheRefresh = null;
}

function profileWriteEntries(payload = {}) {
  return Object.entries(payload).filter(([key]) => PROFILE_WRITE_COLUMNS.has(key));
}

function filterApprovedPostgresProfiles(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter(
    (profile) => profile?.is_active === true
  );
}

function filterPublicPostgresProfiles(rows = []) {
  return filterApprovedPostgresProfiles(rows).filter(
    (profile) => isProfilePublishable(profile)
  );
}

function filterIndexableProfiles(rows = []) {
  return filterPublicPostgresProfiles(rows);
}

async function listAdminPostgresProfiles() {
  if (!hasDatabaseUrl()) {
    return [];
  }

  const { rows } = await query(
    `select *
     from public.profiles
     order by created_at desc`
  );

  return Array.isArray(rows) ? rows : [];
}

async function listProfilePublicationPostgresProfiles() {
  if (!hasDatabaseUrl()) {
    return [];
  }

  const { rows } = await query(
    `select name, slug, description, images, is_active
     from public.profiles
     order by created_at desc`
  );

  return Array.isArray(rows) ? rows : [];
}

async function listCustomerPostgresProfiles(ownerUserId) {
  if (!hasDatabaseUrl()) {
    return [];
  }

  const { rows } = await query(
    `select *
     from public.profiles
     where owner_user_id = $1
     order by created_at desc`,
    [ownerUserId]
  );

  return Array.isArray(rows) ? rows : [];
}

async function getPostgresProfileById(profileId) {
  if (!hasDatabaseUrl()) {
    return null;
  }

  const { rows } = await query("select * from public.profiles where id = $1 limit 1", [profileId]);
  return rows[0] || null;
}

async function getCustomerPostgresProfileById(profileId, ownerUserId) {
  if (!hasDatabaseUrl()) {
    return null;
  }

  const { rows } = await query(
    `select *
     from public.profiles
     where id = $1
       and owner_user_id = $2
     limit 1`,
    [profileId, ownerUserId]
  );
  return rows[0] || null;
}

async function assertOwnerProfileQuota(client, ownerUserId, profileId, profileLimit) {
  const owner = String(ownerUserId || "").trim();
  if (!owner) return;
  const limit = Number.parseInt(profileLimit, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    const error = new Error("Müşteri profil kotası doğrulanamadı.");
    error.status = 400;
    throw error;
  }

  await client.query(
    "select pg_advisory_xact_lock(hashtext($1))",
    [`vip-gece-customer:${owner}`]
  );
  const params = profileId ? [owner, profileId] : [owner];
  const profileFilter = profileId ? "and id <> $2" : "";
  const countResult = await client.query(
    `select count(*)::int as count
     from public.profiles
     where owner_user_id = $1
       ${profileFilter}`,
    params
  );
  const used = Number(countResult.rows[0]?.count || 0);
  if (used >= limit) {
    const error = new Error(`Müşteri profil kotası dolu (${limit}).`);
    error.code = "PROFILE_LIMIT_REACHED";
    error.status = 409;
    throw error;
  }
}

async function createPostgresProfile(payload = {}, options = {}) {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL env eksik");
  }

  const row = await transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock($1::bigint)", [98173041]);
    await assertOwnerProfileQuota(
      client,
      payload.owner_user_id,
      null,
      options.ownerProfileLimit
    );
    const existing = await client.query(
      "select type, is_active, vip_slot, normal_slot from public.profiles"
    );
    const normalized = applyProfileCreateDefaults(payload, existing.rows);
    const entries = profileWriteEntries(normalized);
    if (!entries.length) return null;

    const columns = entries.map(([key]) => key);
    const values = entries.map(([, value]) => value);
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const { rows } = await client.query(
      `insert into public.profiles (${columns.join(", ")})
       values (${placeholders.join(", ")})
       returning *`,
      values
    );
    return rows[0] || null;
  });

  clearPostgresProfileCache();
  return row;
}

async function createCustomerPostgresProfile(ownerUserId, payload = {}, profileLimit = 10) {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL env eksik");
  }

  const owner = String(ownerUserId || "").trim();
  const limit = Math.max(1, Math.min(Number.parseInt(profileLimit, 10) || 10, 50));
  if (!owner) {
    const error = new Error("Müşteri sahipliği gerekli.");
    error.status = 400;
    throw error;
  }

  const row = await transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`vip-gece-customer:${owner}`]);

    const countResult = await client.query(
      "select count(*)::int as count from public.profiles where owner_user_id = $1",
      [owner]
    );
    const used = Number(countResult.rows[0]?.count || 0);
    if (used >= limit) {
      const error = new Error(`Profil sınırına ulaşıldı (${limit}).`);
      error.code = "PROFILE_LIMIT_REACHED";
      error.status = 409;
      error.limit = limit;
      error.used = used;
      throw error;
    }

    const existing = await client.query(
      "select type, is_active, vip_slot, normal_slot from public.profiles"
    );
    const normalized = applyProfileCreateDefaults(
      {
        ...payload,
        owner_user_id: owner,
        is_active: false
      },
      existing.rows
    );
    normalized.owner_user_id = owner;
    normalized.is_active = false;

    const entries = profileWriteEntries(normalized);
    if (!entries.length) return null;

    const columns = entries.map(([key]) => key);
    const values = entries.map(([, value]) => value);
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const { rows } = await client.query(
      `insert into public.profiles (${columns.join(", ")})
       values (${placeholders.join(", ")})
       returning *`,
      values
    );
    return rows[0] || null;
  });

  clearPostgresProfileCache();
  return row;
}

async function updatePostgresProfile(profileId, payload = {}, options = {}) {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL env eksik");
  }

  let entries = profileWriteEntries(applyProfileUpdateDefaults(payload));
  if (!entries.length) return getPostgresProfileById(profileId);

  const row = await transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock($1::bigint)", [98173041]);
    const currentResult = await client.query(
      "select * from public.profiles where id = $1 limit 1 for update",
      [profileId]
    );
    const current = currentResult.rows[0] || null;
    if (!current) return null;

    let nextPayload = applyProfileUpdateDefaults(
      Object.fromEntries(entries),
      current
    );
    entries = profileWriteEntries(nextPayload);
    assertProfileUpdatePublishable(current, nextPayload);

    if (
      Object.prototype.hasOwnProperty.call(nextPayload, "owner_user_id") &&
      nextPayload.owner_user_id &&
      nextPayload.owner_user_id !== current.owner_user_id
    ) {
      await assertOwnerProfileQuota(
        client,
        nextPayload.owner_user_id,
        profileId,
        options.ownerProfileLimit
      );
    }

    const nextIsActive = Object.prototype.hasOwnProperty.call(nextPayload, "is_active")
      ? nextPayload.is_active === true
      : current.is_active === true;
    const nextType = String(nextPayload.type || current.type || "").toLowerCase() === "normal"
      ? "normal"
      : "vip";
    const nextSlotField = nextType === "normal" ? "normal_slot" : "vip_slot";
    const requestedActiveSlot = Number(
      Object.prototype.hasOwnProperty.call(nextPayload, nextSlotField)
        ? nextPayload[nextSlotField]
        : current[nextSlotField]
    );

    if (
      current.is_active === true &&
      nextIsActive &&
      Number.isInteger(requestedActiveSlot) &&
      requestedActiveSlot > 0
    ) {
      const occupiedResult = await client.query(
        `select id
         from public.profiles
         where id <> $1
           and is_active = true
           and (vip_slot = $2 or normal_slot = $2)
         limit 1
         for update`,
        [profileId, requestedActiveSlot]
      );
      if (occupiedResult.rows[0]) {
        const error = new Error(`Ana sayfa sırası ${requestedActiveSlot} başka bir yayındaki profile ait.`);
        error.code = "HOMEPAGE_SLOT_OCCUPIED";
        error.status = 409;
        throw error;
      }
    }

    if (current.is_active !== true && nextPayload.is_active === true) {
      const profileType =
        String(nextPayload.type || current.type || "").toLowerCase() === "normal"
          ? "normal"
          : "vip";
      const slotField = profileType === "normal" ? "normal_slot" : "vip_slot";
      const otherSlotField = profileType === "normal" ? "vip_slot" : "normal_slot";
      const existing = await client.query(
        `select type, is_active, vip_slot, normal_slot
         from public.profiles
         where id <> $1
           and is_active = true`,
        [profileId]
      );
      const requestedSlot = Number(nextPayload[slotField]);
      const occupied = new Set(existing.rows.flatMap((profile) => [
        Number(profile.vip_slot) || 0,
        Number(profile.normal_slot) || 0
      ]));
      const slot = Number.isInteger(requestedSlot) &&
        requestedSlot > 0 &&
        !occupied.has(requestedSlot)
        ? requestedSlot
        : firstFreeSlot(existing.rows, profileType);
      nextPayload = {
        ...nextPayload,
        [slotField]: slot,
        [otherSlotField]: null,
        priority_order: slot,
        display_priority: slot
      };
      entries = profileWriteEntries(nextPayload);
    }

    const assignments = entries.map(([key], index) => `${key} = $${index + 2}`);
    const values = entries.map(([, value]) => value);
    const { rows } = await client.query(
      `update public.profiles
       set ${assignments.join(", ")},
           updated_at = now()
       where id = $1
       returning *`,
      [profileId, ...values]
    );
    return rows[0] || null;
  });

  clearPostgresProfileCache();
  return row;
}

async function mutateCustomerPostgresProfileImages(
  profileId,
  ownerUserId,
  mutation
) {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL env eksik");
  }

  const row = await transaction(async (client) => {
    const currentResult = await client.query(
      `select *
       from public.profiles
       where id = $1
         and owner_user_id = $2
       limit 1
       for update`,
      [profileId, ownerUserId]
    );
    const current = currentResult.rows[0] || null;
    if (!current) return null;

    const images = Array.isArray(current.images)
      ? current.images.map((image) => String(image || "").trim()).filter(Boolean)
      : [];
    const nextImages = mutation(images);
    const nextIsActive =
      current.is_active === true &&
      isProfilePublishable({ ...current, images: nextImages });
    const { rows } = await client.query(
      `update public.profiles
       set images = $3,
           is_active = $4,
           updated_at = now()
       where id = $1
         and owner_user_id = $2
       returning *`,
      [profileId, ownerUserId, nextImages, nextIsActive]
    );
    return rows[0] || null;
  });

  clearPostgresProfileCache();
  return row;
}

async function appendCustomerPostgresProfileImage(
  profileId,
  ownerUserId,
  imageUrl,
  maxImages = 12
) {
  const limit = Math.max(1, Math.min(Number.parseInt(maxImages, 10) || 12, 12));
  return mutateCustomerPostgresProfileImages(
    profileId,
    ownerUserId,
    (images) => {
      if (images.length >= limit) {
        const error = new Error(`Bir profilde en fazla ${limit} görsel olabilir.`);
        error.code = "PROFILE_IMAGE_LIMIT_REACHED";
        error.status = 409;
        throw error;
      }
      return [...images, imageUrl];
    }
  );
}

async function removeCustomerPostgresProfileImage(
  profileId,
  ownerUserId,
  imageUrl
) {
  return mutateCustomerPostgresProfileImages(
    profileId,
    ownerUserId,
    (images) => {
      if (!images.includes(imageUrl)) {
        const error = new Error("Profil görseli bulunamadı.");
        error.code = "PROFILE_IMAGE_NOT_FOUND";
        error.status = 404;
        throw error;
      }
      return images.filter((image) => image !== imageUrl);
    }
  );
}

async function updateCustomerPostgresProfile(profileId, ownerUserId, payload = {}) {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL env eksik");
  }

  let entries = profileWriteEntries(applyProfileUpdateDefaults(payload))
    .filter(([key]) => key !== "owner_user_id");
  if (!entries.length) return getCustomerPostgresProfileById(profileId, ownerUserId);

  const row = await transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock($1::bigint)", [98173041]);
    const currentResult = await client.query(
      `select *
       from public.profiles
       where id = $1
         and owner_user_id = $2
       limit 1
       for update`,
      [profileId, ownerUserId]
    );
    const current = currentResult.rows[0] || null;
    if (!current) return null;

    let nextPayload = applyProfileUpdateDefaults(
      Object.fromEntries(entries),
      current
    );
    entries = profileWriteEntries(nextPayload)
      .filter(([key]) => key !== "owner_user_id");
    assertProfileUpdatePublishable(current, nextPayload);

    if (current.is_active !== true && nextPayload.is_active === true) {
      const profileType =
        String(nextPayload.type || current.type || "").toLowerCase() === "normal"
          ? "normal"
          : "vip";
      const slotField = profileType === "normal" ? "normal_slot" : "vip_slot";
      const otherSlotField = profileType === "normal" ? "vip_slot" : "normal_slot";
      const existing = await client.query(
        `select type, is_active, vip_slot, normal_slot
         from public.profiles
         where id <> $1
           and is_active = true`,
        [profileId]
      );
      const requestedSlot = Number(nextPayload[slotField]);
      const occupied = new Set(existing.rows.flatMap((profile) => [
        Number(profile.vip_slot) || 0,
        Number(profile.normal_slot) || 0
      ]));
      const slot = Number.isInteger(requestedSlot) &&
        requestedSlot > 0 &&
        !occupied.has(requestedSlot)
        ? requestedSlot
        : firstFreeSlot(existing.rows, profileType);
      nextPayload = {
        ...nextPayload,
        [slotField]: slot,
        [otherSlotField]: null,
        priority_order: slot,
        display_priority: slot
      };
      entries = profileWriteEntries(nextPayload)
        .filter(([key]) => key !== "owner_user_id");
    }

    const assignments = entries.map(([key], index) => `${key} = $${index + 3}`);
    const values = entries.map(([, value]) => value);
    const { rows } = await client.query(
      `update public.profiles
       set ${assignments.join(", ")},
           updated_at = now()
       where id = $1
         and owner_user_id = $2
       returning *`,
      [profileId, ownerUserId, ...values]
    );
    return rows[0] || null;
  });

  clearPostgresProfileCache();
  return row;
}

async function deletePostgresProfile(profileId) {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL env eksik");
  }

  const result = await query("delete from public.profiles where id = $1", [profileId]);
  clearPostgresProfileCache();
  return result.rowCount || 0;
}

async function getPostgresProfiles() {
  if (!hasDatabaseUrl()) {
    return [];
  }

  const now = Date.now();
  if (profileCache.rows && profileCache.expiresAt > now) {
    return profileCache.rows;
  }

  if (profileCacheRefresh) {
    return profileCacheRefresh;
  }

  const generation = profileCacheGeneration;
  const refresh = (async () => {
    try {
      const { rows } = await query(
        `select ${PUBLIC_PROFILE_COLUMNS}
         from public.profiles
         where is_active = true
         order by created_at desc`
      );
      const publicRows = filterPublicPostgresProfiles(rows);
      const fetchedAt = Date.now();

      if (generation === profileCacheGeneration) {
        profileCache = {
          rows: publicRows,
          expiresAt: fetchedAt + PROFILE_CACHE_TTL_MS,
          fetchedAt
        };
      }

      return publicRows;
    } catch (error) {
      console.error("Postgres profiles fallback error:", error.message);
      const failedAt = Date.now();
      if (
        profileCache.rows?.length &&
        profileCache.fetchedAt > 0 &&
        failedAt - profileCache.fetchedAt <= PROFILE_CACHE_STALE_MAX_MS
      ) {
        return profileCache.rows;
      }
      throw error;
    }
  })();
  profileCacheRefresh = refresh;

  try {
    return await refresh;
  } finally {
    if (profileCacheRefresh === refresh) {
      profileCacheRefresh = null;
    }
  }
}

async function getIndexablePostgresProfiles() {
  return filterIndexableProfiles(await getPostgresProfiles());
}

async function expireOldPostgresProfiles() {
  if (!hasDatabaseUrl()) {
    return;
  }

  try {
    const result = await query(
      `update public.profiles
       set is_active = false,
           updated_at = now()
       where expires_at is not null
         and expires_at < now()
         and coalesce(is_lifetime, false) = false
         and is_active = true`
    );

    if ((result.rowCount || 0) > 0) {
      clearPostgresProfileCache();
    }
  } catch (error) {
    console.error("Postgres expire profiles fallback error:", error.message);
  }
}

module.exports = {
  appendCustomerPostgresProfileImage,
  createCustomerPostgresProfile,
  createPostgresProfile,
  clearPostgresProfileCache,
  deletePostgresProfile,
  filterApprovedPostgresProfiles,
  filterIndexableProfiles,
  filterPublicPostgresProfiles,
  getCustomerPostgresProfileById,
  getIndexablePostgresProfiles,
  getPostgresProfileById,
  getPostgresProfiles,
  listCustomerPostgresProfiles,
  listAdminPostgresProfiles,
  listProfilePublicationPostgresProfiles,
  removeCustomerPostgresProfileImage,
  updateCustomerPostgresProfile,
  updatePostgresProfile,
  expireOldPostgresProfiles
};
