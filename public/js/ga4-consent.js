"use strict";

(() => {
  const RETIRED_IDS = new Set(["G-MGGWKPN1KH", "G-DF04MCZGRF"]);
  function validConfig(id, configuredOrigin, actualOrigin) {
    return /^G-[A-Z0-9]{10}$/.test(id || "") && !RETIRED_IDS.has(id) &&
      /^https:\/\/[^/?#]+$/.test(configuredOrigin || "") && configuredOrigin === actualOrigin;
  }
  function publicPage(pathname) {
    if (pathname === "/" || pathname === "/index.html") return { path: "/", title: "Ana sayfa" };
    if (/^\/profil\/[a-z0-9-]+\/?$/.test(pathname) || pathname === "/detay.html") {
      return { path: "/profil/", title: "Profil" };
    }
    if (/^\/[a-z0-9-]+-escort\/?$/.test(pathname)) return { path: pathname.replace(/\/$/, ""), title: "Ilanlar" };
    if (["/ilanlar", "/kategoriler", "/iletisim", "/guven-ve-politikalar"].includes(pathname.replace(/\.html$/, ""))) {
      return { path: pathname.replace(/\.html$/, ""), title: "Site" };
    }
    return null;
  }
  function consentAllowed(value, now, privacySignal) {
    return !privacySignal && value?.version === 1 && value.choice === "accepted" &&
      Number.isFinite(value.at) && value.at <= now && now - value.at < 180 * 86400000;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { validConfig, publicPage, consentAllowed };
    return;
  }
  const root = document.currentScript;
  const id = root?.dataset.ga4Id;
  const origin = root?.dataset.ga4Origin;
  const page = publicPage(location.pathname);
  if (!validConfig(id, origin, location.origin) || !page || window.vipGa4ConsentReady ||
      /bot|crawler|spider|headlesschrome|lighthouse|pagespeed/i.test(navigator.userAgent)) return;
  window.vipGa4ConsentReady = true;
  const key = "vg-analytics-consent-v1";
  const privacySignal = navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
  let loaded = false;
  let sent = false;
  let consent = null;
  try { consent = JSON.parse(localStorage.getItem(key) || "null"); } catch { /* Storage can be disabled. */ }
  const gtag = function () { window.dataLayer.push(arguments); };
  function clearCookies() {
    const domains = ["", location.hostname, `.${location.hostname}`];
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.trim().split("=")[0];
      if (!/^(?:_ga(?:_|$)|vg_ga4(?:_|$))/.test(name)) continue;
      for (const domain of domains) {
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure${domain ? `; Domain=${domain}` : ""}`;
      }
    }
  }
  function start() {
    if (privacySignal || loaded) return;
    loaded = true;
    window[`ga-disable-${id}`] = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag = gtag;
    gtag("consent", "default", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
    gtag("consent", "update", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
    const safePage = { page_location: `${origin}${page.path}`, page_title: page.title, page_referrer: "" };
    gtag("set", safePage);
    gtag("js", new Date());
    gtag("config", id, {
      ...safePage, send_page_view: false, allow_google_signals: false,
      allow_ad_personalization_signals: false, cookie_domain: location.hostname,
      cookie_prefix: "vg_ga4", cookie_expires: 86400, cookie_update: false,
      cookie_flags: "SameSite=Lax;Secure"
    });
    if (!sent) {
      sent = true;
      gtag("event", "page_view", { ...safePage, send_to: id });
    }
    const tag = document.createElement("script");
    tag.async = true;
    if (root.nonce) tag.nonce = root.nonce;
    tag.referrerPolicy = "no-referrer";
    tag.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    tag.addEventListener("error", () => { loaded = false; sent = false; }, { once: true });
    document.head.appendChild(tag);
  }
  const preference = document.createElement("button");
  preference.type = "button";
  preference.textContent = "\u00c7erez tercihleri";
  preference.className = "vg-consent-preference";
  const banner = document.createElement("section");
  banner.className = "vg-consent-banner";
  banner.setAttribute("aria-label", "Analitik \u00e7erez tercihi");
  const copy = document.createElement("p");
  copy.textContent = "\u0130zin verirseniz ziyaret istatistikleri Google Analytics ile \u00f6l\u00e7\u00fcl\u00fcr. Reklam takibi yap\u0131lmaz. Reddetmeniz site kullan\u0131m\u0131n\u0131 etkilemez.";
  const actions = document.createElement("div");
  const reject = document.createElement("button");
  reject.type = "button"; reject.textContent = "Reddet";
  const accept = document.createElement("button");
  accept.type = "button"; accept.textContent = "\u0130zin ver"; accept.disabled = privacySignal;
  actions.append(reject, accept);
  banner.append(copy, actions);
  function choose(choice) {
    consent = { version: 1, choice, at: Date.now() };
    try { localStorage.setItem(key, JSON.stringify(consent)); } catch { /* Apply to this page even without storage. */ }
    banner.hidden = true;
    if (choice === "accepted") start();
    else {
      window[`ga-disable-${id}`] = true;
      clearCookies();
      if (loaded) location.reload();
    }
  }
  accept.addEventListener("click", () => choose("accepted"));
  reject.addEventListener("click", () => choose("rejected"));
  preference.addEventListener("click", () => { banner.hidden = false; reject.focus(); });
  document.body.append(preference, banner);
  if (consentAllowed(consent, Date.now(), privacySignal)) { banner.hidden = true; start(); }
  else {
    clearCookies();
    banner.hidden = privacySignal || (consent?.choice === "rejected" && consent.at <= Date.now() && Date.now() - consent.at < 180 * 86400000);
  }
})();
