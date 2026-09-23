"use strict";

const { readFileSync } = require("node:fs");
const path = require("node:path");

const { publicProfileCard } = require("../../routes/publicApiRoutes");
const { getProfileLocation, getProfileSlug, isGeneralArea } = require("../../utils/profile");
const { categoryRows, districtRows } = require("../../data/publicMetadata");
const {
  exactLocalProfilesForLanding,
  filterProfilesForLanding,
  profilesSupportingLanding
} = require("../landingContextService");
const { buildMetaKeywords } = require("../../utils/seoLanguage");
const {
  absoluteUrl,
  clean,
  injectPublicShell,
  readSiteConfig,
  readView,
  optimizedImageSrcset,
  optimizedImageUrl,
  replaceHeadValue,
  replaceNodeInnerHtml,
  safeSlug,
  sortProfiles,
  esc
} = require("./shared");
const { buildHomeStructuredData } = require("./structuredData");

// GSC-proven near-page-one / high-click landings first, then major districts.
const DISTRICT_CHIP_GROUPS = [
  { key: "all", title: "Tüm İstanbul", districts: ["Tümü"] },
  {
    key: "hot",
    title: "Öne Çıkan Bölgeler",
    districts: ["Laleli", "Kavacık", "Madenler", "Cihangir", "Esenyurt", "Sultangazi", "Hadımköy", "Çakmak"]
  },
  {
    key: "europe",
    title: "Avrupa Yakası",
    districts: ["Şişli", "Beşiktaş", "Beyoğlu", "Fatih", "Bakırköy", "Avcılar", "Esenyurt"]
  },
  {
    key: "asia",
    title: "Anadolu Yakası",
    districts: ["Kadıköy", "Ataşehir", "Üsküdar", "Kavacık", "Madenler", "Pendik"]
  }
];

const REGION_CARDS = ["Laleli", "Kavacık", "Esenyurt", "Sultangazi", "Şişli", "Kadıköy"];

const CATEGORY_SHORTCUTS = [
  { key: "vip", title: "VIP Escort", href: "/vip-escort", icon: "ri-vip-crown-2-line" },
  { key: "anal", title: "Anal Escort", href: "/anal-escort", icon: "ri-heart-3-line" },
  { key: "otel", title: "Otel Escort", href: "/otel-escort", icon: "ri-hotel-bed-line" },
  { key: "yabanci", title: "Yabancı Escort", href: "/yabanci-escort", icon: "ri-global-line" },
  { key: "turbanli", title: "Türbanlı Escort", href: "/turbanli-escort", icon: "ri-map-pin-user-line" },
  { key: "gfe", title: "GFE Escort", href: "/gfe-escort", icon: "ri-emotion-line" },
  { key: "esmer", title: "Esmer Escort", href: "/esmer-escort", icon: "ri-user-star-line" },
  { key: "sarisin", title: "Sarışın Escort", href: "/sarisin-escort", icon: "ri-sparkling-line" },
  { key: "genc", title: "Genç Escort", href: "/genc-escort", icon: "ri-user-heart-line" },
  { key: "all", title: "Tüm Kategoriler", href: "/kategoriler", icon: "ri-apps-2-line" }
];

const CATEGORY_CARDS = [
  { key: "vip", title: "Vip Escort", href: "/vip-escort", icon: "ri-vip-crown-2-line" },
  { key: "anal", title: "Anal Escort", href: "/anal-escort", icon: "ri-heart-3-line" },
  { key: "otel", title: "Otel Escort", href: "/otel-escort", icon: "ri-hotel-bed-line" },
  { key: "yabanci", title: "Yabancı Escort", href: "/yabanci-escort", icon: "ri-global-line" },
  { key: "esmer", title: "Esmer Escort", href: "/esmer-escort", icon: "ri-user-star-line" },
  { key: "sarisin", title: "Sarışın Escort", href: "/sarisin-escort", icon: "ri-sparkling-line" },
  { key: "all", title: "Tüm Kategoriler", href: "/kategoriler", icon: "ri-apps-2-line", isAll: true }
];

const HERO_HIGHLIGHTS = [
  { title: "Güncel İlanlar", subtitle: "Her gün yenilenir", icon: "ri-calendar-check-line" },
  { title: "Güvenli İletişim", subtitle: "Hızlı ve kolay", icon: "ri-shield-check-line" },
  { title: "Seçkin Profiller", subtitle: "Kaliteyi keşfet", icon: "ri-camera-lens-line" }
];

const HOME_RENDER_CSS = readView("public/css/home-render.min.css").trim();
const HOME_BRAND_AVIF_DATA_URI = `data:image/avif;base64,${readFileSync(
  path.join(__dirname, "../../../public/assets/vip-gece-brand-banner-20260726-720.avif")
).toString("base64")}`;

const HOME_RENDER_BLOCKING_LINKS = Object.freeze([
  /<link\b[^>]*href=["']\/style\.css(?:\?[^"']*)?["'][^>]*>/gi,
  /<link\b[^>]*href=["']\/public\/css\/icons\.css(?:\?[^"']*)?["'][^>]*>/gi,
  /<link\b[^>]*href=["']\/public\/css\/components\.css(?:\?[^"']*)?["'][^>]*>/gi,
  /<link\b[^>]*href=["']\/public\/css\/home-redesign\.css(?:\?[^"']*)?["'][^>]*>/gi
]);

// Keep the discovery strip visually continuous without duplicating every
// public profile above the fold. The complete 27-profile inventory remains in
// the selected grid and in structured data.
const HOME_STORY_PROFILE_LIMIT = 5;
const HOME_DEFERRED_SELECTED_CARD_START = 10;

function optimizeServerRenderedHome(html) {
  let output = String(html || "");
  for (const pattern of HOME_RENDER_BLOCKING_LINKS) {
    output = output.replace(pattern, "");
  }

  output = output.replace(
    /<script\b(?=[^>]*type=["']module["'])(?=[^>]*src=["']\/public\/js\/home-render\.js(?:\?[^"']*)?["'])[^>]*><\/script>\s*/gi,
    ""
  );

  output = output.replace(
    /<link\b(?=[^>]*rel=["']preload["'])(?=[^>]*href=["']\/public\/assets\/vip-gece-brand-banner-20260726-720\.avif["'])[^>]*>\s*/i,
    ""
  );

  output = output.replace(
    /<source\b(?=[^>]*type=["']image\/avif["'])(?=[^>]*srcset=["']\/public\/assets\/vip-gece-brand-banner-20260726-720\.avif 720w["'])[^>]*>/i,
    `<source type="image/avif" srcset="${HOME_BRAND_AVIF_DATA_URI}" sizes="(max-width: 720px) calc(100vw - 50px), 634px" width="720" height="226">`
  );

  return output.replace(
    "</head>",
    `<style data-home-critical-css>\n${HOME_RENDER_CSS}\n</style>\n</head>`
  );
}

function homeProfileLinkAttributes(label = "Profili yeni sekmede aç") {
  const safeLabel = esc(label);
  return `target="_blank" rel="noopener noreferrer" title="${safeLabel}"`;
}

function districtHref(name) {
  if (name === "Tümü") return "/istanbul-escort";
  return `/${safeSlug(name)}-escort`;
}

function exactProfilesForLanding(slug, profiles) {
  return exactLocalProfilesForLanding(slug, profiles);
}

/** Hybrid inventory: citywide geneli also opens district/semt landings. */
function landingHasInventory(slug, profiles) {
  if (!slug) return false;
  return profilesSupportingLanding(slug, profiles).length > 0;
}

const PROFILE_IMAGE_FOCUS = {
  "istanbul-meli-s-2": { story: "50% 38%", featured: "54% 42%", selected: "54% 42%", hero: "58% 36%", category: "54% 42%", mini: "50% 42%", directory: "50% 46%" },
  "istanbul-cansu-3": { story: "48% 38%", featured: "48% 40%", selected: "48% 40%", category: "48% 40%", mini: "48% 42%", directory: "48% 40%" },
  "istanbul-deni-z-4": { story: "50% 40%", featured: "50% 38%", selected: "50% 38%", category: "50% 38%", mini: "50% 40%", directory: "50% 38%" },
  "istanbul-aleyna-5": { story: "58% 36%", featured: "50% 38%", selected: "50% 38%", category: "50% 38%", mini: "56% 38%", directory: "50% 38%" },
  "istanbul-i-rem-7": { story: "50% 34%", featured: "50% 34%", selected: "50% 34%", category: "50% 34%", mini: "50% 34%", directory: "50% 34%" },
  "istanbul-meli-ke-6": { story: "54% 34%", featured: "54% 38%", selected: "54% 38%", category: "54% 38%", mini: "54% 36%", directory: "54% 38%" },
  "istanbul-gi-zem-8": { story: "50% 36%", featured: "50% 40%", selected: "50% 40%", category: "50% 40%", mini: "50% 38%", directory: "50% 40%" },
  "istanbul-merve-9": { story: "50% 34%", featured: "50% 38%", selected: "50% 38%", category: "50% 38%", mini: "50% 36%", directory: "50% 38%" },
  "bade-nur": { story: "50% 36%", featured: "50% 38%", selected: "50% 38%", category: "50% 38%", mini: "50% 38%", directory: "50% 38%" },
  "tatyana": { story: "54% 36%", featured: "52% 38%", selected: "52% 38%", category: "52% 38%", mini: "54% 38%", directory: "52% 38%" },
  "istanbul-burcu-1779240144181": { story: "50% 58%", featured: "50% 46%", selected: "50% 46%", category: "50% 46%", mini: "50% 54%", directory: "50% 46%" },
  "istanbul-ela-1779241002723": { story: "50% 46%", featured: "50% 44%", selected: "50% 44%", category: "50% 44%", mini: "50% 46%", directory: "50% 44%" }
};

const PROFILE_IMAGE_SURFACE_INDEX = {
  "istanbul-meli-s-2": { story: 1, featured: 3, selected: 3, hero: 3, category: 3, mini: 1, directory: 1 },
  "istanbul-cansu-3": { story: 2, featured: 2, selected: 2, category: 2, mini: 2, directory: 2 },
  "istanbul-deni-z-4": { story: 1, featured: 1, selected: 1, category: 1, mini: 1, directory: 1 },
  "istanbul-aleyna-5": { story: 2, featured: 2, selected: 2, category: 2, mini: 2, directory: 2 },
  "istanbul-i-rem-7": { story: 0, featured: 0, selected: 0, category: 0, mini: 0, directory: 0 },
  "istanbul-meli-ke-6": { story: 0, featured: 0, selected: 0, category: 0, mini: 0, directory: 0 },
  "istanbul-gi-zem-8": { story: 0, featured: 2, selected: 2, category: 2, mini: 0, directory: 2 },
  "istanbul-merve-9": { story: 2, featured: 2, selected: 2, category: 2, mini: 2, directory: 2 },
  "bade-nur": { story: 1, featured: 1, selected: 1, category: 1, mini: 1, directory: 1 },
  "tatyana": { story: 2, featured: 2, selected: 2, category: 2, mini: 2, directory: 2 },
  "istanbul-burcu-1779240144181": { story: 0, featured: 0, selected: 0, category: 0, mini: 0, directory: 0 },
  "istanbul-ela-1779241002723": { story: 0, featured: 0, selected: 0, category: 0, mini: 0, directory: 0 }
};

function getProfileImageForSurface(profile, surface = "default") {
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

function getProfileImageFocus(profile, surface, fallback = "50% 40%") {
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

function getInitial(value, fallback = "V") {
  return clean(value || fallback).charAt(0).toUpperCase() || fallback;
}

function getProfileArea(profile) {
  return getProfileLocation(profile);
}

function createImageMarkup(image, alt, fallbackClass, fallbackText, options = {}) {
  if (clean(image)) {
    const imageWidth = Number(options.imageWidth || 720);
    const imageHeight = Number(options.imageHeight || Math.round(imageWidth * 1.25));
    const imageQuality = Number(options.imageQuality || 72);
    const absoluteImage = absoluteUrl(image);
    const srcset = optimizedImageSrcset(absoluteImage, options.srcsetWidths || [240, 360, 480, 640, 720], {
      quality: imageQuality,
      resize: options.resize || "cover"
    });
    const attributes = [
      `src="${esc(optimizedImageUrl(absoluteImage, {
        width: Number.isFinite(imageWidth) ? imageWidth : 720,
        quality: imageQuality,
        resize: options.resize || "cover"
      }))}"`,
      `alt="${esc(alt)}"`,
      `width="${esc(String(Number.isFinite(imageWidth) ? Math.round(imageWidth) : 720))}"`,
      `height="${esc(String(Number.isFinite(imageHeight) ? Math.round(imageHeight) : 900))}"`,
      `loading="${esc(options.loading || "lazy")}"`,
      `decoding="async"`
    ];

    if (clean(options.className)) {
      attributes.push(`class="${esc(options.className)}"`);
    }

    if (clean(options.fetchPriority)) {
      attributes.push(`fetchpriority="${esc(options.fetchPriority)}"`);
    }

    if (clean(options.sizes)) {
      attributes.push(`sizes="${esc(options.sizes)}"`);
    }

    if (srcset) {
      attributes.push(`srcset="${esc(srcset)}"`);
    }

    return `<img ${attributes.join(" ")}>`;
  }

  return `<div class="${fallbackClass}">${esc(fallbackText)}</div>`;
}

function getCategoryCount(item, profiles) {
  if (item?.key === "all") {
    return categoryRows().filter(
      (category) => category.is_city_hub || filterProfilesForLanding(category.slug, profiles).length > 0
    ).length;
  }
  return filterProfilesForLanding(String(item?.href || "").replace(/^\//, ""), profiles).length;
}

function renderHeroHighlightsMarkup() {
  return HERO_HIGHLIGHTS.map((item) => `
    <div class="hero-highlight">
      <span class="hero-highlight-icon"><i class="${esc(item.icon)}" aria-hidden="true"></i></span>
      <div>
        <strong>${esc(item.title)}</strong>
        <small>${esc(item.subtitle)}</small>
      </div>
    </div>
  `).join("");
}

function renderHeroVisualMarkup(profile) {
  const renderBrandFallback = (currentProfile) => {
    const name = clean(currentProfile?.name || "VIP GECE");
    const area = getProfileArea(currentProfile);
    return `
      <div class="hero-brand-fallback">
        <div class="hero-brand-plate">
          <img class="hero-brand-logo" src="${esc(absoluteUrl("/logo.png.webp"))}" alt="VIP GECE marka görseli" width="900" height="650" loading="lazy" decoding="async">
          <div class="hero-brand-caption">
            <span>Öne çıkan profil</span>
            <strong>${esc(name)}</strong>
            ${area ? `<small>${esc(area)}</small>` : ""}
          </div>
        </div>
      </div>
    `;
  };

  if (!profile) {
    return renderBrandFallback(null);
  }

  const image = getProfileImageForSurface(profile, "hero");
  if (image) {
    return `
      <div class="hero-portrait">
        ${createImageMarkup(image, profile.name || "VIP GECE", "hero-portrait-fallback", "V", {
          className: "hero-portrait-image",
          loading: "lazy",
          sizes: "(max-width: 1024px) 100vw, 36vw",
          imageWidth: 640,
          srcsetWidths: [360, 480, 640]
        })}
      </div>
    `;
  }

  return renderBrandFallback(profile);
}

function renderCategoryShortcutsMarkup(profiles) {
  return CATEGORY_SHORTCUTS
    .filter((item) => item.key === "all" || getCategoryCount(item, profiles) > 0)
    .map((item) => `
    <a class="shortcut-tile" href="${esc(item.href)}">
      <span class="shortcut-icon"><i class="${esc(item.icon)}" aria-hidden="true"></i></span>
      <span class="shortcut-title">${esc(item.title)}</span>
    </a>
  `).join("");
}

function renderDistrictChipMarkup(district, isActive = false) {
  return `
    <a class="district-chip${isActive ? " is-active" : ""}" href="${esc(districtHref(district))}">
      <i class="ri-map-pin-line" aria-hidden="true"></i>
      <span>${esc(district)}</span>
    </a>
  `;
}

function renderDistrictChipsMarkup(profiles) {
  const seen = new Set();
  return DISTRICT_CHIP_GROUPS.map((group) => {
    const chips = group.districts
      .filter((district) => {
        if (district === "Tümü") return true;
        const slug = districtHref(district).slice(1);
        if (seen.has(slug)) return false;
        if (!landingHasInventory(slug, profiles)) return false;
        seen.add(slug);
        return true;
      })
      .map((district) => renderDistrictChipMarkup(district, district === "Tümü"))
      .join("");

    if (group.key === "all") return chips;
    if (!chips) return "";

    return `
      <div class="district-chip-group" aria-label="${esc(group.title)} ilçeleri">
        <span class="district-chip-group-label">${esc(group.title)}</span>
        ${chips}
      </div>
    `;
  }).join("");
}

function renderLatestProfilesMarkup(profiles) {
  if (!(profiles || []).length) {
    return "";
  }

  const storyItems = profiles;
  const renderStoryItem = (profile, index = 0) => {
    const image = getProfileImageForSurface(profile, "story");
    const label = `${profile.name || "Profil"} profilini yeni sekmede aç`;
    return `
      <a class="home-story-item" href="${esc(`/profil/${getProfileSlug(profile)}`)}" ${homeProfileLinkAttributes(label)}${profileFocusStyle(profile, {
        "profile-story-position": { surface: "story", fallback: "50% 42%" }
      })}>
          <span class="home-story-ring">
          <span class="home-story-visual">
            ${createImageMarkup(image, profile.name || "Profil", "story-fallback", getInitial(profile.name), {
              imageWidth: 320,
              loading: index === 0 ? "eager" : "lazy",
              fetchPriority: "low",
              sizes: "(max-width: 720px) 18vw, (max-width: 1024px) 14vw, 10vw",
              srcsetWidths: [160, 220, 280, 320],
              resize: "contain"
            })}
          </span>
        </span>
        <span class="home-story-name">${esc(profile.name || "Profil")}</span>
      </a>
    `;
  };

  const items = storyItems.map((profile, index) => renderStoryItem(profile, index)).join("");

  return `<div class="latest-marquee-track">${items}</div>`;
}

function renderSelectedProfilesMarkup(profiles) {
  return (profiles || []).slice(0, 50).map((profile, index) => {
    const image = getProfileImageForSurface(profile, "selected");
    const area = getProfileArea(profile);
    const age = clean(profile.age || profile.yas);
    return `
      <a class="selected-card"${index >= HOME_DEFERRED_SELECTED_CARD_START ? ' data-home-deferred-card="true"' : ""} href="${esc(`/profil/${getProfileSlug(profile)}`)}" ${homeProfileLinkAttributes(`${profile.name || "Profil"} profilini yeni sekmede aç`)}${profileFocusStyle(profile, {
        "profile-selected-position": { surface: "selected", fallback: "50% 40%" }
      })}>
        <div class="selected-image-wrap">
          ${createImageMarkup(image, profile.name || "Profil", "story-fallback", getInitial(profile.name), {
            imageWidth: 420,
            loading: "lazy",
            fetchPriority: "low",
            sizes: "(max-width: 1024px) 20vw, 16vw",
            srcsetWidths: [160, 240, 320, 420],
            resize: "contain"
          })}
        </div>
        <div class="selected-card-content">
          <span class="selected-badge">${index < 6 ? "Yeni" : "Profil"}</span>
          <div>
            <h2 class="selected-name">${esc(profile.name || "Profil")}</h2>
            <span class="selected-location">${esc(area)}</span>
          </div>
          <div class="selected-meta">
            ${age ? `<span class="selected-age">${esc(age)} yaş</span>` : "<span class=\"selected-age\">Güncel profil</span>"}
          </div>
        </div>
      </a>
    `;
  }).join("");
}

function renderRegionCardsMarkup(profiles) {
  const activeDistrictCount = districtRows().filter(
    (district) => landingHasInventory(district.slug, profiles)
  ).length;
  const districtCards = REGION_CARDS
    .map((district) => ({
      district,
      slug: districtHref(district).slice(1),
      rankedProfiles: filterProfilesForLanding(districtHref(district).slice(1), profiles)
    }))
    .filter((item) => landingHasInventory(item.slug, profiles))
    .slice(0, 4)
    .map(({ district, rankedProfiles }) => {
    const sample = rankedProfiles[0];
    const image = sample ? getProfileImageForSurface(sample, "directory") : "";
    return `
      <a class="directory-card" href="${esc(districtHref(district))}"${sample ? profileFocusStyle(sample, {
        "profile-directory-position": { surface: "directory", fallback: "50% 40%" }
      }) : ""}>
        <div class="directory-card-thumb">
          ${createImageMarkup(image, district, "story-fallback", getInitial(district), {
            imageWidth: 320,
            sizes: "(max-width: 720px) 78vw, (max-width: 1024px) 50vw, 24vw",
            srcsetWidths: [180, 240, 320],
            resize: "contain"
          })}
        </div>
        <div class="directory-card-content">
        <h3 class="directory-title">${esc(district)}</h3>
        <div class="directory-meta">
            <span>${esc(String(rankedProfiles.length))} profil</span>
        </div>
      </div>
    </a>
    `;
    }).join("");

  return `
    ${districtCards}
    <a class="directory-card all-card" href="/istanbul-escort">
      <div class="directory-all-inner">
        <i class="ri-apps-2-line" aria-hidden="true"></i>
        <strong>Tüm Bölgeler</strong>
        <span class="directory-meta">${esc(String(activeDistrictCount))} aktif ilçe</span>
      </div>
    </a>
  `;
}

function renderCategoryCardsMarkup(profiles) {
  return CATEGORY_CARDS
    .filter((item) => item.isAll || getCategoryCount(item, profiles) > 0)
    .map((item) => {
    const count = getCategoryCount(item, profiles);
    if (item.isAll) {
      return `
        <a class="category-directory-card all-card" href="${esc(item.href)}">
          <div class="category-all-inner">
            <i class="${esc(item.icon)}" aria-hidden="true"></i>
            <strong>${esc(item.title)}</strong>
            <span class="category-stat">Tüm kategoriler</span>
          </div>
        </a>
      `;
    }

    return `
      <a class="category-directory-card" href="${esc(item.href)}">
        <span class="category-icon"><i class="${esc(item.icon)}" aria-hidden="true"></i></span>
        <div>
          <h3 class="category-directory-title">${esc(item.title)}</h3>
          <p class="category-subtitle">${esc(String(count))} ilan</p>
        </div>
      </a>
    `;
  }).join("");
}

function buildHomePublicProfiles(profiles) {
  return sortProfiles(
    (profiles || [])
      .filter((profile) => profile && profile.is_active !== false)
      .map((profile) => publicProfileCard(profile, getProfileSlug))
      .filter((profile) => profile && profile.is_active !== false)
  );
}

function selectHomepageProfiles(profiles) {
  return (profiles || [])
    .filter((profile) => {
      const slot = Number(profile?.vip_slot ?? profile?.normal_slot);
      return Number.isInteger(slot) && slot >= 1 && slot <= 50;
    })
    .slice(0, 50);
}

function newestProfiles(profiles) {
  return [...(profiles || [])].sort((left, right) => {
    const leftTime = Date.parse(left?.created_at || "") || 0;
    const rightTime = Date.parse(right?.created_at || "") || 0;
    return rightTime - leftTime;
  });
}

function renderHomeHtml(profiles) {
  let html = readView("index.html");
  const config = readSiteConfig();
  const sorted = buildHomePublicProfiles(profiles);
  const selectedProfiles = selectHomepageProfiles(sorted);
  const latestProfiles = newestProfiles(sorted).slice(0, HOME_STORY_PROFILE_LIMIT);
  const districts = districtRows().filter(
    (district) => landingHasInventory(district.slug, sorted)
  );
  const vipProfiles = selectedProfiles
    .filter((profile) => profile.type === "vip" || profile.is_featured === true)
    .slice(0, 8);
  const primaryProfiles = vipProfiles.length ? vipProfiles : selectedProfiles;

  const title = clean(config.homeTitle || config.siteName || "VIP GECE");
  const description = clean(
    config.homeDescription ||
    "İstanbul VIP escort profilleri, güncel ilanlar, doğrulanmış bölge erişimi ve kategori bağlantıları."
  );
  const keywords = buildMetaKeywords({
    area: "İstanbul",
    categoryName: "Escort İlan Sitesi",
    extra: [
      "VIP GECE",
      ...districts.slice(0, 12).map((district) => `${district.name} Escort`),
      ...CATEGORY_SHORTCUTS.slice(0, 8).map((category) => category.title)
    ]
  });
  const robots = "index, follow, max-image-preview:large";
  const verificationCode = clean(config.googleVerificationCode);
  const canonicalUrl = `${require("./shared").SITE_URL}/`;
  const heroProfile = primaryProfiles[0] || null;
  const heroImage = (heroProfile && Array.isArray(heroProfile.images) && heroProfile.images[0]) || "/logo.png.webp";
  const imageUrl = absoluteUrl(optimizedImageUrl(heroImage, {
    width: 1200,
    quality: 80,
    resize: "cover"
  }));

  html = replaceHeadValue(html, /<title>.*?<\/title>/i, `<title>${esc(title)}</title>`);
  html = replaceHeadValue(html, /<meta name="description" content="[^"]*">/i, `<meta name="description" content="${esc(description)}">`);
  html = replaceHeadValue(html, /<meta name="keywords" content="[^"]*">/i, `<meta name="keywords" content="${esc(keywords)}">`);
  html = replaceHeadValue(html, /<meta name="robots" content="[^"]*">/i, `<meta name="robots" content="${esc(robots)}">`);
  html = replaceHeadValue(html, /<link rel="canonical" href="[^"]*">/i, `<link rel="canonical" href="${esc(canonicalUrl)}">`);
  html = replaceHeadValue(html, /<meta property="og:title" content="[^"]*">/i, `<meta property="og:title" content="${esc(title)}">`);
  html = replaceHeadValue(html, /<meta property="og:description" content="[^"]*">/i, `<meta property="og:description" content="${esc(description)}">`);
  html = replaceHeadValue(html, /<meta property="og:url" content="[^"]*">/i, `<meta property="og:url" content="${esc(canonicalUrl)}">`);
  html = replaceHeadValue(html, /<meta property="og:image" content="[^"]*">/i, `<meta property="og:image" content="${esc(imageUrl)}">`);
  html = replaceHeadValue(html, /<meta name="twitter:title" content="[^"]*">/i, `<meta name="twitter:title" content="${esc(title)}">`);
  html = replaceHeadValue(html, /<meta name="twitter:description" content="[^"]*">/i, `<meta name="twitter:description" content="${esc(description)}">`);
  html = replaceHeadValue(html, /<meta name="twitter:image" content="[^"]*">/i, `<meta name="twitter:image" content="${esc(imageUrl)}">`);

  if (verificationCode && !verificationCode.includes("BURAYI")) {
    html = html.replace(
      "</head>",
      `\n<meta name="google-site-verification" content="${esc(verificationCode)}">\n</head>`
    );
  }

  html = html.replace(
    "</head>",
    `\n${buildHomeStructuredData(config, title, description, selectedProfiles, districts, imageUrl)}\n</head>`
  );

  html = replaceNodeInnerHtml(html, "siteTitle", esc(config.siteName || "VIP GECE"));
  html = replaceNodeInnerHtml(
    html,
    "siteSlogan",
    esc(config.siteSlogan || "Güncel ilanlar arasından seçim yap; görselleri ve iletişim seçeneklerini profil sayfasında incele.")
  );
  html = replaceNodeInnerHtml(html, "normalTitle", esc(config.normalTitle || "VIP Profiller"));
  html = replaceNodeInnerHtml(html, "heroHighlights", renderHeroHighlightsMarkup());
  html = replaceNodeInnerHtml(html, "heroVisual", renderHeroVisualMarkup(heroProfile));
  html = replaceNodeInnerHtml(html, "categoryShortcutGrid", renderCategoryShortcutsMarkup(sorted));
  html = replaceNodeInnerHtml(html, "districtChips", renderDistrictChipsMarkup(sorted));
  html = replaceNodeInnerHtml(html, "latestProfiles", renderLatestProfilesMarkup(latestProfiles));
  html = replaceNodeInnerHtml(html, "normalProfiles", renderSelectedProfilesMarkup(selectedProfiles));

  html = html.replace('<body data-page="home">', '<body data-page="home" data-server-rendered="true">');

  return optimizeServerRenderedHome(injectPublicShell(html, "home"));
}

module.exports = {
  renderHomeHtml
};
