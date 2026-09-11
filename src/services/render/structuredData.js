"use strict";

const { HOME_CATEGORY_LINKS, SITE_ICON_PATH, SITE_URL, absoluteUrl, clean, esc, jsonLd } = require("./shared");

function buildOrganizationJson(siteName = "VIP GECE") {
  const logoUrl = absoluteUrl(SITE_ICON_PATH);

  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: clean(siteName || "VIP GECE"),
    url: `${SITE_URL}/`,
    logo: {
      "@type": "ImageObject",
      url: logoUrl,
      width: 512,
      height: 512
    },
    image: logoUrl
  };
}

function buildWebSiteJson(siteName = "VIP GECE", canonicalUrl = `${SITE_URL}/`) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: clean(siteName || "VIP GECE"),
    url: canonicalUrl,
    inLanguage: "tr-TR",
    publisher: {
      "@id": `${SITE_URL}/#organization`
    }
  };
}

function buildCollectionPageJson({ title, description, canonicalUrl, imageUrl, siteName = "VIP Gece" }) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    description,
    url: canonicalUrl,
    inLanguage: "tr-TR",
    publisher: {
      "@id": `${SITE_URL}/#organization`
    },
    isPartOf: {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: siteName,
      url: `${SITE_URL}/`
    },
    primaryImageOfPage: {
      "@type": "ImageObject",
      url: imageUrl
    }
  };
}

function buildLandingStructuredData(context, imageUrl) {
  const canonicalUrl = `${SITE_URL}/${context.slug}`;
  const collectionPageJson = {
    ...buildCollectionPageJson({
      title: context.pageTitle,
      description: context.metaDescription,
      canonicalUrl,
      imageUrl,
      siteName: "VIP Gece"
    }),
    ...(context.type === "district" && context.place
      ? {
        spatialCoverage: {
          "@type": "Place",
          name: context.place.name,
          address: {
            "@type": "PostalAddress",
            addressLocality: context.place.addressLocality,
            addressRegion: context.place.addressRegion,
            addressCountry: context.place.addressCountry
          },
          containedInPlace: {
            "@type": "City",
            name: "İstanbul"
          }
        }
      }
      : {})
  };

  const breadcrumbJson = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: (context.breadcrumbItems || []).map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${SITE_URL}${item.url}`
    }))
  };

  const faqItems = Array.isArray(context.faqItems)
    ? context.faqItems.filter((item) => item?.question && item?.answer)
    : [];
  const faqJson = faqItems.length
    ? {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqItems.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer
        }
      }))
    }
    : null;

  return [
    jsonLd(buildOrganizationJson("VIP Gece")),
    jsonLd(buildWebSiteJson("VIP Gece")),
    jsonLd(collectionPageJson),
    jsonLd(breadcrumbJson),
    faqJson ? jsonLd(faqJson) : ""
  ].join("\n");
}

function buildFaqJson(faqItems) {
  const rows = (faqItems || []).filter((item) => item?.question && item?.answer);
  if (!rows.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: rows.map((item) => ({
      "@type": "Question",
      name: clean(item.question),
      acceptedAnswer: {
        "@type": "Answer",
        text: clean(item.answer)
      }
    }))
  };
}

function buildListingsHubStructuredData(title, description, _profiles, imageUrl, faqItems = []) {
  const canonicalUrl = `${SITE_URL}/ilanlar`;
  const collectionPageJson = buildCollectionPageJson({
    title,
    description,
    canonicalUrl,
    imageUrl,
    siteName: "VIP Gece"
  });
  const faqJson = buildFaqJson(faqItems);

  return [
    jsonLd(buildOrganizationJson("VIP Gece")),
    jsonLd(buildWebSiteJson("VIP Gece")),
    jsonLd(collectionPageJson),
    jsonLd({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "İlanlar", item: canonicalUrl }
      ]
    }),
    faqJson ? jsonLd(faqJson) : ""
  ].join("\n");
}

function buildCategoriesHubStructuredData(title, description, _categories, imageUrl, faqItems = []) {
  const canonicalUrl = `${SITE_URL}/kategoriler`;
  const collectionPageJson = buildCollectionPageJson({
    title,
    description,
    canonicalUrl,
    imageUrl,
    siteName: "VIP Gece"
  });
  const faqJson = buildFaqJson(faqItems);

  return [
    jsonLd(buildOrganizationJson("VIP Gece")),
    jsonLd(buildWebSiteJson("VIP Gece")),
    jsonLd(collectionPageJson),
    jsonLd({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "Kategoriler", item: canonicalUrl }
      ]
    }),
    faqJson ? jsonLd(faqJson) : ""
  ].join("\n");
}

function buildContactStructuredData(title, description, faqItems = [], imageUrl = "") {
  const canonicalUrl = `${SITE_URL}/iletisim`;
  const faqJson = buildFaqJson(faqItems);
  const webPageJson = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: clean(title),
    description: clean(description),
    url: canonicalUrl,
    inLanguage: "tr-TR",
    isPartOf: {
      "@type": "WebSite",
      name: "VIP GECE",
      url: `${SITE_URL}/`
    },
    ...(imageUrl ? { primaryImageOfPage: { "@type": "ImageObject", url: imageUrl } } : {})
  };

  return [
    jsonLd(buildOrganizationJson("VIP Gece")),
    jsonLd(buildWebSiteJson("VIP Gece")),
    jsonLd(webPageJson),
    jsonLd({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "İletişim", item: canonicalUrl }
      ]
    }),
    faqJson ? jsonLd(faqJson) : ""
  ].join("\n");
}

function buildHomeSeoText(config, districts) {
  const provided = clean(config.homeKeywordsText);
  if (provided) return provided;

  return `VIP Gece ana sayfası, İstanbul escort ve ${districts.length} ilçe escort aramaları için son eklenenler, seçili profil listesi, hızlı bölge erişimi ve kategori bağlantıları sunan mobil uyumlu bir ilan platformudur. Ziyaretçi önce güncel profil akışını görür, ardından ilçe veya kategori seçerek aramasını daha net bir listeye indirir.`;
}

function normalizeKeyword(value) {
  return clean(value)
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .replace(/Ç/g, "ç")
    .replace(/Ğ/g, "ğ")
    .replace(/Ö/g, "ö")
    .replace(/Ş/g, "ş")
    .replace(/Ü/g, "ü")
    .toLowerCase();
}

function buildHomeKeywords(districts) {
  const keywords = [
    "vip gece",
    "istanbul escort",
    "vip escort",
    "istanbul vip escort",
    "güncel escort ilanları",
    "istanbul escort profilleri",
    ...HOME_CATEGORY_LINKS.slice(1, 8).map((item) => normalizeKeyword(item.title)),
    ...districts.map((district) => `${normalizeKeyword(district.name)} escort`)
  ];

  return [...new Set(keywords)].join(", ");
}

function buildHomeInternalLinks(districts, categoryLinks = HOME_CATEGORY_LINKS) {
  const groups = [
    {
      title: "Merkez İlanlar",
      links: [
        { href: "/istanbul-escort", title: "İstanbul Escort" },
        { href: "/ilanlar", title: "Profiller" },
        { href: "/kategoriler", title: "Tüm Kategoriler" },
        { href: "/vip-escort", title: "VIP Escort" }
      ]
    },
    {
      title: "Kategori Erişimi",
      links: categoryLinks.filter((item) => item.href !== "/kategoriler" && item.href !== "/istanbul-escort")
    },
    {
      title: "İlçe İlanları",
      links: districts.map((district) => ({
        href: `/${district.slug}`,
        title: `${district.name} Escort`
      }))
    }
  ];

  return groups.map((group) => `
    <section class="seo-link-group">
      <h3>${esc(group.title)}</h3>
      <div class="internal-links">
        ${group.links.map((link) => `<a href="${esc(link.href)}">${esc(link.title)}</a>`).join("\n")}
      </div>
    </section>
  `).join("\n");
}

function buildHomeSeoParagraphs(seoText, districts, categoryLinks) {
  const districtNames = districts.map((district) => district.name).filter(Boolean);
  const primaryDistricts = districtNames.slice(0, 8).join(", ");
  const categoryNames = (categoryLinks || [])
    .filter((link) => !["/kategoriler", "/istanbul-escort"].includes(link.href))
    .map((link) => link.title)
    .filter(Boolean)
    .slice(0, 10)
    .join(", ");

  return [
    seoText,
    primaryDistricts ? `${primaryDistricts} ve diğer İstanbul ilçe sayfalarından bölgeye özel profil ilanlarını inceleyebilirsiniz.` : "",
    categoryNames
      ? `${categoryNames} kategorileri yalnız eşleşen güncel profil bulunduğunda ayrı ilan listesi sunar. Telefon, WhatsApp ve diğer iletişim seçenekleri yalnızca seçilen profilin detay sayfasında gösterilir.`
      : "Telefon, WhatsApp ve diğer iletişim seçenekleri yalnızca seçilen profilin detay sayfasında gösterilir."
  ].filter(Boolean);
}

function buildHomeSeoSection(title, seoText, districts, categoryLinks) {
  const paragraphs = buildHomeSeoParagraphs(seoText, districts, categoryLinks);

  return `
      <section class="seo-content">
        <details class="seo-directory-panel">
          <summary>İstanbul ilanları ve kategori erişimi</summary>
          ${paragraphs.map((paragraph) => `<p class="seo-directory-copy">${esc(paragraph)}</p>`).join("\n")}
          <div class="seo-link-groups">
            ${buildHomeInternalLinks(districts, categoryLinks)}
          </div>
        </details>
      </section>
  `;
}

function buildHomeStructuredData(config, title, description, _profiles, _districts, imageUrl) {
  const siteName = clean(config.siteName || "VIP GECE");
  const canonicalUrl = `${SITE_URL}/`;
  const collectionPageJson = buildCollectionPageJson({
    title,
    description,
    canonicalUrl,
    imageUrl,
    siteName
  });

  return [
    jsonLd(buildOrganizationJson(siteName)),
    jsonLd(buildWebSiteJson(siteName, canonicalUrl)),
    jsonLd(collectionPageJson)
  ].join("\n");
}

module.exports = {
  buildCategoriesHubStructuredData,
  buildContactStructuredData,
  buildHomeKeywords,
  buildHomeSeoSection,
  buildHomeSeoText,
  buildHomeStructuredData,
  buildLandingStructuredData,
  buildListingsHubStructuredData
};
