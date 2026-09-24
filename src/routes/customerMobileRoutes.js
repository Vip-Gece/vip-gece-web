"use strict";

const crypto = require("crypto");
const { registerCustomerDeviceToken } = require("../services/customerDeviceTokenService");
const { requireCustomerGateway, customerRateLimitKey } = require("../middleware/customerGateway");
const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  resolveSupabaseUser,
  requireFullAdmin
} = require("../middleware/auth");
const { getSupabaseServiceClient } = require("../data/supabaseClient");
const {
  listAdminPostgresProfiles
} = require("../data/postgresProfilesRepo");
const { publicProfile } = require("./publicApiRoutes");
const {
  buildCustomerProfilePreviewImageUrl,
  loadCustomerProfileImage,
  resizePublicCustomerProfileImage,
  ownedCustomerProfileImagePath,
  markCustomerProfileImageLinked,
  removeCustomerProfileImage,
  restoreStagedCustomerProfileImage,
  stageCustomerProfileImageRemoval,
  storeCustomerProfileImage
} = require("../services/customerProfileImageService");
const {
  appendCustomerMobileProfileImage,
  authenticateCustomerMobile,
  changeCustomerMobilePassword,
  createCustomerMobileProfile,
  customerMobileBootstrap,
  getCustomerMobileAccount,
  getCustomerMobileProfile,
  getCustomerMobileProfilePreview,
  listCustomerMobileAccounts,
  issueCustomerMobileAccessLink,
  issueCustomerMobilePasswordResetLink,
  validateCustomerMobilePasswordReset,
  consumeCustomerMobilePasswordReset,
  ownerUserId,
  removeCustomerMobileProfileImage,
  requireCustomerMobileSession,
  updateCustomerMobileProfile,
  upsertCustomerMobileAccount
} = require("../services/customerMobileAccountService");
const {
  approveSupportSession,
  closeSupportSession,
  createSupportSession,
  getAdminSupportSession,
  getCustomerSupportSession,
  submitSupportSnapshot
} = require("../services/customerSupportService");
const {
  getCustomerDailyAnalytics,
  getCustomerProfileAnalytics
} = require("../services/profileAnalyticsService");
const { renderProfileDetailHtml } = require("../services/renderService");
const { sanitizeCustomerProfilePayload } = require("../utils/input");
const { getProfileSlug } = require("../utils/profile");
const { setNoStore } = require("../utils/cacheHeaders");
const { loadProfileImage } = require("../services/profileImageProxyService");

const CUSTOMER_IMAGE_BUCKET = "images";
const CUSTOMER_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const CUSTOMER_IMAGE_MAX_COUNT = 12;
const CUSTOMER_IMAGE_TYPES = new Map([
  ["image/jpeg", { extension: "jpg", matches: (buffer) =>
    buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ["image/png", { extension: "png", matches: (buffer) =>
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
  ["image/webp", { extension: "webp", matches: (buffer) =>
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP" }]
]);

function customerError(res, error, fallback = "İşlem tamamlanamadı.") {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  if (status >= 500) {
    console.error("Customer mobile error:", {
      name: String(error?.name || "Error").slice(0, 80),
      code: String(error?.code || "").slice(0, 80)
    });
  }
  return res.status(status).json({
    ok: false,
    error: status >= 500 ? fallback : (error?.message || fallback),
    code: status < 500 ? (error?.code || undefined) : undefined
  });
}

function customerImageType(req, res, next) {
  const contentType = String(req.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!CUSTOMER_IMAGE_TYPES.has(contentType)) {
    return res.status(415).json({
      ok: false,
      error: "Yalnız JPEG, PNG veya WebP görsel yüklenebilir."
    });
  }
  req.customerImageContentType = contentType;
  return next();
}

function validateCustomerImage(buffer, contentType) {
  const type = CUSTOMER_IMAGE_TYPES.get(contentType);
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > CUSTOMER_IMAGE_MAX_BYTES) {
    const error = new Error("Görsel boş veya izin verilen boyutu aşıyor.");
    error.status = 413;
    throw error;
  }
  if (!type?.matches(buffer)) {
    const error = new Error("Görsel içeriği dosya türüyle eşleşmiyor.");
    error.status = 415;
    throw error;
  }
  return type;
}

function previewProfileData(profile) {
  return JSON.stringify(publicProfile(profile, getProfileSlug))
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function previewProfileWithSignedImages(profile) {
  return {
    ...profile,
    images: (Array.isArray(profile?.images) ? profile.images : [])
      .map((image) => buildCustomerProfilePreviewImageUrl(image, 960))
      .filter(Boolean)
  };
}

function customerImageAccountScope(account) {
  return crypto
    .createHash("sha256")
    .update(ownerUserId(account))
    .digest("hex")
    .slice(0, 32);
}

function customerImageStoragePrefix(account, profileId) {
  const accountScope = customerImageAccountScope(account);
  const safeProfileId = String(profileId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return `profiles/customer/${accountScope}/${safeProfileId}`;
}

function customerImageStoragePath(account, profileId, extension) {
  return `${customerImageStoragePrefix(account, profileId)}/${crypto.randomUUID()}.${extension}`;
}

function ownedCustomerImageStoragePath(imageUrl, account, profileId) {
  try {
    const parsed = new URL(String(imageUrl || ""));
    const expectedOrigin = new URL(String(process.env.SUPABASE_URL || "")).origin;
    if (parsed.origin !== expectedOrigin) return "";

    const pathname = parsed.pathname;
    const marker = `/storage/v1/object/public/${CUSTOMER_IMAGE_BUCKET}/`;
    if (!pathname.startsWith(marker)) return "";
    const storagePath = decodeURIComponent(pathname.slice(marker.length));
    const prefix = `${customerImageStoragePrefix(account, profileId)}/`;
    const fileName = storagePath.slice(prefix.length);
    return storagePath.startsWith(prefix) && /^[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(fileName)
      ? storagePath
      : "";
  } catch {
    return "";
  }
}

async function resolveCustomerMobile(req, res, next) {
  try {
    const account = await requireCustomerMobileSession(req.get("authorization"));
    if (!account) {
      return res.status(401).json({ ok: false, error: "Müşteri oturumu gerekli." });
    }
    if (account.must_change_password !== false) {
      return res.status(403).json({ ok: false, code: "PASSWORD_CHANGE_REQUIRED", error: "Ilk giriste sifrenizi yenilemeniz gerekiyor." });
    }
    req.customerAccount = account;
    return next();
  } catch (error) {
    return customerError(res, error, "Müşteri oturumu doğrulanamadı.");
  }
}

function createCustomerMobileRouter() {
  const router = express.Router();
  router.use("/api/customer/mobile", requireCustomerGateway);
  const adminAuth = [resolveSupabaseUser, requireFullAdmin];
  const loginLimiter = rateLimit({
    keyGenerator: customerRateLimitKey,
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false
  });
  const customerMutationLimiter = rateLimit({
    keyGenerator: customerRateLimitKey,
    windowMs: 60 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false
  });
  const supportLimiter = rateLimit({
    keyGenerator: customerRateLimitKey,
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false
  });

  router.use((req, res, next) => {
    const requestPath = req.path;
    if (
      requestPath.startsWith("/api/customer/mobile/") ||
      requestPath.startsWith("/api/customer/password-reset") ||
      requestPath.startsWith("/api/v1/admin/customer-accounts") ||
      requestPath.startsWith("/api/v1/admin/customer-support/")
    ) {
      setNoStore(res);
    }
    return next();
  });

  router.post("/api/customer/mobile/login", loginLimiter, async (req, res) => {
    try {
      const identifier = req.body?.identifier ?? req.body?.username ?? req.body?.email;
      const result = await authenticateCustomerMobile(identifier, req.body?.password, req.body?.access_token);
      if (!result) {
        return res.status(401).json({ ok: false, error: "Giriş bilgileri geçersiz." });
      }
      return res.json({ ok: true, ...result });
    } catch (error) {
      return customerError(res, error, "Müşteri girişi tamamlanamadı.");
    }
  });

  router.get("/api/customer/mobile/bootstrap", resolveCustomerMobile, async (req, res) => {
    try {
      const bootstrap = await customerMobileBootstrap(req.customerAccount);
      return res.json({ ok: true, ...bootstrap });
    } catch (error) {
      return customerError(res, error, "Müşteri profilleri alınamadı.");
    }
  });

  router.post("/api/customer/mobile/password", loginLimiter, async (req, res) => {
    try {
      const result = await changeCustomerMobilePassword(req.get("authorization"), req.body?.current_password, req.body?.new_password);
      return res.json({ ok: true, ...result });
    } catch (error) {
      return customerError(res, error, "Sifre yenilenemedi.");
    }
  });

  // FCM cihaz token kaydi: guncelleme duyurulari icin (oturum gerekmez, gateway korumali).
  router.post("/api/customer/mobile/device-token", loginLimiter, async (req, res) => {
    try {
      const result = await registerCustomerDeviceToken(
        req.body?.token,
        req.body?.platform,
        req.body?.app_version
      );
      return res.json({ ok: true, devices: result.count });
    } catch (error) {
      return customerError(res, error, "Cihaz kaydi tamamlanamadi.");
    }
  });

  // Şifre yenileme bağlantısı: kişisel bilgi (e-posta/telefon) gerektirmez.
  // Gateway koruması dışındadır; güvenlik tek kullanımlık, süreli ve hash'li linktedir.
  router.post("/api/customer/password-reset/start", loginLimiter, async (req, res) => {
    try {
      const info = await validateCustomerMobilePasswordReset(String(req.body?.token || ""));
      if (!info) {
        return res.status(404).json({
          ok: false,
          code: "RESET_LINK_INVALID",
          error: "Bağlantı geçersiz veya süresi dolmuş."
        });
      }
      return res.json({
        ok: true,
        label: info.account.label,
        email_masked: info.account.email_masked,
        expires_at: info.expires_at
      });
    } catch (error) {
      return customerError(res, error, "Bağlantı doğrulanamadı.");
    }
  });

  router.post("/api/customer/password-reset", loginLimiter, async (req, res) => {
    try {
      await consumeCustomerMobilePasswordReset(String(req.body?.token || ""), req.body?.new_password);
      return res.json({ ok: true });
    } catch (error) {
      return customerError(res, error, "Şifre yenilenemedi.");
    }
  });

  router.get("/api/customer/mobile/analytics/daily", resolveCustomerMobile, async (req, res) => {
    try {
      const summary = await getCustomerDailyAnalytics(ownerUserId(req.customerAccount));
      return res.json({ ok: true, ...summary });
    } catch (error) {
      return customerError(res, error, "Günlük analiz özeti alınamadı.");
    }
  });

  router.get(
    "/api/customer/mobile/profiles/:id/analytics",
    resolveCustomerMobile,
    async (req, res) => {
      try {
        const analytics = await getCustomerProfileAnalytics({
          days: req.query.days,
          ownerUserId: ownerUserId(req.customerAccount),
          profileId: req.params.id
        });
        return res.json(analytics);
      } catch (error) {
        return customerError(res, error, "Site etkileşimi alınamadı.");
      }
    }
  );

  router.get("/api/customer/mobile/profiles/:id", resolveCustomerMobile, async (req, res) => {
    try {
      const profile = await getCustomerMobileProfile(req.customerAccount, req.params.id);
      if (!profile) return res.status(404).json({ ok: false, error: "Profil bulunamadı." });
      return res.json({ ok: true, profile });
    } catch (error) {
      return customerError(res, error, "Profil alınamadı.");
    }
  });

  router.get(
    "/api/customer/mobile/profiles/:id/preview",
    resolveCustomerMobile,
    async (req, res) => {
      try {
        const preview = await getCustomerMobileProfilePreview(
          req.customerAccount,
          req.params.id
        );
        if (!preview) {
          return res
            .status(404)
            .type("text/plain; charset=utf-8")
            .send("Profil bulunamadı.");
        }

        const previewProfile = previewProfileWithSignedImages(preview.profile);
        const previewProfiles = preview.profiles.map(previewProfileWithSignedImages);
        const html = renderProfileDetailHtml(
          previewProfile,
          previewProfiles
        ).replace(
          'data-server-rendered="true"',
          'data-server-rendered="true" data-profile-preview="true"'
        ).replace(
          "</body>",
          `<script type="application/json" id="vipProfilePreviewData">${previewProfileData(previewProfile)}</script></body>`
        );
        setNoStore(res);
        return res.status(200).type("html").send(html);
      } catch (error) {
        return customerError(res, error, "Profil önizlemesi hazırlanamadı.");
      }
    }
  );

  router.post(
    "/api/customer/mobile/profiles",
    customerMutationLimiter,
    resolveCustomerMobile,
    async (req, res) => {
      try {
        const payload = sanitizeCustomerProfilePayload(req.body || {});
        delete payload.images;
        const profile = await createCustomerMobileProfile(req.customerAccount, payload);
        const bootstrap = await customerMobileBootstrap(req.customerAccount);
        return res.status(201).json({ ok: true, profile, quota: bootstrap.quota });
      } catch (error) {
        return customerError(res, error, "Profil oluşturulamadı.");
      }
    }
  );

  router.put(
    "/api/customer/mobile/profiles/:id",
    customerMutationLimiter,
    resolveCustomerMobile,
    async (req, res) => {
      try {
        const payload = sanitizeCustomerProfilePayload(req.body || {});
        delete payload.images;
        if (!Object.keys(payload).length) {
          return res.status(400).json({ ok: false, error: "Kaydedilecek profil alanı yok." });
        }
        const profile = await updateCustomerMobileProfile(
          req.customerAccount,
          req.params.id,
          payload
        );
        if (!profile) return res.status(404).json({ ok: false, error: "Profil bulunamadı." });
        return res.json({ ok: true, profile });
      } catch (error) {
        return customerError(res, error, "Profil güncellenemedi.");
      }
    }
  );

  router.get("/api/customer/mobile/profiles/:id/images/:index", resolveCustomerMobile, async (req, res) => {
    try {
      if (!/^(?:[0-9]|1[01])$/.test(req.params.index)) return res.status(404).json({ ok: false });
      const profile = await getCustomerMobileProfile(req.customerAccount, req.params.id);
      const source = profile?.images?.[Number(req.params.index)];
      if (!source) return res.status(404).json({ ok: false });
      const local = source.match(/^\/media\/customer-profile\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/([a-f0-9-]+\.(?:jpg|png|webp))$/);
      const image = local ? await loadCustomerProfileImage(local[1], local[2], local[3]) : await loadProfileImage(source, { width: 960, quality: 76, resize: "contain" });
      if (!image) return res.status(404).json({ ok: false });
      const body = await resizePublicCustomerProfileImage(image.body, 960, 76);
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.type("image/jpeg").send(body);
    } catch (error) { return customerError(res, error, "Gorsel alinamadi."); }
  });

  router.post(
    "/api/customer/mobile/profiles/:id/images",
    customerMutationLimiter,
    resolveCustomerMobile,
    customerImageType,
    express.raw({
      type: ["image/jpeg", "image/png", "image/webp"],
      limit: CUSTOMER_IMAGE_MAX_BYTES
    }),
    async (req, res) => {
      let uploadedLocalPath = "";
      try {
        const profile = await getCustomerMobileProfile(req.customerAccount, req.params.id);
        if (!profile) return res.status(404).json({ ok: false, error: "Profil bulunamadı." });

        const currentImages = Array.isArray(profile.images) ? profile.images : [];
        const uploadId = req.get("x-upload-id") || undefined;
        const existingRetry = process.env.CUSTOMER_PROFILE_STORAGE_MODE === "server-original-supabase" &&
          /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(uploadId || "") &&
          currentImages.some((url) => ownedCustomerImageStoragePath(url, req.customerAccount, req.params.id) ===
            `${customerImageStoragePrefix(req.customerAccount, req.params.id)}/${uploadId}.jpg`);
        if (currentImages.length >= CUSTOMER_IMAGE_MAX_COUNT && !existingRetry) {
          return res.status(409).json({
            ok: false,
            error: `Bir profilde en fazla ${CUSTOMER_IMAGE_MAX_COUNT} görsel olabilir.`
          });
        }

        validateCustomerImage(req.body, req.customerImageContentType);
        const stored = await storeCustomerProfileImage({
          accountScope: customerImageAccountScope(req.customerAccount),
          profileId: req.params.id,
          body: req.body,
          uploadId
        });
        uploadedLocalPath = stored.filePath;
        const imageUrl = stored.publicPath;

        const updated = await appendCustomerMobileProfileImage(
          req.customerAccount,
          req.params.id,
          imageUrl,
          CUSTOMER_IMAGE_MAX_COUNT
        );
        if (!updated) throw new Error("Profil görseli kaydedilemedi.");
        await markCustomerProfileImageLinked({
          accountScope: customerImageAccountScope(req.customerAccount), profileId: req.params.id,
          uploadId: stored.uploadId, publicPath: imageUrl
        });
        return res.status(201).json({ ok: true, profile: updated, image_url: imageUrl,
          upload_id: stored.uploadId, original_saved: stored.originalSaved === true });
      } catch (error) {
        if (uploadedLocalPath) {
          await removeCustomerProfileImage(uploadedLocalPath).catch(() => {});
        }
        return customerError(res, error, "Profil görseli yüklenemedi.");
      }
    }
  );

  router.delete(
    "/api/customer/mobile/profiles/:id/images",
    customerMutationLimiter,
    resolveCustomerMobile,
    async (req, res) => {
      let stagedLocalRemoval = null;
      try {
        const profile = await getCustomerMobileProfile(req.customerAccount, req.params.id);
        if (!profile) return res.status(404).json({ ok: false, error: "Profil bulunamadı." });

        const imageUrl = String(req.body?.url || "").trim();
        const currentImages = Array.isArray(profile.images) ? profile.images : [];
        if (!imageUrl || !currentImages.includes(imageUrl)) {
          return res.status(404).json({ ok: false, error: "Profil görseli bulunamadı." });
        }

        const storagePath = ownedCustomerImageStoragePath(
          imageUrl,
          req.customerAccount,
          req.params.id
        );
        const localPath = ownedCustomerProfileImagePath(
          imageUrl,
          customerImageAccountScope(req.customerAccount),
          req.params.id
        );
        const supabase = storagePath ? getSupabaseServiceClient() : null;
        if (storagePath && !supabase) {
          const error = new Error("Görsel depolama servisi hazır değil.");
          error.status = 503;
          throw error;
        }
        if (localPath) {
          stagedLocalRemoval = await stageCustomerProfileImageRemoval(localPath);
        }
        const updated = await removeCustomerMobileProfileImage(
          req.customerAccount,
          req.params.id,
          imageUrl
        );
        if (!updated) {
          const error = new Error("Profil bulunamadı.");
          error.status = 404;
          throw error;
        }

        // Never break a still-linked image when the database update fails.
        let cleanupPending = false;
        if (storagePath) {
          try {
            const { error } = await supabase.storage.from(CUSTOMER_IMAGE_BUCKET).remove([storagePath]);
            if (error && Number(error.statusCode || error.status) !== 404) throw error;
          } catch {
            cleanupPending = true;
            console.error("Customer image detached; remote object cleanup pending:", storagePath);
          }
        }

        if (stagedLocalRemoval) {
          await removeCustomerProfileImage(stagedLocalRemoval.stagedPath).catch((error) => {
            console.error("Customer profile image cleanup error:", error.message);
          });
          stagedLocalRemoval = null;
        }
        return res.json({ ok: true, profile: updated, cleanup_pending: cleanupPending });
      } catch (error) {
        if (stagedLocalRemoval) {
          await restoreStagedCustomerProfileImage(stagedLocalRemoval).catch((restoreError) => {
            console.error("Customer profile image rollback error:", restoreError.message);
          });
        }
        return customerError(res, error, "Profil görseli kaldırılamadı.");
      }
    }
  );

  router.post(
    "/api/customer/mobile/support/sessions",
    supportLimiter,
    resolveCustomerMobile,
    async (req, res) => {
      try {
        const session = await createSupportSession(req.customerAccount, req.body || {});
        return res.status(201).json({ ok: true, session });
      } catch (error) {
        return customerError(res, error, "Destek oturumu başlatılamadı.");
      }
    }
  );

  router.get(
    "/api/customer/mobile/support/sessions/:id",
    resolveCustomerMobile,
    async (req, res) => {
      const session = await getCustomerSupportSession(req.customerAccount, req.params.id);
      if (!session) return res.status(404).json({ ok: false, error: "Destek oturumu bulunamadı." });
      return res.json({ ok: true, session });
    }
  );

  router.post(
    "/api/customer/mobile/support/sessions/:id/snapshot",
    customerMutationLimiter,
    resolveCustomerMobile,
    async (req, res) => {
      try {
        const session = await submitSupportSnapshot(
          req.customerAccount,
          req.params.id,
          req.body || {}
        );
        if (!session) {
          return res.status(409).json({
            ok: false,
            error: "İki taraf onayı olmayan veya süresi dolmuş destek oturumu."
          });
        }
        return res.json({ ok: true, session });
      } catch (error) {
        return customerError(res, error, "Tanılama verisi gönderilemedi.");
      }
    }
  );

  router.delete(
    "/api/customer/mobile/support/sessions/:id",
    resolveCustomerMobile,
    async (req, res) => {
      const session = await closeSupportSession(
        req.params.id,
        `customer:${req.customerAccount.id}`,
        req.customerAccount.id
      );
      if (!session) return res.status(404).json({ ok: false, error: "Destek oturumu bulunamadı." });
      return res.json({ ok: true, session });
    }
  );

  router.get("/api/v1/admin/customer-accounts", adminAuth, async (req, res) => {
    try {
      const [accounts, profiles] = await Promise.all([
        listCustomerMobileAccounts(),
        listAdminPostgresProfiles()
      ]);
      const counts = new Map();
      for (const profile of profiles) {
        const owner = String(profile.owner_user_id || "");
        if (!owner.startsWith("customer:")) continue;
        const current = counts.get(owner) || { profiles: 0, active: 0 };
        current.profiles += 1;
        if (profile.is_active === true) current.active += 1;
        counts.set(owner, current);
      }
      return res.json({
        ok: true,
        accounts: accounts.map((account) => {
          const count = counts.get(account.owner_user_id) || { profiles: 0, active: 0 };
          return {
            ...account,
            profile_count: count.profiles,
            active_profile_count: count.active,
            quota_remaining: Math.max(0, account.max_profiles - count.profiles)
          };
        })
      });
    } catch (error) {
      return customerError(res, error, "Müşteri hesapları alınamadı.");
    }
  });

  router.post("/api/v1/admin/customer-accounts", adminAuth, async (req, res) => {
    try {
      const account = await upsertCustomerMobileAccount("", req.body || {});
      return res.status(201).json({ ok: true, account });
    } catch (error) {
      return customerError(res, error, "Müşteri hesabı oluşturulamadı.");
    }
  });

  router.post("/api/v1/admin/customer-accounts/:id/access-link", adminAuth, async (req, res) => {
    try {
      return res.json({ ok: true, ...await issueCustomerMobileAccessLink(req.params.id) });
    } catch (error) {
      return customerError(res, error, "Customer access link could not be issued.");
    }
  });

  router.post("/api/v1/admin/customer-accounts/:id/password-reset-link", adminAuth, async (req, res) => {
    try {
      const ttlMinutes = Number.parseInt(req.body?.ttl_minutes, 10);
      return res.json({
        ok: true,
        ...await issueCustomerMobilePasswordResetLink(req.params.id,
          Number.isFinite(ttlMinutes) ? { ttlMinutes } : {})
      });
    } catch (error) {
      return customerError(res, error, "Şifre yenileme bağlantısı oluşturulamadı.");
    }
  });

  router.put("/api/v1/admin/customer-accounts/:id", adminAuth, async (req, res) => {
    try {
      if (!await getCustomerMobileAccount(req.params.id)) {
        return res.status(404).json({ ok: false, error: "Müşteri hesabı bulunamadı." });
      }
      const account = await upsertCustomerMobileAccount(req.params.id, req.body || {});
      return res.json({ ok: true, account });
    } catch (error) {
      return customerError(res, error, "Müşteri hesabı güncellenemedi.");
    }
  });

  router.post("/api/v1/admin/customer-support/approve", adminAuth, async (req, res) => {
    try {
      const actor = String(req.authUser?.email || req.authUser?.id || "support");
      const session = await approveSupportSession(req.body?.code, actor);
      if (!session) {
        return res.status(404).json({
          ok: false,
          error: "Geçerli ve müşteri tarafından onaylanmış destek oturumu bulunamadı."
        });
      }
      return res.json({ ok: true, session });
    } catch (error) {
      return customerError(res, error, "Destek oturumu onaylanamadı.");
    }
  });

  router.get("/api/v1/admin/customer-support/:id", adminAuth, async (req, res) => {
    const session = await getAdminSupportSession(req.params.id);
    if (!session) return res.status(404).json({ ok: false, error: "Destek oturumu bulunamadı." });
    return res.json({ ok: true, session });
  });

  router.delete("/api/v1/admin/customer-support/:id", adminAuth, async (req, res) => {
    const actor = String(req.authUser?.email || req.authUser?.id || "support");
    const session = await closeSupportSession(req.params.id, actor);
    if (!session) return res.status(404).json({ ok: false, error: "Destek oturumu bulunamadı." });
    return res.json({ ok: true, session });
  });

  return router;
}

module.exports = {
  createCustomerMobileRouter,
  customerImageStoragePath,
  ownedCustomerImageStoragePath
};
