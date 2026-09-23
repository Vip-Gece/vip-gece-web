"use strict";

import { $, showStatus, showTab } from "./shared.js?v=20260913-auth-session1";
import { issueCustomerAccessLink, issueCustomerPasswordResetLink, generateCustomerPassword, copyCustomerPassword } from "./customer-onboarding.js?v=20260923-reset1";
import { loadSettings, saveSettings } from "./settings.js?v=20260809-home-theme1";
import {
  focusAnalyticsProfile,
  loadAnalytics,
  loadSearchAnalytics,
  populateAnalyticsProfiles
} from "./analytics.js?v=20260809-home-theme1";
import {
  handleCustomerAccountAction,
  loadCustomerAccounts,
  newCustomerAccount,
  renderSelectedCustomerProfiles,
  saveCustomerAccount
} from "./customers.js?v=20260809-home-theme1";
import {
  autoFillSeo,
  clearProfileForm,
  copyCustomerAccessLink,
  deleteProfile,
  editProfile,
  loadProfiles,
  renderProfiles,
  renderPreview,
  renderSelectedImagePreview,
  saveCustomerAccess,
  saveProfile,
  updateStats
} from "./profiles.js?v=20260911-seo-fido1";
import { deleteAd, loadAds, saveAd, toggleAd } from "./ads.js?v=20260809-home-theme1";
import {
  bulkGenerateSlugs,
  copyUrlList,
  exportProfiles,
  generateSitemap,
  localProfilePathById,
  seoReport,
  syncSearchConsole
} from "./tools.js?v=20260809-home-theme1";
import { loadSeoControl } from "./seo-control.js?v=20260911-seo-control1";
import { initAdmin, loginAdmin, loginAdminWithGoogle, loginAdminWithPasskey, logoutAdmin } from "./auth.js?v=20260913-auth-session1";
import { setupAdminPwa } from "./pwa.js";
import { initPasskeyPanel, loadPasskeys } from "./passkeys.js?v=20260913-auth-session1";

const ADMIN_THEMES = new Set(["gece", "bordo", "yuksek-kontrast"]);

function storedAdminTheme() {
  return "gece";
}

function applyAdminTheme(value, persist = false) {
  const theme = ADMIN_THEMES.has(value) ? value : "gece";
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll("[data-admin-theme]").forEach((select) => {
    if (select instanceof HTMLSelectElement) select.value = theme;
  });

  const themeColor = document.getElementById("adminThemeColor");
  if (themeColor) {
    themeColor.setAttribute(
      "content",
      theme === "yuksek-kontrast" ? "#000000" : theme === "bordo" ? "#160208" : "#070205"
    );
  }

  void persist;
}

applyAdminTheme(storedAdminTheme());

export async function refreshAll() {
  const profilesLoaded = await loadProfiles();
  if (!profilesLoaded) return;

  const profileOnly = document.documentElement.dataset.adminRole === "profile_admin";
  if (!profileOnly) {
    const settingsLoaded = await loadSettings();
    if (!settingsLoaded) return;

    const saveProfileButton = $("saveProfileBtn");
    if (saveProfileButton) saveProfileButton.disabled = true;
    try {
      await loadCustomerAccounts();
      if (saveProfileButton) saveProfileButton.disabled = false;
    } catch (error) {
      showStatus(
        "panelStatus",
        error.message || "Müşteri hesapları şu anda alınamadı; diğer yönetim alanları kullanılabilir.",
        "warn"
      );
      return;
    }
    renderProfiles();
  }

  if (document.documentElement.dataset.adminCanManageAds === "true") {
    await loadAds();
  }

  populateAnalyticsProfiles();
  const analyticsLoaded = await loadAnalytics();
  if (document.documentElement.dataset.adminRole === "full_admin") {
    await loadSeoControl();
    await loadPasskeys();
  }
  updateStats();
  if (analyticsLoaded) showStatus("panelStatus", "Veriler yenilendi.", "ok");
}

function activateProfilePanel() {
  showTab("profilePanel", document.querySelector('.tab[data-tab="profilePanel"]'));
}

function isNativeOrStandalone() {
  return Boolean(window.Capacitor) ||
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator?.standalone === true;
}

async function installedAdminAppInfo() {
  const plugin = window.Capacitor?.Plugins?.VipGeceAppInfo;
  if (!plugin?.getInfo) return null;
  try {
    return await plugin.getInfo();
  } catch {
    return null;
  }
}

async function checkAdminAppUpdate() {
  showStatus("panelStatus", "APK guncelleme bilgisi kontrol ediliyor...", "warn");
  try {
    const updater = window.Capacitor?.Plugins?.VipGeceUpdater;
    if (updater?.runUpdate) {
      const result = await updater.runUpdate({ manifestUrl: `${window.location.origin}/api/mobile/admin/update` });
      const state = String(result?.state || "");
      const message = String(result?.message || "");
      const type = state.includes("failed") ? "err" : state.includes("permission") ? "warn" : "ok";
      showStatus("panelStatus", message || "Arka plan guncelleme denetimi baslatildi.", type);
      return;
    }

    const response = await fetch("/api/mobile/admin/update", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.apk_url) {
      throw new Error(payload.error || "APK guncelleme manifesti alinamadi.");
    }

    const installed = await installedAdminAppInfo();
    const installedCode = Number(installed?.versionCode || 0);
    const availableCode = Number(payload.version_code || 0);
    if (installedCode > 0 && availableCode > 0 && installedCode >= availableCode) {
      const currentVersion = installed?.versionName ? `v${installed.versionName}` : `surum ${installedCode}`;
      showStatus("panelStatus", `Yonetim uygulamasi guncel: ${currentVersion}.`, "ok");
      return;
    }

    const version = payload.version_name ? `v${payload.version_name}` : "son surum";
    const size = Number.isFinite(Number(payload.size_bytes)) && Number(payload.size_bytes) > 0
      ? ` · ${Math.round(Number(payload.size_bytes) / 1024 / 1024)} MB`
      : "";
    showStatus("panelStatus", `APK hazir: ${version}${size}. Indirme aciliyor.`, "ok");
    if (isNativeOrStandalone()) {
      window.location.assign(payload.apk_url);
      return;
    }
    window.open(payload.apk_url, "_blank", "noopener");
  } catch (error) {
    showStatus("panelStatus", error.message || "APK guncelleme kontrolu basarisiz.", "err");
  }
}

function runCommand(command) {
  if (command === "new-profile") {
    activateProfilePanel();
    clearProfileForm();
    $("name")?.focus();
    return;
  }

  if (command === "seo-missing") {
    activateProfilePanel();
    const filter = $("filterSelect");
    if (filter) filter.value = "seoMissing";
    renderProfiles();
    $("profileList")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function scrollToAdminSurface(selector) {
  const target = selector ? document.querySelector(selector) : null;
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bindEvents() {
  const add = (id, event, handler) => {
    const el = $(id);
    if (el) el.addEventListener(event, handler);
  };

  add("loginPasskeyBtn", "click", () => loginAdminWithPasskey(refreshAll));
  add("loginGoogleBtn", "click", loginAdminWithGoogle);
  add("loginBtn", "click", () => loginAdmin(refreshAll));
  add("logoutBtn", "click", logoutAdmin);
  add("openSiteBtn", "click", () => window.open("/", "_blank", "noopener"));
  add("refreshBtn", "click", refreshAll);
  add("adminAppUpdateBtn", "click", checkAdminAppUpdate);
  add("exportBtn", "click", exportProfiles);
  add("saveSettingsBtn", "click", saveSettings);
  add("saveProfileBtn", "click", saveProfile);
  add("saveCustomerAccessBtn", "click", saveCustomerAccess);
  add("copyCustomerAccessBtn", "click", copyCustomerAccessLink);
  add("autoSeoBtn", "click", autoFillSeo);
  add("cancelEditBtn", "click", clearProfileForm);
  add("searchInput", "input", renderProfiles);
  add("filterSelect", "change", renderProfiles);
  add("customerFilterSelect", "change", renderProfiles);
  add("sortSelect", "change", renderProfiles);
  add("saveAdBtn", "click", saveAd);
  add("exportToolsBtn", "click", exportProfiles);
  add("urlListBtn", "click", copyUrlList);
  add("sitemapBtn", "click", generateSitemap);
  add("searchSyncBtn", "click", syncSearchConsole);
  add("slugBtn", "click", bulkGenerateSlugs);
  add("seoReportBtn", "click", seoReport);
  add("refreshAnalyticsBtn", "click", loadAnalytics);
  add("analyticsRange", "change", loadAnalytics);
  add("analyticsProfileFilter", "change", loadAnalytics);
  add("refreshSearchAnalyticsBtn", "click", loadSearchAnalytics);
  add("refreshSeoControlBtn", "click", loadSeoControl);
  add("saveCustomerAccountBtn", "click", saveCustomerAccount);
  add("newCustomerAccountBtn", "click", newCustomerAccount);
  add("issueCustomerAccessLinkBtn", "click", issueCustomerAccessLink);
  add("issueCustomerPasswordResetLinkBtn", "click", issueCustomerPasswordResetLink);
  add("generateCustomerPasswordBtn", "click", generateCustomerPassword);
  add("copyCustomerPasswordBtn", "click", copyCustomerPassword);
  add("images", "input", renderPreview);
  add("newProfileShortcutBtn", "click", () => runCommand("new-profile"));
  add("seoMissingShortcutBtn", "click", () => runCommand("seo-missing"));
  add("imageFiles", "change", (event) => renderSelectedImagePreview(event.target.files || []));

  document.querySelectorAll("[data-admin-theme]").forEach((select) => {
    select.addEventListener("change", () => {
      applyAdminTheme(select.value, true);
    });
  });

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tabButton = button.classList.contains("tab")
        ? button
        : document.querySelector(`.tab[data-tab="${button.dataset.tab}"]`);
      showTab(button.dataset.tab, tabButton);
      if (button.dataset.tab === "analyticsPanel") void loadAnalytics();
      if (button.dataset.tab === "toolsPanel") void loadSeoControl();
      if (button.dataset.tab === "customersPanel") renderSelectedCustomerProfiles();
    });
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.detail) window.open(localProfilePathById(target.dataset.detail), "_blank", "noopener");
    if (target.dataset.edit) editProfile(target.dataset.edit);
    if (target.dataset.customerAccess) editProfile(target.dataset.customerAccess);
    if (target.dataset.delete) deleteProfile(target.dataset.delete);
    if (target.dataset.adToggle) toggleAd(target.dataset.adToggle, target.dataset.next);
    if (target.dataset.adDelete) deleteAd(target.dataset.adDelete);
    if (target.dataset.analyticsProfile) focusAnalyticsProfile(target.dataset.analyticsProfile);
    if (handleCustomerAccountAction(target)) return;
    if (target.dataset.command) runCommand(target.dataset.command);
    if (target.dataset.adminScroll) scrollToAdminSurface(target.dataset.adminScroll);
  });

  document.addEventListener("vip-gece:profiles-updated", () => {
    populateAnalyticsProfiles();
    if (document.documentElement.dataset.adminRole === "full_admin") {
      void loadCustomerAccounts()
        .then(renderProfiles)
        .catch((error) => {
          showStatus("panelStatus", error.message || "Müşteri profil sayıları yenilenemedi.", "err");
        });
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  applyAdminTheme(storedAdminTheme());
  setupAdminPwa();
  bindEvents();
  initPasskeyPanel();
  initAdmin(refreshAll);
});
