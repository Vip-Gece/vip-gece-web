"use strict";

const crypto = require("crypto");
const { constants: fsConstants, lstatSync } = require("fs");
const {
  access,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} = require("fs/promises");
const path = require("path");
const { ROOT_DIR } = require("../config/env");
const { parseAllowedProfileImageUrl } = require("./profileImageProxyService");

let sharpFactory = null;

const MAX_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 40_000_000;
const MAX_STORED_IMAGE_BYTES = 2_500_000;
const MAX_STORED_EDGE_PIXELS = 2048;
const MAX_THUMBNAIL_BYTES = 512 * 1024;
const IMAGE_TYPES = Object.freeze({
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
});
const ALLOWED_SOURCE_FORMATS = new Set(["jpeg", "png", "webp"]);
const JPEG_ATTEMPTS = Object.freeze([
  { edge: 2048, quality: 84 },
  { edge: 1920, quality: 78 },
  { edge: 1600, quality: 72 },
  { edge: 1280, quality: 68 }
]);

function storageRoot() {
  const configured = String(process.env.CUSTOMER_PROFILE_IMAGE_DIR || "").trim();
  if (configured) return path.resolve(configured);
  if (process.env.NODE_ENV === "production") {
    return "/var/lib/vip-gece/customer-profile-images";
  }
  return path.join(ROOT_DIR, ".data", "customer-profile-images");
}

async function assertCustomerProfileImageStorageReady() {
  const root = storageRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await lstat(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0
  ) {
    throw new Error("Customer profile image storage root is not a safe directory.");
  }
  await access(root, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
}

function safePart(value, max = 80) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, max);
}

function imagePathParts(accountScope, profileId, fileName) {
  const scope = safePart(accountScope, 64);
  const profile = safePart(profileId, 80);
  const file = String(fileName || "").toLowerCase();
  const match = file.match(/^([a-f0-9-]{36})\.(jpg|png|webp)$/);
  if (!scope || !profile || !match) return null;
  return {
    scope,
    profile,
    file,
    extension: match[2]
  };
}

function publicImagePath(accountScope, profileId, fileName) {
  const parts = imagePathParts(accountScope, profileId, fileName);
  return parts
    ? `/media/customer-profile/${parts.scope}/${parts.profile}/${parts.file}`
    : "";
}

function filePath(parts) {
  return path.join(storageRoot(), parts.scope, parts.profile, parts.file);
}

function imageUrlParts(imageUrl) {
  const match = String(imageUrl || "").match(
    /^\/media\/customer-profile\/([^/]+)\/([^/]+)\/([^/]+)$/
  );
  return match ? imagePathParts(match[1], match[2], match[3]) : null;
}

function customerImageError(message, status = 415, code = "INVALID_CUSTOMER_IMAGE") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function sharpInput(body) {
  if (!sharpFactory) {
    sharpFactory = require("sharp");
  }

  return sharpFactory(body, {
    autoOrient: true,
    failOn: "warning",
    limitInputPixels: MAX_SOURCE_PIXELS,
    pages: 1,
    sequentialRead: true
  });
}

async function sanitizeCustomerProfileImage(body) {
  if (
    !Buffer.isBuffer(body) ||
    !body.length ||
    body.length > MAX_SOURCE_IMAGE_BYTES
  ) {
    throw customerImageError(
      "Görsel boş veya izin verilen boyutu aşıyor.",
      413,
      "CUSTOMER_IMAGE_TOO_LARGE"
    );
  }

  let metadata;
  try {
    metadata = await sharpInput(body).metadata();
  } catch {
    throw customerImageError("Görsel güvenli biçimde açılamadı.");
  }

  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (
    !ALLOWED_SOURCE_FORMATS.has(String(metadata.format || "")) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MAX_SOURCE_PIXELS
  ) {
    throw customerImageError("Görsel biçimi veya çözünürlüğü desteklenmiyor.");
  }

  for (const attempt of JPEG_ATTEMPTS) {
    try {
      const { data, info } = await sharpInput(body)
        .resize({
          width: attempt.edge,
          height: attempt.edge,
          fit: "inside",
          withoutEnlargement: true
        })
        .jpeg({
          chromaSubsampling: "4:2:0",
          mozjpeg: true,
          progressive: true,
          quality: attempt.quality
        })
        .toBuffer({ resolveWithObject: true });

      if (
        data.length > 0 &&
        data.length <= MAX_STORED_IMAGE_BYTES &&
        info.format === "jpeg" &&
        info.width > 0 &&
        info.height > 0 &&
        info.width <= attempt.edge &&
        info.height <= attempt.edge
      ) {
        return {
          body: data,
          contentType: "image/jpeg",
          extension: "jpg",
          height: info.height,
          width: info.width
        };
      }
    } catch {
      throw customerImageError("Görsel güvenli biçimde dönüştürülemedi.");
    }
  }

  throw customerImageError(
    "Görsel güvenli yükleme sınırına küçültülemedi.",
    413,
    "CUSTOMER_IMAGE_OUTPUT_TOO_LARGE"
  );
}

function customerThumbnailSecret() {
  const configured = String(
    process.env.PROFILE_IMAGE_PROXY_SECRET ||
    process.env.CUSTOMER_MOBILE_SESSION_SECRET ||
    process.env.CUSTOMER_ACCESS_SESSION_SECRET ||
    ""
  ).trim();
  if (configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Customer profile thumbnail secret must contain at least 32 characters.");
  }
  return "vip-gece-local-customer-thumbnail-secret";
}

function customerThumbnailSignature(body) {
  return crypto
    .createHmac("sha256", customerThumbnailSecret())
    .update(`customer-profile-thumbnail:${body}`)
    .digest("base64url");
}

function customerPreviewSignature(body) {
  return crypto
    .createHmac("sha256", customerThumbnailSecret())
    .update(`customer-profile-preview:${body}`)
    .digest("base64url");
}

function buildCustomerProfilePreviewImageUrl(imageUrl, width = 960) {
  const localParts = imageUrlParts(imageUrl);
  const remoteSource = localParts ? null : parseAllowedProfileImageUrl(imageUrl);
  const source = localParts
    ? publicImagePath(localParts.scope, localParts.profile, localParts.file)
    : remoteSource?.toString() || "";
  if (!source) return "";

  const normalizedWidth = [320, 640, 960, 1200].includes(Number(width))
    ? Number(width)
    : 960;
  const payload = Buffer.from(JSON.stringify({
    source,
    width: normalizedWidth,
    expires_at: Date.now() + (10 * 60 * 1000)
  })).toString("base64url");
  return `/api/customer/mobile/media/preview/${payload}.${customerPreviewSignature(payload)}`;
}

function decodeCustomerProfilePreviewImageToken(token) {
  try {
    const raw = String(token || "").trim();
    if (!raw || raw.length > 2000) return null;
    const [body, signature, extra] = raw.split(".");
    if (!body || !signature || extra) return null;
    const expected = Buffer.from(customerPreviewSignature(body));
    const actual = Buffer.from(signature);
    if (
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    ) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const expiresAt = Number(payload?.expires_at);
    const now = Date.now();
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt < now ||
      expiresAt > now + (11 * 60 * 1000) ||
      ![320, 640, 960, 1200].includes(Number(payload?.width))
    ) {
      return null;
    }

    const localParts = imageUrlParts(payload?.source);
    if (localParts) {
      return {
        kind: "local",
        scope: localParts.scope,
        profile: localParts.profile,
        file: localParts.file,
        source: publicImagePath(localParts.scope, localParts.profile, localParts.file),
        width: Number(payload.width)
      };
    }

    const remoteSource = parseAllowedProfileImageUrl(payload?.source);
    return remoteSource
      ? { kind: "remote", source: remoteSource.toString(), width: Number(payload.width) }
      : null;
  } catch {
    return null;
  }
}

function buildCustomerProfileThumbnailUrl(imageUrl, width = 240) {
  const parts = imageUrlParts(imageUrl);
  if (!parts) return "";
  const normalizedWidth = Math.min(480, Math.max(96, Math.round(Number(width) || 240)));
  const payload = Buffer.from(JSON.stringify({
    path: publicImagePath(parts.scope, parts.profile, parts.file),
    width: normalizedWidth
  })).toString("base64url");
  return `/api/customer/mobile/media/thumbnail/${payload}.${customerThumbnailSignature(payload)}`;
}

function decodeCustomerProfileThumbnailToken(token) {
  try {
    const raw = String(token || "").trim();
    if (!raw || raw.length > 1200) return null;
    const [body, signature, extra] = raw.split(".");
    if (!body || !signature || extra) return null;
    const expected = Buffer.from(customerThumbnailSignature(body));
    const actual = Buffer.from(signature);
    if (
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    ) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const parts = imageUrlParts(payload?.path);
    const width = Math.min(480, Math.max(96, Math.round(Number(payload?.width) || 240)));
    return parts ? { ...parts, width } : null;
  } catch {
    return null;
  }
}

async function resizeCustomerProfileThumbnail(body, width = 240) {
  const normalizedWidth = Math.min(480, Math.max(96, Math.round(Number(width) || 240)));
  const height = Math.round(normalizedWidth * 1.325);
  for (const quality of [76, 66]) {
    try {
      const thumbnail = await sharpInput(body)
        .resize({
          width: normalizedWidth,
          height,
          fit: "cover",
          position: "attention",
          withoutEnlargement: false
        })
        .jpeg({
          chromaSubsampling: "4:2:0",
          mozjpeg: true,
          progressive: true,
          quality
        })
        .toBuffer();
      if (thumbnail.length > 0 && thumbnail.length <= MAX_THUMBNAIL_BYTES) {
        return thumbnail;
      }
    } catch {
      throw customerImageError("Görsel küçük önizlemesi hazırlanamadı.");
    }
  }
  throw customerImageError(
    "Görsel küçük önizleme sınırına küçültülemedi.",
    413,
    "CUSTOMER_THUMBNAIL_TOO_LARGE"
  );
}

async function resizePublicCustomerProfileImage(body, width = 720, quality = 72) {
  const normalizedWidth = Math.min(1600, Math.max(96, Math.round(Number(width) || 720)));
  const normalizedQuality = Math.min(85, Math.max(45, Math.round(Number(quality) || 72)));
  try {
    return await sharpInput(body)
      .resize({
        width: normalizedWidth,
        fit: "inside",
        withoutEnlargement: true
      })
      .jpeg({
        chromaSubsampling: "4:2:0",
        mozjpeg: true,
        progressive: true,
        quality: normalizedQuality
      })
      .toBuffer();
  } catch {
    throw customerImageError("Görsel web boyutuna küçültülemedi.");
  }
}

function customerProfileImageExists(imageUrl) {
  const parts = imageUrlParts(imageUrl);
  if (!parts) return false;
  try {
    const stat = lstatSync(filePath(parts));
    return stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.size > 0 &&
      stat.size <= MAX_STORED_IMAGE_BYTES;
  } catch {
    return false;
  }
}

async function storeCustomerProfileImage({
  accountScope,
  profileId,
  body
}) {
  await assertCustomerProfileImageStorageReady();
  const sanitized = await sanitizeCustomerProfileImage(body);

  const fileName = `${crypto.randomUUID()}.${sanitized.extension}`;
  const parts = imagePathParts(accountScope, profileId, fileName);
  if (!parts) throw new Error("Müşteri profil görseli yolu geçersiz.");

  const directory = path.dirname(filePath(parts));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${fileName}.${process.pid}.tmp`);
  try {
    await writeFile(temporary, sanitized.body, { flag: "wx", mode: 0o600 });
    await rename(temporary, filePath(parts));
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }

  return {
    contentType: sanitized.contentType,
    filePath: filePath(parts),
    height: sanitized.height,
    publicPath: publicImagePath(parts.scope, parts.profile, parts.file),
    size: sanitized.body.length,
    width: sanitized.width
  };
}

function ownedCustomerProfileImagePath(imageUrl, accountScope, profileId) {
  const parts = imageUrlParts(imageUrl);
  if (
    !parts ||
    parts.scope !== safePart(accountScope, 64) ||
    parts.profile !== safePart(profileId, 80)
  ) {
    return "";
  }
  return filePath(parts);
}

async function removeCustomerProfileImage(absolutePath) {
  const root = `${storageRoot()}${path.sep}`;
  const target = path.resolve(String(absolutePath || ""));
  if (!target.startsWith(root)) return false;
  try {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    await unlink(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function stageCustomerProfileImageRemoval(absolutePath) {
  const root = `${storageRoot()}${path.sep}`;
  const originalPath = path.resolve(String(absolutePath || ""));
  if (!originalPath.startsWith(root)) return null;

  try {
    const stat = await lstat(originalPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const stagedPath = `${originalPath}.delete-${crypto.randomUUID()}`;
    await rename(originalPath, stagedPath);
    return { originalPath, stagedPath };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function restoreStagedCustomerProfileImage(removal) {
  if (!removal?.originalPath || !removal?.stagedPath) return false;
  await rename(removal.stagedPath, removal.originalPath);
  return true;
}

async function loadCustomerProfileImage(accountScope, profileId, fileName) {
  const parts = imagePathParts(accountScope, profileId, fileName);
  if (!parts) return null;
  const target = filePath(parts);
  try {
    const stat = await lstat(target);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size < 1 ||
      stat.size > MAX_STORED_IMAGE_BYTES
    ) {
      return null;
    }
    const body = await readFile(target);
    if (!body.length || body.length > MAX_STORED_IMAGE_BYTES) return null;
    return {
      body,
      contentType: IMAGE_TYPES[parts.extension]
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

module.exports = {
  MAX_STORED_EDGE_PIXELS,
  MAX_STORED_IMAGE_BYTES,
  assertCustomerProfileImageStorageReady,
  buildCustomerProfilePreviewImageUrl,
  buildCustomerProfileThumbnailUrl,
  customerProfileImageExists,
  decodeCustomerProfileThumbnailToken,
  decodeCustomerProfilePreviewImageToken,
  loadCustomerProfileImage,
  ownedCustomerProfileImagePath,
  publicImagePath,
  removeCustomerProfileImage,
  resizePublicCustomerProfileImage,
  resizeCustomerProfileThumbnail,
  restoreStagedCustomerProfileImage,
  sanitizeCustomerProfileImage,
  stageCustomerProfileImageRemoval,
  storeCustomerProfileImage
};
