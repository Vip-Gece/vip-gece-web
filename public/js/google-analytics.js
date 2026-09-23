"use strict";

(() => {
  if (document.body?.dataset?.profilePreview === "true") return;

  const acquisitionKey = "vip-gece-acquisition-v1";
  const acquisitionTtlMs = 30 * 60 * 1e3;
  const analyticsTransportDelayMs = 9000;
  const analyticsTransportEvents = ["pointerdown", "keydown", "touchstart"];

  function normalizedAcquisitionSource() {
    const campaign = String(new URLSearchParams(window.location.search).get("utm_source") || "").trim().toLowerCase();
    let candidate = campaign;
    if (!candidate && document.referrer) {
      try {
        const referrer = new URL(document.referrer);
        if (referrer.origin === window.location.origin) return "internal";
        candidate = referrer.hostname.toLowerCase();
      } catch {
        return "unknown";
      }
    }
    if (!candidate) return "direct";
    if (candidate.includes("google")) return "google";
    if (candidate.includes("bing")) return "bing";
    if (candidate.includes("yandex")) return "yandex";
    if (candidate.includes("instagram")) return "instagram";
    if (candidate.includes("facebook") || candidate === "fb") return "facebook";
    if (candidate.includes("tiktok")) return "tiktok";
    if (candidate === "x" || candidate.includes("twitter")) return "x";
    if (candidate.includes("telegram") || candidate === "tg") return "telegram";
    return "referral";
  }

  function rememberAcquisitionSource() {
    const source = normalizedAcquisitionSource();
    if (["direct", "internal", "unknown"].includes(source)) return;
    try {
      localStorage.setItem(acquisitionKey, JSON.stringify({
        source,
        expires_at: Date.now() + acquisitionTtlMs
      }));
    } catch {}
  }

  rememberAcquisitionSource();

  const script = document.currentScript;
  const rawId = String(script?.dataset?.gaMeasurementId || window.VIP_GECE_GA_ID || "").trim();
  const measurementId = /^G-[A-Z0-9]+$/i.test(rawId) ? rawId.toUpperCase() : "";
  if (!measurementId) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };

  let started = false;
  let transportQueued = false;
  let transportTimer = 0;

  function clearTransportWakeups() {
    window.clearTimeout(transportTimer);
    analyticsTransportEvents.forEach((eventName) => {
      document.removeEventListener(eventName, loadRemoteGtag, true);
    });
    window.removeEventListener("pagehide", loadRemoteGtag, true);
    document.removeEventListener("visibilitychange", loadRemoteGtag, true);
  }

  function loadRemoteGtag() {
    if (document.getElementById("vip-gece-ga4-loader")) return;
    clearTransportWakeups();
    const loader = document.createElement("script");
    loader.id = "vip-gece-ga4-loader";
    loader.async = true;
    loader.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(loader);
  }

  function queueRemoteTransport() {
    if (transportQueued) return;
    transportQueued = true;
    const schedule = () => {
      transportTimer = window.setTimeout(() => {
        if ("requestIdleCallback" in window) {
          window.requestIdleCallback(loadRemoteGtag, { timeout: 2000 });
          return;
        }
        loadRemoteGtag();
      }, analyticsTransportDelayMs);
    };
    if (document.readyState === "complete") {
      schedule();
    } else {
      window.addEventListener("load", schedule, { once: true });
    }
    analyticsTransportEvents.forEach((eventName) => {
      document.addEventListener(eventName, loadRemoteGtag, { once: true, passive: true, capture: true });
    });
    window.addEventListener("pagehide", loadRemoteGtag, { once: true, capture: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") loadRemoteGtag();
    }, { once: true, capture: true });
  }

  function startAnalytics() {
    if (started) return;
    started = true;
    window.gtag("js", new Date);
    window.gtag("config", measurementId, {
      send_page_view: true,
      anonymize_ip: true
    });
    queueRemoteTransport();
  }

  startAnalytics();
})();
