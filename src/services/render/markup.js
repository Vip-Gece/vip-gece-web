"use strict";

const { clean, absoluteUrl, optimizedImageSrcset, optimizedImageUrl, esc, safeSlug } = require("./shared");
const { getProfileLocation, getProfileSlug } = require("../../utils/profile");
const { isVipProfile } = require("../landingContextService");

function renderInlineLinks(links, className = "category-inline-link") {
  return (links || [])
    .map((link) => `<a class="${esc(className)}" href="${esc(link.href)}">${esc(link.title)}</a>`)
    .join("");
}

function renderSummaryItems(items) {
  return (items || [])
    .map((item) => `
      <div class="category-highlight">
        <strong>${esc(item.value)}</strong>
        <span>${esc(item.label)}</span>
      </div>
    `)
    .join("");
}

function renderBreadcrumbMarkup(items) {
  return (items || [])
    .map((item, index) => {
      const content = item.url
        ? `<a href="${esc(item.url)}">${esc(item.name)}</a>`
        : `<span>${esc(item.name)}</span>`;
      const separator = index < items.length - 1 ? `<span class="category-breadcrumb-sep">/</span>` : "";
      return `${content}${separator}`;
    })
    .join("");
}

function renderFaqMarkup(title, items) {
  const rows = (items || [])
    .map((item) => `
      <article class="category-faq-item">
        <h3>${esc(item.question)}</h3>
        <p>${esc(item.answer)}</p>
      </article>
    `)
    .join("");

  return `
    <div class="category-info-head">
      <h2>${esc(title)}</h2>
    </div>
    <div class="category-faq-list">
      ${rows}
    </div>
  `;
}

function renderNearbyMarkup(title, text, links) {
  return `
    <div class="category-info-head">
      <h2>${esc(title)}</h2>
      <p>${esc(text)}</p>
    </div>
    <div class="category-inline-links">
      ${renderInlineLinks(links)}
    </div>
  `;
}

function renderSeoPanelMarkup(context) {
  const localIntentRows = (context.localIntentRows || [])
    .map((row) => `
      <a class="category-local-intent-card" href="${esc(row.href)}">
        <strong>${esc(row.title)}</strong>
        <span>${esc(row.text)}</span>
      </a>
    `)
    .join("");

  return `
    <div class="category-info-head">
      <h2>${esc(context.seoTitle)}</h2>
    </div>
    ${(context.seoParagraphs || []).map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}
    ${localIntentRows ? `
      <section class="category-local-intent">
        <h3>${esc(context.localIntentTitle || "Yakın Semt İlanları")}</h3>
        <div class="category-local-intent-grid">
          ${localIntentRows}
        </div>
      </section>
    ` : ""}
    <div class="category-inline-links">
      ${renderInlineLinks(context.internalLinks)}
    </div>
  `;
}

function renderChipLinks(links, className = "detail-chip") {
  return (links || [])
    .map((link) => `<a class="${esc(className)}" href="${esc(link.href)}">${esc(link.title)}</a>`)
    .join("");
}

function renderEmptyStatePanel(title, copy, links = []) {
  return `
    <div class="empty-state">
      <strong class="empty-state-title">${esc(title)}</strong>
      ${copy ? `<p class="empty-state-copy">${esc(copy)}</p>` : ""}
      ${links.length ? `<div class="empty-state-links">${links.map((link) => `<a href="${esc(link.href)}">${esc(link.title)}</a>`).join("")}</div>` : ""}
    </div>
  `;
}

const PROFILE_IMAGE_FOCUS = {
  "istanbul-meli-s-2": { category: "54% 42%", mini: "50% 42%", listings: "54% 42%" },
  "istanbul-cansu-3": { category: "48% 40%", mini: "48% 42%", listings: "48% 40%" },
  "istanbul-deni-z-4": { category: "50% 38%", mini: "50% 40%", listings: "50% 38%" },
  "istanbul-aleyna-5": { category: "50% 38%", mini: "50% 36%", listings: "50% 38%" },
  "istanbul-i-rem-7": { category: "50% 34%", mini: "50% 34%", listings: "50% 34%" },
  "istanbul-meli-ke-6": { category: "54% 38%", mini: "54% 36%", listings: "54% 38%" },
  "istanbul-gi-zem-8": { category: "50% 40%", mini: "50% 38%", listings: "50% 40%" },
  "istanbul-merve-9": { category: "50% 38%", mini: "50% 36%", listings: "50% 38%" },
  "bade-nur": { category: "50% 36%", mini: "50% 36%", listings: "50% 36%" },
  "tatyana": { category: "52% 38%", mini: "54% 38%", listings: "52% 38%" },
  "istanbul-burcu-1779240144181": { category: "50% 46%", mini: "50% 54%", listings: "50% 46%" },
  "istanbul-ela-1779241002723": { category: "50% 38%", mini: "50% 38%", listings: "50% 38%" }
};

const PROFILE_IMAGE_SURFACE_INDEX = {
  "istanbul-meli-s-2": { category: 3, mini: 1, listings: 3 },
  "istanbul-cansu-3": { category: 2, mini: 2, listings: 2 },
  "istanbul-deni-z-4": { category: 1, mini: 1, listings: 1 },
  "istanbul-aleyna-5": { category: 2, mini: 2, listings: 2 },
  "istanbul-i-rem-7": { category: 0, mini: 0, listings: 0 },
  "istanbul-meli-ke-6": { category: 0, mini: 0, listings: 0 },
  "istanbul-gi-zem-8": { category: 2, mini: 2, listings: 2 },
  "istanbul-merve-9": { category: 2, mini: 2, listings: 2 },
  "bade-nur": { category: 1, mini: 1, listings: 1 },
  "tatyana": { category: 2, mini: 2, listings: 2 },
  "istanbul-burcu-1779240144181": { category: 0, mini: 0, listings: 0 },
  "istanbul-ela-1779241002723": { category: 0, mini: 0, listings: 0 }
};

function getProfileImageForSurface(profile, surface = "category") {
  const images = Array.isArray(profile?.images) ? profile.images.map(clean).filter(Boolean) : [];
  if (!images.length) return "";

  const slug = getProfileSlug(profile);
  const dbSlug = safeSlug(profile?.slug || "");
  const nameSlug = safeSlug(profile?.name || "");
  const indexMap = PROFILE_IMAGE_SURFACE_INDEX[dbSlug] || PROFILE_IMAGE_SURFACE_INDEX[slug] || PROFILE_IMAGE_SURFACE_INDEX[nameSlug] || {};
  const index = Number(indexMap[surface]);
  if (Number.isInteger(index) && images[index]) return images[index];

  return images[0];
}

function getProfileImageFocus(profile, surface, fallback = "50% 38%") {
  const slug = getProfileSlug(profile);
  const dbSlug = safeSlug(profile?.slug || "");
  const nameSlug = safeSlug(profile?.name || "");
  const focus = PROFILE_IMAGE_FOCUS[dbSlug] || PROFILE_IMAGE_FOCUS[slug] || PROFILE_IMAGE_FOCUS[nameSlug] || {};
  return clean(focus[surface] || focus.default || fallback);
}

function profileFocusStyle(profile, variables) {
  const entries = Object.entries(variables || {})
    .map(([name, value]) => {
      const focus = getProfileImageFocus(profile, value.surface, value.fallback);
      return /^-?-?[a-z0-9-]+$/i.test(name) && /^[0-9.]+% [0-9.]+%$/.test(focus)
        ? `--${name}: ${focus}`
        : "";
    })
    .filter(Boolean);

  return entries.length ? ` style="${esc(entries.join("; "))}"` : "";
}

function renderImageTag(src, alt, options = {}) {
  const imageWidth = Number(options.imageWidth || 720);
  const imageHeight = Number(options.imageHeight || Math.round(imageWidth * 1.25));
  const imageQuality = Number(options.imageQuality || 72);
  const optimizedSrc = optimizedImageUrl(src, {
    width: Number.isFinite(imageWidth) ? imageWidth : 720,
    quality: imageQuality,
    resize: options.resize || "contain"
  });
  const srcset = optimizedImageSrcset(src, options.srcsetWidths || [240, 360, 480, 640, 720], {
    quality: imageQuality,
    resize: options.resize || "contain"
  });
  const attributes = [
    `src="${esc(optimizedSrc)}"`,
    `alt="${esc(alt)}"`,
    `width="${esc(String(Number.isFinite(imageWidth) ? Math.round(imageWidth) : 720))}"`,
    `height="${esc(String(Number.isFinite(imageHeight) ? Math.round(imageHeight) : 900))}"`,
    `loading="${esc(options.loading || "lazy")}"`,
    `decoding="${esc(options.decoding || "async")}"`
  ];

  if (options.fetchPriority) {
    attributes.push(`fetchpriority="${esc(options.fetchPriority)}"`);
  }

  if (options.sizes) {
    attributes.push(`sizes="${esc(options.sizes)}"`);
  }

  if (srcset) {
    attributes.push(`srcset="${esc(srcset)}"`);
  }

  return `<img ${attributes.join(" ")}>`;
}

function renderMiniLandingRows(profiles) {
  if (!(profiles || []).length) {
    return renderEmptyStatePanel(
      "Güncel kart akışı şu anda görünmüyor.",
      "İstersen güncel ilanlar, İstanbul veya kategori sayfaları üzerinden akışa başka bir girişten devam edebilirsin.",
      [
        { href: "/ilanlar", title: "Güncel İlanlar" },
        { href: "/istanbul-escort", title: "İstanbul Escort" },
        { href: "/kategoriler", title: "Kategoriler" }
      ]
    );
  }

  return profiles.map((profile, index) => {
    const url = `/profil/${esc(getProfileSlug(profile))}`;
    const image = getProfileImageForSurface(profile, "mini");
    const location = getProfileLocation(profile);
    const meta = [location, profile.age ? `${clean(profile.age)} yaş` : ""].filter(Boolean).join(" / ");
    const imageMarkup = renderImageTag(image, profile.name || "Profil", {
      loading: "lazy",
      sizes: "(max-width: 1024px) 42vw, 18vw",
      imageWidth: 420,
      srcsetWidths: [180, 240, 320, 420]
    });

    return `
      <a class="landing-mini-card" href="${url}"${profileFocusStyle(profile, {
        "profile-mini-position": { surface: "mini", fallback: "50% 38%" }
      })}>
        <div class="landing-mini-cover">
          ${imageMarkup}
        </div>
        <div class="landing-mini-body">
          <strong>${esc(profile.name || "İsimsiz")}</strong>
          <span>${esc(meta || location)}</span>
        </div>
      </a>
    `;
  }).join("");
}

function renderLandingProfileCards(profiles) {
  if (!(profiles || []).length) {
    return renderEmptyStatePanel(
      "Bu sayfada şu anda aktif profil görünmüyor.",
      "İstersen genel profil akışına dönebilir, İstanbul sayfasına çıkabilir veya uygun kategoriden devam edebilirsin.",
      [
        { href: "/ilanlar", title: "Güncel İlanlar" },
        { href: "/istanbul-escort", title: "İstanbul Escort" },
        { href: "/kategoriler", title: "Kategoriler" }
      ]
    );
  }

  return profiles.map((profile, index) => {
    const url = `/profil/${esc(getProfileSlug(profile))}`;
    const image = getProfileImageForSurface(profile, "category");
    const location = getProfileLocation(profile);
    const badge = isVipProfile(profile)
      ? `<span class="category-card-vip">VIP</span>`
      : "";
    const imageMarkup = renderImageTag(image, profile.name || "Profil", {
      loading: index === 0 ? "eager" : "lazy",
      fetchPriority: index === 0 ? "high" : "",
      sizes: "(max-width: 720px) 100vw, (max-width: 1024px) 50vw, 33vw",
      imageWidth: 720,
      srcsetWidths: [320, 480, 640, 720]
    });
    const metaBits = [
      location,
      profile.age ? `${clean(profile.age)} yaş` : "",
      profile.height ? `${clean(profile.height)} cm` : ""
    ].filter(Boolean);

    return `
      <a class="category-card" href="${url}"${profileFocusStyle(profile, {
        "profile-category-position": { surface: "category", fallback: "50% 38%" }
      })}>
        <div class="category-card-cover">
          ${imageMarkup}
          ${badge}
        </div>
        <div class="category-card-body">
          <h3 class="category-card-name">${esc(profile.name || "İsimsiz")}</h3>
          <div class="category-card-meta">
            ${metaBits.map((bit) => `<span>${esc(bit)}</span>`).join("")}
          </div>
          <p class="category-card-desc">${esc(profile.card_label || profile.description || "Premium profil detaylarını inceleyin.")}</p>
        </div>
      </a>
    `;
  }).join("");
}

function renderProfileHubCards(profiles) {
  if (!(profiles || []).length) {
    return renderEmptyStatePanel(
      "Bu vitrinde gösterilecek ilan görünmüyor.",
      "İstersen İstanbul, kategori veya tüm ilan akışını açarak başka bir yerden devam edebilirsin.",
      [
        { href: "/istanbul-escort", title: "İstanbul Escort" },
        { href: "/kategoriler", title: "Kategoriler" },
        { href: "/ilanlar", title: "Güncel İlanlar" }
      ]
    );
  }

  return profiles.map((profile, index) => {
    const url = `/profil/${esc(getProfileSlug(profile))}`;
    const image = getProfileImageForSurface(profile, "listings");
    const imageMarkup = renderImageTag(image, profile.name || "Profil", {
      loading: index === 0 ? "eager" : "lazy",
      fetchPriority: index === 0 ? "high" : "",
      sizes: "(max-width: 720px) 100vw, (max-width: 1024px) 50vw, 33vw",
      imageWidth: 720,
      srcsetWidths: [320, 480, 640, 720]
    });
    const metaBits = [
      getProfileLocation(profile),
      profile.age ? `${clean(profile.age)} yaş` : ""
    ].filter(Boolean);

    return `
      <a class="listings-card" href="${url}"${profileFocusStyle(profile, {
        "profile-listings-position": { surface: "listings", fallback: "50% 38%" }
      })}>
        <div class="listings-card-cover">
          ${imageMarkup}
          ${isVipProfile(profile) ? `<span class="listings-card-badge">VIP</span>` : ""}
        </div>
        <div class="listings-card-body">
          <h3 class="listings-card-name">${esc(profile.name || "İsimsiz")}</h3>
          <div class="listings-card-meta">${metaBits.map((bit) => `<span>${esc(bit)}</span>`).join("")}</div>
          <p class="listings-card-desc">${esc(profile.card_label || profile.description || "Premium ilan detaylarını inceleyin.")}</p>
        </div>
      </a>
    `;
  }).join("");
}

function renderProfileRows(profiles) {
  if (!(profiles || []).length) {
    return renderEmptyStatePanel(
      "Son güncellenen akış şu anda görünmüyor.",
      "İstersen seçili profiller, İstanbul veya kategori sayfaları üzerinden akışa farklı bir girişten devam edebilirsin.",
      [
        { href: "/ilanlar", title: "Güncel İlanlar" },
        { href: "/istanbul-escort", title: "İstanbul Escort" },
        { href: "/vip-escort", title: "VIP Escort" }
      ]
    );
  }

  return profiles.map((profile) => {
    const url = `/profil/${esc(getProfileSlug(profile))}`;
    const image = absoluteUrl(Array.isArray(profile.images) ? profile.images[0] : "");
    const imageMarkup = renderImageTag(image, profile.name || "Profil", {
      loading: "lazy",
      sizes: "(max-width: 1024px) 28vw, 14vw",
      imageWidth: 360,
      srcsetWidths: [160, 240, 320, 360]
    });

    return `
      <a class="listings-row" href="${url}">
        ${imageMarkup}
        <div class="listings-row-body">
          <strong>${esc(profile.name || "İsimsiz")}</strong>
          <span>${esc(getProfileLocation(profile))}</span>
          <p>${esc(profile.card_label || profile.description || "Detayları inceleyin.")}</p>
        </div>
      </a>
    `;
  }).join("");
}

function renderRelatedProfileCards(profiles, emptyTitle = "Yakın bölgelerde başka profil görünmüyor.") {
  if (!(profiles || []).length) {
    return renderEmptyStatePanel(
      emptyTitle,
      "İstersen İstanbul sayfasına dönebilir, güncel ilanlara geçebilir veya kategori sayfasından farklı bir profile ulaşabilirsin.",
      [
        { href: "/ilanlar", title: "Güncel İlanlar" },
        { href: "/istanbul-escort", title: "İstanbul Escort" },
        { href: "/kategoriler", title: "Kategoriler" }
      ]
    );
  }

  return profiles.map((profile) => {
    const url = `/profil/${esc(getProfileSlug(profile))}`;
    const image = absoluteUrl(Array.isArray(profile.images) ? profile.images[0] : "");
    const imageMarkup = renderImageTag(image, profile.name || "Profil", {
      loading: "lazy",
      sizes: "(max-width: 720px) 46vw, (max-width: 1024px) 32vw, 18vw",
      imageWidth: 480,
      srcsetWidths: [240, 320, 420, 480]
    });

    return `
      <a class="detail-related-card" href="${url}">
        <div class="detail-related-cover">
          ${imageMarkup}
        </div>
        <div class="detail-related-body">
          <h3 class="detail-related-name">${esc(profile.name || "İsimsiz")}</h3>
          <div class="detail-related-meta">${esc(getProfileLocation(profile))}</div>
          <p class="detail-related-desc">${esc(profile.card_label || profile.description || "Benzer ilan detaylarını inceleyin.")}</p>
        </div>
      </a>
    `;
  }).join("");
}

module.exports = {
  renderBreadcrumbMarkup,
  renderChipLinks,
  renderFaqMarkup,
  renderInlineLinks,
  renderLandingProfileCards,
  renderMiniLandingRows,
  renderNearbyMarkup,
  renderProfileHubCards,
  renderProfileRows,
  renderRelatedProfileCards,
  renderSeoPanelMarkup,
  renderSummaryItems
};
