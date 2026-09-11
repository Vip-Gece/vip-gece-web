"use strict";

const { hasDatabaseUrl, query } = require("./postgresClient");

const AD_WRITE_COLUMNS = new Set([
  "title",
  "image_url",
  "target_url",
  "position",
  "is_active",
  "starts_at",
  "ends_at"
]);

function adWriteEntries(payload = {}) {
  return Object.entries(payload).filter(([key]) => AD_WRITE_COLUMNS.has(key));
}

function normalizeAdId(adId) {
  const normalized = String(adId || "").trim();
  if (!/^\d{1,20}$/.test(normalized) || normalized === "0") {
    const error = new Error("Geçersiz reklam kimliği.");
    error.code = "INVALID_AD_ID";
    throw error;
  }
  return normalized;
}

async function listAdminPostgresAds() {
  if (!hasDatabaseUrl()) return [];

  const { rows } = await query(
    `select id, created_at, title, image_url, target_url, position, is_active, starts_at, ends_at
     from public.ads
     order by created_at desc, id desc`
  );
  return Array.isArray(rows) ? rows : [];
}

async function createPostgresAd(payload = {}) {
  if (!hasDatabaseUrl()) throw new Error("DATABASE_URL env eksik");

  const entries = adWriteEntries(payload);
  if (!entries.length) return null;

  const columns = entries.map(([key]) => key);
  const values = entries.map(([, value]) => value);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const { rows } = await query(
    `insert into public.ads (${columns.join(", ")})
     values (${placeholders.join(", ")})
     returning *`,
    values
  );
  return rows[0] || null;
}

async function updatePostgresAd(adId, payload = {}) {
  if (!hasDatabaseUrl()) throw new Error("DATABASE_URL env eksik");

  const id = normalizeAdId(adId);
  const entries = adWriteEntries(payload);
  if (!entries.length) {
    const { rows } = await query("select * from public.ads where id = $1 limit 1", [id]);
    return rows[0] || null;
  }

  const assignments = entries.map(([key], index) => `${key} = $${index + 2}`);
  const values = entries.map(([, value]) => value);
  const { rows } = await query(
    `update public.ads
     set ${assignments.join(", ")}
     where id = $1
     returning *`,
    [id, ...values]
  );
  return rows[0] || null;
}

async function deletePostgresAd(adId) {
  if (!hasDatabaseUrl()) throw new Error("DATABASE_URL env eksik");

  const id = normalizeAdId(adId);
  const result = await query("delete from public.ads where id = $1", [id]);
  return result.rowCount || 0;
}

module.exports = {
  createPostgresAd,
  deletePostgresAd,
  listAdminPostgresAds,
  updatePostgresAd
};
