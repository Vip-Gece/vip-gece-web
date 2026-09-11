"use strict";

const { categoryRows, districtRows, districtSideLabel } = require("../../data/publicMetadata");
const { buildLandingContext, countLandingProfiles, isVipProfile } = require("../landingContextService");
const { getProfileArea, getProfileLocation, getProfileSlug, isGeneralArea } = require("../../utils/profile");
const {
  SITE_URL,
  absoluteUrl,
  clean,
  readSiteConfig,
  readView,
  replaceHeadValue,
  replaceNodeInnerHtml,
  injectPublicShell,
  optimizedImageSrcset,
  optimizedImageUrl,
  safeSlug,
  sortProfiles,
  upsertMetaName,
  upsertMetaProperty,
  esc
} = require("./shared");
const { renderProfileHubCards, renderProfileRows, renderFaqMarkup } = require("./markup");
const {
  buildCategoriesHubStructuredData,
  buildContactStructuredData,
  buildListingsHubStructuredData
} = require("./structuredData");

function districtLinkFromName(name, count = 0) {
  const cleanName = clean(name || "İstanbul");
  const slug = safeSlug(cleanName);
  const row = districtRows().find((district) => safeSlug(district.name) === slug);
  return {
    href: row ? `/${row.slug}` : `/${slug}-escort`,
    title: `${row?.name || cleanName} Escort`,
    count,
    side: row?.side || "",
    sideLabel: row?.side_label || districtSideLabel(cleanName)
  };
}

function buildActiveDistrictLinks(profiles, limit) {
  const generalProfileCount = profiles.filter((profile) => (
    (!profile?.district || isGeneralArea(profile?.district))
      && safeSlug(profile?.city || "İstanbul") === "istanbul"
  )).length;
  const districtUsage = new Map();

  if (generalProfileCount > 0) {
    districtRows().forEach((district) => {
      districtUsage.set(district.name, generalProfileCount);
    });
  }

  profiles.forEach((profile) => {
    if (!profile?.district || isGeneralArea(profile.district)) return;
    const district = getProfileArea(profile);
    if (!district) return;
    districtUsage.set(district, (districtUsage.get(district) || 0) + 1);
  });

  return [...districtUsage.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, Number.isFinite(limit) ? limit : undefined)
    .map(([district, count]) => districtLinkFromName(district, count));
}

function renderGroupedDistrictCloud(links, chipClass) {
  const groupConfig = [
    { key: "europe", title: "Avrupa Yakası" },
    { key: "asia", title: "Anadolu Yakası" }
  ];

  const groups = groupConfig
    .map((group) => {
      const items = links.filter((link) => link.side === group.key);
      if (!items.length) return "";

      return `
        <section class="hub-side-group" data-side="${esc(group.key)}">
          <div class="hub-side-head">
            <h3>${esc(group.title)}</h3>
            <span>${esc(String(items.length))} aktif ilçe</span>
          </div>
          <div class="hub-side-chip-row">
            ${items.map((link) => `<a class="${esc(chipClass)}" href="${esc(link.href)}">${esc(link.title)}</a>`).join("")}
          </div>
        </section>
      `;
    })
    .join("");

  const uncategorized = links
    .filter((link) => !link.side)
    .map((link) => `<a class="${esc(chipClass)}" href="${esc(link.href)}">${esc(link.title)}</a>`)
    .join("");

  return groups
    ? `<div class="hub-side-groups">${groups}${uncategorized ? `<div class="hub-side-chip-row">${uncategorized}</div>` : ""}</div>`
    : uncategorized;
}

function renderListingsHubHtml(profiles) {
  let html = readView("ilanlar.html");
  const config = readSiteConfig();
  const active = sortProfiles(profiles);
  const featured = active.filter((profile) => isVipProfile(profile)).slice(0, 8);
  const primary = active;
  const recent = [...active]
    .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime())
    .slice(0, 6);
  const districtLinks = buildActiveDistrictLinks(active);
  const categoryLinks = categoryRows()
    .filter((category) => (
      category.slug !== "istanbul-escort" &&
      countLandingProfiles(category.slug, active) > 0
    ))
    .map((category) => ({
      href: `/${category.slug}`,
      title: category.name
    }));
  const title = "İlanlar | Güncel VIP Profil Vitrini | VIP Gece";
  const description = `Güncel VIP GECE ilanları: ${active.length} aktif profil, seçili vitrinler, son güncellenen kartlar, ilçe ve kategori bağlantılarıyla İstanbul genelinde kolay keşif.`;
  const primaryImage = (primary[0] && Array.isArray(primary[0].images) && primary[0].images[0]) || "/logo.png.webp";
  const imageUrl = absoluteUrl(optimizedImageUrl(primaryImage, {
    width: 1200,
    quality: 80,
    resize: "cover"
  }));
  const faqItems = [
    {
      question: "İlan listesinde iletişim numarası neden yok?",
      answer: "Her profil farklı kişiye aittir. Telefon veya WhatsApp bilgisi yalnızca ilgili profil detay sayfasında gösterilir; böylece doğru kişiye doğru kanaldan ulaşılır."
    },
    {
      question: "İlanları ilçeye göre nasıl daraltırım?",
      answer: "Sayfadaki ilçe bağlantılarından veya İstanbul Escort hub’ından istediğiniz bölgeyi seçin. İlçe sayfaları güncel profil kartlarını ve yakın semt seçeneklerini bir arada sunar."
    },
    {
      question: "VIP ilan ile standart ilan farkı nedir?",
      answer: "VIP etiketli kartlar öne çıkan vitrin sıralamasında yer alır. Tüm aktif ilanlar fotoğraf, bölge ve temel bilgilerle listelenir; detay sayfasında iletişim aksiyonu açılır."
    }
  ];

  html = replaceHeadValue(html, /<title>.*?<\/title>/i, `<title>${esc(title)}</title>`);
  html = replaceHeadValue(html, /<meta name="robots" content="[^"]*">/i, '<meta name="robots" content="index, follow, max-image-preview:large">');
  html = replaceHeadValue(html, /<link rel="canonical" href="[^"]*">/i, `<link rel="canonical" href="${esc(`${SITE_URL}/ilanlar`)}">`);
  html = upsertMetaName(html, "description", description);
  html = upsertMetaProperty(html, "og:title", title);
  html = upsertMetaProperty(html, "og:description", description);
  html = upsertMetaProperty(html, "og:url", `${SITE_URL}/ilanlar`);
  html = upsertMetaProperty(html, "og:image", imageUrl);
  html = upsertMetaName(html, "twitter:card", "summary_large_image");
  html = upsertMetaName(html, "twitter:title", title);
  html = upsertMetaName(html, "twitter:description", description);
  html = upsertMetaName(html, "twitter:image", imageUrl);
  html = html.replace(
    "</head>",
    `
    ${buildListingsHubStructuredData(title, description, primary, imageUrl, faqItems)}
  </head>`
  );

  html = replaceNodeInnerHtml(html, "listingsBreadcrumb", `<a href="/">Ana Sayfa</a><span>/</span><span>İlanlar</span>`);
  html = replaceNodeInnerHtml(html, "listingsTitle", `VIP GECE <span>İlanlar</span>`);
  html = replaceNodeInnerHtml(html, "listingsText", esc(`${active.length} güncel ilanı fotoğraf, bölge ve temel bilgilerle karşılaştırın; iletişim her zaman seçtiğiniz profil detayında açılır.`));
  html = replaceNodeInnerHtml(html, "listingsStats", [
    { value: String(active.length), label: "aktif ilan" },
    { value: String(featured.length || primary.length), label: "öne çıkan kart" },
    { value: String(districtLinks.length), label: "aktif bölge" },
    { value: String(categoryLinks.length), label: "kategori seçeneği" }
  ].map((item) => `<div class="listings-stat"><strong>${esc(item.value)}</strong><span>${esc(item.label)}</span></div>`).join(""));
  html = replaceNodeInnerHtml(
    html,
    "listingsQuickLinks",
    [
      { href: "/istanbul-escort", title: "İstanbul Escort" },
      { href: "/vip-escort", title: "VIP Escort" },
      { href: "/kategoriler", title: "Tüm Kategoriler" },
      { href: "/iletisim", title: "İletişim Rehberi" },
      ...districtLinks.slice(0, 6)
    ].map((link) => `<a class="listings-link" href="${esc(link.href)}">${esc(link.title)}</a>`).join("")
  );
  html = replaceNodeInnerHtml(html, "listingsFeaturedGrid", renderProfileHubCards(primary));
  html = replaceNodeInnerHtml(html, "listingsRecentGrid", renderProfileRows(recent));
  html = replaceNodeInnerHtml(html, "listingsDirectoryLinks", renderGroupedDistrictCloud(districtLinks, "listings-chip"));
  html = replaceNodeInnerHtml(html, "listingsCategoryLinks", categoryLinks.map((link) => `<a class="listings-chip" href="${esc(link.href)}">${esc(link.title)}</a>`).join(""));
  html = replaceNodeInnerHtml(html, "listingsSeoPanel", `
    <h2>Güncel Escort İlanları</h2>
    <p>VIP GECE ilan sayfası, güncel profilleri fotoğraf, isim, bölge ve temel bilgilerle birlikte görsel ağırlıklı kartlarda sunar. Şu an listede ${esc(String(active.length))} aktif ilan vardır.</p>
    <p>İstanbul geneli ilanlar ${esc(districtLinks.map((link) => link.title.replace(/\s+Escort$/i, "")).slice(0, 12).join(", ") || "ilçe")} ve diğer dolu ilçe bağlantılarıyla daraltılabilir; kategori seçenekleri aynı ilan akışını tercihe göre filtreler.</p>
    <p>İletişim seçenekleri yalnızca seçilen profil detayında açılır; her profil kendi iletişim kanalını taşır. Liste sayfası karşılaştırma ve doğru ilana hızlı ulaşım için sade kalır.</p>
    <div class="listings-faq" id="listingsFaqBox">
      ${renderFaqMarkup("Sık sorulanlar", faqItems)}
    </div>
  `);

  return injectPublicShell(html, "profiles");
}

function renderCategoriesHubHtml(profiles) {
  let html = readView("kategori.html");
  const config = readSiteConfig();
  const active = sortProfiles(profiles);
  const activeCategoryRows = categoryRows().map((category) => {
    const context = buildLandingContext(category.slug, active);
    return {
      key: category.key,
      name: category.name,
      href: `/${category.slug}`,
      count: countLandingProfiles(category.slug, active),
      summary: context.heroText,
      kicker: category.is_city_hub ? "İstanbul İlanları" : "Kategori",
      isCityHub: category.is_city_hub === true
    };
  });
  const visibleCategories = activeCategoryRows.filter(
    (category) => category.isCityHub || category.count > 0
  );
  const selectableCategoryCount = visibleCategories.filter((category) => !category.isCityHub).length;
  const recent = [...active]
    .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime())
    .slice(0, 6);
  const districtLinks = buildActiveDistrictLinks(active);
  const totalLandingCount = districtLinks.length + visibleCategories.length;
  const title = "Kategoriler | İstanbul Escort Kategori İlanları | VIP Gece";
  const description = `VIP GECE kategorileri: ${selectableCategoryCount} dolu kategori, ${active.length} aktif profil ve ${districtLinks.length} ilçe bağlantısıyla İstanbul ilanlarını tercihe göre daraltın.`;
  const primaryImage = (recent[0] && Array.isArray(recent[0].images) && recent[0].images[0]) || "/logo.png.webp";
  const imageUrl = absoluteUrl(optimizedImageUrl(primaryImage, {
    width: 1200,
    quality: 80,
    resize: "cover"
  }));
  const faqItems = [
    {
      question: "Hangi kategori sayfaları indekslenir?",
      answer: "Yalnızca en az bir aktif profil taşıyan veya şehir hub’ı olan kategori sayfaları listelenir ve sitemap’e girer. Boş kategori üretimi yapılmaz."
    },
    {
      question: "Kategori seçtikten sonra ne yapmalıyım?",
      answer: "Kategori kartından profil listesine gidin, ilgilendiğiniz kartı açın. İletişim bilgisi her profilin kendi detay sayfasında yer alır."
    },
    {
      question: "İlçe ve kategori birlikte kullanılabilir mi?",
      answer: "Evet. Önce kategori veya ilçe sayfasından daraltın, ardından profil detayını açın. Sayfa sonundaki ilçe bağlantıları bu adımı hızlandırır."
    }
  ];

  html = replaceHeadValue(html, /<title>.*?<\/title>/i, `<title>${esc(title)}</title>`);
  html = replaceHeadValue(html, /<meta name="robots" content="[^"]*">/i, '<meta name="robots" content="index, follow, max-image-preview:large">');
  html = replaceHeadValue(html, /<link rel="canonical" href="[^"]*">/i, `<link rel="canonical" href="${esc(`${SITE_URL}/kategoriler`)}">`);
  html = upsertMetaName(html, "description", description);
  html = upsertMetaProperty(html, "og:title", title);
  html = upsertMetaProperty(html, "og:description", description);
  html = upsertMetaProperty(html, "og:url", `${SITE_URL}/kategoriler`);
  html = upsertMetaProperty(html, "og:image", imageUrl);
  html = upsertMetaName(html, "twitter:card", "summary_large_image");
  html = upsertMetaName(html, "twitter:title", title);
  html = upsertMetaName(html, "twitter:description", description);
  html = upsertMetaName(html, "twitter:image", imageUrl);
  html = html.replace(
    "</head>",
    `
    ${buildCategoriesHubStructuredData(title, description, visibleCategories, imageUrl, faqItems)}
  </head>`
  );

  html = replaceNodeInnerHtml(html, "categoriesBreadcrumb", `<a href="/">Ana Sayfa</a><span>/</span><span>Kategoriler</span>`);
  html = replaceNodeInnerHtml(html, "categoriesTitle", `VIP GECE <span>Kategoriler</span>`);
  html = replaceNodeInnerHtml(html, "categoriesText", esc(`${selectableCategoryCount} kategori ve ${districtLinks.length} ilçe bağlantısıyla İstanbul genelindeki güncel profilleri tercihinize göre daraltın.`));
  html = replaceNodeInnerHtml(html, "categoriesStats", [
    { value: String(selectableCategoryCount), label: "kategori seçeneği" },
    { value: String(active.length), label: "aktif profil" },
    { value: String(districtLinks.length), label: "ilçe bağlantısı" },
    { value: String(totalLandingCount), label: "hızlı bağlantı" }
  ].map((item) => `<div class="categories-stat"><strong>${esc(item.value)}</strong><span>${esc(item.label)}</span></div>`).join(""));
  html = replaceNodeInnerHtml(
    html,
    "categoriesQuickLinks",
    [
      { href: "/istanbul-escort", title: "İstanbul Escort" },
      { href: "/ilanlar", title: "Güncel İlanlar" },
      { href: "/iletisim", title: "İletişim Rehberi" },
      ...visibleCategories.slice(1, 6).map((category) => ({ href: category.href, title: category.name }))
    ].map((link) => `<a class="categories-link" href="${esc(link.href)}">${esc(link.title)}</a>`).join("")
  );
  html = replaceNodeInnerHtml(html, "categoriesDistrictLinks", renderGroupedDistrictCloud(districtLinks, "categories-chip"));
  html = replaceNodeInnerHtml(
    html,
    "categoriesHubLinks",
    [
      { href: "/ilanlar", title: "Tüm İlanlar" },
      { href: "/istanbul-escort", title: "İstanbul Escort" },
      { href: "/vip-escort", title: "VIP Escort" }
    ].map((link) => `<a class="categories-chip" href="${esc(link.href)}">${esc(link.title)}</a>`).join("")
  );
  html = replaceNodeInnerHtml(
    html,
    "categoriesGrid",
    visibleCategories.map((category, index) => `
      <article class="categories-card${index === 0 ? " categories-card-featured" : ""}">
        <span class="categories-card-kicker">${esc(category.kicker)}</span>
        <h3>${esc(category.name)}</h3>
        <p>${esc(category.summary)}</p>
        <div class="categories-card-meta">
          <span>${esc(String(category.count))} profil</span>
          <span>${esc(index === 0 ? `${districtLinks.length} aktif ilçe` : "kategori ilanı")}</span>
        </div>
        <a class="categories-card-btn" href="${esc(category.href)}">Profilleri Gör</a>
      </article>
    `).join("")
  );
  html = replaceNodeInnerHtml(
    html,
    "categoriesRecentProfiles",
    recent.map((profile) => {
      const url = `/profil/${esc(getProfileSlug(profile))}`;
      const image = absoluteUrl(Array.isArray(profile.images) ? profile.images[0] : "");
      const imageSrc = optimizedImageUrl(image, { width: 360, quality: 72, resize: "cover" });
      const imageSrcset = optimizedImageSrcset(image, [160, 240, 320, 360], { quality: 72, resize: "cover" });
      return `
        <a class="categories-row" href="${url}">
          <img
            src="${esc(imageSrc)}"
            alt="${esc(profile.name || "Profil")}"
            width="360"
            height="450"
            loading="lazy"
            decoding="async"
            sizes="(max-width: 1024px) 28vw, 14vw"
            ${imageSrcset ? `srcset="${esc(imageSrcset)}"` : ""}
          >
          <div class="categories-row-body">
            <strong>${esc(profile.name || "İsimsiz")}</strong>
            <span>${esc(getProfileLocation(profile))}</span>
            <p>${esc(profile.card_label || profile.description || "Profil detaylarını inceleyin.")}</p>
          </div>
        </a>
      `;
    }).join("")
  );
  html = replaceNodeInnerHtml(html, "categoriesSeoPanel", `
    <h2>Kategori ve Bölge Bağlantıları</h2>
    <p>Kategoriler sayfası, ziyaretçinin aradığı profil tipine daha hızlı ulaşması için hazırlanmıştır. Önce kategori seçilir, ardından uygun bölge veya profil kartı üzerinden detay sayfasına geçilir.</p>
    <p>İstanbul genelindeki ilçe seçenekleri, güncel ilanlar ve VIP vitrinler aynı akış içinde sade biçimde sunulur. Şu an ${esc(String(active.length))} aktif profil ve ${esc(String(selectableCategoryCount))} dolu kategori listelenir.</p>
    <div class="categories-chip-cloud">
      ${districtLinks.slice(0, 12).map((link) => `<a class="categories-chip" href="${esc(link.href)}">${esc(link.title)}</a>`).join("")}
    </div>
    <div class="categories-faq" id="categoriesFaqBox">
      ${renderFaqMarkup("Sık sorulanlar", faqItems)}
    </div>
  `);

  return injectPublicShell(html, "categories");
}

function renderContactHtml(profiles) {
  let html = readView("iletisim.html");
  const config = readSiteConfig();
  const active = sortProfiles(profiles);
  const recent = [...active]
    .sort((left, right) => new Date(right.updated_at || right.created_at || 0).getTime() - new Date(left.updated_at || left.created_at || 0).getTime())
    .slice(0, 8);
  const districtLinks = buildActiveDistrictLinks(active, 16);
  const categoryLinks = categoryRows()
    .filter((category) => (
      category.slug !== "istanbul-escort" &&
      countLandingProfiles(category.slug, active) > 0
    ))
    .slice(0, 8)
    .map((category) => ({
      href: `/${category.slug}`,
      title: category.name
    }));
  const title = "İletişim | VIP GECE İstanbul Profil Rehberi";
  const description = `VIP GECE iletişim rehberi: ${active.length} aktif profilin her biri kendi iletişim kanalını detay sayfasında taşır. İstanbul, ilçe ve kategori üzerinden doğru ilana ulaşın.`;
  const primaryImage = (recent[0] && Array.isArray(recent[0].images) && recent[0].images[0]) || "/logo.png.webp";
  const imageUrl = absoluteUrl(optimizedImageUrl(primaryImage, {
    width: 1200,
    quality: 80,
    resize: "cover"
  }));
  const faqItems = [
    {
      question: "Tek bir site WhatsApp numarası var mı?",
      answer: "Hayır. VIP GECE bir ilan platformudur; her profil farklı kişiye aittir. İletişim bilgisi yalnızca seçtiğiniz profilin detay sayfasında gösterilir."
    },
    {
      question: "Doğru profile nasıl ulaşırım?",
      answer: "Ana sayfa, İlanlar, Kategoriler veya İstanbul/ilçe sayfalarından kartı seçin. Detay sayfasındaki WhatsApp veya telefon aksiyonu yalnızca o profile aittir."
    },
    {
      question: "Reklam veya işbirliği için ne yapmalıyım?",
      answer: "Site içi ilan iletişimi profil detayındadır. Platform/reklam işbirliği talepleri için mevcut operasyon kanalınız üzerinden yöneticiyle görüşün; bu sayfa genel yönlendirme sağlar."
    },
    {
      question: "İlçe sayfalarında neden numara yok?",
      answer: "İlçe ve kategori sayfaları keşif içindir. Numara göstermek yanlış kişiye yazma riskini artırır; bu yüzden iletişim bilinçli olarak profil detayında tutulur."
    }
  ];

  html = replaceHeadValue(html, /<title>.*?<\/title>/i, `<title>${esc(title)}</title>`);
  html = replaceHeadValue(html, /<meta name="robots" content="[^"]*">/i, '<meta name="robots" content="index, follow, max-image-preview:large">');
  html = replaceHeadValue(html, /<link rel="canonical" href="[^"]*">/i, `<link rel="canonical" href="${esc(`${SITE_URL}/iletisim`)}">`);
  html = upsertMetaName(html, "description", description);
  html = upsertMetaProperty(html, "og:title", title);
  html = upsertMetaProperty(html, "og:description", description);
  html = upsertMetaProperty(html, "og:url", `${SITE_URL}/iletisim`);
  html = upsertMetaProperty(html, "og:image", imageUrl);
  html = upsertMetaName(html, "twitter:card", "summary_large_image");
  html = upsertMetaName(html, "twitter:title", title);
  html = upsertMetaName(html, "twitter:description", description);
  html = upsertMetaName(html, "twitter:image", imageUrl);
  html = html.replace(
    "</head>",
    `
    ${buildContactStructuredData(title, description, faqItems, imageUrl)}
  </head>`
  );

  html = replaceNodeInnerHtml(html, "contactBreadcrumb", `<a href="/">Ana Sayfa</a><span>/</span><span>İletişim</span>`);
  html = replaceNodeInnerHtml(html, "contactTitle", `VIP <span>GECE</span> İletişim Rehberi`);
  html = replaceNodeInnerHtml(
    html,
    "contactText",
    esc(`Bu sayfa tek bir kişiye ait çağrı merkezi değildir. ${active.length} aktif ilanın her biri kendi iletişim kanalını profil detayında taşır. Aşağıdan güncel profillere, ilçelere ve kategorilere geçerek doğru ilanı seçin.`)
  );
  html = replaceNodeInnerHtml(html, "contactStats", [
    { value: String(active.length), label: "aktif profil" },
    { value: String(districtLinks.length), label: "ilçe bağlantısı" },
    { value: String(categoryLinks.length), label: "dolu kategori" },
    { value: "Detay", label: "iletişim yeri" }
  ].map((item) => `<div class="contact-stat"><strong>${esc(item.value)}</strong><span>${esc(item.label)}</span></div>`).join(""));
  html = replaceNodeInnerHtml(
    html,
    "contactActions",
    [
      { href: "/ilanlar", title: "Tüm İlanlar", className: "contact-action" },
      { href: "/istanbul-escort", title: "İstanbul Escort", className: "contact-action secondary" },
      { href: "/kategoriler", title: "Kategoriler", className: "contact-action secondary" },
      { href: "/vip-escort", title: "VIP Escort", className: "contact-action secondary" }
    ].map((link) => `<a class="${esc(link.className)}" href="${esc(link.href)}">${esc(link.title)}</a>`).join("")
  );
  html = replaceNodeInnerHtml(html, "contactProfileGrid", renderProfileHubCards(recent));
  html = replaceNodeInnerHtml(
    html,
    "contactDistrictLinks",
    districtLinks.map((link) => `<a class="contact-chip" href="${esc(link.href)}">${esc(link.title)}</a>`).join("")
  );
  html = replaceNodeInnerHtml(
    html,
    "contactCategoryLinks",
    categoryLinks.map((link) => `<a class="contact-chip" href="${esc(link.href)}">${esc(link.title)}</a>`).join("")
  );
  html = replaceNodeInnerHtml(html, "contactFaqBox", renderFaqMarkup("Sık sorulan sorular", faqItems));
  html = replaceNodeInnerHtml(html, "contactSeoPanel", `
    <h2>VIP GECE iletişim ve profil erişimi</h2>
    <p>VIP GECE, İstanbul odaklı güncel profil ilanlarını bir araya getiren bir platformdur. Ziyaretçi iletişim bilgisini ararken önce doğru profili seçmeli; çünkü her ilanın WhatsApp veya telefon kanalı o profile özeldir.</p>
    <p>Google’da görünen ilçe, kategori veya genel arama sonuçlarından gelen kullanıcılar ana sayfa, ilanlar, kategoriler veya ${esc(districtLinks.slice(0, 8).map((link) => link.title.replace(/\s+Escort$/i, "")).join(", ") || "ilçe")} sayfaları üzerinden detaya inebilir. Bu iletişim sayfası boş bir destek formu değil; doğru detay sayfasına giden kalıcı bir rehberdir.</p>
    <p>Arama görünürlüğü için her profil kendi canonical URL’sine, görsellerine ve bölge bağlantılarına sahiptir. Platform, tek numarada birleştirme yapmaz; kalite, güncel ilan ve net iç bağlantı ile keşfi güçlendirir.</p>
  `);

  return injectPublicShell(html, "contact");
}

module.exports = {
  renderCategoriesHubHtml,
  renderContactHtml,
  renderListingsHubHtml
};
