"use strict";

const {
  buildLandingContext,
  isVipProfile,
  rankProfilesForLocalIntent
} = require("../landingContextService");
const {
  SITE_URL,
  absoluteUrl,
  injectPublicShell,
  readView,
  replaceHeadValue,
  replaceNodeInnerHtml,
  upsertMetaName,
  upsertMetaProperty,
  optimizedImageUrl,
  esc
} = require("./shared");
const {
  renderBreadcrumbMarkup,
  renderFaqMarkup,
  renderInlineLinks,
  renderLandingProfileCards,
  renderMiniLandingRows,
  renderNearbyMarkup,
  renderSeoPanelMarkup,
  renderSummaryItems
} = require("./markup");
const { buildLandingStructuredData } = require("./structuredData");
const { buildMetaKeywords, buildSeoVariationText } = require("../../utils/seoLanguage");

function renderGroupedDistrictLinks(groups) {
  return (groups || [])
    .map((group) => `
      <section class="landing-side-group" data-side="${esc(group.key || "")}">
        <div class="landing-side-group-head">
          <h3>${esc(group.title)}</h3>
          <span>${esc(String(group.count || 0))} ilçe / ${esc(String(group.semtCount || 0))} semt</span>
        </div>
        <div class="landing-chip-grid landing-chip-grid-side">
          ${renderInlineLinks(group.links, "landing-chip")}
        </div>
      </section>
    `)
    .join("");
}

function activeIstanbulProfiles(profiles) {
  return (Array.isArray(profiles) ? profiles : []).filter((profile) => {
    if (!profile || profile.is_active === false) return false;
    const city = String(profile.city || "İstanbul").trim().toLocaleLowerCase("tr-TR");
    return !city || city === "istanbul";
  });
}

function applyIstanbulWideDistrictInventory(context, profiles) {
  if (!context || context.type !== "district") return context;

  // Product rule: district/semt pages are discovery entrances into the same
  // Istanbul-wide active profile pool. A profile's descriptive location data
  // may still be shown on its card/detail, but it must not exclude the profile
  // from another Istanbul district landing.
  const orderedProfiles = rankProfilesForLocalIntent(
    activeIstanbulProfiles(profiles),
    context.slug
  );
  const vipCount = orderedProfiles.filter(isVipProfile).length;
  const navigationCount = Array.isArray(context.localIntentRows) && context.localIntentRows.length
    ? context.localIntentRows.length
    : (Array.isArray(context.nearbyLinks) ? context.nearbyLinks.length : 0);

  context.totalProfileCount = orderedProfiles.length;
  context.primaryProfiles = orderedProfiles;
  context.secondaryProfiles = [];
  context.secondaryTitle = "";
  context.secondaryText = "";
  context.recentProfiles = orderedProfiles.slice(0, 6);
  context.heroText = `${context.name} sayfasından İstanbul genelindeki aktif profillerin tamamını tek listede inceleyin. Bölge adı aramanıza hızlı bir başlangıç sunar; her profil için geçerli konum bilgisi kendi kartında yer alır.`;
  context.sectionTitle = `${context.name} için İstanbul Geneli Güncel Profiller`;
  context.sectionText = `${orderedProfiles.length} aktif İstanbul profili bu bölge sayfasında birlikte gösterilir. Kartların sırası sayfaya göre değişebilir; İstanbul kapsamındaki aktif profiller bölge bilgileri nedeniyle listeden çıkarılmaz.`;
  context.summaryItems = [
    { value: String(orderedProfiles.length), label: "aktif profil" },
    { value: String(vipCount), label: "VIP profil" },
    { value: "İstanbul Geneli", label: "profil kapsamı" },
    { value: String(navigationCount), label: context.localIntentRows?.length ? "semt bağlantısı" : "yakın bölge" }
  ];

  const existingFaq = Array.isArray(context.faqItems) ? context.faqItems : [];
  const contactFaq = existingFaq.find((item) => /İletişim bilgilerine/i.test(String(item?.question || "")));
  context.faqItems = [
    {
      question: `${context.name} sayfasında hangi profiller gösterilir?`,
      answer: `İstanbul genelindeki ${orderedProfiles.length} aktif profil bu sayfada gösterilir. Bölge adı bir keşif girişidir ve listelenen her profil fiziksel olarak ${context.name} ilçesinde bulunuyor anlamına gelmez.`
    },
    {
      question: `${context.name} için profiller neden farklı sırada görünebilir?`,
      answer: `Tüm aktif İstanbul profilleri listede kalır; yalnızca kartların sırası güncel ve öne çıkan seçenekleri daha kolay incelemeniz için değişebilir.`
    },
    contactFaq || {
      question: "İletişim bilgilerine nereden ulaşılır?",
      answer: "Telefon, WhatsApp ve diğer iletişim seçenekleri yalnızca seçilen profilin detay sayfasında gösterilir."
    }
  ];
  context.seoParagraphs = [
    `${context.name} sayfası, İstanbul genelindeki aktif profil ilanlarının tamamını bir arada inceleyebileceğiniz bir keşif girişidir. Listede görünmek, profilin fiziksel olarak ${context.name} ilçesinde bulunduğu anlamına gelmez.`,
    `Bu sayfadaki aktif profiller İstanbul Geneli kapsamındadır. Kartların sırası ${context.name} sayfasına göre değişebilir, ancak İstanbul kapsamındaki aktif profiller ilçe bilgileri nedeniyle gizlenmez.`,
    `Profil kartlarında fotoğraf, isim ve mevcut temel bilgiler birlikte sunulur. Ziyaretçi herhangi bir karttan profil detayına geçerek kayıtlı iletişim seçeneklerini inceleyebilir.`,
    `${context.name} ile ilgili semt ve yakın bölge bağlantıları farklı keşif yolları sunar. Her bölge sayfasında İstanbul genelindeki aktif profillerin tamamı, sayfaya uygun bir sırayla gösterilir.`,
    `WhatsApp, telefon ve varsa diğer iletişim seçenekleri seçilen profilin detay sayfasında açılır. Bölge sayfasındaki içerik, profilin kesin fiziksel konumu hakkında ek bir iddia oluşturmaz.`
  ];

  return context;
}

function renderCategoryHtml(slug, profiles) {
  const context = applyIstanbulWideDistrictInventory(
    buildLandingContext(slug, profiles || []),
    profiles || []
  );
  if (!context) return null;
  const viewName = context.type === "city"
    ? "istanbul.html"
    : (context.type === "district" ? "bolge.html" : "kategori-landing.html");
  const heroLinks = context.type === "category" ? (context.categoryLinks || context.quickLinks) : context.quickLinks;
  let html = readView(viewName);
  const robots = context.indexable ? "index, follow, max-image-preview:large" : "noindex, follow";
  const canonical = `${SITE_URL}/${context.slug}`;
  const primaryImage = (context.primaryProfiles[0] && Array.isArray(context.primaryProfiles[0].images) && context.primaryProfiles[0].images[0]) || "/logo.png.webp";
  const seoKeywords = buildMetaKeywords({
    area: context.name || "İstanbul",
    categoryName: context.type === "category" ? context.name : "Escort İlanları",
    extra: [
      "VIP GECE",
      ...(context.searchTerms || []),
      ...(context.internalLinks || []).slice(0, 12).map((link) => link.title)
    ]
  });
  const seoVariationText = buildSeoVariationText({
    area: context.name || "İstanbul",
    categoryName: context.type === "category" ? context.name : "Escort İlanları",
    extra: context.searchTerms || []
  });
  const imageUrl = absoluteUrl(optimizedImageUrl(primaryImage, {
    width: 1200,
    quality: 80,
    resize: "cover"
  }));

  html = replaceHeadValue(html, /<title>.*?<\/title>/i, `<title>${esc(context.pageTitle)}</title>`);
  html = replaceHeadValue(html, /<meta name="robots" content="[^"]*">/i, `<meta name="robots" content="${esc(robots)}">`);
  html = replaceHeadValue(html, /<link rel="canonical" href="[^"]*">/i, `<link rel="canonical" href="${esc(canonical)}">`);
  html = upsertMetaName(html, "description", context.metaDescription);
  html = upsertMetaName(html, "keywords", seoKeywords);
  html = upsertMetaProperty(html, "og:title", context.pageTitle);
  html = upsertMetaProperty(html, "og:description", context.metaDescription);
  html = upsertMetaProperty(html, "og:url", canonical);
  html = upsertMetaProperty(html, "og:image", imageUrl);
  html = upsertMetaName(html, "twitter:card", "summary_large_image");
  html = upsertMetaName(html, "twitter:title", context.pageTitle);
  html = upsertMetaName(html, "twitter:description", context.metaDescription);
  html = upsertMetaName(html, "twitter:image", imageUrl);
  html = html.replace(
    "</head>",
    `
    ${buildLandingStructuredData(context, imageUrl)}
  </head>`
  );
  html = html.replace(
    /<body data-page="([^"]+)">/i,
    `<body data-page="$1" data-server-rendered="true" data-landing-slug="${esc(context.slug)}" data-landing-type="${esc(context.type)}">`
  );

  html = replaceNodeInnerHtml(html, "categoryBreadcrumb", renderBreadcrumbMarkup(context.breadcrumbItems));
  html = replaceNodeInnerHtml(html, "categoryTitle", `${esc(context.heroLead)} <span>${esc(context.heroAccent)}</span>`);
  html = replaceNodeInnerHtml(html, "categoryText", esc(context.heroText));
  html = replaceNodeInnerHtml(html, "categoryHighlights", renderSummaryItems(context.summaryItems));
  html = replaceNodeInnerHtml(html, "categoryLinks", renderInlineLinks(heroLinks, context.type === "category" ? "landing-chip" : "category-link"));
  html = replaceNodeInnerHtml(html, "categorySectionTitle", esc(context.sectionTitle));
  html = replaceNodeInnerHtml(html, "categorySectionText", esc(context.sectionText));
  html = replaceNodeInnerHtml(html, "categoryProfiles", renderLandingProfileCards(context.primaryProfiles));
  const secondaryProfiles = Array.isArray(context.secondaryProfiles) ? context.secondaryProfiles : [];
  const hasSecondary = secondaryProfiles.length > 0;
  html = replaceNodeInnerHtml(html, "categorySecondaryTitle", esc(context.secondaryTitle || "İstanbul Geneli Diğer İlanlar"));
  html = replaceNodeInnerHtml(html, "categorySecondaryText", esc(context.secondaryText || ""));
  html = replaceNodeInnerHtml(
    html,
    "categorySecondaryProfiles",
    hasSecondary ? renderLandingProfileCards(secondaryProfiles) : ""
  );
  html = html.replace(
    /<section[^>]*\bid=["']categorySecondarySection["'][^>]*>/i,
    hasSecondary
      ? `<section id="categorySecondarySection" class="container landing-surface landing-surface-secondary">`
      : `<section id="categorySecondarySection" class="container landing-surface landing-surface-secondary" hidden style="display:none">`
  );
  html = replaceNodeInnerHtml(html, "categoryNearbyBox", renderNearbyMarkup(context.nearbyTitle, context.nearbyText, context.nearbyLinks));
  html = replaceNodeInnerHtml(html, "categoryFaqBox", renderFaqMarkup(context.faqTitle, context.faqItems));
  html = replaceNodeInnerHtml(html, "categorySeoBox", renderSeoPanelMarkup({
    ...context,
    seoVariationText
  }));
  html = replaceNodeInnerHtml(html, "cityDistrictLinks", renderGroupedDistrictLinks(context.sideDistrictGroups) || renderInlineLinks(context.districtLinks || context.nearbyLinks, "landing-chip"));
  html = replaceNodeInnerHtml(html, "cityCategoryLinks", renderInlineLinks(context.categoryLinks || context.quickLinks, "landing-chip"));
  html = replaceNodeInnerHtml(html, "cityRecentProfiles", renderMiniLandingRows(context.recentProfiles));
  html = replaceNodeInnerHtml(html, "districtHubLinks", renderInlineLinks(context.quickLinks, "landing-chip"));
  html = replaceNodeInnerHtml(html, "districtRecentProfiles", renderMiniLandingRows(context.recentProfiles));
  html = replaceNodeInnerHtml(html, "categoryDistrictRail", renderInlineLinks(context.districtLinks || context.nearbyLinks, "landing-chip"));
  html = replaceNodeInnerHtml(html, "categoryRecentProfiles", renderMiniLandingRows(context.recentProfiles));
  html = replaceNodeInnerHtml(html, "categoryHubLinks", renderInlineLinks(context.quickLinks, "landing-chip"));

  html = html.replace(
    /<div class="category-kicker">[\s\S]*?<\/div>/i,
    `<div class="category-kicker">${esc(context.kicker)}</div>`
  );

  return injectPublicShell(html, context.type === "category" ? "categories" : "regions");
}

module.exports = {
  renderCategoryHtml
};
