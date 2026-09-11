import { chmod, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "vip-gece-customer-mobile-"));
process.env.NODE_ENV = "test";
process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH = path.join(temporaryDirectory, "accounts.json");
process.env.CUSTOMER_SUPPORT_STORE_PATH = path.join(temporaryDirectory, "support.json");
process.env.CUSTOMER_PROFILE_IMAGE_DIR = path.join(temporaryDirectory, "profile-images");
// secret-scan: allow-next-line test fixture
process.env.CUSTOMER_MOBILE_SESSION_SECRET = "contract-only-secret-with-at-least-32-characters";
process.env.SUPABASE_URL = "https://contract-project.supabase.co";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const {
  authenticateCustomerMobile,
  requireCustomerMobileSession,
  upsertCustomerMobileAccount
} = require("../src/services/customerMobileAccountService");
const {
  approveSupportSession,
  closeSupportSession,
  createSupportSession,
  submitSupportSnapshot
} = require("../src/services/customerSupportService");
const {
  customerImageStoragePath,
  ownedCustomerImageStoragePath
} = require("../src/routes/customerMobileRoutes");
const {
  MAX_STORED_EDGE_PIXELS,
  MAX_STORED_IMAGE_BYTES,
  assertCustomerProfileImageStorageReady,
  buildCustomerProfileThumbnailUrl,
  decodeCustomerProfileThumbnailToken,
  loadCustomerProfileImage,
  ownedCustomerProfileImagePath,
  removeCustomerProfileImage,
  resizeCustomerProfileThumbnail,
  restoreStagedCustomerProfileImage,
  stageCustomerProfileImageRemoval,
  storeCustomerProfileImage
} = require("../src/services/customerProfileImageService");
const { profileWithUsableImages } = require("../src/data/profilesRepo");
const { assertProfileImageReadiness } = require("../src/routes/healthRoutes");
const { assertCustomerImageSubset } = require("../src/services/customerAccessService");
const {
  assertCustomerAnalyticsScope,
  normalizeCustomerAnalyticsInput,
  normalizeEvent
} = require("../src/services/profileAnalyticsService");
const { sanitizeCustomerProfilePayload } = require("../src/utils/input");
const { assertProfileUpdatePublishable } = require("../src/services/profileDefaults");

const failures = [];
let assertionCount = 0;

function assert(condition, message) {
  assertionCount += 1;
  if (condition) {
    console.log(`ok ${message}`);
    return;
  }
  failures.push(message);
  console.log(`fail ${message}`);
}

try {
  const created = await upsertCustomerMobileAccount("", {
    label: "Umutajans",
    email: "umutajans-contract@example.invalid",
    // secret-scan: allow-next-line test fixture
    password: "Contract-Password-2026",
    max_profiles: 10,
    enabled: true
  });
  assert(created.max_profiles === 10, "Umutajans account limit is ten");
  assert(
    !("password_hash" in created) && !("session_version" in created),
    "admin response never exposes password hashes or session revisions"
  );

  const rejected = await authenticateCustomerMobile(
    "umutajans-contract@example.invalid",
    "wrong-password"
  );
  assert(rejected === null, "invalid customer password is rejected");

  const authenticated = await authenticateCustomerMobile(
    "umutajans-contract@example.invalid",
    "Contract-Password-2026"
  );
  assert(
    authenticated?.session?.token && !authenticated.session.token.includes("Contract-Password"),
    "customer login returns an opaque bearer session"
  );

  const account = await requireCustomerMobileSession(
    `Bearer ${authenticated.session.token}`
  );
  assert(account?.id === created.id, "bearer session resolves only its customer account");

  const rotating = await upsertCustomerMobileAccount("", {
    label: "Oturum Sözleşmesi",
    username: "contract.operator",
    email: "session-contract@example.invalid",
    // secret-scan: allow-next-line test fixture
    password: "Initial-Contract-Password-2026",
    max_profiles: 10,
    enabled: true
  });
  const usernameLogin = await authenticateCustomerMobile(
    "contract.operator",
    "Initial-Contract-Password-2026"
  );
  assert(
    usernameLogin?.account?.id === rotating.id,
    "customer login accepts the unique username without exposing credentials"
  );

  let shortPasswordRejected = false;
  try {
    await upsertCustomerMobileAccount(rotating.id, { password: "Seven77" });
  } catch (error) {
    shortPasswordRejected = error?.status === 400;
  }
  assert(shortPasswordRejected, "customer password rotation enforces the same minimum length");

  let structuredPasswordRejected = false;
  try {
    await upsertCustomerMobileAccount(rotating.id, {
      password: { unexpected: "value" }
    });
  } catch (error) {
    structuredPasswordRejected = error?.status === 400;
  }
  assert(
    structuredPasswordRejected,
    "customer password input rejects objects and other non-string values"
  );

  await upsertCustomerMobileAccount(rotating.id, {
    password: "Eight888"
  });
  assert(
    await requireCustomerMobileSession(`Bearer ${usernameLogin.session.token}`) === null &&
      await authenticateCustomerMobile(
        "contract.operator",
        "Initial-Contract-Password-2026"
      ) === null,
    "password rotation invalidates existing sessions and the previous password"
  );

  const rotatedLogin = await authenticateCustomerMobile(
    "contract.operator",
    "Eight888"
  );
  assert(
    rotatedLogin?.account?.id === rotating.id,
    "customer password accepts the exact eight-character minimum"
  );
  await upsertCustomerMobileAccount(rotating.id, { enabled: false });
  await upsertCustomerMobileAccount(rotating.id, { enabled: true });
  assert(
    rotatedLogin?.session?.token &&
      await requireCustomerMobileSession(`Bearer ${rotatedLogin.session.token}`) === null,
    "disable and re-enable cannot revive a previously issued customer session"
  );

  const publishPayload = sanitizeCustomerProfilePayload({ is_active: true });
  let incompletePublishRejected = false;
  try {
    assertProfileUpdatePublishable(
      { name: "Hazır Değil", slug: "hazir-degil", description: "", images: [] },
      publishPayload
    );
  } catch (error) {
    incompletePublishRejected = error?.code === "PROFILE_NOT_PUBLISHABLE";
  }
  assert(
    publishPayload.is_active === true &&
      incompletePublishRejected &&
      assertProfileUpdatePublishable(
        {
          name: "Hazır Profil",
          slug: "hazir-profil",
          description: "Yayın için eksiksiz profil.",
          images: ["https://example.invalid/profile.webp"]
        },
        publishPayload
      ).is_active === true,
    "customer publication choice is accepted only for a complete profile"
  );

  const ownedPath = customerImageStoragePath(account, "profile-1", "webp");
  const ownedUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/images/${ownedPath}`;
  assert(
    ownedCustomerImageStoragePath(ownedUrl, account, "profile-1") === ownedPath &&
      !ownedCustomerImageStoragePath(ownedUrl, { ...account, id: "another-account" }, "profile-1") &&
      !ownedCustomerImageStoragePath(
        `https://foreign.supabase.co/storage/v1/object/public/images/${ownedPath}`,
        account,
        "profile-1"
      ),
    "customer image deletion is scoped to the configured tenant and profile"
  );

  const accountScope = ownedPath.split("/")[2];
  await assertCustomerProfileImageStorageReady();
  let malformedImageRejected = false;
  try {
    await storeCustomerProfileImage({
      accountScope,
      profileId: "profile-1",
      body: Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    });
  } catch (error) {
    malformedImageRejected = error?.status === 415;
  }
  assert(
    malformedImageRejected,
    "customer image storage rejects magic-prefix-only malformed files"
  );

  const imageBody = await sharp({
    create: {
      width: 1800,
      height: 3200,
      channels: 4,
      background: { r: 122, g: 22, b: 62, alpha: 0.85 }
    }
  })
    .jpeg({ quality: 90 })
    .withMetadata({ density: 72, orientation: 6 })
    .toBuffer();
  const sourceMetadata = await sharp(imageBody).metadata();
  const safeImageRoot = process.env.CUSTOMER_PROFILE_IMAGE_DIR;
  const unsafeImageRoot = path.join(temporaryDirectory, "unsafe-profile-images");
  await mkdir(unsafeImageRoot, { recursive: true, mode: 0o755 });
  await chmod(unsafeImageRoot, 0o755);
  process.env.CUSTOMER_PROFILE_IMAGE_DIR = unsafeImageRoot;
  let unsafeStorageRejected = false;
  try {
    await storeCustomerProfileImage({
      accountScope,
      profileId: "unsafe-profile",
      body: imageBody
    });
  } catch {
    unsafeStorageRejected = true;
  } finally {
    process.env.CUSTOMER_PROFILE_IMAGE_DIR = safeImageRoot;
  }
  assert(
    unsafeStorageRejected,
    "image upload rejects a pre-existing storage root with unsafe permissions"
  );

  const storedImage = await storeCustomerProfileImage({
    accountScope,
    profileId: "profile-1",
    body: imageBody
  });
  const storedFileName = path.basename(storedImage.publicPath);
  const loadedImage = await loadCustomerProfileImage(
    accountScope,
    "profile-1",
    storedFileName
  );
  const storedMetadata = await sharp(loadedImage.body).metadata();
  const storedFileMode = (await stat(storedImage.filePath)).mode & 0o777;
  const storedDirectoryMode = (await stat(path.dirname(storedImage.filePath))).mode & 0o777;
  assert(
    storedImage.publicPath.startsWith(
      `/media/customer-profile/${accountScope}/profile-1/`
    ) &&
      ownedCustomerProfileImagePath(
        storedImage.publicPath,
        accountScope,
        "profile-1"
      ) === storedImage.filePath &&
      loadedImage?.contentType === "image/jpeg" &&
      loadedImage.body.length <= MAX_STORED_IMAGE_BYTES &&
      sourceMetadata.orientation === 6 &&
      Boolean(sourceMetadata.exif) &&
      storedMetadata.format === "jpeg" &&
      storedMetadata.width > storedMetadata.height &&
      storedMetadata.width <= MAX_STORED_EDGE_PIXELS &&
      storedMetadata.height <= MAX_STORED_EDGE_PIXELS &&
      !storedMetadata.orientation &&
      !storedMetadata.exif &&
      !storedMetadata.xmp &&
      storedFileMode === 0o600 &&
      storedDirectoryMode === 0o700,
    "customer image storage decodes, auto-orients, bounds and strips metadata before persistence"
  );
  const thumbnailUrl = buildCustomerProfileThumbnailUrl(storedImage.publicPath, 240);
  const thumbnailToken = thumbnailUrl.split("/").pop();
  const thumbnailRequest = decodeCustomerProfileThumbnailToken(thumbnailToken);
  const thumbnailBody = await resizeCustomerProfileThumbnail(
    loadedImage.body,
    thumbnailRequest?.width
  );
  const thumbnailMetadata = await sharp(thumbnailBody).metadata();
  const tamperedToken = `${thumbnailToken.slice(0, -1)}${thumbnailToken.endsWith("a") ? "b" : "a"}`;
  assert(
    thumbnailUrl.startsWith("/api/customer/mobile/media/thumbnail/") &&
      thumbnailRequest?.scope === accountScope &&
      thumbnailRequest?.profile === "profile-1" &&
      thumbnailMetadata.format === "jpeg" &&
      thumbnailMetadata.width === 240 &&
      thumbnailBody.length < loadedImage.body.length &&
      decodeCustomerProfileThumbnailToken(tamperedToken) === null,
    "customer cards use a signed bounded real thumbnail"
  );
  assert(
    profileWithUsableImages({ images: [storedImage.publicPath] }).images.length === 1,
    "stored customer image is accepted by the public profile projection"
  );
  assertProfileImageReadiness([{ images: [storedImage.publicPath] }]);
  const stagedRemoval = await stageCustomerProfileImageRemoval(storedImage.filePath);
  const hiddenWhileStaged = await loadCustomerProfileImage(
    accountScope,
    "profile-1",
    storedFileName
  ) === null;
  await restoreStagedCustomerProfileImage(stagedRemoval);
  assert(
    hiddenWhileStaged &&
      (await loadCustomerProfileImage(accountScope, "profile-1", storedFileName))?.body.equals(
        loadedImage.body
      ),
    "customer image removal is reversible until the database mutation commits"
  );
  await removeCustomerProfileImage(storedImage.filePath);
  assert(
    await loadCustomerProfileImage(accountScope, "profile-1", storedFileName) === null,
    "customer image removal deletes the exact scoped object"
  );
  let missingLocalImageRejected = false;
  try {
    assertProfileImageReadiness([{ images: [storedImage.publicPath] }]);
  } catch {
    missingLocalImageRejected = true;
  }
  assert(
    missingLocalImageRejected &&
      profileWithUsableImages({ images: [storedImage.publicPath] }).images.length === 0,
    "readiness and public projection fail closed for a missing customer image"
  );

  let foreignImageRejected = false;
  try {
    assertCustomerImageSubset(
      { images: [ownedUrl] },
      {
        images: [
          `${process.env.SUPABASE_URL}/storage/v1/object/public/images/profiles/customer/another-account/profile-1/image.webp`
        ]
      }
    );
  } catch (error) {
    foreignImageRejected = error?.status === 403;
  }
  assert(
    foreignImageRejected &&
      assertCustomerImageSubset({ images: [ownedUrl] }, { images: [ownedUrl] }) === undefined,
    "legacy customer updates cannot attach another profile image"
  );

  const normalizedView = normalizeEvent({
    event_type: "profile_view",
    profile_slug: "contract-profile",
    source: "google",
    channel: "none",
    event_id: "123e4567-e89b-42d3-a456-426614174000",
    proof: "contract-page-proof"
  });
  let invalidAnalyticsRejected = false;
  try {
    normalizeEvent({
      event_type: "contact_click",
      profile_slug: "contract-profile",
      source: "google",
      channel: "none",
      count: 100
    });
  } catch (error) {
    invalidAnalyticsRejected = error?.code === "INVALID_ANALYTICS_EVENT";
  }
  assert(
    normalizedView.eventType === "profile_view" &&
      normalizedView.eventId === "123e4567-e89b-42d3-a456-426614174000" &&
      normalizedView.proof === "contract-page-proof" &&
      invalidAnalyticsRejected,
    "analytics accepts only strict server-counted profile events"
  );

  const ownedAnalyticsProfile = {
    id: "501",
    owner_user_id: "customer:tenant-a"
  };
  let foreignOwnerAnalyticsRejected = false;
  try {
    assertCustomerAnalyticsScope(ownedAnalyticsProfile, {
      profileId: "501",
      ownerUserId: "customer:tenant-b"
    });
  } catch (error) {
    foreignOwnerAnalyticsRejected =
      error?.status === 404 && error?.code === "ANALYTICS_PROFILE_NOT_FOUND";
  }
  assert(
    foreignOwnerAnalyticsRejected,
    "profile analytics rejects a different tenant owner for the same profile id"
  );

  let foreignProfileAnalyticsRejected = false;
  try {
    assertCustomerAnalyticsScope(ownedAnalyticsProfile, {
      profileId: "502",
      ownerUserId: "customer:tenant-a"
    });
  } catch (error) {
    foreignProfileAnalyticsRejected =
      error?.status === 404 && error?.code === "ANALYTICS_PROFILE_NOT_FOUND";
  }
  assert(
    foreignProfileAnalyticsRejected,
    "profile analytics rejects another profile id within a valid tenant session"
  );

  const customerAnalyticsInput = normalizeCustomerAnalyticsInput({
    days: "90",
    ownerUserId: "customer:tenant-a",
    profileId: "501"
  });
  assert(
    customerAnalyticsInput.days === 90 &&
      customerAnalyticsInput.ownerUserId === "customer:tenant-a" &&
      customerAnalyticsInput.profileId === "501",
    "customer analytics accepts only the explicit profile, owner and supported period scope"
  );

  const waiting = await createSupportSession(account, {
    app_version: "1.0.0",
    android_version: "15",
    device_model: "contract-device"
  });
  assert(
    waiting.state === "waiting_support_approval" &&
      waiting.customer_approved &&
      !waiting.support_approved,
    "support session starts with customer approval only"
  );

  const blockedSnapshot = await submitSupportSnapshot(account, waiting.id, {
    api_status: "ok"
  });
  assert(blockedSnapshot === null, "diagnostics are blocked before support approval");

  const approved = await approveSupportSession(waiting.code, "support@example.invalid");
  assert(
    approved?.state === "active" &&
      approved.customer_approved &&
      approved.support_approved,
    "support session activates only after both approvals"
  );

  const snapshot = await submitSupportSnapshot(account, waiting.id, {
    app_version: "1.0.0",
    active_origin: "https://vip-gece.site",
    api_status: "ok",
    errors: ["safe contract diagnostic"]
  });
  assert(snapshot?.state === "active", "approved support session accepts allowlisted diagnostics");

  const closed = await closeSupportSession(waiting.id, `customer:${account.id}`, account.id);
  assert(closed?.state === "closed", "customer can terminate the support session");

  const storedAccounts = JSON.parse(
    await readFile(process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH, "utf8")
  );
  assert(
    storedAccounts.accounts.every((stored) => stored.password_hash) &&
      !JSON.stringify(storedAccounts).includes("Contract-Password-2026") &&
      !JSON.stringify(storedAccounts).includes("Rotated-Contract-Password-2026"),
    "account store persists only a password hash"
  );

  const postgresSource = await readFile(
    new URL("../src/data/postgresProfilesRepo.js", import.meta.url),
    "utf8"
  );
  assert(
      postgresSource.includes("pg_advisory_xact_lock(hashtext($1))") &&
      postgresSource.includes("assertOwnerProfileQuota") &&
      postgresSource.includes("options.ownerProfileLimit") &&
      postgresSource.includes("where owner_user_id = $1") &&
      postgresSource.includes('error.code = "PROFILE_LIMIT_REACHED"') &&
      postgresSource.includes("appendCustomerPostgresProfileImage") &&
      postgresSource.includes("removeCustomerPostgresProfileImage") &&
      postgresSource.includes("const nextIsActive =") &&
      postgresSource.includes("isProfilePublishable({ ...current, images: nextImages })") &&
      postgresSource.includes("is_active = $4") &&
      postgresSource.includes("firstFreeSlot(existing.rows, profileType)") &&
      postgresSource.includes("current.is_active !== true && nextPayload.is_active === true") &&
      postgresSource.includes('.filter(([key]) => key !== "owner_user_id")') &&
      !postgresSource.includes(
        '.filter(([key]) => key !== "owner_user_id" && key !== "is_active")'
      ),
    "server enforces tenant ownership, quota, customer publication and atomic image unpublishing"
  );

  const routesSource = await readFile(
    new URL("../src/routes/customerMobileRoutes.js", import.meta.url),
    "utf8"
  );
  assert(
      routesSource.includes('router.post("/api/customer/mobile/login"') &&
      routesSource.includes('"/api/customer/mobile/bootstrap"') &&
      routesSource.includes('"/api/customer/mobile/analytics/daily"') &&
      routesSource.includes('"/api/customer/mobile/profiles/:id/preview"') &&
      routesSource.includes("req.body?.identifier ?? req.body?.username ?? req.body?.email") &&
      routesSource.includes('router.get("/api/v1/admin/customer-accounts"') &&
      routesSource.includes('router.post("/api/v1/admin/customer-accounts"') &&
      routesSource.includes('router.put("/api/v1/admin/customer-accounts/:id"') &&
      routesSource.includes("renderProfileDetailHtml") &&
      routesSource.includes('data-profile-preview="true"') &&
      routesSource.includes('"/api/customer/mobile/support/sessions"') &&
      (routesSource.match(/delete payload\.images;/g) || []).length === 2,
    "native customer API exposes credential-only login, tenant bootstrap, scoped images and support consent"
  );
  const customerInputSource = await readFile(
    new URL("../src/utils/input.js", import.meta.url),
    "utf8"
  );
  const customerMainActivity = await readFile(
    new URL(
      "../mobile-customer-native/android/app/src/main/java/com/vipgece/customer/MainActivity.java",
      import.meta.url
    ),
    "utf8"
  );
  assert(
    customerInputSource.includes(
      'Object.prototype.hasOwnProperty.call(input, "is_active")'
    ) &&
      customerMainActivity.includes('"Şimdi yayınla"') &&
      customerMainActivity.includes('"Yayından kaldır"') &&
      customerMainActivity.includes('.put("is_active", publish)'),
    "customer controls publishing directly after the completeness gate"
  );
  const imageDeleteRouteSource = routesSource.slice(
    routesSource.indexOf('"/api/customer/mobile/profiles/:id/images"'),
    routesSource.indexOf('"/api/customer/mobile/support/sessions"')
  );
  const mediaRoutesSource = await readFile(
    new URL("../src/routes/profileMediaRoutes.js", import.meta.url),
    "utf8"
  );
  const previewMediaRouteSource = mediaRoutesSource.slice(
    mediaRoutesSource.indexOf('"/api/customer/mobile/media/preview/:token"'),
    mediaRoutesSource.indexOf('"/api/customer/mobile/media/thumbnail/:token"')
  );
  const thumbnailMediaRouteSource = mediaRoutesSource.slice(
    mediaRoutesSource.indexOf('"/api/customer/mobile/media/thumbnail/:token"'),
    mediaRoutesSource.indexOf('"/media/customer-profile/:accountScope/:profileId/:fileName"')
  );
  const publicCustomerMediaRouteSource = mediaRoutesSource.slice(
    mediaRoutesSource.indexOf('"/media/customer-profile/:accountScope/:profileId/:fileName"')
  );
  assert(
    imageDeleteRouteSource.indexOf(".remove([storagePath])") >= 0 &&
      imageDeleteRouteSource.indexOf(".remove([storagePath])") <
        imageDeleteRouteSource.indexOf("removeCustomerMobileProfileImage(") &&
      imageDeleteRouteSource.includes(
        "if (error && status !== 404) throw error;"
      ) &&
      mediaRoutesSource.includes('"/api/customer/mobile/media/thumbnail/:token"') &&
      previewMediaRouteSource.includes("setNoStore(res);") &&
      thumbnailMediaRouteSource.includes("setNoStore(res);") &&
      publicCustomerMediaRouteSource.includes(
        '"public, max-age=60, s-maxage=60, must-revalidate"'
      ) &&
      !publicCustomerMediaRouteSource.includes("s-maxage=300"),
    "image deletion is retry-safe, draft previews are uncached and public cache revocation is bounded"
  );

  const accountServiceSource = await readFile(
    new URL("../src/services/customerMobileAccountService.js", import.meta.url),
    "utf8"
  );
  const detailClientSource = await readFile(
    new URL("../public/js/detail/index.js", import.meta.url),
    "utf8"
  );
  assert(
    accountServiceSource.includes("cover_thumbnail_url") &&
      accountServiceSource.includes("session_version") &&
      accountServiceSource.includes("normalizeUsername") &&
      accountServiceSource.includes('typeof body.password !== "string"') &&
      accountServiceSource.includes("password.length < 8") &&
      detailClientSource.includes('runtime.profilePreview === "true"') &&
      detailClientSource.includes("vipProfilePreviewData"),
    "customer accounts rotate sessions safely while cards and previews retain the media contract"
  );

  const androidManifest = await readFile(
    new URL("../mobile-customer-native/android/app/src/main/AndroidManifest.xml", import.meta.url),
    "utf8"
  );
  assert(
    androidManifest.includes("android.permission.POST_NOTIFICATIONS") &&
      androidManifest.includes('android:name=".update.UpdateInstallReceiver"') &&
      androidManifest.includes('android:exported="false"'),
    "Android update result receiver is private and notification permission is declared"
  );

  const updateEngine = await readFile(
    new URL(
      "../mobile-customer-native/android/app/src/main/java/com/vipgece/customer/update/CustomerUpdateEngine.java",
      import.meta.url
    ),
    "utf8"
  );
  assert(
    updateEngine.includes("SessionParams.USER_ACTION_NOT_REQUIRED") &&
      updateEngine.includes("PackageInstaller.STATUS_PENDING_USER_ACTION") &&
      updateEngine.includes("verifyCandidate(context, candidate)") &&
      updateEngine.includes('putBoolean("pending_mandatory"') &&
      updateEngine.includes('"User-Agent", "VIP-Gece-Customer-Native/1"') &&
      !updateEngine.includes("VIP-Gece-Customer-Updater/1"),
    "native updater persists and re-verifies mandatory releases before PackageInstaller commit"
  );

  const backgroundWorker = await readFile(
    new URL(
      "../mobile-customer-native/android/app/src/main/java/com/vipgece/customer/background/ConfigRefreshWorker.java",
      import.meta.url
    ),
    "utf8"
  );
  const mainActivity = await readFile(
    new URL(
      "../mobile-customer-native/android/app/src/main/java/com/vipgece/customer/MainActivity.java",
      import.meta.url
    ),
    "utf8"
  );
  assert(
    backgroundWorker.includes("CustomerUpdateEngine.checkAndDownload") &&
      backgroundWorker.includes("CustomerNotifications.showUpdate") &&
      backgroundWorker.includes("CustomerApi.dailyAnalytics") &&
      !backgroundWorker.includes("CustomerUpdateEngine.requestBackgroundInstall") &&
      mainActivity.includes("showMandatoryUpdate(candidate)") &&
      mainActivity.includes("Eski sürümle devam edilemez.") &&
      mainActivity.includes("ActivityResultContracts.StartActivityForResult") &&
      mainActivity.includes("Intent.ACTION_PICK") &&
      mainActivity.includes("MediaStore.Images.Media.EXTERNAL_CONTENT_URI") &&
      mainActivity.includes("Intent.ACTION_OPEN_DOCUMENT") &&
      mainActivity.includes("CustomerApi.profilePreviewUrl") &&
      mainActivity.includes('profile.optString("cover_thumbnail_url"'),
    "native app keeps the no-skip update gate and uses system gallery, signed thumbnail and exact preview flows"
  );

  const notificationSource = await readFile(
    new URL(
      "../mobile-customer-native/android/app/src/main/java/com/vipgece/customer/notification/CustomerNotifications.java",
      import.meta.url
    ),
    "utf8"
  );
  assert(
    notificationSource.includes(".setAutoCancel(true)") &&
      notificationSource.includes(".setOngoing(false)") &&
      notificationSource.includes("VISIBILITY_PRIVATE") &&
      notificationSource.includes("last_notified_daily_summary_id"),
    "update and account analytics notifications are dismissible, private and deduplicated"
  );

  const analyticsSource = await readFile(
    new URL("../src/services/profileAnalyticsService.js", import.meta.url),
    "utf8"
  );
  const customerAnalyticsServiceSource = analyticsSource.slice(
    analyticsSource.indexOf("async function getCustomerProfileAnalytics"),
    analyticsSource.indexOf("async function getAdminAnalyticsOverview")
  );
  assert(
    analyticsSource.includes("public.analytics_events") &&
      analyticsSource.includes("owner_user_id_snapshot,") &&
      analyticsSource.includes("limit 1\n        for share") &&
      analyticsSource.includes("on conflict (event_id) where event_id is not null do nothing") &&
      analyticsSource.includes("profiles.owner_user_id = $1") &&
      customerAnalyticsServiceSource.includes("and owner_user_id = $2") &&
      (customerAnalyticsServiceSource.match(/profiles\.owner_user_id = \$3/g) || []).length === 3 &&
      (customerAnalyticsServiceSource.match(/events\.owner_user_id_snapshot = \$3/g) || []).length === 3 &&
      customerAnalyticsServiceSource.includes('metric_scope: "site_interaction"') &&
      customerAnalyticsServiceSource.includes('metric_label: "Site etkileşimi"') &&
      analyticsSource.includes("count(*)::bigint as event_count") &&
      !analyticsSource.includes("insert into public.analytics_events (\n          referrer") &&
      !analyticsSource.includes("insert into public.analytics_events (\n          user_agent") &&
      !analyticsSource.includes("insert into public.analytics_events (\n          ip_hash"),
    "analytics stays profile and owner scoped without storing raw client identifiers"
  );

  const customerAccessRouteSource = await readFile(
    new URL("../src/routes/customerAccessRoutes.js", import.meta.url),
    "utf8"
  );
  const customerPanelHtmlSource = await readFile(
    new URL("../customer-panel.html", import.meta.url),
    "utf8"
  );
  const customerPanelClientSource = await readFile(
    new URL("../public/js/customer-panel.js", import.meta.url),
    "utf8"
  );
  assert(
    routesSource.includes('"/api/customer/mobile/profiles/:id/analytics"') &&
      routesSource.includes("ownerUserId: ownerUserId(req.customerAccount)") &&
      routesSource.includes("profileId: req.params.id") &&
      customerAccessRouteSource.includes(
        '"/api/customer/access/:token/profile/analytics"'
      ) &&
      customerAccessRouteSource.includes("ownerUserId: profile.owner_user_id") &&
      customerAccessRouteSource.includes("profileId: session.profile_id") &&
      !customerAccessRouteSource.includes("req.query.owner_user_id") &&
      customerPanelHtmlSource.includes("Site etkileşimi") &&
      customerPanelClientSource.includes("metric_scope") &&
      customerPanelClientSource.includes("analyticsPeriod"),
    "web and mobile analytics endpoints derive tenant scope server-side and label site interactions"
  );

  const releaseSigner = await readFile(
    new URL("../scripts/sign-customer-mobile-release.mjs", import.meta.url),
    "utf8"
  );
  assert(
    releaseSigner.includes('args.get("--mandatory") ?? "true"') &&
      releaseSigner.includes('mandatory: mandatoryValue === "true"') &&
      releaseSigner.includes('args.get("--apk-url")') &&
      releaseSigner.includes("temporaryLatestApk") &&
      releaseSigner.includes("apk_url: apkUrl"),
    "customer releases default to mandatory and use atomically published versioned APK URLs"
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, assertions: assertionCount }, null, 2));
