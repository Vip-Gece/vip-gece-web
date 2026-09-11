"use strict";

(() => {
  const interactionEvents = ["pointerdown", "keydown", "touchstart"];
  let activated = false;

  function activateDeferredStyles() {
    if (activated) return;
    activated = true;
    document.querySelectorAll('link[rel="stylesheet"][data-defer-css]').forEach((link) => {
      const href = link.getAttribute("data-href");
      if (href && !link.getAttribute("href")) link.setAttribute("href", href);
      link.media = "all";
      link.removeAttribute("data-defer-css");
      link.removeAttribute("data-href");
    });
    interactionEvents.forEach((eventName) => {
      window.removeEventListener(eventName, activateDeferredStyles, true);
    });
  }

  // Loading decorative web fonts only after a real interaction keeps the
  // first render connection-free and avoids a late font swap contributing to
  // CLS. The system fallback remains fully usable when no interaction occurs.
  interactionEvents.forEach((eventName) => {
    window.addEventListener(eventName, activateDeferredStyles, {
      capture: true,
      once: true,
      passive: eventName !== "keydown",
    });
  });

  function setupProgressiveHomeCards() {
    const selector = '.selected-card[data-home-deferred-card="true"]';
    const cards = [...document.querySelectorAll(selector)];
    if (!cards.length) return;

    let observer = null;
    const revealCard = (card) => {
      if (!(card instanceof HTMLElement) || !card.matches(selector)) return;
      card.removeAttribute("data-home-deferred-card");
      observer?.unobserve(card);
    };
    const revealEventCard = (event) => revealCard(event.target?.closest?.(selector));

    document.addEventListener("focusin", revealEventCard, true);
    document.addEventListener("pointerover", revealEventCard, { passive: true });

    function activateProgressiveCards() {
      if (observer) return;

      const referenceCard = document.querySelector(".selected-card:not([data-home-deferred-card])");
      const referenceHeight = Math.ceil(referenceCard?.getBoundingClientRect().height || 0);
      if (referenceHeight > 0) {
        document.documentElement.style.setProperty("--home-deferred-card-height", `${referenceHeight}px`);
      }

      if (!("IntersectionObserver" in window)) {
        cards.forEach(revealCard);
        return;
      }

      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) revealCard(entry.target);
        });
      }, { rootMargin: "280px 0px" });
      cards.forEach((card) => observer.observe(card));
    }

    window.addEventListener("scroll", activateProgressiveCards, {
      once: true,
      passive: true,
    });
    if (window.scrollY > 0) activateProgressiveCards();
  }

  setupProgressiveHomeCards();
})();
