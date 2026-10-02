"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT_DIR } = require("../config/env");
const { getSupabaseClient, getSupabaseServiceClient } = require("./supabaseClient");
const { hasDatabaseUrl } = require("./postgresClient");
const { getDemoProfiles, shouldUseDemoProfiles } = require("./demoProfiles");
const {
  expireOldPostgresProfiles,
  filterIndexableProfiles,
  getIndexablePostgresProfiles,
  getPostgresProfiles,
  getPostgresProfileSlugOwners
} = require("./postgresProfilesRepo");
const { findProfileBySlug } = require("../utils/profile");
const { isProfilePublishable } = require("../services/profileDefaults");
const {
  customerProfileImageExists
} = require("../services/customerProfileImageService");

const CUSTOMER_UPLOADS_DIR = path.join(ROOT_DIR, "media", "customer-upload");
const DEFAULT_RETIRED_PROFILE_IMAGE_HOSTS = new Set([
  "hofblpqaxzhybozavtaz.supabase.co"
]);

function fallbackProfiles() {
  return shouldUseDemoProfiles() ? getDemoProfiles() : [];
}

function boundedCacheMs(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

const SUPABASE_PROFILE_CACHE_TTL_MS = boundedCacheMs("SUPABASE_PROFILE_CACHE_TTL_MS", 60_000, 5_000, 300_000);
const POSTGRES_PROFILE_FAILURE_BACKOFF_MS = boundedCacheMs("POSTGRES_PROFILE_FAILURE_BACKOFF_MS", 300_000, 30_000, 900_000);

let postgresProfileBackoffUntil = 0;
let supabaseProfileCache = { rows: null, expiresAt: 0 };
let supabaseProfileRefresh = null;

function allowSupabaseProfileData() {
  return process.env.VIP_GECE_ALLOW_SUPABASE_PROFILE_DATA === "true";
}

function getSupabaseProfileReadClient() {
  return getSupabaseServiceClient() || getSupabaseClient();
}

function logPostgresProfileFallback(label, error) {
  console.error(`${label}:`, error?.message || error);
}

function canReadPostgresProfiles() {
  return hasDatabaseUrl() && Date.now() >= postgresProfileBackoffUntil;
}

function notePostgresProfileFailure(label, error) {
  postgresProfileBackoffUntil = Date.now() + POSTGRES_PROFILE_FAILURE_BACKOFF_MS;
  logPostgresProfileFallback(label, error);
}

async function getSupabaseProfiles() {
  if (!allowSupabaseProfileData()) return [];
  if (supabaseProfileCache.rows && supabaseProfileCache.expiresAt > Date.now()) {
    return supabaseProfileCache.rows;
  }
  if (supabaseProfileRefresh) return supabaseProfileRefresh;

  const supabase = getSupabaseProfileReadClient();
  if (!supabase) return [];

  const refresh = (async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase profiles error:", error);
      return [];
    }

    const rows = Array.isArray(data) ? data : [];
    supabaseProfileCache = {
      rows,
      expiresAt: Date.now() + SUPABASE_PROFILE_CACHE_TTL_MS
    };
    return rows;
  })();

  supabaseProfileRefresh = refresh;
  try {
    return await refresh;
  } finally {
    if (supabaseProfileRefresh === refresh) supabaseProfileRefresh = null;
  }
}

function retiredProfileImageHosts() {
  return new Set([
    ...DEFAULT_RETIRED_PROFILE_IMAGE_HOSTS,
    ...String(process.env.PROFILE_IMAGE_RETIRED_HOSTS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  ]);
}

function isRetiredProfileImage(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return retiredProfileImageHosts().has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isUsableProfileImage(value) {
  const image = String(value || "").trim();
  if (!image) return false;
  if (isRetiredProfileImage(image)) return false;
  if (image.startsWith("/media/customer-profile/")) {
    return customerProfileImageExists(image);
  }
  if (!image.startsWith("/media/customer-upload/")) return true;

  try {
    const pathname = decodeURIComponent(new URL(image, "https://vip-gece.invalid").pathname);
    const filePath = path.resolve(ROOT_DIR, `.${pathname}`);
    if (!filePath.startsWith(`${CUSTOMER_UPLOADS_DIR}${path.sep}`)) return false;
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function profileWithUsableImages(profile = {}) {
  if (!Array.isArray(profile.images)) return profile;

  const images = profile.images.filter(isUsableProfileImage);
  if (images.length === profile.images.length) return profile;
  return { ...profile, images };
}

function profilesWithUsableImages(profiles) {
  return Array.isArray(profiles) ? profiles.map(profileWithUsableImages) : [];
}

function publicProfilesWithUsableImages(profiles) {
  return profilesWithUsableImages(profiles).filter(
    (profile) => profile?.is_active === true && isProfilePublishable(profile)
  );
}

function indexableProfilesWithUsableImages(profiles) {
  return filterIndexableProfiles(profilesWithUsableImages(profiles));
}

async function getProfiles() {
  const supabaseProfiles = await getSupabaseProfiles();
  if (supabaseProfiles.length) {
    return publicProfilesWithUsableImages(supabaseProfiles);
  }

  if (canReadPostgresProfiles()) {
    try {
      const postgresProfiles = await getPostgresProfiles();
      if (postgresProfiles.length) {
        return publicProfilesWithUsableImages(postgresProfiles);
      }
    } catch (error) {
      notePostgresProfileFailure("Postgres profiles primary error", error);
    }
  }

  if (!hasDatabaseUrl()) {
    const postgresProfiles = await getPostgresProfiles();
    if (postgresProfiles.length) {
      return publicProfilesWithUsableImages(postgresProfiles);
    }
  }

  return publicProfilesWithUsableImages(fallbackProfiles());
}

async function getSeoProfiles() {
  const supabaseProfiles = await getSupabaseProfiles();
  if (supabaseProfiles.length) {
    return indexableProfilesWithUsableImages(supabaseProfiles);
  }

  if (canReadPostgresProfiles()) {
    try {
      const postgresProfiles = await getIndexablePostgresProfiles();
      if (postgresProfiles.length) {
        return indexableProfilesWithUsableImages(postgresProfiles);
      }
    } catch (error) {
      notePostgresProfileFailure("Postgres indexable profiles primary error", error);
    }
  }

  if (!hasDatabaseUrl()) {
    const postgresProfiles = await getIndexablePostgresProfiles();
    if (postgresProfiles.length) {
      return indexableProfilesWithUsableImages(postgresProfiles);
    }
  }

  return indexableProfilesWithUsableImages(fallbackProfiles());
}

async function findPublicProfileBySlug(profiles, rawSlug) {
  const supabaseProfiles = await getSupabaseProfiles();
  if (supabaseProfiles.length) {
    return findProfileBySlug(profiles, rawSlug, supabaseProfiles);
  }

  if (canReadPostgresProfiles()) {
    try {
      return findProfileBySlug(profiles, rawSlug, await getPostgresProfileSlugOwners());
    } catch (error) {
      notePostgresProfileFailure("Postgres profile slug owner lookup error", error);
    }
  }
  return findProfileBySlug(profiles, rawSlug, fallbackProfiles());
}

async function expireOldProfiles() {
  if (allowSupabaseProfileData()) {
    const supabase = getSupabaseProfileReadClient();
    if (!supabase) return;

    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("profiles")
        .update({ is_active: false })
        .lt("expires_at", now)
        .eq("is_lifetime", false)
        .eq("is_active", true);

      if (!error) {
        return;
      }

      console.error("Expire profiles error:", error);
    } catch (err) {
      console.error("Expire profiles crash:", err);
    }

    return;
  }

  if (canReadPostgresProfiles()) {
    try {
      await expireOldPostgresProfiles();
    } catch (error) {
      notePostgresProfileFailure("Postgres expire profiles fallback error", error);
    }
  }
}

module.exports = {
  getProfiles,
  getSeoProfiles,
  findPublicProfileBySlug,
  expireOldProfiles,
  indexableProfilesWithUsableImages,
  isRetiredProfileImage,
  profileWithUsableImages,
  publicProfilesWithUsableImages
};
