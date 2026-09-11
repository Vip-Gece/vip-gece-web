"use strict";

const fs = require("fs");
const path = require("path");
const { ROOT_DIR } = require("../config/env");
const { verifyManifestSignature } = require("./mobileReleaseManifest");

const RELEASE_MANIFEST_PATH = path.join(ROOT_DIR, "public", "downloads", "vip-gece-admin-latest.json");
const RELEASE_PUBLIC_KEY_PATH = path.join(
  ROOT_DIR,
  "mobile-admin",
  "android",
  "app",
  "src",
  "main",
  "res",
  "raw",
  "vip_gece_update_public_key.pem"
);

function cleanString(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function readManifestFile() {
  try {
    if (!fs.existsSync(RELEASE_MANIFEST_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(RELEASE_MANIFEST_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function adminAndroidReleaseManifest(env = process.env) {
  const fileManifest = readManifestFile() || {};
  if (fileManifest.signature) {
    const publicKey = fs.readFileSync(RELEASE_PUBLIC_KEY_PATH, "utf8");
    if (!verifyManifestSignature(fileManifest, publicKey)) {
      throw new Error("Mobil release manifest imzasi gecersiz.");
    }
    return { ...fileManifest, ok: true };
  }

  if (env.NODE_ENV === "production") {
    throw new Error("İmzalı mobil release manifesti production ortamında zorunludur.");
  }

  const apkUrl = cleanString(
    env.VIP_GECE_ADMIN_APK_URL ||
    fileManifest.apk_url ||
    "/public/downloads/vip-gece-admin-latest.apk"
  );

  return {
    ok: true,
    app: "vip-gece-admin",
    platform: "android",
    version_name: cleanString(env.VIP_GECE_ADMIN_APK_VERSION_NAME || fileManifest.version_name, "1.0.1"),
    version_code: Number.parseInt(env.VIP_GECE_ADMIN_APK_VERSION_CODE || fileManifest.version_code || "2", 10),
    build_label: cleanString(env.VIP_GECE_ADMIN_APK_BUILD_LABEL || fileManifest.build_label, "20260705-admin-apk"),
    apk_url: apkUrl,
    sha256: cleanString(env.VIP_GECE_ADMIN_APK_SHA256 || fileManifest.sha256),
    size_bytes: Number.parseInt(env.VIP_GECE_ADMIN_APK_SIZE_BYTES || fileManifest.size_bytes || "0", 10),
    mandatory: String(env.VIP_GECE_ADMIN_APK_MANDATORY || fileManifest.mandatory || "").toLowerCase() === "true",
    release_notes: cleanString(
      env.VIP_GECE_ADMIN_APK_RELEASE_NOTES || fileManifest.release_notes,
      "Canli yonetim paneli, profil gorsel yonetimi ve sunucu uzerinden APK guncelleme denetimi."
    ),
    updated_at: cleanString(fileManifest.updated_at, new Date().toISOString())
  };
}

module.exports = {
  adminAndroidReleaseManifest,
  RELEASE_MANIFEST_PATH,
  RELEASE_PUBLIC_KEY_PATH
};
