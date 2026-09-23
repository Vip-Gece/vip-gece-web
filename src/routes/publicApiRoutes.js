"use strict";

const express = require("express");
const { categoryRows, districtRows, publicContact, publicSettings, seoClusterRows } = require("../data/publicMetadata");
const { buildProfileImageProxyUrl } = require("../services/profileImageProxyService");
const { setNoStore } = require("../utils/cacheHeaders");
const { cleanImageUrl, cleanText } = require("../utils/input");

function getProfileHelpers() {
  const { getProfiles, getSeoProfiles, findPublicProfileBySlug } = require("../data/profilesRepo");
  const { getProfileSlug } = require("../utils/profile");
  return { findProfileBySlug: findPublicProfileBySlug, getProfiles, getProfileSlug, getSeoProfiles };
}

function activeProfiles(profiles) {
  return (profiles || []).filter((profile) => profile?.is_active === true);
}

function publicText(value, maxLength = 500) {
  return cleanText(value, maxLength).replace(/[<>]/g, "");
}

function publicImages(profile) {
  return Array.isArray(profile.images)
    ? profile.images
      .map(cleanImageUrl)
      .filter(Boolean)
      .slice(0, 12)
      .map((image) => buildProfileImageProxyUrl(image))
    : [];
}

function sendPublicUnavailable(res, message) {
  setNoStore(res);
  res.setHeader("Retry-After", "60");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  return res.status(503).json({ error: message });
}

function sendNoStoreJson(res, body) {
  setNoStore(res);
  return res.json(body);
}

function publicTags(profile) {
  return Array.isArray(profile.tags)
    ? profile.tags.map((tag) => publicText(tag, 80)).filter(Boolean).slice(0, 24)
    : [];
}

function publicPhone(value) {
  return cleanText(value, 40).replace(/[^\d+]/g, "").slice(0, 40);
}

function publicTelegram(value) {
  return cleanText(value, 80).replace(/^@+/, "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 80);
}

function publicSlug(profile, getProfileSlug) {
  return publicText(getProfileSlug(profile), 160);
}

function publicNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function publicOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function publicTimestamp(value) {
  const raw = cleanText(value, 80);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function publicProfile(profile, getProfileSlug) {
  return {
    id: publicText(profile.id, 120),
    slug: publicSlug(profile, getProfileSlug),
    name: publicText(profile.name || "Profil", 120),
    city: publicText(profile.city, 80),
    district: publicText(profile.district, 80),
    age: publicText(profile.age || profile.yas, 8),
    height: publicText(profile.height || profile.boy, 16),
    weight: publicText(profile.weight || profile.kilo, 16),
    description: publicText(profile.description || profile.card_label, 3000),
    images: publicImages(profile),
    phone: publicPhone(profile.phone),
    whatsapp: publicPhone(profile.whatsapp),
    telegram: publicTelegram(profile.telegram),
    card_label: publicText(profile.card_label, 120),
    tags: publicTags(profile),
    type: publicText(profile.type, 24),
    is_featured: profile.is_featured === true
  };
}

function publicProfileCard(profile, getProfileSlug) {
  return {
    slug: publicSlug(profile, getProfileSlug),
    name: publicText(profile.name || "Profil", 120),
    city: publicText(profile.city, 80),
    district: publicText(profile.district, 80),
    age: publicText(profile.age || profile.yas, 8),
    height: publicText(profile.height || profile.boy, 16),
    weight: publicText(profile.weight || profile.kilo, 16),
    description: publicText(profile.description || profile.card_label, 3000),
    images: publicImages(profile),
    card_label: publicText(profile.card_label, 120),
    tags: publicTags(profile),
    type: publicText(profile.type, 24),
    is_featured: profile.is_featured === true,
    is_active: profile.is_active !== false,
    priority_order: publicNumber(profile.priority_order),
    display_priority: publicNumber(profile.display_priority),
    vip_slot: publicOptionalNumber(profile.vip_slot),
    normal_slot: publicOptionalNumber(profile.normal_slot),
    created_at: publicTimestamp(profile.created_at)
  };
}

async function sendPublicProfiles(req, res) {
  setNoStore(res);
  try {
    const { getProfiles, getProfileSlug } = getProfileHelpers();
    const profiles = activeProfiles(await getProfiles());
    if (!profiles.length) {
      return sendPublicUnavailable(res, "Profil listesi geçici olarak kullanılamıyor.");
    }
    return res.json({
      profiles: profiles.map((profile) => publicProfileCard(profile, getProfileSlug))
    });
  } catch (err) {
    console.error("Public profiles API error:", err);
    return sendPublicUnavailable(res, "Profil listesi geçici olarak kullanılamıyor.");
  }
}

async function sendPublicProfile(req, res) {
  setNoStore(res);
  try {
    const { findProfileBySlug, getProfileSlug, getSeoProfiles } = getProfileHelpers();
    const profiles = await getSeoProfiles();
    if (!profiles.length) {
      return sendPublicUnavailable(res, "Profil listesi geçici olarak kullanılamıyor.");
    }
    const profile = await findProfileBySlug(profiles, req.params.slug);

    if (!profile) {
      return res.status(404).json({ error: "Profil bulunamadı." });
    }

    return res.json({ profile: publicProfile(profile, getProfileSlug) });
  } catch (err) {
    console.error("Public profile API error:", err);
    return sendPublicUnavailable(res, "Profil geçici olarak kullanılamıyor.");
  }
}

function createPublicApiRouter() {
  const router = express.Router();

  router.get("/api/v1/public/profiles", sendPublicProfiles);
  router.get("/api/v1/public/profiles/:slug", sendPublicProfile);

  router.get("/api/public/profiles", sendPublicProfiles);
  router.get("/api/public/profile/:slug", sendPublicProfile);
  router.get("/api/public/settings", (req, res) =>
    sendNoStoreJson(res, { settings: publicSettings() }));
  router.get("/api/public/districts", (req, res) =>
    sendNoStoreJson(res, { districts: districtRows() }));
  router.get("/api/public/categories", (req, res) =>
    sendNoStoreJson(res, { categories: categoryRows() }));
  router.get("/api/public/seo-clusters", (req, res) =>
    sendNoStoreJson(res, { clusters: seoClusterRows() }));
  router.get("/api/public/contact", (req, res) =>
    sendNoStoreJson(res, { contact: publicContact() }));

  return router;
}

module.exports = {
  createPublicApiRouter,
  publicProfileCard,
  publicProfile
};
