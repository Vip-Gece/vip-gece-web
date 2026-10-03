"use strict";

(() => {
  if (window.trustedTypes && !window.vipGeceTrustedTypesReady) {
    const sanitizeTrustedHtml = (value) => String(value)
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s+(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, "");

    try {
      window.trustedTypes.createPolicy("default", {
        createHTML: sanitizeTrustedHtml,
        createScript: (value) => String(value),
        createScriptURL: (value) => String(value)
      });
      window.vipGeceTrustedTypesReady = true;
    } catch {
      window.vipGeceTrustedTypesReady = true;
    }
  }

  const interactionEvents = ["pointerdown", "keydown", "touchstart"];
  let deferredStylesActivated = false;

  function activateDeferredStyles() {
    if (deferredStylesActivated) return;
    deferredStylesActivated = true;

    document.querySelectorAll('link[rel="stylesheet"][data-defer-css]').forEach((link) => {
      const href = link.getAttribute("data-href");
      if (href && !link.getAttribute("href")) {
        link.setAttribute("href", href);
      }
      link.media = "all";
      link.removeAttribute("data-defer-css");
      link.removeAttribute("data-href");
    });

    interactionEvents.forEach((eventName) => {
      window.removeEventListener(eventName, activateDeferredStyles, true);
    });
  }

  interactionEvents.forEach((eventName) => {
    window.addEventListener(eventName, activateDeferredStyles, {
      capture: true,
      once: true,
      passive: eventName !== "keydown"
    });
  });

  const deferredCardSelector = '.selected-card[data-home-deferred-card="true"]';
  const deferredCards = Array.from(document.querySelectorAll(deferredCardSelector));
  if (!deferredCards.length) return;

  let observer = null;

  function revealCard(card) {
    if (card instanceof HTMLElement && card.matches(deferredCardSelector)) {
      card.removeAttribute("data-home-deferred-card");
      observer?.unobserve(card);
    }
  }

  function revealFromEvent(event) {
    revealCard(event.target?.closest?.(deferredCardSelector));
  }

  function startDeferredCardObserver() {
    if (observer) return;

    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) revealCard(entry.target);
          });
        },
        { rootMargin: "280px 0px" }
      );
      deferredCards.forEach((card) => observer.observe(card));
      return;
    }

    deferredCards.forEach(revealCard);
  }

  document.addEventListener("focusin", revealFromEvent, true);
  document.addEventListener("pointerover", revealFromEvent, { passive: true });
  window.addEventListener("scroll", startDeferredCardObserver, { once: true, passive: true });

  if (window.scrollY > 0) {
    startDeferredCardObserver();
  }
})();
