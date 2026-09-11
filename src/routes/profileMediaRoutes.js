"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  decodeProfileImageToken,
  loadProfileImage,
  parseAllowedProfileImageUrl,
  parseImageOptionsQuery
} = require("../services/profileImageProxyService");
const {
  decodeCustomerProfilePreviewImageToken,
  decodeCustomerProfileThumbnailToken,
  loadCustomerProfileImage,
  publicImagePath,
  resizePublicCustomerProfileImage,
  resizeCustomerProfileThumbnail
} = require("../services/customerProfileImageService");
const { setNoStore } = require("../utils/cacheHeaders");

const PUBLIC_CUSTOMER_IMAGE_WIDTHS = new Set([
  160,
  180,
  220,
  240,
  280,
  320,
  360,
  420,
  480,
  512,
  640,
  720,
  960,
  1024,
  1200,
  1280,
  1600
]);
const PUBLIC_CUSTOMER_IMAGE_QUALITIES = new Set([68, 72, 76, 80]);

function publicCustomerImageVariant(query) {
  const keys = Object.keys(query || {});
  if (keys.some((key) => !["width", "quality"].includes(key))) return null;
  if (!keys.length) return { width: null, quality: null };
  if (
    typeof query.width !== "string" ||
    !/^\d+$/.test(query.width) ||
    (query.quality !== undefined && (
      typeof query.quality !== "string" ||
      !/^\d+$/.test(query.quality)
    ))
  ) {
    return null;
  }

  const width = Number(query.width);
  const quality = query.quality === undefined ? 72 : Number(query.quality);
  return String(width) === query.width &&
    (query.quality === undefined || String(quality) === query.quality) &&
    PUBLIC_CUSTOMER_IMAGE_WIDTHS.has(width) &&
    PUBLIC_CUSTOMER_IMAGE_QUALITIES.has(quality)
    ? { width, quality }
    : null;
}

async function isPublishedCustomerProfileImage(requestPath) {
  if (!requestPath) return false;
  const { getProfiles } = require("../data/profilesRepo");
  const profiles = await getProfiles();
  return profilesContainCustomerProfileImage(profiles, requestPath);
}

function profilesContainCustomerProfileImage(profiles, requestPath) {
  return (Array.isArray(profiles) ? profiles : []).some((profile) =>
    Array.isArray(profile?.images) &&
    profile.images.some((image) => String(image || "").trim() === requestPath)
  );
}

function profilesContainRemoteProfileImage(profiles, sourceUrl) {
  return (Array.isArray(profiles) ? profiles : []).some((profile) =>
    Array.isArray(profile?.images) &&
    profile.images.some((image) =>
      parseAllowedProfileImageUrl(image)?.toString() === sourceUrl
    )
  );
}

function createProfileMediaRouter() {
  const router = express.Router();
  const imageLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: Math.max(60, Number.parseInt(process.env.PROFILE_IMAGE_RATE_LIMIT || "240", 10) || 240),
    standardHeaders: true,
    legacyHeaders: false
  });

  router.get("/media/profile-image/:token", imageLimiter, async (req, res) => {
    const sourceUrl = decodeProfileImageToken(req.params.token);
    const variant = parseImageOptionsQuery(req.query);
    if (!sourceUrl || !variant) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(400).send("Geçersiz görsel isteği.");
    }

    try {
      const { getProfiles } = require("../data/profilesRepo");
      if (!profilesContainRemoteProfileImage(await getProfiles(), sourceUrl)) {
        setNoStore(res);
        return res.status(404).send("Görsel bulunamadı.");
      }
      const image = await loadProfileImage(sourceUrl, variant);
      res.setHeader("Content-Type", image.contentType);
      res.setHeader("Content-Length", String(image.body.length));
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60, must-revalidate");
      res.removeHeader("Pragma");
      res.removeHeader("CDN-Cache-Control");
      res.removeHeader("Cloudflare-CDN-Cache-Control");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Profile-Image-Cache", image.cacheStatus);
      if (image.sourceEtag) res.setHeader("ETag", image.sourceEtag);
      return res.status(200).send(image.body);
    } catch (error) {
      console.error("Profile image proxy error:", error.message);
      res.setHeader("Cache-Control", "no-store");
      return res.status(error.statusCode || 502).send("Görsel şu anda alınamadı.");
    }
  });

  router.get(
    "/api/customer/mobile/media/preview/:token",
    imageLimiter,
    async (req, res) => {
      setNoStore(res);
      const request = decodeCustomerProfilePreviewImageToken(req.params.token);
      if (!request) return res.status(400).send("Geçersiz görsel isteği.");

      try {
        if (request.kind === "local") {
          const image = await loadCustomerProfileImage(
            request.scope,
            request.profile,
            request.file
          );
          if (!image) return res.status(404).send("Görsel bulunamadı.");
          const body = await resizePublicCustomerProfileImage(
            image.body,
            request.width,
            76
          );
          res.setHeader("Content-Type", "image/jpeg");
          res.setHeader("Content-Length", String(body.length));
          res.setHeader("X-Content-Type-Options", "nosniff");
          return res.status(200).send(body);
        }

        const image = await loadProfileImage(request.source, {
          width: request.width,
          quality: 76,
          resize: "contain"
        });
        res.setHeader("Content-Type", image.contentType);
        res.setHeader("Content-Length", String(image.body.length));
        res.setHeader("X-Content-Type-Options", "nosniff");
        return res.status(200).send(image.body);
      } catch (error) {
        console.error("Customer profile preview image error:", error.message);
        return res.status(error?.status === 413 ? 413 : 500).send("Görsel şu anda alınamadı.");
      }
    }
  );

  router.get(
    "/api/customer/mobile/media/thumbnail/:token",
    imageLimiter,
    async (req, res) => {
      setNoStore(res);
      const request = decodeCustomerProfileThumbnailToken(req.params.token);
      if (!request) return res.status(400).send("Geçersiz görsel isteği.");

      try {
        const image = await loadCustomerProfileImage(
          request.scope,
          request.profile,
          request.file
        );
        if (!image) return res.status(404).send("Görsel bulunamadı.");

        const body = await resizeCustomerProfileThumbnail(image.body, request.width);
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Content-Length", String(body.length));
        res.setHeader("X-Content-Type-Options", "nosniff");
        return res.status(200).send(body);
      } catch (error) {
        console.error("Customer profile thumbnail error:", error.message);
        return res.status(error?.status === 413 ? 413 : 500).send("Görsel şu anda alınamadı.");
      }
    }
  );

  router.get(
    "/media/customer-profile/:accountScope/:profileId/:fileName",
    imageLimiter,
    async (req, res) => {
      try {
        const requestPath = publicImagePath(
          req.params.accountScope,
          req.params.profileId,
          req.params.fileName
        );
        const routePath = `/media/customer-profile/${req.params.accountScope}/${req.params.profileId}/${req.params.fileName}`;
        const variant = publicCustomerImageVariant(req.query);
        if (!requestPath || requestPath !== routePath || !variant) {
          setNoStore(res);
          return res.status(400).send("Geçersiz görsel isteği.");
        }
        if (!await isPublishedCustomerProfileImage(requestPath)) {
          setNoStore(res);
          return res.status(404).send("Görsel bulunamadı.");
        }

        const image = await loadCustomerProfileImage(
          req.params.accountScope,
          req.params.profileId,
          req.params.fileName
        );
        if (!image) {
          setNoStore(res);
          return res.status(404).send("Görsel bulunamadı.");
        }
        const body = variant.width
          ? await resizePublicCustomerProfileImage(image.body, variant.width, variant.quality)
          : image.body;
        res.setHeader("Content-Type", variant.width ? "image/jpeg" : image.contentType);
        res.setHeader("Content-Length", String(body.length));
        res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60, must-revalidate");
        res.removeHeader("Pragma");
        res.setHeader("CDN-Cache-Control", "public, max-age=60, must-revalidate");
        res.setHeader("Cloudflare-CDN-Cache-Control", "public, max-age=60, must-revalidate");
        res.setHeader("X-Content-Type-Options", "nosniff");
        return res.status(200).send(body);
      } catch (error) {
        console.error("Customer profile image error:", error.message);
        setNoStore(res);
        return res.status(500).send("Görsel şu anda alınamadı.");
      }
    }
  );

  return router;
}

module.exports = {
  createProfileMediaRouter,
  profilesContainCustomerProfileImage,
  profilesContainRemoteProfileImage,
  publicCustomerImageVariant
};
