"use strict";

const fs = require("fs");
const { constants: fsConstants } = require("fs");
const { access, lstat, mkdir, readFile, rename, writeFile } = require("fs/promises");
const path = require("path");
const { ROOT_DIR } = require("../config/env");
const { cleanPhone, cleanTelegram, cleanText } = require("../utils/input");

const DEFAULT_SITE_SETTINGS = Object.freeze({
  site_name: "VIP GECE",
  site_slogan: "Premium ilan vitrini",
  home_title: "İstanbul VIP Escort Profilleri | VIP Gece",
  home_description: "İstanbul'daki güncel VIP escort profil ilanlarını doğrulanmış konum ve dolu kategori bağlantılarıyla sunar.",
  home_keywords_text: "VIP Gece, İstanbul'daki güncel escort profil ilanlarını fotoğrafları ve temel bilgileriyle listeler.",
  featured_title: "VIP Vitrin",
  normal_title: "VIP Profiller",
  detail_title: "VIP GECE İLAN DETAYI",
  empty_text: "Profil yakında",
  whatsapp: "",
  telegram: "",
  phone: ""
});

const TEXT_LIMITS = Object.freeze({
  site_name: 80,
  site_slogan: 180,
  home_title: 180,
  home_description: 320,
  home_keywords_text: 1600,
  featured_title: 120,
  normal_title: 120,
  detail_title: 160,
  empty_text: 160
});

const REQUIRED_FIELDS = Object.freeze([
  "site_name",
  "home_title",
  "home_description",
  "featured_title",
  "normal_title",
  "detail_title",
  "empty_text"
]);

let writeQueue = Promise.resolve();

function settingsStorePath() {
  const configured = String(process.env.SITE_SETTINGS_STORE_PATH || "").trim();
  if (configured) return path.resolve(configured);
  if (process.env.NODE_ENV === "production") {
    return "/var/lib/vip-gece/site-settings.json";
  }
  return path.join(ROOT_DIR, ".data", "site-settings.json");
}

async function assertSiteSettingsStorageReady() {
  const filePath = settingsStorePath();
  const directoryPath = path.dirname(filePath);
  await mkdir(directoryPath, { recursive: true, mode: 0o700 });

  const directory = await lstat(directoryPath);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o077) !== 0
  ) {
    throw new Error("Site settings storage root is not a safe directory.");
  }
  await access(directoryPath, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);

  try {
    const file = await lstat(filePath);
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      (file.mode & 0o077) !== 0
    ) {
      throw new Error("Site settings store is not a safe private file.");
    }
    await getSiteSettings();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function fallbackSettings(config = {}) {
  return {
    ...DEFAULT_SITE_SETTINGS,
    site_name: cleanText(config.siteName, TEXT_LIMITS.site_name) || DEFAULT_SITE_SETTINGS.site_name,
    site_slogan: cleanText(config.siteSlogan, TEXT_LIMITS.site_slogan) || DEFAULT_SITE_SETTINGS.site_slogan,
    home_title: cleanText(config.homeTitle, TEXT_LIMITS.home_title) || DEFAULT_SITE_SETTINGS.home_title,
    home_description: cleanText(config.homeDescription, TEXT_LIMITS.home_description) || DEFAULT_SITE_SETTINGS.home_description,
    home_keywords_text: cleanText(config.homeKeywordsText, TEXT_LIMITS.home_keywords_text) || DEFAULT_SITE_SETTINGS.home_keywords_text,
    featured_title: cleanText(config.featuredTitle, TEXT_LIMITS.featured_title) || DEFAULT_SITE_SETTINGS.featured_title,
    normal_title: cleanText(config.normalTitle, TEXT_LIMITS.normal_title) || DEFAULT_SITE_SETTINGS.normal_title,
    detail_title: cleanText(config.detailPageTitle, TEXT_LIMITS.detail_title) || DEFAULT_SITE_SETTINGS.detail_title,
    empty_text: cleanText(config.emptyBoxText, TEXT_LIMITS.empty_text) || DEFAULT_SITE_SETTINGS.empty_text
  };
}

function sanitizeSettings(input = {}, fallback = DEFAULT_SITE_SETTINGS) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const output = {};

  for (const [field, limit] of Object.entries(TEXT_LIMITS)) {
    output[field] = cleanText(source[field] ?? fallback[field], limit);
  }

  output.whatsapp = cleanPhone(source.whatsapp ?? fallback.whatsapp);
  output.telegram = cleanTelegram(source.telegram ?? fallback.telegram);
  output.phone = cleanPhone(source.phone ?? fallback.phone);
  output.updated_at = cleanText(source.updated_at, 80);
  return output;
}

function assertValidSettings(settings) {
  const missing = REQUIRED_FIELDS.filter((field) => !settings[field]);
  if (missing.length) {
    const error = new Error(`Zorunlu site ayarları boş bırakılamaz: ${missing.join(", ")}`);
    error.status = 400;
    throw error;
  }
}

function readStoredSettingsSync() {
  try {
    return JSON.parse(fs.readFileSync(settingsStorePath(), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error("Site settings read error:", error.message);
    }
    return null;
  }
}

function readSiteSettingsSync(config = {}) {
  const fallback = fallbackSettings(config);
  const stored = readStoredSettingsSync();
  return sanitizeSettings(stored || {}, fallback);
}

async function getSiteSettings(config = {}) {
  const fallback = fallbackSettings(config);
  try {
    const stored = JSON.parse(await readFile(settingsStorePath(), "utf8"));
    return sanitizeSettings(stored, fallback);
  } catch (error) {
    if (error?.code === "ENOENT") return sanitizeSettings({}, fallback);
    const wrapped = new Error("Canlı site ayarları güvenli biçimde okunamadı.");
    wrapped.status = 503;
    wrapped.cause = error;
    throw wrapped;
  }
}

async function updateSiteSettings(input = {}, config = {}) {
  const operation = writeQueue.then(async () => {
    const current = await getSiteSettings(config);
    const settings = sanitizeSettings(
      {
        ...current,
        ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}),
        updated_at: new Date().toISOString()
      },
      fallbackSettings(config)
    );
    assertValidSettings(settings);

    const filePath = settingsStorePath();
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
      mode: 0o600
    });
    await rename(temporaryPath, filePath);
    return settings;
  });

  writeQueue = operation.catch(() => {});
  return operation;
}

function siteConfigOverlay(settings = {}) {
  return {
    siteName: settings.site_name,
    siteSlogan: settings.site_slogan,
    homeTitle: settings.home_title,
    homeDescription: settings.home_description,
    homeKeywordsText: settings.home_keywords_text,
    featuredTitle: settings.featured_title,
    normalTitle: settings.normal_title,
    detailPageTitle: settings.detail_title,
    emptyBoxText: settings.empty_text
  };
}

module.exports = {
  DEFAULT_SITE_SETTINGS,
  assertSiteSettingsStorageReady,
  getSiteSettings,
  readSiteSettingsSync,
  siteConfigOverlay,
  updateSiteSettings
};
