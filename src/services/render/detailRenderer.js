"use strict";

const crypto = require("crypto");

const { categoryRows, getNearbyDistricts } = require("../../data/publicMetadata");
const { getProfileArea, getProfileSlug, isGeneralArea } = require("../../utils/profile");
const {
  buildProfilePageDescription,
  buildProfilePageTitle,
  buildProfileSeoDefaults,
  trimReadable
} = require("../../utils/profileSeo");
const { filterProfilesForLanding, isVipProfile } = require("../landingContextService");
const {
  SITE_URL,
  absoluteUrl,
  activeProfiles,
  clean,
    esc,
    injectPublicShell,
    jsonLd,
    optimizedImageUrl,
    readSiteConfig,
    readView,
    replaceNodeInnerHtml,
  safeSlug,
  sortProfiles,
  upsertMetaName,
  upsertMetaProperty
} = require("./shared");
const { renderChipLinks, renderRelatedProfileCards } = require("./markup");

function profileTextHaystack(profile) {
  return [
    profile?.type,
    profile?.city,
    profile?.district,
    profile?.neighborhood,
    profile?.location,
    profile?.slug,
    profile?.name,
    profile?.card_label,
    profile?.description,
    Array.isArray(profile?.tags) ? profile.tags.join(" ") : profile?.tags
  ]
    .map((value) => safeSlug(clean(value)))
    .filter(Boolean)
    .join(" ");
}

function categoryMatches(profile, category) {
  if (!category || category.is_city_hub) return false;
  if (category.key === "vip") return isVipProfile(profile);

  const haystack = profileTextHaystack(profile);
  const needles = [
    category.key,
    String(category.slug || "").replace(/-escort$/i, ""),
    String(category.name || "").replace(/\s+escort$/i, ""),
    ...(Array.isArray(category.keywords) ? category.keywords : [])
  ]
    .map((value) => safeSlug(clean(value)))
    .filter(Boolean);

  return needles.some((needle) => haystack.includes(needle));
}

function buildCategoryLinks(profile) {
  return categoryRows()
    .filter((category) => categoryMatches(profile, category))
    .map((category) => ({
      href: `/${category.slug}`,
      title: category.name
    }))
    .slice(0, 4);
}

function validIsoDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) || date.getTime() <= 0
    ? ""
    : date.toISOString();
}

function cleanContactDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? digits : "";
}

function createLeadReference(profile) {
  const profileKey = [
    getProfileSlug(profile),
    profile?.id,
    profile?.name
  ].map((value) => clean(value)).filter(Boolean).join(":") || "profil";
  const profileHash = crypto.createHash("sha256").update(profileKey).digest("hex").slice(0, 9).toUpperCase();
  return `VG-WEB${profileHash}`;
}

function buildWhatsappHref(profile, config, reference) {
  const whatsapp = cleanContactDigits(profile?.whatsapp);
  if (!whatsapp) return "";

  const template = clean(
    config?.contactMessage
      || "Merhaba 👋 VIP GECE'de “{profile}” profilini gördüm. Uygunluk ve detayları öğrenebilir miyim?\n\n🔖 VIP GECE Referansı: {reference}"
  );
  const message = template.replace(/\{(profile|reference)\}/g, (_match, key) => (
    key === "profile" ? clean(profile?.name || "bu") : reference
  ));

  return `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`;
}

function injectWhatsappAction(html, profile, config) {
  const reference = createLeadReference(profile);
  const href = buildWhatsappHref(profile, config, reference);
  if (!href) return html;

  return String(html).replace(
    /<a id="whatsappBtn" class="detail-action hidden"([^>]*)>/i,
    `<a id="whatsappBtn" class="detail-action" href="${esc(href)}" data-lead-reference="${reference}" data-ssr-contact="true"$1>`
  );
}

function renderProfileDetailHtml(profile, profiles) {
  let html = readView("detay.html");
  const config = readSiteConfig();

  const name = profile.name || "Profil";
  const area = getProfileArea(profile);
  const generalArea = isGeneralArea(profile?.district) || safeSlug(area) === "istanbul-geneli";
  const areaPath = generalArea ? "/istanbul-escort" : `/${safeSlug(area)}-escort`;
  const schemaLocality = generalArea ? "İstanbul" : area;
  const slug = getProfileSlug(profile);
  const canonicalUrl = `${SITE_URL}/profil/${slug}`;
  const seoDefaults = buildProfileSeoDefaults(profile);
  const title = buildProfilePageTitle(profile);
  const description = buildProfilePageDescription(profile);
  const dateCreated = validIsoDate(profile.created_at);
  const dateModified = validIsoDate(profile.updated_at || profile.created_at);

  const images = Array.isArray(profile.images) ? profile.images : [];
  const mainImage = images[0] || `${SITE_URL}/logo.png.webp`;
  const schemaImage = absoluteUrl(optimizedImageUrl(mainImage, { width: 960, quality: 76, resize: "contain" }));
  const safeCanonicalUrl = esc(canonicalUrl);
  const safeMainImage = esc(schemaImage);
  const active = activeProfiles(profiles || []);
  const relatedProfiles = sortProfiles(
    active.filter((item) => getProfileSlug(item) !== slug && safeSlug(getProfileArea(item)) === safeSlug(area))
  ).slice(0, 4);
  const fallbackRelated = relatedProfiles.length
    ? relatedProfiles
    : sortProfiles(active.filter((item) => getProfileSlug(item) !== slug)).slice(0, 4);
  const nearbyLinks = getNearbyDistricts(area)
    .filter((district) => filterProfilesForLanding(district.slug, active).length > 0)
    .map((district) => ({
      href: `/${district.slug}`,
      title: `${district.name} Escort`
    }));
  const categoryLinks = buildCategoryLinks(profile);
  const hubLinks = [
    { href: "/ilanlar", title: "Güncel İlanlar" },
    { href: "/istanbul-escort", title: "İstanbul Escort" },
    { href: areaPath, title: `${area} Escort` }
  ];

  if (isVipProfile(profile)) {
    hubLinks.push({ href: "/vip-escort", title: "VIP Escort" });
  }

  categoryLinks.forEach((link) => {
    if (!hubLinks.some((item) => item.href === link.href)) {
      hubLinks.push(link);
    }
  });

  const breadcrumbJson = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Ana Sayfa",
        item: `${SITE_URL}/`
      },
      {
        "@type": "ListItem",
        position: 2,
        name: `${area} Escort`,
        item: `${SITE_URL}${areaPath}`
      },
      {
        "@type": "ListItem",
        position: 3,
        name,
        item: canonicalUrl
      }
    ]
  };

  const personJson = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${canonicalUrl}#person`,
    name,
    url: canonicalUrl,
    image: schemaImage,
    description,
    address: {
      "@type": "PostalAddress",
      addressLocality: schemaLocality,
      addressRegion: "İstanbul",
      addressCountry: "TR"
    }
  };

  const webPageJson = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    name: title,
    description,
    url: canonicalUrl,
    isPartOf: {
      "@type": "WebSite",
      name: "VIP Gece",
      url: `${SITE_URL}/`
    },
    primaryImageOfPage: {
      "@type": "ImageObject",
      url: schemaImage
    },
    mainEntity: {
      "@id": `${canonicalUrl}#person`
    },
    ...(dateCreated ? { dateCreated } : {}),
    ...(dateModified ? { dateModified } : {})
  };

  const imageJson = {
    "@context": "https://schema.org",
    "@type": "ImageObject",
    name: `${name} Profil Görseli`,
    url: schemaImage,
    contentUrl: schemaImage,
    caption: `${name} profil görseli`
  };

  html = html.replace(/<title>.*?<\/title>/i, `<title>${esc(title)}</title>`);
  html = upsertMetaName(html, "robots", "index, follow, max-image-preview:large");
  html = upsertMetaName(html, "description", description);
  html = upsertMetaProperty(html, "og:title", title);
  html = upsertMetaProperty(html, "og:description", description);
  html = upsertMetaProperty(html, "og:url", canonicalUrl);
  html = upsertMetaProperty(html, "og:image", schemaImage);
  html = upsertMetaName(html, "twitter:card", "summary_large_image");
  html = upsertMetaName(html, "twitter:title", title);
  html = upsertMetaName(html, "twitter:description", description);
  html = upsertMetaName(html, "twitter:image", schemaImage);
  html = html.replace(
    "</head>",
    `
    <link rel="canonical" href="${safeCanonicalUrl}">
    ${jsonLd(breadcrumbJson)}
    ${jsonLd(webPageJson)}
    ${jsonLd(personJson)}
    ${jsonLd(imageJson)}
  </head>`
  );
  html = html.replace(
    '<body data-page="profile-detail">',
    `<body data-page="profile-detail" data-server-rendered="true" data-profile-slug="${esc(slug)}">`
  );

  html = html.replace(
    /id="detailMainImage" class="detail-main-image" src="[^"]*" alt="[^"]*"/i,
    `id="detailMainImage" class="detail-main-image" src="${safeMainImage}" alt="${esc(`${name} profil görseli`)}" width="960" height="1200" loading="eager" decoding="async" fetchpriority="high"`
  );
  html = replaceNodeInnerHtml(html, "detailBreadcrumb", `<a href="/">Ana Sayfa</a><span>/</span><a href="/ilanlar">İlanlar</a><span>/</span><a href="${esc(areaPath)}">${esc(area)} Escort</a><span>/</span><span>${esc(name)}</span>`);
  html = replaceNodeInnerHtml(html, "detailBadge", esc(isVipProfile(profile) ? "VIP Profil" : "Profil"));
  html = replaceNodeInnerHtml(html, "detailName", esc(`${name} ${area} Escort`));
  html = replaceNodeInnerHtml(html, "detailDescription", esc(profile.description || profile.card_label || "Premium profil detaylarını inceleyin."));
  html = replaceNodeInnerHtml(html, "detailCity", esc(area));
  html = replaceNodeInnerHtml(html, "detailAge", esc(clean(profile.age || profile.yas || "-")));
  html = replaceNodeInnerHtml(html, "detailHeight", esc(clean(profile.height || profile.boy || "-")));
  html = replaceNodeInnerHtml(html, "detailWeight", esc(clean(profile.weight || profile.kilo || "-")));
  html = injectWhatsappAction(html, profile, config);
  html = replaceNodeInnerHtml(html, "relatedProfilesTitle", esc(`${area} Çevresinde Benzer Profiller`));
  html = replaceNodeInnerHtml(html, "relatedProfilesText", "Aynı ilçe veya yakın bölgelerdeki benzer profilleri hızlıca inceleyin.");
  html = replaceNodeInnerHtml(html, "detailHubTitle", "Hızlı Bağlantılar");
  html = replaceNodeInnerHtml(html, "detailHubText", "İlgili ilan, kategori ve profil sayfalarını hızlıca açın.");
  html = replaceNodeInnerHtml(html, "detailAssistTitle", "Benzer İlanlar ve Kategoriler");
  html = replaceNodeInnerHtml(html, "detailAssistText", `${esc(area)} çevresindeki benzer ilan ve kategori bağlantıları aynı panelde toplanır.`);
  html = replaceNodeInnerHtml(html, "detailQuickLinks", renderChipLinks(hubLinks));
  html = replaceNodeInnerHtml(
    html,
    "relatedProfilesGrid",
    renderRelatedProfileCards(
      fallbackRelated,
      config.emptyBoxText || "Yakın bölgelerde başka profil görünmüyor."
    )
  );
  html = replaceNodeInnerHtml(html, "detailHubLinks", renderChipLinks(hubLinks));
  html = replaceNodeInnerHtml(html, "detailNearbyLinks", renderChipLinks([...nearbyLinks, ...categoryLinks]));
  html = replaceNodeInnerHtml(html, "detailSeoPanel", `
    <h2>${esc(config.detailPageTitle || "Profil İlanı")}</h2>
    <p>${esc(name)} profil sayfası; görselleri, temel bilgileri ve iletişim seçeneklerini tek ekranda sunar. ${esc(area)} bölgesi, güncel ilanlar ve ${esc(categoryLinks.map((link) => link.title).join(", ") || "ilgili kategori sayfaları")} üzerinden benzer profillere devam edebilirsin.</p>
    <p>${esc(area)} bölgesi ve ilgili kategoriler, profilleri daha kolay karşılaştırmak için sayfa sonunda birlikte verilir. Yaş, boy, kilo, bölge ve görsel bilgileri karttan okunur; yakın bölge ve kategori bağlantılarıyla diğer güncel ilanlara geçilebilir.</p>
  `);

  if (images.length) {
    html = replaceNodeInnerHtml(
      html,
      "detailThumbs",
      images.map((src, index) => (
        `<button type="button" class="detail-thumb-button${index === 0 ? " active" : ""}" aria-label="${esc(`${name} görsel ${index + 1}`)}" aria-pressed="${index === 0 ? "true" : "false"}" data-index="${index}">
          <img class="detail-thumb" src="${esc(optimizedImageUrl(src, { width: 240, quality: 68, resize: "contain" }))}" alt="${esc(`${name} ${index + 1}`)}" width="240" height="300" loading="${index === 0 ? "eager" : "lazy"}" decoding="async">
        </button>`
      )).join("")
    );
  }

  return injectPublicShell(html, "profiles");
}

module.exports = {
  renderProfileDetailHtml
};
