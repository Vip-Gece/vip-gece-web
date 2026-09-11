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
  getPostgresProfiles
} = require("./postgresProfilesRepo");
const { isProfilePublishable } = require("../services/profileDefaults");
const {
  customerProfileImageExists
} = require("../services/customerProfileImageService");

const CUSTOMER_UPLOADS_DIR = path.join(ROOT_DIR, "media", "customer-upload");

function fallbackProfiles() {
  return shouldUseDemoProfiles() ? getDemoProfiles() : [];
}

function allowSupabaseProfileData() {
  return process.env.VIP_GECE_ALLOW_SUPABASE_PROFILE_DATA === "true";
}

function isUsableProfileImage(value) {
  const image = String(value || "").trim();
  if (!image) return false;
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
  expireOldProfiles,
  indexableProfilesWithUsableImages,
  profileWithUsableImages,
  publicProfilesWithUsableImages
};
