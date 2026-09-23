import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

process.env.ADMIN_EMAILS = "owner@example.com";
process.env.PROFILE_ADMIN_EMAILS = "operator@example.com";
const settingsDirectory = await mkdtemp(path.join(os.tmpdir(), "vip-gece-admin-settings-"));
process.env.SITE_SETTINGS_STORE_PATH = path.join(settingsDirectory, "site-settings.json");

const {
  requireFullAdmin,
  resolveAdminRole
} = require("../src/middleware/auth");
const { adminPermissions } = require("../src/services/adminPermissions");
const {
  updateSiteSettings
} = require("../src/services/siteSettingsService");

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function runGuard(guard, email) {
  const result = { next: false, status: null, body: null };
  const req = { authUser: { email } };
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    }
  };

  guard(req, res, () => {
    result.next = true;
  });

  result.role = req.adminRole || "";
  return result;
}

assert(resolveAdminRole("owner@example.com") === "full_admin", "owner must resolve as full_admin");
assert(resolveAdminRole("operator@example.com") === "profile_admin", "operator must resolve as profile_admin");

const ownerCustomers = runGuard(requireFullAdmin, "owner@example.com");
const operatorCustomers = runGuard(requireFullAdmin, "operator@example.com");
const outsiderCustomers = runGuard(requireFullAdmin, "outsider@example.com");
const operatorSettings = runGuard(requireFullAdmin, "operator@example.com");
const customerRoutesSource = readFileSync(new URL("../src/routes/customerAccessRoutes.js", import.meta.url), "utf8");
const mobileRoutesSource = readFileSync(new URL("../src/routes/adminMobileRoutes.js", import.meta.url), "utf8");
const adminRoutesSource = readFileSync(new URL("../src/routes/adminRoutes.js", import.meta.url), "utf8");
const adminOpsRoutesSource = readFileSync(new URL("../src/routes/adminOpsRoutes.js", import.meta.url), "utf8");
const healthRoutesSource = readFileSync(new URL("../src/routes/healthRoutes.js", import.meta.url), "utf8");
const analyticsServiceSource = readFileSync(new URL("../src/services/profileAnalyticsService.js", import.meta.url), "utf8");
const analyticsMigrationSource = readFileSync(new URL("../ops/postgres/001-analytics-events.sql", import.meta.url), "utf8");
const analyticsUiSource = readFileSync(new URL("../public/js/admin/analytics.js", import.meta.url), "utf8");
const compactAnalyticsUiSource = analyticsUiSource.replace(/\s+/g, "");
const profilesUiSource = readFileSync(new URL("../public/js/admin/profiles.js", import.meta.url), "utf8");
const customersUiSource = readFileSync(new URL("../public/js/admin/customers.js", import.meta.url), "utf8");
const settingsUiSource = readFileSync(new URL("../public/js/admin/settings.js", import.meta.url), "utf8");
const toolsUiSource = readFileSync(new URL("../public/js/admin/tools.js", import.meta.url), "utf8");
const compactProfilesUiSource = profilesUiSource.replace(/\s+/g, "");
const compactCustomersUiSource = customersUiSource.replace(/\s+/g, "");
const compactSettingsUiSource = settingsUiSource.replace(/\s+/g, "");
const compactToolsUiSource = toolsUiSource.replace(/\s+/g, "");
const adsUiSource = readFileSync(new URL("../public/js/admin/ads.js", import.meta.url), "utf8");
const postgresProfilesSource = readFileSync(new URL("../src/data/postgresProfilesRepo.js", import.meta.url), "utf8");
const adminEntrySource = readFileSync(new URL("../admin.js", import.meta.url), "utf8");
const adminIndexSource = readFileSync(new URL("../public/js/admin/index.js", import.meta.url), "utf8");
const adminAuthSource = readFileSync(new URL("../public/js/admin/auth.js", import.meta.url), "utf8");
const adminSharedSource = readFileSync(new URL("../public/js/admin/shared.js", import.meta.url), "utf8");
const adminPwaSource = readFileSync(new URL("../public/js/admin/pwa.js", import.meta.url), "utf8");
const adminPanelSource = readFileSync(new URL("../vg-panel-91x.html", import.meta.url), "utf8");
const ownerPermissions = adminPermissions("full_admin");
const operatorPermissions = adminPermissions("profile_admin");

assert(
  adminRoutesSource.includes("adminProfilesView(await listAdminPostgresProfiles())") &&
    adminRoutesSource.includes("profiles: adminProfilesView(data)") &&
    adminRoutesSource.includes("profile: adminProfileView(profile)") &&
    adminRoutesSource.includes("profile: adminProfileView(data)") &&
    compactProfilesUiSource.includes("profile.cover_preview_url") &&
    compactProfilesUiSource.includes("profile?.image_preview_urls") &&
    compactProfilesUiSource.includes("storedImages[index]===url"),
  "admin draft images must use signed previews without replacing stored image paths"
);

assert(ownerCustomers.next && ownerCustomers.role === "full_admin", "owner must manage customers");
assert(
  !operatorCustomers.next && operatorCustomers.status === 403,
  "profile admin must not manage customer credentials"
);
assert(!outsiderCustomers.next && outsiderCustomers.status === 403, "outsider must not manage customers");
assert(!operatorSettings.next && operatorSettings.status === 403, "profile admin must not pass full-admin settings guard");
assert(
  operatorPermissions.roleLabel === "operations_manager" &&
    operatorPermissions.canManageProfiles &&
    !operatorPermissions.canManageCustomers &&
    operatorPermissions.canManageAds &&
    operatorPermissions.canViewAnalytics,
  "operations manager must control listings, ads and read-only analytics without customer credentials"
);
assert(
  !operatorPermissions.canManageSettings &&
    !operatorPermissions.canManageSeo &&
    !operatorPermissions.canRunGoogleSync &&
    !operatorPermissions.canManageInfrastructure &&
    !operatorPermissions.canManageSiteIdentity,
  "operations manager must not control owner-only site fate settings"
);
assert(
  ownerPermissions.canManageSettings &&
    ownerPermissions.canManageSeo &&
    ownerPermissions.canRunGoogleSync &&
    ownerPermissions.canManageInfrastructure &&
    ownerPermissions.canManageSiteIdentity,
  "owner must retain infrastructure, identity, SEO and Google controls"
);
assert(
  customerRoutesSource.includes("const adminAuth = [resolveSupabaseUser, requireFullAdmin]"),
  "customer access credential routes must remain full-admin only"
);
assert(
  mobileRoutesSource.includes("const fullAdminAuth = [setMobileHeaders, resolveSupabaseUser, requireFullAdmin]") &&
    mobileRoutesSource.includes('router.patch("/api/admin/mobile/settings", fullAdminAuth') &&
    mobileRoutesSource.includes('router.post("/api/admin/mobile/settings/update", fullAdminAuth') &&
    mobileRoutesSource.includes("getSiteSettings()"),
  "mobile site settings must remain full-admin only"
);
assert(
  mobileRoutesSource.includes("settings: permissions.canViewSettings ? settings : null") &&
    mobileRoutesSource.includes("google: permissions.canRunGoogleSync ? googleStatus() : null") &&
    mobileRoutesSource.includes("sitemaps: permissions.canRunGoogleSync ? { configured: true } : null"),
  "mobile bootstrap must not expose owner-only settings or Google state to operations managers"
);
assert(
  mobileRoutesSource.includes('router.get("/api/admin/mobile/ads", adminAuth') &&
    mobileRoutesSource.includes('router.post("/api/admin/mobile/ads", adminAuth') &&
    mobileRoutesSource.includes('router.patch("/api/admin/mobile/ads/:id", adminAuth') &&
    mobileRoutesSource.includes('router.delete("/api/admin/mobile/ads/:id", adminAuth') &&
    mobileRoutesSource.includes("createPostgresAd") &&
    mobileRoutesSource.includes("sanitizeAdPayload") &&
    !mobileRoutesSource.includes('disabledMobileMutation("ad_'),
  "ad operations must use authenticated server routes backed by sanitized PostgreSQL mutations"
);
assert(
  adsUiSource.includes('adminApi("/api/admin/mobile/ads"') &&
    !adsUiSource.includes('sb.from("ads")'),
  "ad UI must use the server API instead of direct Supabase writes"
);
assert(
  adminOpsRoutesSource.includes('router.post("/api/admin/google/serp-audit", fullAdminAuth'),
  "every Google and SERP operation must remain owner-only"
);
assert(
  adminRoutesSource.indexOf('"/api/v1/admin/profile-images"') <
    adminRoutesSource.indexOf("adminAuth", adminRoutesSource.indexOf('"/api/v1/admin/profile-images"')) &&
    adminRoutesSource.indexOf("adminAuth", adminRoutesSource.indexOf('"/api/v1/admin/profile-images"')) <
      adminRoutesSource.indexOf("imageLimiter", adminRoutesSource.indexOf('"/api/v1/admin/profile-images"')),
  "admin authentication must run before the profile-image rate limiter"
);
assert(
  (analyticsServiceSource.match(/join public\.profiles profiles/g) || []).length >= 3 &&
    analyticsServiceSource.includes("action_rate") &&
    !analyticsServiceSource.includes("conversion_rate"),
  "analytics totals, daily rows, sources and top profiles must share the real profile ledger scope"
);
assert(
  adminOpsRoutesSource.includes('req.adminRole !== "full_admin"') &&
    adminOpsRoutesSource.includes("getCustomerMobileAccount(customerId)") &&
    (analyticsServiceSource.match(/\(\$3::text is null or profiles\.owner_user_id = \$3::text\)/g) || []).length >= 4 &&
    (analyticsServiceSource.match(/\(\$3::text is null or events\.owner_user_id_snapshot = \$3::text\)/g) || []).length >= 4 &&
    analyticsMigrationSource.includes("analytics_events_owner_profile_created_idx") &&
    analyticsMigrationSource.includes("analytics_events_event_id_uidx") &&
    compactAnalyticsUiSource.includes('group.label="Tekmüşteri"') &&
    compactAnalyticsUiSource.includes('query.set("customer_id",scope.id)'),
  "customer analytics must resolve an owner account and keep every metric query in the same tenant scope"
);
assert(
  compactAnalyticsUiSource.includes('searchRequest(["date"])') &&
    compactAnalyticsUiSource.includes('searchRequest(["query"])') &&
    compactAnalyticsUiSource.includes('dimension:"page"') &&
    compactAnalyticsUiSource.includes('operator:"equals"') &&
    compactAnalyticsUiSource.includes("dateWithOffset(-2)") &&
    compactAnalyticsUiSource.includes(':"0"') &&
    !profilesUiSource.includes("profile.view_count") &&
    !profilesUiSource.includes("profile.click_count"),
  "admin analytics uses finalized GSC totals and never displays stale profile counters"
);
assert(
  adminPanelSource.includes('id="customerCard" data-customer-manager-only') &&
    adminPanelSource.includes('id="analyticsPanel" class="panel"') &&
    adminPanelSource.includes('id="customersPanel" class="panel" data-full-admin-only') &&
    adminPanelSource.includes('id="adsPanel" class="panel" data-ad-manager-only') &&
    adminPanelSource.includes('id="settingsPanel" class="panel" data-full-admin-only') &&
    adminPanelSource.includes('id="toolsPanel" class="panel" data-full-admin-only'),
  "panel must expose customers and ads while keeping settings and SEO owner-only"
);
assert(
  adminPanelSource.includes('admin.js?v=20260923-reset1') &&
    adminEntrySource.includes('index.js?v=20260923-reset1') &&
    adminIndexSource.includes('settings.js?v=20260809-home-theme1') &&
    adminIndexSource.includes('profiles.js?v=20260911-seo-fido1') &&
    adminIndexSource.includes('customers.js?v=20260809-home-theme1') &&
    adminIndexSource.includes('analytics.js?v=20260809-home-theme1') &&
    adminIndexSource.includes('ads.js?v=20260809-home-theme1') &&
    adminIndexSource.includes('auth.js?v=20260913-auth-session1') &&
    adminIndexSource.includes('passkeys.js?v=20260913-auth-session1'),
  "admin shell must invalidate cached role and operations modules"
);
assert(
  adminPanelSource.includes('id="loginPasskeyBtn"') &&
    adminPanelSource.includes('id="registerPasskeyBtn"') &&
    adminPanelSource.includes('value="bkaytanci00@gmail.com"') &&
    !adminPanelSource.includes('id="loginGoogleBtn"') &&
    !adminPanelSource.includes('id="loginBtn"') &&
    !adminPanelSource.includes('id="loginPassword"') &&
    !adminPanelSource.includes("<summary>Yedek şifreli giriş</summary>") &&
    adminRoutesSource.includes("adminPasswordLoginEnabled()") &&
    adminRoutesSource.includes('VIP_GECE_ADMIN_PASSWORD_LOGIN_ENABLED === "true"') &&
    adminAuthSource.includes("loginAdminWithPasskey") &&
    adminAuthSource.includes("signInAdminWithPasskey") &&
    adminSharedSource.includes("experimental:{passkey:true}") &&
    adminSharedSource.includes("persistSession:false") &&
    adminSharedSource.includes("autoRefreshToken:false") &&
    adminSharedSource.includes("detectSessionInUrl:true") &&
    !adminSharedSource.includes("storageKey") &&
    !adminIndexSource.includes("localStorage") &&
    !adminPwaSource.includes("serviceWorker.register"),
  "admin login must support FIDO passkey sign-in with Google fallback and avoid browser-persistent admin session storage"
);
assert(
  compactProfilesUiSource.includes("areCustomerAccountsLoaded") &&
    compactProfilesUiSource.includes("currentProfile.expires_at||null") &&
    compactProfilesUiSource.includes('preset==="none"') &&
    compactCustomersUiSource.includes("customerAccountsLoaded=false") &&
    compactCustomersUiSource.includes("customerAccountsLoaded=true") &&
    compactSettingsUiSource.includes("settingsLoaded=false") &&
    compactSettingsUiSource.includes("button.disabled=!enabled") &&
    adminPanelSource.includes('<option value="none">Süre sınırını kaldır</option>'),
  "admin profile ownership, duration and site-settings writes fail closed"
);
assert(
  postgresProfilesSource.includes('error.code = "HOMEPAGE_SLOT_OCCUPIED"') &&
    postgresProfilesSource.includes("and (vip_slot = $2 or normal_slot = $2)") &&
    adminRoutesSource.includes("HOMEPAGE_SLOT_OCCUPIED"),
  "active homepage slot changes reject duplicate public order"
);
assert(
  adminIndexSource.includes("await loadAnalytics()") &&
    compactToolsUiSource.includes('fetch("/sitemap.xml"') &&
    !compactToolsUiSource.includes('<?xmlversion="1.0"'),
  "admin dashboard loads real analytics and exports the complete live sitemap"
);

const storedSettings = await updateSiteSettings({
  site_name: "VIP GECE Contract",
  home_title: "Contract Home",
  home_description: "Contract description",
  featured_title: "Contract VIP",
  normal_title: "Contract Profiles",
  detail_title: "Contract Detail",
  empty_text: "Contract Empty",
  database_url: "must-not-persist",
  cloudflare_token: "must-not-persist"
});
const settingsDiskText = await readFile(process.env.SITE_SETTINGS_STORE_PATH, "utf8");
const settingsMode = (await stat(process.env.SITE_SETTINGS_STORE_PATH)).mode & 0o777;
assert(
  (process.platform === "win32" || settingsMode === 0o600) &&
    !("database_url" in storedSettings) &&
    !("cloudflare_token" in storedSettings),
  "site settings persist only the public allowlist with private file permissions"
);

assert(
  healthRoutesSource.includes("assertSiteSettingsStorageReady") &&
    healthRoutesSource.includes("assertCustomerMobileAccountStorageReady"),
  "readiness covers persistent admin settings and customer account stores"
);
assert(
  !settingsDiskText.includes("must-not-persist"),
  "site settings never persist database or Cloudflare secret-shaped fields"
);
let missingRequiredSettingRejected = false;
try {
  await updateSiteSettings({ home_title: "" });
} catch (error) {
  missingRequiredSettingRejected = error?.status === 400;
}
assert(
  missingRequiredSettingRejected,
  "site settings reject empty required public metadata"
);
await rm(settingsDirectory, { recursive: true, force: true });

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  assertions: 29,
  operator: {
    role: "profile_admin",
    role_label: operatorPermissions.roleLabel,
    can_manage_profiles: operatorPermissions.canManageProfiles,
    can_manage_customers: operatorPermissions.canManageCustomers,
    can_manage_ads: operatorPermissions.canManageAds,
    can_view_analytics: operatorPermissions.canViewAnalytics,
    can_manage_site_settings: false,
    can_manage_seo: operatorPermissions.canManageSeo,
    can_manage_google: operatorPermissions.canRunGoogleSync
  }
}, null, 2));
