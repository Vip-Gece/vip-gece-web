"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT_DIR } = require("../config/env");
const { getSupabaseClient } = require("./supabaseClient");
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

function allowSupabaseProfileData() {
  return process.env.VIP_GECE_ALLOW_SUPABASE_PROFILE_DATA === "true";
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
  if (hasDatabaseUrl()) {
    const postgresProfiles = await getPostgresProfiles();
    if (postgresProfiles.length) {
      return publicProfilesWithUsableImages(postgresProfiles);
    }
  }

  const supabase = getSupabaseClient();

  if (supabase && allowSupabaseProfileData()) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase profiles error:", error);
    } else if (Array.isArray(data) && data.length) {
      return publicProfilesWithUsableImages(data);
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
  if (hasDatabaseUrl()) {
    const postgresProfiles = await getIndexablePostgresProfiles();
    if (postgresProfiles.length) {
      return indexableProfilesWithUsableImages(postgresProfiles);
    }
  }

  const supabase = getSupabaseClient();

  if (supabase && allowSupabaseProfileData()) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase indexable profiles error:", error);
    } else if (Array.isArray(data) && data.length) {
      return indexableProfilesWithUsableImages(data);
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
  if (hasDatabaseUrl()) {
    return findProfileBySlug(profiles, rawSlug, await getPostgresProfileSlugOwners());
  }
  const supabase = getSupabaseClient();
  if (supabase && allowSupabaseProfileData()) {
    const { data, error } = await supabase.from("profiles")
      .select("id,name,card_label,slug,city,district,is_active");
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("Profile slug ownership is unavailable.");
    return findProfileBySlug(profiles, rawSlug, data);
  }
  return findProfileBySlug(profiles, rawSlug, fallbackProfiles());
}

async function expireOldProfiles() {
  if (hasDatabaseUrl()) {
    await expireOldPostgresProfiles();
    return;
  }

  const supabase = getSupabaseClient();

  if (supabase && allowSupabaseProfileData()) {
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
  }

  await expireOldPostgresProfiles();
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
