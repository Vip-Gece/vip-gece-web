"use strict";

import { $ } from "./shared.js?v=20260913-auth-session1";

async function removeAdminBrowserWorkers() {
  if ("serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations
          .filter((registration) => {
            const scriptUrl = registration.active?.scriptURL ||
              registration.installing?.scriptURL ||
              registration.waiting?.scriptURL ||
              "";
            return scriptUrl.includes("/admin-sw.js") ||
              String(registration.scope || "").includes("/vg-panel-91x");
          })
          .map((registration) => registration.unregister())
      );
    } catch {
      // Older browsers can refuse service worker inspection; the CSP still blocks new workers.
    }
  }

  if ("caches" in window) {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => /admin|vip-gece/i.test(name))
          .map((name) => caches.delete(name))
      );
    } catch {
      // Cache cleanup is best-effort and must never block panel load.
    }
  }
}

export function setupAdminPwa() {
  void removeAdminBrowserWorkers();
  const button = $("installAdminAppBtn");
  if (button) {
    button.classList.add("hidden");
    button.setAttribute("aria-hidden", "true");
    button.setAttribute("tabindex", "-1");
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
  });
}
