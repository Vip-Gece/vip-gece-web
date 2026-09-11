"use strict";

const express = require("express");
const { transaction } = require("../data/postgresClient");
const {
  assertCustomerProfileImageStorageReady,
  customerProfileImageExists
} = require("../services/customerProfileImageService");
const {
  assertCustomerMobileAccountStorageReady
} = require("../services/customerMobileAccountService");
const {
  ensureProfileAnalyticsStorage
} = require("../services/profileAnalyticsService");
const {
  assertSiteSettingsStorageReady
} = require("../services/siteSettingsService");
const { buildProfileImageProxyUrl } = require("../services/profileImageProxyService");
const { isProfilePublishable } = require("../services/profileDefaults");
const { setNoStore } = require("../utils/cacheHeaders");

// Supabase can occasionally take several seconds to establish or reuse a TLS
// connection. Keep readiness fail-closed, but do not report a false outage
// while the database client is still inside its own bounded query timeout.
const READINESS_TIMEOUT_MS = 12_000;
const READINESS_SUCCESS_TTL_MS = 15_000;
let readinessInFlight = null;
let readinessSucceededAt = 0;

function assertProfileImageReadiness(profiles) {
  const images = (profiles || [])
    .flatMap((profile) => Array.isArray(profile?.images) ? profile.images : [])
    .map((image) => String(image || "").trim())
    .filter(Boolean);
  const missingLocalImage = images.find(
    (image) =>
      image.startsWith("/media/customer-profile/") &&
      !customerProfileImageExists(image)
  );
  if (missingLocalImage) {
    throw new Error("Public customer profile image storage is not ready");
  }

  const source = images.find((image) => /^https:\/\//i.test(image));
  if (!source) return;

  const proxied = buildProfileImageProxyUrl(source);
  if (!proxied.startsWith("/media/profile-image/")) {
    throw new Error("Public profile image proxy is not ready");
  }
}

async function performReadinessCheck() {
  await assertSiteSettingsStorageReady();
  await assertCustomerMobileAccountStorageReady();
  await assertCustomerProfileImageStorageReady();
  await transaction(async (client) => {
    await client.query("set local statement_timeout = '1000ms'");
    return client.query("select 1");
  });
  await ensureProfileAnalyticsStorage();

  const {
    listProfilePublicationPostgresProfiles
  } = require("../data/postgresProfilesRepo");
  const { getProfiles } = require("../data/profilesRepo");
  const [publicationProfiles, profiles] = await Promise.all([
    listProfilePublicationPostgresProfiles(),
    getProfiles()
  ]);
  const activePublicationProfiles = publicationProfiles.filter(
    (profile) => profile?.is_active === true && isProfilePublishable(profile)
  );
  if (!profiles.length) {
    throw new Error("No active public profile is available");
  }
  if (profiles.length !== activePublicationProfiles.length) {
    throw new Error("Not every active profile has a usable public image");
  }
  assertProfileImageReadiness(profiles);
}

function sharedReadinessCheck() {
  if (readinessSucceededAt > 0 && Date.now() - readinessSucceededAt < READINESS_SUCCESS_TTL_MS) {
    return Promise.resolve();
  }

  if (!readinessInFlight) {
    const operation = performReadinessCheck().then(() => {
      readinessSucceededAt = Date.now();
    });
    const shared = operation.finally(() => {
      if (readinessInFlight === shared) readinessInFlight = null;
    });
    readinessInFlight = shared;
    // A caller may time out before PostgreSQL finishes. Keep the shared
    // operation handled while it drains so repeated requests cannot grow the
    // pool queue or create an unhandled rejection.
    shared.catch(() => {});
  }

  return readinessInFlight;
}

async function checkReadiness() {
  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Readiness check timed out")), READINESS_TIMEOUT_MS);
  });

  try {
    await Promise.race([sharedReadinessCheck(), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sendReadiness(req, res) {
  setNoStore(res);
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");

  try {
    await checkReadiness();
    return res.status(200).json({ status: "ready" });
  } catch {
    return res.status(503).json({ status: "unavailable" });
  }
}

function createHealthRouter() {
  const router = express.Router();

  router.get("/health", (req, res) => {
    return res.json({
      status: "ok",
      service: "vip-gece",
      env: process.env.NODE_ENV || "production"
    });
  });

  router.get("/api/health", (req, res) => {
    return res.json({
      status: "ok",
      api: "available",
      env: process.env.NODE_ENV || "production"
    });
  });

  router.route("/api/ready")
    .get(sendReadiness)
    .head(sendReadiness);

  return router;
}

module.exports = {
  assertProfileImageReadiness,
  checkReadiness,
  createHealthRouter
};
