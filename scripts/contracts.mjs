import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const BASE_URL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3105";
const EXPECTED_SITE_URL = (process.env.EXPECTED_SITE_URL || "https://vip-gece.site").replace(/\/$/, "");
const PUBLIC_ADMIN_HOSTS = new Set([
  "vip-gece.site",
  "www.vip-gece.site",
  "vip-gece.online",
  "www.vip-gece.online",
  "vip-gece.com",
  "www.vip-gece.com"
]);
const publicAdminSurfaceHidden = PUBLIC_ADMIN_HOSTS.has(new URL(BASE_URL).hostname.toLowerCase());
const adminGuardStatus = publicAdminSurfaceHidden ? 404 : 401;
const adminGuardError = publicAdminSurfaceHidden ? "API endpoint bulunamadı." : "Oturum gerekli.";
const require = createRequire(import.meta.url);
const {
  sanitizeDraftPayload,
  sanitizeCustomerProfilePayload,
  sanitizeCustomerRequestPayload,
  sanitizeProfilePayload
} = require("../src/utils/input");
const { buildImageSitemapXml, buildSitemapXml } = require("../src/services/sitemapService");
const { getBearerToken } = require("../src/middleware/auth");
const { publicProfile, publicProfileCard } = require("../src/routes/publicApiRoutes");
const { findProfileBySlug, getProfileSlug } = require("../src/utils/profile");
const {
  parsePwnedRangeResponse,
  sha1UpperHex
} = require("../src/services/leakedPasswordService");
const { categoryRows, districtRows, getDistrictAliases, landingAliasRows, seoClusterRows } = require("../src/data/publicMetadata");
const { getDemoProfiles } = require("../src/data/demoProfiles");
const { profileWithUsableImages } = require("../src/data/profilesRepo");
const { databaseConnectionString } = require("../src/data/postgresClient");
const {
  buildLandingContext,
  filterProfilesForLanding,
  listIndexableLandingSlugs,
  profilesSupportingLanding,
  rankProfilesForLocalIntent,
  resolveLandingTarget
} = require("../src/services/landingContextService");
const { buildHomeKeywords } = require("../src/services/render/structuredData");
const { renderHomeHtml } = require("../src/services/render/homeRenderer");
const { renderCategoriesHubHtml, renderListingsHubHtml } = require("../src/services/render/hubRenderers");
const { renderProfileDetailHtml } = require("../src/services/render/detailRenderer");
const { renderCategoryHtml } = require("../src/services/render/landingRenderer");
const {
  DEFAULT_PROFILE_WHATSAPP,
  applyProfileCreateDefaults,
  applyProfileUpdateDefaults
} = require("../src/services/profileDefaults");
const { buildRuntimeConfigSource } = require("../src/routes/systemRoutes");
const { assertProfileImageReadiness } = require("../src/routes/healthRoutes");
const { normalizeEvent: normalizeProfileAnalyticsEvent } = require("../src/services/profileAnalyticsService");
const {
  buildCustomerProfilePreviewImageUrl,
  decodeCustomerProfilePreviewImageToken
} = require("../src/services/customerProfileImageService");
const {
  profilesContainCustomerProfileImage,
  profilesContainRemoteProfileImage,
  publicCustomerImageVariant
} = require("../src/routes/profileMediaRoutes");
const { adminProfileView } = require("../src/routes/adminRoutes");
const {
  buildProfileImageProxyUrl,
  buildSupabaseRenderUrl,
  decodeProfileImageToken,
  encodeProfileImageUrl,
  parseImageOptionsQuery,
  parseAllowedProfileImageUrl
} = require("../src/services/profileImageProxyService");
const {
  buildSitemapSubmitUrl,
  buildSitemapsListUrl,
  defaultInspectionUrls,
  extractSitemapLocs,
  normalizeSearchConsoleSiteUrl,
  publicFastDiscoveryPlan,
  searchConsoleStatus
} = require("../src/services/googleSearchConsoleService");

const failures = [];
let contractProfileSlug = "";
const contractProfileSlugOverride = process.env.CONTRACT_PROFILE_SLUG || "";

async function profileSlugExists(slug) {
  if (!slug) return false;

  try {
    const response = await fetch(`${BASE_URL}/api/v1/public/profiles/${encodeURIComponent(slug)}`);
    return response.ok && (response.headers.get("content-type") || "").includes("application/json");
  } catch {
    return false;
  }
}

async function getContractProfileSlug() {
  if (contractProfileSlug) {
    if (await profileSlugExists(contractProfileSlug)) return contractProfileSlug;
    contractProfileSlug = "";
  }

  if (await profileSlugExists(contractProfileSlugOverride)) {
    contractProfileSlug = contractProfileSlugOverride;
    return contractProfileSlug;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/api/v1/public/profiles`);
      if (response.ok && (response.headers.get("content-type") || "").includes("application/json")) {
        const body = await response.json();
        const firstSlug = body?.profiles?.find((profile) => typeof profile?.slug === "string" && profile.slug.trim())?.slug;
        if (firstSlug) {
          contractProfileSlug = firstSlug;
          return contractProfileSlug;
        }
      }
    } catch {
      // Keep the local demo fallback below for offline contract runs.
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  contractProfileSlug = "ada-vip";
  return contractProfileSlug;
}

async function getContractProfilePath() {
  return `/profil/${await getContractProfileSlug()}`;
}

function assertProfileImageProxyContracts() {
  const source = "https://example-project.supabase.co/storage/v1/object/public/images/vip-gece/profiles/example.jpeg";
  const legacySource = "https://example-project.supabase.co/storage/v1/object/public/images/profiles/legacy.jpeg";
  const token = encodeProfileImageUrl(source);
  const proxied = buildProfileImageProxyUrl(source, { width: 640, quality: 72, resize: "contain" });
  const upstream = buildSupabaseRenderUrl(source, { width: 640, quality: 72, resize: "contain" });
  const narrow = buildProfileImageProxyUrl(source, { width: 320, quality: 72, resize: "contain" });

  if (
    token &&
    decodeProfileImageToken(token) === source &&
    proxied.startsWith(`/media/profile-image/${token}?`) &&
    upstream.includes("/storage/v1/render/image/public/images/vip-gece/profiles/example.jpeg") &&
    parseAllowedProfileImageUrl(legacySource) &&
    narrow !== proxied
  ) {
    pass("profile image proxy preserves current and legacy Supabase profile sources");
  } else {
    fail("profile image proxy preserves current and legacy Supabase profile sources");
  }

  if (
    !parseAllowedProfileImageUrl("https://example.com/image.jpg") &&
    !parseAllowedProfileImageUrl("https://example-project.supabase.co/storage/v1/object/public/private/image.jpg") &&
    !decodeProfileImageToken(Buffer.from("https://example.com/image.jpg").toString("base64url")) &&
    !decodeProfileImageToken(`${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`)
  ) {
    pass("profile image proxy rejects unsigned, tampered, non-profile, and non-Supabase sources");
  } else {
    fail("profile image proxy rejects unsigned, tampered, non-profile, and non-Supabase sources");
  }

  if (
    parseImageOptionsQuery({ width: "360", quality: "72", resize: "cover" })?.width === 360 &&
    parseImageOptionsQuery({ width: "0360", quality: "72", resize: "cover" }) === null &&
    parseImageOptionsQuery({ width: "360", quality: "072", resize: "cover" }) === null &&
    parseImageOptionsQuery({ width: "360", quality: "72", resize: "cover", extra: "1" }) === null &&
    profilesContainRemoteProfileImage([{ images: [source] }], source) &&
    !profilesContainRemoteProfileImage([{ images: [legacySource] }], source)
  ) {
    pass("remote profile image variants are canonical and require a published source reference");
  } else {
    fail("remote profile image variants are canonical and require a published source reference");
  }

  const customerImagePath = "/media/customer-profile/account-1/profile-1/123e4567-e89b-12d3-a456-426614174000.jpg";
  const previewImageUrl = buildCustomerProfilePreviewImageUrl(customerImagePath, 960);
  const previewImageToken = previewImageUrl.split("/").at(-1);
  const decodedPreviewImage = decodeCustomerProfilePreviewImageToken(previewImageToken);
  if (
    publicCustomerImageVariant({ width: "360", quality: "72" })?.width === 360 &&
    publicCustomerImageVariant({})?.width === null &&
    publicCustomerImageVariant({ width: "0360", quality: "72" }) === null &&
    publicCustomerImageVariant({ width: "360", quality: "072" }) === null &&
    publicCustomerImageVariant({ width: "361", quality: "72" }) === null &&
    publicCustomerImageVariant({ width: "360", quality: "71" }) === null &&
    publicCustomerImageVariant({ width: "360", extra: "1" }) === null &&
    profilesContainCustomerProfileImage([{ images: [customerImagePath] }], customerImagePath) &&
    !profilesContainCustomerProfileImage([{ images: [] }], customerImagePath) &&
    decodedPreviewImage?.kind === "local" &&
    decodedPreviewImage?.source === customerImagePath &&
    decodedPreviewImage?.width === 960 &&
    decodeCustomerProfilePreviewImageToken(
      `${previewImageToken.slice(0, -1)}${previewImageToken.endsWith("a") ? "b" : "a"}`
    ) === null
  ) {
    pass("customer profile images use bounded public variants and expiring signed draft previews");
  } else {
    fail("customer profile images use bounded public variants and expiring signed draft previews");
  }

  const adminDraftView = adminProfileView({
    id: "draft-1",
    is_active: false,
    images: [customerImagePath, customerImagePath]
  });
  const emptyAdminDraftView = adminProfileView({ id: "draft-empty", images: [] });
  const adminCoverToken = adminDraftView.cover_preview_url.split("/").at(-1);
  const adminImageToken = adminDraftView.image_preview_urls[0].split("/").at(-1);
  if (
    adminDraftView.is_active === false &&
    adminDraftView.images[0] === customerImagePath &&
    adminDraftView.images.length === 2 &&
    adminDraftView.image_preview_urls.length === adminDraftView.images.length &&
    adminDraftView.image_preview_urls.every((url) =>
      decodeCustomerProfilePreviewImageToken(url.split("/").at(-1))?.source === customerImagePath
    ) &&
    decodeCustomerProfilePreviewImageToken(adminCoverToken)?.width === 320 &&
    decodeCustomerProfilePreviewImageToken(adminImageToken)?.width === 960 &&
    emptyAdminDraftView.cover_preview_url === "" &&
    emptyAdminDraftView.image_preview_urls.length === 0
  ) {
    pass("admin draft view preserves private image paths and adds expiring signed previews");
  } else {
    fail("admin draft view preserves private image paths and adds expiring signed previews");
  }

  const previousEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    SUPABASE_URL: process.env.SUPABASE_URL,
    PROFILE_IMAGE_PROXY_SECRET: process.env.PROFILE_IMAGE_PROXY_SECRET,
    CUSTOMER_ACCESS_SESSION_SECRET: process.env.CUSTOMER_ACCESS_SESSION_SECRET
  };
  let missingSecretRejected = false;
  try {
    process.env.NODE_ENV = "production";
    process.env.SUPABASE_URL = "https://example-project.supabase.co";
    delete process.env.PROFILE_IMAGE_PROXY_SECRET;
    delete process.env.CUSTOMER_ACCESS_SESSION_SECRET;
    assertProfileImageReadiness([{ images: [source] }]);
  } catch {
    missingSecretRejected = true;
  } finally {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  if (missingSecretRejected) {
    pass("readiness fails closed when production profile image signing is unavailable");
  } else {
    fail("readiness fails closed when production profile image signing is unavailable");
  }
}

assertProfileImageProxyContracts();

function assertMissingCustomerUploadFallback() {
  const profile = profileWithUsableImages({
    images: [
      "/media/customer-upload/contracts/does-not-exist.webp",
      "https://example-project.supabase.co/storage/v1/object/public/images/profiles/example.jpeg",
      "/logo.png.webp"
    ]
  });

  if (
    profile.images.length === 2 &&
    !profile.images.includes("/media/customer-upload/contracts/does-not-exist.webp") &&
    profile.images.includes("https://example-project.supabase.co/storage/v1/object/public/images/profiles/example.jpeg") &&
    profile.images.includes("/logo.png.webp")
  ) {
    pass("missing legacy customer uploads fall back without breaking public pages");
  } else {
    fail("missing legacy customer uploads fall back without breaking public pages");
  }
}

assertMissingCustomerUploadFallback();

function assertRetiredProfileImageFallback() {
  const profile = profileWithUsableImages({
    images: [
      "https://hofblpqaxzhybozavtaz.supabase.co/storage/v1/object/public/images/vip-gece/profiles/migrated/missing.jpg",
      "/logo.png.webp"
    ]
  });

  if (profile.images.length === 1 && profile.images[0] === "/logo.png.webp") {
    pass("retired profile image hosts fall back without broken public images");
  } else {
    fail("retired profile image hosts fall back without broken public images");
  }

  const retiredOnly = profileWithUsableImages({
    images: [
      "https://hofblpqaxzhybozavtaz.supabase.co/storage/v1/object/public/images/vip-gece/profiles/migrated/missing.jpg"
    ]
  });
  if (retiredOnly.images.length === 0) {
    pass("retired-only profiles remain unpublished without usable media");
  } else {
    fail("retired-only profiles remain unpublished without usable media");
  }
}

assertRetiredProfileImageFallback();

function countMatches(source, pattern) {
  return (String(source || "").match(pattern) || []).length;
}

function isNoindexHtml(html) {
  return /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(String(html || ""));
}

function compactSource(source) {
  return String(source || "").replace(/\s+/g, "");
}

function compactCode(source) {
  return compactSource(source).replace(/;/g, "");
}

function includesCompact(source, snippet) {
  return compactSource(source).includes(compactSource(snippet));
}

function includesAnyCompact(source, snippets) {
  return snippets.some((snippet) => includesCompact(source, snippet));
}

function includesCode(source, snippet) {
  return compactCode(source).includes(compactCode(snippet));
}

function includesAnyCode(source, snippets) {
  return snippets.some((snippet) => includesCode(source, snippet));
}

function fail(message) {
  failures.push(message);
  console.log(`fail ${message}`);
}

function pass(message) {
  console.log(`ok ${message}`);
}

function assertProfileCanonicalSlugContracts() {
  const legacyProfile = {
    slug: "istanbul-meli-s-2",
    name: "MELİS",
    city: "istanbul",
    district: "Beşiktaş"
  };
  const stableProfile = {
    slug: "tatyana",
    name: "TATYANA",
    city: "istanbul"
  };
  const iremLegacyProfile = {
    slug: "istanbul-irem-2",
    name: "İrem",
    city: "İstanbul"
  };
  const iremCollisionProfile = {
    slug: "istanbul-i-rem-7",
    name: "İREM",
    city: "İstanbul"
  };
  const aliasCollision = {
    slug: "istanbul-sofia",
    name: "SOFIA",
    city: "istanbul"
  };
  const exactCollision = {
    slug: "sofia-istanbul",
    name: "SOFIA",
    city: "istanbul"
  };
  const baharGeneratedProfile = {
    slug: "bahar-39bc3dbe",
    name: "BAHAR",
    city: "İstanbul",
    district: "İstanbul Geneli"
  };
  const betulGeneratedProfile = {
    slug: "betul-0a8e1b15",
    name: "BETÜL",
    city: "İstanbul",
    district: "İstanbul Geneli"
  };

  if (getProfileSlug(legacyProfile) === "melis-besiktas") {
    pass("legacy generated profile slug resolves to clean canonical URL");
  } else {
    fail("legacy generated profile slug resolves to clean canonical URL");
  }

  if (getProfileSlug(stableProfile) === "tatyana") {
    pass("stable profile slug remains unchanged");
  } else {
    fail("stable profile slug remains unchanged");
  }

  if (findProfileBySlug([legacyProfile], "istanbul-meli-s-2") === legacyProfile) {
    pass("legacy profile URL remains resolvable for redirect compatibility");
  } else {
    fail("legacy profile URL remains resolvable for redirect compatibility");
  }

  if (
    getProfileSlug(iremLegacyProfile) === "irem-istanbul" &&
    findProfileBySlug([iremLegacyProfile], "istanbul-irem-2") === iremLegacyProfile &&
    findProfileBySlug([iremLegacyProfile], "irem-istanbul") === iremLegacyProfile
  ) {
    pass("Irem stored slug and canonical URL remain bound to the same profile");
  } else {
    fail("Irem stored slug and canonical URL remain bound to the same profile");
  }

  if (
    getProfileSlug(iremCollisionProfile) === "irem-vip-istanbul" &&
    findProfileBySlug([iremCollisionProfile], "istanbul-i-rem-7") === iremCollisionProfile &&
    findProfileBySlug([iremCollisionProfile], "irem-vip-istanbul") === iremCollisionProfile
  ) {
    pass("duplicate Irem profile keeps a distinct canonical with legacy redirect compatibility");
  } else {
    fail("duplicate Irem profile keeps a distinct canonical with legacy redirect compatibility");
  }

  if (findProfileBySlug([aliasCollision, exactCollision], "sofia-istanbul") === exactCollision) {
    pass("stored profile slug wins over another profile alias");
  } else {
    fail("stored profile slug wins over another profile alias");
  }

  if (
    getProfileSlug(baharGeneratedProfile) === "bahar-istanbul" &&
    findProfileBySlug([baharGeneratedProfile], "bahar-39bc3dbe") === baharGeneratedProfile &&
    findProfileBySlug([baharGeneratedProfile], "bahar-istanbul") === baharGeneratedProfile &&
    getProfileSlug(betulGeneratedProfile) === "betul-istanbul" &&
    findProfileBySlug([betulGeneratedProfile], "betul-0a8e1b15") === betulGeneratedProfile &&
    findProfileBySlug([betulGeneratedProfile], "betul-istanbul") === betulGeneratedProfile
  ) {
    pass("generated Bahar and Betul slugs resolve to clean canonical URLs with legacy compatibility");
  } else {
    fail("generated Bahar and Betul slugs resolve to clean canonical URLs with legacy compatibility");
  }

  const verifiedLegacyCansu = {
    slug: "cansu-istanbul",
    name: "CANSU",
    city: "İstanbul",
    district: "İstanbul Geneli"
  };
  const verifiedLegacyProfiles = [
    verifiedLegacyCansu,
    { slug: "aleyna-istanbul", name: "ALEYNA", city: "İstanbul", district: "İstanbul Geneli" },
    { slug: "irem-vip-istanbul", name: "İREM", city: "İstanbul", district: "İstanbul Geneli" },
    { slug: "melis-istanbul", name: "MELİS", city: "İstanbul", district: "İstanbul Geneli" },
    { slug: "merve-istanbul", name: "MERVE", city: "İstanbul", district: "İstanbul Geneli" }
  ];
  const verifiedLegacyAliases = new Map([
    ["cansu-sisli", "cansu-istanbul"],
    ["aleyna-fatih", "aleyna-istanbul"],
    ["irem-bahcelievler", "irem-vip-istanbul"],
    ["melis-besiktas", "melis-istanbul"],
    ["merve-levent", "merve-istanbul"]
  ]);
  const legacyAliasesResolve = [...verifiedLegacyAliases].every(([legacySlug, canonicalSlug]) => {
    const expected = verifiedLegacyProfiles.find((profile) => profile.slug === canonicalSlug);
    return expected && findProfileBySlug(verifiedLegacyProfiles, legacySlug) === expected;
  });
  if (legacyAliasesResolve) {
    pass("verified legacy ranking profile slugs resolve to their current canonical profiles");
  } else {
    fail("verified legacy ranking profile slugs resolve to their current canonical profiles");
  }
}

assertProfileCanonicalSlugContracts();

async function assertSeoHeadContracts() {
  const contractProfilePath = await getContractProfilePath();
  const allHtmlTemplates = [
    "404.html",
    "bolge.html",
    "detay.html",
    "guven-ve-politikalar.html",
    "ilanlar.html",
    "iletisim.html",
    "index.html",
    "istanbul.html",
    "kategori-landing.html",
    "kategori.html"
  ];
  const privateHtmlTemplates = ["customer-panel.html", "vg-panel-91x.html"];
  const staticTemplates = [
    "index.html",
    "guven-ve-politikalar.html",
    "iletisim.html",
    "kategori.html",
    "ilanlar.html",
    "istanbul.html",
    "bolge.html",
    "kategori-landing.html",
    "detay.html"
  ];

  for (const file of allHtmlTemplates) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const robots = html.match(/<meta\s+name="robots"\s+content="([^"]*)"/i)?.[1] || "";
    if (robots.includes("index") && !/\bnoindex\b/i.test(robots)) {
      pass(`${file} has an indexable robots directive`);
    } else {
      fail(`${file} is missing an indexable robots directive`);
    }
  }
  for (const file of privateHtmlTemplates) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const robots = html.match(/<meta\s+name="robots"\s+content="([^"]*)"/i)?.[1] || "";
    if (/\bnoindex\b/i.test(robots) && /\bnofollow\b/i.test(robots)) {
      pass(`${file} has a private noindex robots directive`);
    } else {
      fail(`${file} is missing a private noindex robots directive`);
    }
  }
  const staticPatterns = [
    { label: "description", pattern: /<meta\s+name="description"\s+content="[^"]*">/i },
    { label: "og:title", pattern: /<meta\s+property="og:title"\s+content="[^"]*">/i },
    { label: "og:description", pattern: /<meta\s+property="og:description"\s+content="[^"]*">/i },
    { label: "og:image", pattern: /<meta\s+property="og:image"\s+content="[^"]*">/i },
    { label: "twitter:card", pattern: /<meta\s+name="twitter:card"\s+content="[^"]*">/i },
    { label: "twitter:title", pattern: /<meta\s+name="twitter:title"\s+content="[^"]*">/i },
    { label: "twitter:description", pattern: /<meta\s+name="twitter:description"\s+content="[^"]*">/i },
    { label: "twitter:image", pattern: /<meta\s+name="twitter:image"\s+content="[^"]*">/i }
  ];

  for (const file of staticTemplates) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const missing = staticPatterns
      .filter(({ pattern }) => !pattern.test(html))
      .map(({ label }) => label);

    if (!missing.length) {
      pass(`${file} static fallback meta pack`);
    } else {
      fail(`${file} static fallback meta missing ${missing.join(", ")}`);
    }
  }

  const runtimePages = [
    "/",
    "/guven-ve-politikalar",
    "/iletisim",
    "/ilanlar",
    "/kategoriler",
    "/istanbul-escort",
    "/cihangir-escort",
    "/sisli-escort",
    "/vip-escort",
    "/esmer-escort",
    contractProfilePath
  ];
  const runtimePatterns = [
    { label: "description", pattern: /<meta\s+name="description"\s+content="[^"]*">/gi },
    { label: "canonical", pattern: /<link\s+rel="canonical"\s+href="[^"]*">/gi },
    { label: "og:title", pattern: /<meta\s+property="og:title"\s+content="[^"]*">/gi },
    { label: "og:description", pattern: /<meta\s+property="og:description"\s+content="[^"]*">/gi },
    { label: "og:url", pattern: /<meta\s+property="og:url"\s+content="[^"]*">/gi },
    { label: "og:image", pattern: /<meta\s+property="og:image"\s+content="[^"]*">/gi },
    { label: "twitter:card", pattern: /<meta\s+name="twitter:card"\s+content="[^"]*">/gi },
    { label: "twitter:title", pattern: /<meta\s+name="twitter:title"\s+content="[^"]*">/gi },
    { label: "twitter:description", pattern: /<meta\s+name="twitter:description"\s+content="[^"]*">/gi },
    { label: "twitter:image", pattern: /<meta\s+name="twitter:image"\s+content="[^"]*">/gi }
  ];

  const runtimeSitemap = await text("/sitemap.xml", 200, "application/xml");
  const indexablePaths = new Set([...String(runtimeSitemap).matchAll(/<loc>(.*?)<\/loc>/g)].map(match => new URL(match[1]).pathname));
  for (const path of runtimePages) {
    const html = await text(path, 200, "text/html");
    if (!html) continue;

    const robots = html.match(/<meta\s+name="robots"\s+content="([^"]*)"/i)?.[1] || "";
    const emptyLanding = /data-page="landing-/.test(html) && !indexablePaths.has(path);
    if (emptyLanding && /\bnoindex\b/i.test(robots)) {
      pass(`${path} empty landing is excluded from indexing`);
    } else if (!emptyLanding && robots.includes("index") && !/\bnoindex\b/i.test(robots)) {
      pass(`${path} is indexable in rendered HTML`);
    } else {
      fail(`${path} rendered HTML is not indexable`);
    }

    const duplicates = runtimePatterns
      .map(({ label, pattern }) => ({ label, count: countMatches(html, pattern) }))
      .filter(({ count }) => count !== 1);

    if (!duplicates.length) {
      pass(`${path} unique SEO head tags`);
    } else {
      fail(`${path} unique SEO head tags ${duplicates.map(({ label, count }) => `${label}:${count}`).join(", ")}`);
    }

    if (["/istanbul-escort", "/sisli-escort", "/vip-escort", "/esmer-escort"].includes(path)) {
      const hasUnsupportedCarousel = html.includes('"@type":"ItemList"');
      const hasVisibleProfileCards = html.includes('class="category-card"');
      const emptyCategory = ["/vip-escort", "/esmer-escort"].includes(path) && !hasVisibleProfileCards;
      const indexableRobots = robots.includes("index") && !/\bnoindex\b/i.test(robots);
      if (!hasUnsupportedCarousel && hasVisibleProfileCards) {
        pass(`${path} exposes visible profile links without unsupported Carousel markup`);
      } else if (!hasUnsupportedCarousel && emptyCategory && indexableRobots) {
        pass(`${path} empty category stays indexable per owner policy without fake Carousel markup`);
      } else {
        fail(`${path} exposes visible profile links without unsupported Carousel markup`);
      }
    }
  }

  const cihangirHtml = await text("/cihangir-escort", 200, "text/html");
  const cihangirDescription = cihangirHtml?.match(/<meta\s+name="description"\s+content="([^"]*)">/i)?.[1] || "";
  if (
    cihangirDescription.length >= 80 &&
    cihangirDescription.length <= 155 &&
    /[.!?]$/.test(cihangirDescription) &&
    !/\b(?:temel|ve|ile|için)\.$/i.test(cihangirDescription)
  ) {
    pass("Cihangir meta description ends as a complete sentence");
  } else {
    fail("Cihangir meta description ends as a complete sentence");
  }

  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalToken = process.env.CLOUDFLARE_API_TOKEN;
  const originalFallbackToken = process.env.CF_API_TOKEN;
  const purgeCalls = [];

  try {
    process.env.CLOUDFLARE_API_TOKEN = "contract-token";
    delete process.env.CF_API_TOKEN;
    console.log = () => {};
    globalThis.fetch = async (url, options = {}) => {
      purgeCalls.push({ url: String(url), options });
      const isZoneLookup = String(url).includes("/zones?");
      return {
        ok: true,
        status: 200,
        json: async () => isZoneLookup
          ? {
              success: true,
              result: [{ id: "vip-gece-zone", name: "vip-gece.site", status: "active", paused: false }]
            }
          : { success: true, result: {} }
      };
    };

    await import(`./purge-vip-site-cache.mjs?contract=${Date.now()}`);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    if (originalToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = originalToken;
    if (originalFallbackToken === undefined) delete process.env.CF_API_TOKEN;
    else process.env.CF_API_TOKEN = originalFallbackToken;
  }

  const purgeCall = purgeCalls.at(-1);
  const purgeBody = JSON.parse(purgeCall?.options?.body || "{}");
  if (
    purgeCalls.length === 3 &&
    purgeCall?.url === "https://api.cloudflare.com/client/v4/zones/vip-gece-zone/purge_cache" &&
    purgeCall?.options?.method === "POST" &&
    JSON.stringify(purgeBody) === JSON.stringify({
      files: [
        "https://vip-gece.site/robots.txt",
        "https://www.vip-gece.site/robots.txt"
      ]
    })
  ) {
    pass("Cloudflare cache helper purges only exact robots URLs");
  } else {
    fail("Cloudflare cache helper purges only exact robots URLs");
  }
}

function extractJsonLd(html) {
  const blocks = [];
  const pattern = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = pattern.exec(html))) {
    try {
      blocks.push(JSON.parse(match[1]));
    } catch (err) {
      fail(`JSON-LD parse failed: ${err.message}`);
    }
  }

  return blocks;
}

function findJsonLdType(blocks, type) {
  return blocks.find((block) => {
    if (!block || typeof block !== "object") return false;
    const blockType = block["@type"];
    return Array.isArray(blockType) ? blockType.includes(type) : blockType === type;
  });
}

function assertSequentialListItems(items, label) {
  if (!Array.isArray(items) || !items.length) {
    fail(`${label} JSON-LD has list items`);
    return false;
  }

  const getItemUrl = (item) => {
    if (typeof item?.item === "string") return item.item;
    if (item?.item && typeof item.item.url === "string") return item.item.url;
    return item?.url || "";
  };

  const valid = items.every((item, index) => {
    const itemUrl = getItemUrl(item);
    const baseValid = (
      item &&
      item["@type"] === "ListItem" &&
      item.position === index + 1 &&
      typeof itemUrl === "string" &&
      itemUrl.startsWith(EXPECTED_SITE_URL)
    );

    if (!baseValid) return false;

    return typeof item.name === "string" && item.name.trim();
  });

  if (valid) {
    pass(`${label} JSON-LD list items are canonical and sequential`);
  } else {
    fail(`${label} JSON-LD list items are canonical and sequential`);
  }

  return valid;
}

async function assertStructuredDataContracts() {
  const contractProfilePath = await getContractProfilePath();
  const checks = [
    { path: "/", type: "CollectionPage", needsWebsite: true, forbidsUnsupportedCarousel: true },
    { path: "/guven-ve-politikalar", type: "WebPage", needsBreadcrumb: true },
    { path: "/iletisim", type: "WebPage", needsBreadcrumb: true, needsFaq: true },
    { path: "/ilanlar", type: "CollectionPage", needsBreadcrumb: true, needsFaq: true, forbidsUnsupportedCarousel: true },
    { path: "/kategoriler", type: "CollectionPage", needsBreadcrumb: true, needsFaq: true, forbidsUnsupportedCarousel: true },
    { path: "/istanbul-escort", type: "CollectionPage", needsBreadcrumb: true, forbidsUnsupportedCarousel: true },
    { path: "/sisli-escort", type: "CollectionPage", needsBreadcrumb: true, forbidsUnsupportedCarousel: true },
    { path: "/vip-escort", type: "CollectionPage", needsBreadcrumb: true, forbidsUnsupportedCarousel: true },
    { path: contractProfilePath, type: "ProfilePage", needsBreadcrumb: true, needsImage: true }
  ];

  for (const check of checks) {
    const html = await text(check.path, 200, "text/html");
    if (!html) continue;

    const blocks = extractJsonLd(html);
    const primary = findJsonLdType(blocks, check.type);
    const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="([^"]+)">/i);
    const canonical = canonicalMatch?.[1] || "";

    if (primary && primary.url === canonical && canonical.startsWith(EXPECTED_SITE_URL)) {
      pass(`${check.path} primary JSON-LD matches canonical`);
    } else {
      fail(`${check.path} primary JSON-LD matches canonical`);
    }

    if (
      check.type !== "CollectionPage" ||
      (primary && !("keywords" in primary) && !("about" in primary))
    ) {
      pass(`${check.path} CollectionPage avoids keyword-stuffed JSON-LD`);
    } else {
      fail(`${check.path} CollectionPage avoids keyword-stuffed JSON-LD`);
    }

    if (check.needsWebsite && findJsonLdType(blocks, "WebSite")) {
      pass(`${check.path} WebSite JSON-LD exists`);
    } else if (check.needsWebsite) {
      fail(`${check.path} WebSite JSON-LD exists`);
    }

    if (check.forbidsUnsupportedCarousel) {
      const itemList = findJsonLdType(blocks, "ItemList");
      if (!itemList) {
        pass(`${check.path} avoids unsupported Carousel ItemList markup`);
      } else {
        fail(`${check.path} avoids unsupported Carousel ItemList markup`);
      }
    }

    if (check.needsBreadcrumb) {
      const breadcrumb = findJsonLdType(blocks, "BreadcrumbList");
      assertSequentialListItems(breadcrumb?.itemListElement, `${check.path} BreadcrumbList`);
    }

    if (check.needsFaq) {
      const faq = findJsonLdType(blocks, "FAQPage");
      const entities = Array.isArray(faq?.mainEntity) ? faq.mainEntity : [];
      if (faq && entities.length > 0) {
        pass(`${check.path} FAQPage JSON-LD exists`);
      } else {
        fail(`${check.path} FAQPage JSON-LD exists`);
      }
    }

    if (check.needsImage) {
      const imageObject = findJsonLdType(blocks, "ImageObject");
      if (imageObject && typeof imageObject.url === "string" && imageObject.url.startsWith(EXPECTED_SITE_URL)) {
        pass(`${check.path} ImageObject uses same-origin optimized media`);
      } else {
        fail(`${check.path} ImageObject uses same-origin optimized media`);
      }
    }
  }
}

async function assertGoogleAnalyticsContracts() {
  const expectedId = "G-MGGWKPN1KH";
  const analyticsClient = await readFile(new URL("../public/js/google-analytics.js", import.meta.url), "utf8");
  const detailAnalyticsClient = await readFile(new URL("../public/js/detail/analytics.js", import.meta.url), "utf8");
  const detailViewClient = await readFile(new URL("../public/js/detail/view.js", import.meta.url), "utf8");
  const siteConfigSource = await readFile(new URL("../config.js", import.meta.url), "utf8");
  const leadEvent = normalizeProfileAnalyticsEvent({
    event_type: "contact_click",
    profile_slug: "contract-profile",
    source: "google",
    channel: "whatsapp",
    lead_reference: "VG-ABC123DEF456",
    event_id: "11111111-1111-4111-8111-111111111111",
    proof: "contract-page-proof"
  });

  if (
    analyticsClient.includes("dataLayer") &&
    includesCode(analyticsClient, 'window.gtag("config", measurementId') &&
    includesCode(analyticsClient, "send_page_view: true") &&
    includesCode(analyticsClient, "anonymize_ip: true") &&
    analyticsClient.includes("loadRemoteGtag") &&
    analyticsClient.includes("queueRemoteTransport") &&
    analyticsClient.includes("analyticsTransportDelayMs") &&
    analyticsClient.includes("requestIdleCallback") &&
    analyticsClient.includes("\"pointerdown\", \"keydown\", \"touchstart\"") &&
    analyticsClient.includes("pagehide") &&
    analyticsClient.includes("visibilitychange") &&
    analyticsClient.includes("vip-gece-acquisition-v1") &&
    analyticsClient.includes("acquisitionTtlMs") &&
    !analyticsClient.includes("analyticsFallbackDelayMs") &&
    !analyticsClient.includes("scheduleAnalyticsActivation") &&
    includesCode(detailAnalyticsClient, 'window.gtag("event", "generate_lead"') &&
    detailAnalyticsClient.includes("recentAcquisitionSource") &&
    detailAnalyticsClient.includes("lead_reference") &&
    detailViewClient.includes("?text=${encodeURIComponent(message)}") &&
    detailViewClient.includes("data-lead-reference") &&
    siteConfigSource.includes("🔖 VIP GECE Referansı: {reference}") &&
    leadEvent.leadReference === "VG-ABC123DEF456" &&
    includesCode(analyticsClient, "startAnalytics();")
  ) {
    pass("Google Analytics client queues GA4 immediately and defers remote transport for PageSpeed");
  } else {
    fail("Google Analytics client queues GA4 immediately and defers remote transport for PageSpeed");
  }

  const contractProfilePath = await getContractProfilePath();
  for (const path of ["/", "/ilanlar", "/kategoriler", "/istanbul-escort", contractProfilePath]) {
    const html = await text(path, 200, "text/html");
    if (!html) continue;

    const hasRemoteLoader = html.includes(`https://www.googletagmanager.com/gtag/js?id=${expectedId}`);
    const hasLocalConfig = html.includes('/public/js/google-analytics.js?v=20260911-pagespeed1" data-ga-measurement-id="G-MGGWKPN1KH"');
    const loaderCount = countMatches(html, /googletagmanager\.com\/gtag\/js\?id=G-MGGWKPN1KH/g);
    const localCount = countMatches(html, /\/public\/js\/google-analytics\.js\?v=20260911-pagespeed1/g);

    if (!hasRemoteLoader && hasLocalConfig && loaderCount === 0 && localCount === 1) {
      pass(`${path} GA4 immediate client bootstrap tag`);
    } else {
      fail(`${path} GA4 immediate client bootstrap tag`);
    }
  }
}

async function assertHomePageSpeedContracts() {
  const [html, llmsText, deferredCssSource] = await Promise.all([
    text("/", 200, "text/html"),
    readFile(new URL("../llms.txt", import.meta.url), "utf8"),
    readFile(new URL("../public/js/deferred-css.js", import.meta.url), "utf8")
  ]);
  if (!html) return;

  const renderBlockingLocalCss = /<link\b[^>]*href=["']\/(?:style\.css|public\/css\/(?:icons|components|home-redesign)\.css)/i;
  if (
    html.includes('<style data-home-critical-css>') &&
    !renderBlockingLocalCss.test(html) &&
    !html.includes("/public/js/home-render.js")
  ) {
    pass("home SSR inlines its render CSS and omits redundant hydration chain");
  } else {
    fail("home SSR inlines its render CSS and omits redundant hydration chain");
  }

  if (
    !/<link\b[^>]*rel=["']preload["'][^>]*vip-gece-brand-banner/i.test(html) &&
    html.includes('type="image/avif" srcset="data:image/avif;base64,') &&
    html.includes("vip-gece-brand-banner-20260726-720.webp") &&
    /class="site-logo"[^>]*loading="eager"[^>]*fetchpriority="high"/i.test(html)
  ) {
    pass("home responsive LCP banner inlines its critical AVIF with a WebP fallback and high fetch priority");
  } else {
    fail("home responsive LCP banner inlines its critical AVIF with a WebP fallback and high fetch priority");
  }

  const selectedCards = countMatches(html, /class="selected-card"/g);
  const selectedH2 = countMatches(html, /<h2 class="selected-name">/g);
  if (selectedCards > 0 && selectedH2 === selectedCards && !/<h3 class="selected-name">/i.test(html)) {
    pass("home selected profile headings follow the H1 to H2 hierarchy");
  } else {
    fail("home selected profile headings follow the H1 to H2 hierarchy");
  }

  if (/^#\s+VIP Gece\s*$/m.test(llmsText) && /\[[^\]]+\]\(https:\/\/vip-gece\.site\//.test(llmsText)) {
    pass("llms.txt exposes an H1 and Markdown links");
  } else {
    fail("llms.txt exposes an H1 and Markdown links");
  }

  if (
    html.includes("family=Manrope") &&
    html.includes("display=optional") &&
    !html.includes("display=swap") &&
    html.includes('data-href="https://fonts.googleapis.com/') &&
    !html.includes('rel="preconnect" href="https://fonts.') &&
    deferredCssSource.includes('const interactionEvents = ["pointerdown", "keydown", "touchstart"]') &&
    deferredCssSource.includes('link.setAttribute("href", href)')
  ) {
    pass("home web fonts wait for real interaction and avoid first-load network or CLS");
  } else {
    fail("home web fonts wait for real interaction and avoid first-load network or CLS");
  }

  if (html.includes('/public/assets/favicon-32.png?v=20260810-perf1')) {
    pass("home uses the compact 32px favicon asset");
  } else {
    fail("home uses the compact 32px favicon asset");
  }
}

async function assertPublicImagePriorityContracts() {
  const contractProfilePath = await getContractProfilePath();
  const routeChecks = [
    { path: "/ilanlar", label: "listings primary card", pattern: /<img[^>]*fetchpriority="high"[^>]*>/i },
    { path: "/istanbul-escort", label: "city landing primary card", pattern: /<img[^>]*fetchpriority="high"[^>]*>/i },
    { path: "/vip-escort", label: "category landing primary card", pattern: /<img[^>]*fetchpriority="high"[^>]*>/i },
    { path: "/esmer-escort", label: "category landing primary card", pattern: /<img[^>]*fetchpriority="high"[^>]*>/i },
    { path: contractProfilePath, label: "detail main image", pattern: /id="detailMainImage"[^>]*loading="eager"[^>]*fetchpriority="high"/i }
  ];

  for (const { path, label, pattern } of routeChecks) {
    const html = await text(path, 200, "text/html");
    if (!html) continue;

    if (pattern.test(html)) {
      pass(`${path} ${label} priority hints`);
    } else if (["/vip-escort", "/esmer-escort"].includes(path) && !html.includes('class="category-card"')) {
      pass(`${path} empty legacy category avoids fake priority image`);
    } else {
      fail(`${path} ${label} priority hints`);
    }
  }

  const landingHtml = renderCategoryHtml("istanbul-escort", getDemoProfiles()) || "";
  const listingsHtml = renderListingsHubHtml(getDemoProfiles()) || "";
  const primaryImages = [...landingHtml.matchAll(/<div class="category-card-cover">\s*(<img[^>]+>)/gi)]
    .map((match) => match[1]);
  const miniImages = [...landingHtml.matchAll(/<div class="landing-mini-cover">\s*(<img[^>]+>)/gi)]
    .map((match) => match[1]);
  const listingsImages = [...listingsHtml.matchAll(/<div class="listings-card-cover">\s*(<img[^>]+>)/gi)]
    .map((match) => match[1]);
  const listingsRowImages = [...listingsHtml.matchAll(/<a class="listings-row"[^>]*>\s*(<img[^>]+>)/gi)]
    .map((match) => match[1]);
  const isEagerHigh = (image) => (
    /loading="eager"/i.test(image) &&
    /fetchpriority="high"/i.test(image)
  );
  const isLazyWithoutPriority = (image) => (
    /loading="lazy"/i.test(image) &&
    !/fetchpriority="high"/i.test(image)
  );

  if (
    primaryImages.length > 1 &&
    miniImages.length > 0 &&
    listingsImages.length > 1 &&
    listingsRowImages.length > 0 &&
    isEagerHigh(primaryImages[0]) &&
    primaryImages.slice(1).every(isLazyWithoutPriority) &&
    miniImages.every(isLazyWithoutPriority) &&
    isEagerHigh(listingsImages[0]) &&
    listingsImages.slice(1).every(isLazyWithoutPriority) &&
    listingsRowImages.every(isLazyWithoutPriority)
  ) {
    pass("landing and listings keep one primary LCP image eager while secondary rails stay lazy");
  } else {
    fail("landing and listings keep one primary LCP image eager while secondary rails stay lazy");
  }
}

function assertHomeImagePriorityContracts() {
  const profile = (id, name, type = "normal") => ({
    id,
    name,
    city: "İstanbul",
    district: "Şişli",
    type,
    is_active: true,
    is_featured: type === "vip",
    images: [`https://demo.supabase.co/storage/v1/object/public/images/profiles/${id}.jpeg`]
  });
  const previousAllowedHosts = process.env.PROFILE_IMAGE_ALLOWED_HOSTS;
  let html = "";
  try {
    process.env.PROFILE_IMAGE_ALLOWED_HOSTS = [previousAllowedHosts, "demo.supabase.co"]
      .filter(Boolean)
      .join(",");
    html = renderHomeHtml([
      { ...profile("home-perf-check-vip-1", "Perf Check One", "vip"), vip_slot: 1 },
      { ...profile("home-perf-check-vip-2", "Perf Check Two", "vip"), vip_slot: 2 },
      { ...profile("home-perf-check-vip-3", "Perf Check Three", "vip"), vip_slot: 3 },
      { ...profile("home-perf-check-normal-1", "Perf Check Four"), normal_slot: 4 },
      { ...profile("home-perf-check-normal-2", "Perf Check Five"), normal_slot: 5 }
    ]);
  } finally {
    if (previousAllowedHosts === undefined) delete process.env.PROFILE_IMAGE_ALLOWED_HOSTS;
    else process.env.PROFILE_IMAGE_ALLOWED_HOSTS = previousAllowedHosts;
  }
  const storyImage = html.match(/<span class="home-story-visual">\s*(<img[^>]+>)/i)?.[1] || "";
  const selectedImages = [...html.matchAll(/<div class="selected-image-wrap">\s*(<img[^>]+>)/gi)]
    .map((match) => match[1]);
  const selectedImage = selectedImages[0] || "";
  const deferredSelectedImages = selectedImages;
  const highPriorityProfileImageCount = countMatches(
    html,
    /<img(?=[^>]+\/media\/profile-image\/)(?=[^>]+fetchpriority="high")[^>]*>/gi
  );

  if (
    !html.includes('<link rel="preconnect" href="https://demo.supabase.co"') &&
    !/<link\s+rel="preload"[^>]+as="image"[^>]+\/media\/profile-image\//i.test(html) &&
    highPriorityProfileImageCount === 0 &&
    /loading="eager"/i.test(storyImage) &&
    /fetchpriority="low"/i.test(storyImage) &&
    deferredSelectedImages.every((image) => /loading="lazy"/i.test(image) && /fetchpriority="low"/i.test(image)) &&
    /sizes="\(max-width: 720px\) 18vw, \(max-width: 1024px\) 14vw, 10vw"/i.test(storyImage) &&
    /sizes="\(max-width: 1024px\) 20vw, 16vw"/i.test(selectedImage)
  ) {
    pass("home keeps the responsive brand as the sole high-priority LCP resource while profile images stay lazy or low-priority");
  } else {
    fail("home keeps the responsive brand as the sole high-priority LCP resource while profile images stay lazy or low-priority");
  }

  const latestSectionStart = html.indexOf('id="latestSection"');
  const selectedSectionStart = html.indexOf('id="selectedProfilesSection"');
  if (
    latestSectionStart >= 0 &&
    selectedSectionStart > latestSectionStart &&
    /<section class="story-board" id="latestSection">[\s\S]*?<\/section>\s*<section class="selected-board" id="selectedProfilesSection">/.test(html) &&
    !html.includes('id="featuredSection"') &&
    !html.includes('id="featuredProfiles"') &&
    !html.includes("VIP Vitrin") &&
    !html.includes('class="profile-discovery"') &&
    countMatches(html, /<h1\b/gi) === 1 &&
    html.includes('<h1 id="normalTitle">VIP Profiller</h1>')
  ) {
    pass("home places selected profiles directly after latest profiles without showcase/discovery blocks");
  } else {
    fail("home places selected profiles directly after latest profiles without showcase/discovery blocks");
  }

  const coverageProfiles = Array.from({ length: 20 }, (_, index) =>
    ({
      ...profile(`home-coverage-${index + 1}`, `Coverage ${index + 1}`),
      normal_slot: index + 1
    }));
  const coverageHtml = renderHomeHtml(coverageProfiles);
  if (
    coverageProfiles.every((item) =>
      coverageHtml.includes(`href="/profil/${getProfileSlug(item)}"`)) &&
    coverageHtml.includes('<a href="/ilanlar">Tüm İlanlar ')
  ) {
    pass("home SSR links every publishable profile and exposes all listings");
  } else {
    fail("home SSR links every publishable profile and exposes all listings");
  }

  const gridProfiles = Array.from({ length: 60 }, (_, index) => ({
    ...profile(`home-grid-${index + 1}`, `Grid ${String(index + 1).padStart(2, "0")}`),
    normal_slot: index + 1
  }));
  const gridHtml = renderHomeHtml(gridProfiles);
  const gridStart = gridHtml.indexOf('id="normalProfiles"');
  const gridEnd = gridHtml.indexOf("</section>", gridStart);
  const selectedGridHtml = gridStart >= 0 && gridEnd > gridStart
    ? gridHtml.slice(gridStart, gridEnd)
    : "";
  const selectedGridSlugs = [...selectedGridHtml.matchAll(/href="\/profil\/([^"]+)"/g)]
    .map((match) => match[1]);
  const expectedGridSlugs = gridProfiles
    .slice(0, 50)
    .map((item) => getProfileSlug(item));
  if (
    countMatches(selectedGridHtml, /class="selected-card"/g) === 50 &&
    JSON.stringify(selectedGridSlugs) === JSON.stringify(expectedGridSlugs) &&
    !selectedGridHtml.includes(`/profil/${getProfileSlug(gridProfiles[50])}`)
  ) {
    pass("home selected grid keeps exact admin order and a 50-profile limit");
  } else {
    fail("home selected grid keeps exact admin order and a 50-profile limit");
  }

  const sparseGridProfiles = [
    { ...profile("home-grid-out-67", "Grid Out 67"), normal_slot: 67 },
    { ...profile("home-grid-in-2", "Grid In 02"), normal_slot: 2 },
    { ...profile("home-grid-out-0", "Grid Out 00"), normal_slot: 0 },
    { ...profile("home-grid-in-1", "Grid In 01"), normal_slot: 1 },
    { ...profile("home-grid-in-50", "Grid In 50"), normal_slot: 50 },
    { ...profile("home-grid-out-51", "Grid Out 51"), normal_slot: 51 },
    { ...profile("home-grid-out-null", "Grid Out Null"), normal_slot: null }
  ];
  const sparseGridHtml = renderHomeHtml(sparseGridProfiles);
  const sparseGridStart = sparseGridHtml.indexOf('id="normalProfiles"');
  const sparseGridEnd = sparseGridHtml.indexOf("</section>", sparseGridStart);
  const sparseSelectedGridHtml = sparseGridStart >= 0 && sparseGridEnd > sparseGridStart
    ? sparseGridHtml.slice(sparseGridStart, sparseGridEnd)
    : "";
  const sparseGridSlugs = [...sparseSelectedGridHtml.matchAll(/href="\/profil\/([^"]+)"/g)]
    .map((match) => match[1]);
  const expectedSparseGridSlugs = [
    getProfileSlug(sparseGridProfiles[3]),
    getProfileSlug(sparseGridProfiles[1]),
    getProfileSlug(sparseGridProfiles[4])
  ];
  if (
    JSON.stringify(sparseGridSlugs) === JSON.stringify(expectedSparseGridSlugs) &&
    countMatches(sparseSelectedGridHtml, /class="selected-card"/g) === 3
  ) {
    pass("home selected grid includes only explicit slots 1 through 50");
  } else {
    fail("home selected grid includes only explicit slots 1 through 50");
  }

  const inactiveProfile = {
    ...profile("listings-inactive", "Inactive Listing"),
    is_active: false
  };
  const listingsHtml = renderListingsHubHtml([...coverageProfiles, inactiveProfile]);
  const listingsStart = listingsHtml.indexOf('id="listingsFeaturedGrid"');
  const listingsEnd = listingsHtml.indexOf('id="listingsRecentGrid"');
  const listingsGridHtml = listingsStart >= 0 && listingsEnd > listingsStart
    ? listingsHtml.slice(listingsStart, listingsEnd)
    : "";
  const listingsCardCount = countMatches(listingsGridHtml, /class="listings-card"/g);
  if (
    listingsCardCount === coverageProfiles.length &&
    coverageProfiles.every((item) =>
      listingsGridHtml.includes(`href="/profil/${getProfileSlug(item)}"`)) &&
    !listingsGridHtml.includes(`/profil/${getProfileSlug(inactiveProfile)}`) &&
    listingsHtml.includes("Tüm Yayındaki İlanlar")
  ) {
    pass("listings SSR main grid includes every active profile and excludes drafts");
  } else {
    fail("listings SSR main grid includes every active profile and excludes drafts");
  }
}

async function assertPublicShellSsrContracts() {
  const contractProfilePath = await getContractProfilePath();
  const routeChecks = [
    { path: "/guven-ve-politikalar", status: 200, activeNav: "" },
    { path: "/iletisim", status: 200, activeNav: "contact" },
    { path: "/ilanlar", status: 200, activeNav: "profiles" },
    { path: "/kategoriler", status: 200, activeNav: "categories" },
    { path: "/istanbul-escort", status: 200, activeNav: "regions" },
    { path: contractProfilePath, status: 200, activeNav: "profiles" },
    { path: "/profil/profil-yok", status: 404, activeNav: "profiles" },
    { path: "/olmayan-yuzey-404", status: 404, activeNav: "" }
  ];

  for (const { path, status, activeNav } of routeChecks) {
    const html = await text(path, status, "text/html");
    if (!html) continue;

    const hasShell =
      html.includes('<header class="site-header">') &&
      html.includes('<nav class="mobile-nav" aria-label="Alt gezinme">') &&
      html.includes('<footer class="site-footer">') &&
      html.includes("data-copyright-notice") &&
      html.includes('class="footer-policy-link"');
    const removedPlaceholders =
      !html.includes('data-component="header"') &&
      !html.includes('data-component="mobile-nav"') &&
      !html.includes('data-component="footer"');
    const activeState = !activeNav || new RegExp(`data-nav="${activeNav}"[^>]*class="[^"]*active[^"]*"[^>]*aria-current="page"|data-nav="${activeNav}"[^>]*aria-current="page"[^>]*class="[^"]*active[^"]*"`, "i").test(html);

    if (hasShell && removedPlaceholders && activeState) {
      pass(`${path} SSR public shell is inlined`);
    } else {
      fail(`${path} SSR public shell is inlined`);
    }
  }
}

async function assertHomeTabBehaviorContracts() {
  const homeSources = await Promise.all([
    "../public/js/home/index.js",
    "../public/js/home/utils.js",
    "../public/js/home/sections.js",
    "../public/js/home/search.js"
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  const homeBundle = homeSources.join("\n");

  if (
    homeBundle.includes('target="_blank" rel="noopener noreferrer"') &&
    includesCompact(homeBundle, 'window.open(url, "_blank", "noopener,noreferrer")')
  ) {
    pass("home profile actions open in new tab");
  } else {
    fail("home profile actions open in new tab");
  }

  if (
    includesCompact(homeBundle, "homeProfileLinkAttributes(`${profile.name || \"Profil\"} profilini yeni sekmede aç`)") &&
    includesCompact(homeBundle, 'const openLabel = `${profile.name || "Profil"} profilini yeni sekmede aç`;') &&
    homeBundle.includes(">Aç<")
  ) {
    pass("home visible links expose new-tab intent");
  } else {
    fail("home visible links expose new-tab intent");
  }

  if (
    includesCompact(homeBundle, "const slot = Number(profile?.vip_slot ?? profile?.normal_slot);") &&
    includesCompact(homeBundle, "return Number.isInteger(slot) && slot >= 1 && slot <= 50") &&
    includesCompact(homeBundle, "profiles.slice(0, 50).map((profile, index) => createSelectedCard(profile, index))")
  ) {
    pass("home client uses the same explicit 1-50 curation window as SSR");
  } else {
    fail("home client uses the same explicit 1-50 curation window as SSR");
  }

  const nonHomeSources = await Promise.all([
    "../src/services/render/markup.js",
    "../src/services/render/detailRenderer.js",
    "../src/services/render/landingRenderer.js",
    "../src/services/render/hubRenderers.js",
    "../ilanlar.html",
    "../kategori.html",
    "../istanbul.html",
    "../bolge.html",
    "../kategori-landing.html"
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  const nonHomeBundle = nonHomeSources.join("\n");

  if (!/target="_blank"[^>]*href="\/profil\//.test(nonHomeBundle) && !/window\.open\(\s*["'`]\/profil\//.test(nonHomeBundle)) {
    pass("non-home profile links stay same-tab");
  } else {
    fail("non-home profile links stay same-tab");
  }
}

async function assertHomeSearchAccessibilityContracts() {
  const [indexHtml, searchJs] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/js/home/search.js", import.meta.url), "utf8")
  ]);

  if (
    indexHtml.includes('aria-describedby="profileSearchHint"') &&
    indexHtml.includes("Arama sonuçlarındaki profil bağlantıları yeni sekmede açılır.")
  ) {
    pass("home search announces new-tab behavior");
  } else {
    fail("home search announces new-tab behavior");
  }

  if (
    includesCode(searchJs, "let lastFocusedElement = null;") &&
    searchJs.includes("function trapDrawerFocus(event)") &&
    includesCode(searchJs, "drawer.addEventListener(\"keydown\", trapDrawerFocus);") &&
    includesAnyCode(searchJs, [
      "lastFocusedElement?.focus?.();",
      "lastFocusedElement&&typeof lastFocusedElement.focus==\"function\"&&lastFocusedElement.focus();"
    ])
  ) {
    pass("home search drawer restores and traps focus");
  } else {
    fail("home search drawer restores and traps focus");
  }
}

async function assertHomeSsrContracts() {
  const [homeUtils, homeIndex, html] = await Promise.all([
    readFile(new URL("../public/js/home/utils.js", import.meta.url), "utf8"),
    readFile(new URL("../public/js/home/index.js", import.meta.url), "utf8"),
    text("/", 200, "text/html")
  ]);

  if (
    !homeUtils.includes("window.__VIP_GECE_HOME__") &&
    includesCompact(homeIndex, 'document.body?.dataset?.serverRendered === "true"')
  ) {
    pass("home client recognizes SSR without executable inline state");
  } else {
    fail("home client recognizes SSR without executable inline state");
  }

  if (!html) return;

  const expectedMarkers = [
    'data-server-rendered="true"',
    'class="home-story-item"',
    'class="selected-card"',
    'class="mobile-nav"',
    'class="footer-policy-link"',
    'data-copyright-notice'
  ];

  const removedVisibleSections = [
    'id="regionsSection"',
    'id="categoriesSection"',
    'id="aboutSection"',
    'class="chip-bar-section"',
    'class="seo-directory-panel"',
    'class="directory-card"',
    'class="category-directory-card"'
  ];

  if (
    expectedMarkers.every((marker) => html.includes(marker)) &&
    removedVisibleSections.every((marker) => !html.includes(marker)) &&
    !html.includes("window.__VIP_GECE_HOME__=")
  ) {
    pass("home runtime HTML keeps core SSR content and omits removed visible directories");
  } else {
    fail("home runtime HTML keeps core SSR content and omits removed visible directories");
  }
}

async function assertPublicFallbackPolishContracts() {
  const templateFiles = [
    "istanbul.html",
    "bolge.html",
    "kategori-landing.html",
    "kategori.html"
  ];

  for (const file of templateFiles) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");

    if (
      !html.includes("Yükleniyor...") &&
      html.includes("empty-state-title") &&
      html.includes("empty-state-copy") &&
      html.includes("empty-state-links")
    ) {
      pass(`${file} fallback surface is editorialized`);
    } else {
      fail(`${file} fallback surface is editorialized`);
    }
  }

  const componentsCss = await readFile(new URL("../public/css/components.css", import.meta.url), "utf8");
  if (
    componentsCss.includes(".empty-state{") &&
    componentsCss.includes(".empty-state-title{") &&
    componentsCss.includes(".empty-state-links a{")
  ) {
    pass("shared empty-state pattern exists");
  } else {
    fail("shared empty-state pattern exists");
  }

  const detailHtml = await readFile(new URL("../detay.html", import.meta.url), "utf8");
  if (
    !detailHtml.includes("Yükleniyor...") &&
    detailHtml.includes("Profil Detayları") &&
    detailHtml.includes('id="detailQuickLinks"') &&
    detailHtml.includes('id="detailHubLinks"') &&
    detailHtml.includes('id="detailNearbyLinks"')
  ) {
    pass("detail template fallback is editorialized");
  } else {
    fail("detail template fallback is editorialized");
  }
}

async function assertClientImagePriorityContracts() {
  const [landingView, detailView, homeSections] = await Promise.all([
    readFile(new URL("../public/js/landing/view.js", import.meta.url), "utf8"),
    readFile(new URL("../public/js/detail/view.js", import.meta.url), "utf8"),
    readFile(new URL("../public/js/home/sections.js", import.meta.url), "utf8")
  ]);

  if (
    includesCode(landingView, 'image.loading = index < 2 ? "eager" : "lazy";') &&
    includesAnyCode(landingView, ['image.fetchPriority = "high";', 'fetchPriority = "high";']) &&
    landingView.includes("(max-width: 720px) 100vw, (max-width: 1024px) 50vw, 33vw") &&
    landingView.includes("(max-width: 1024px) 42vw, 18vw")
  ) {
    pass("landing client image priority hints preserved");
  } else {
    fail("landing client image priority hints preserved");
  }

  if (
    homeSections.includes("(max-width: 720px) 18vw, (max-width: 1024px) 14vw, 10vw") &&
    homeSections.includes("(max-width: 1024px) 20vw, 16vw") &&
    homeSections.includes("(max-width: 720px) 78vw, (max-width: 1024px) 50vw, 24vw")
  ) {
    pass("home client image sizes hints preserved");
  } else {
    fail("home client image sizes hints preserved");
  }

  if (
    includesAnyCode(detailView, ['main.fetchPriority = "high";', 'fetchPriority = "high";']) &&
    includesCode(detailView, 'main.loading = "eager";') &&
    includesCode(detailView, 'thumb.loading = index === 0 ? "eager" : "lazy";')
  ) {
    pass("detail client image priority hints preserved");
  } else {
    fail("detail client image priority hints preserved");
  }
}

async function assertMobileSafeAreaContracts() {
  const componentsCss = await readFile(new URL("../public/css/components.css", import.meta.url), "utf8");

  if (
    componentsCss.includes("env(safe-area-inset-bottom)") &&
    includesCode(componentsCss, "padding-bottom:calc(64px + env(safe-area-inset-bottom));") &&
    /bottom:max\((6px|4px),env\(safe-area-inset-bottom\)\);?/.test(compactSource(componentsCss))
  ) {
    pass("mobile nav safe-area spacing exists");
  } else {
    fail("mobile nav safe-area spacing exists");
  }
}

async function assertRuntimeEmptyStateContracts() {
  const [serverMarkup, landingView, detailView] = await Promise.all([
    readFile(new URL("../src/services/render/markup.js", import.meta.url), "utf8"),
    readFile(new URL("../public/js/landing/view.js", import.meta.url), "utf8"),
    readFile(new URL("../public/js/detail/view.js", import.meta.url), "utf8")
  ]);

  if (
    serverMarkup.includes("function renderEmptyStatePanel(title, copy, links = [])") &&
    serverMarkup.includes("empty-state-title") &&
    serverMarkup.includes("empty-state-copy") &&
    serverMarkup.includes("empty-state-links")
  ) {
    pass("server runtime empty states are editorialized");
  } else {
    fail("server runtime empty states are editorialized");
  }

  if (
    landingView.includes("export function createEmptyState(config)") &&
    landingView.includes("empty-state-title") &&
    landingView.includes("empty-state-copy") &&
    landingView.includes("empty-state-links")
  ) {
    pass("landing client empty states are editorialized");
  } else {
    fail("landing client empty states are editorialized");
  }

  if (
    includesCompact(detailView, "function createEmptyStatePanel(title, copy, links = [])") &&
    detailView.includes("Yakın bölgelerde başka profil görünmüyor.") &&
    detailView.includes("empty-state-links")
  ) {
    pass("detail client empty states are editorialized");
  } else {
    fail("detail client empty states are editorialized");
  }
}

async function assertMobileRailPolishContracts() {
  const [homeCss, listingsCss, categoriesCss, landingCss, detailCss, contactCss] = await Promise.all([
    readFile(new URL("../public/css/home-redesign.css", import.meta.url), "utf8"),
    readFile(new URL("../public/css/listings-hub.css", import.meta.url), "utf8"),
    readFile(new URL("../public/css/categories-hub.css", import.meta.url), "utf8"),
    readFile(new URL("../public/css/category-final.css", import.meta.url), "utf8"),
    readFile(new URL("../public/css/detail-final.css", import.meta.url), "utf8"),
    readFile(new URL("../public/css/contact-final.css", import.meta.url), "utf8")
  ]);

  if (
    includesCompact(homeCss, "scroll-snap-type: x proximity;") &&
    includesCompact(homeCss, "overscroll-behavior-inline: contain;") &&
    homeCss.includes("scroll-snap-align") &&
    includesCompact(homeCss, ".hero-highlight > span:not(.hero-highlight-icon)") &&
    includesCompact(homeCss, ".hero-highlight small { margin-top: 2px;") &&
    includesCode(homeCss, "flex: 0 0 74%;") &&
    includesCode(homeCss, "flex: 0 0 78%;") &&
    homeCss.includes(".directory-card-grid,") &&
    includesCompact(homeCss, ".internal-links {")
  ) {
    pass("home mobile rails use touch snap polish");
  } else {
    fail("home mobile rails use touch snap polish");
  }

  if (
    includesCompact(homeCss, ".story-board { align-self: start; width: 100%; min-height: auto;") &&
    includesCode(homeCss, "width: clamp(88px, 10vw, 132px);") &&
    includesCode(homeCss, "aspect-ratio: 4 / 5.12;") &&
    includesCode(homeCss, "min-height: clamp(118px, 10vw, 154px);") &&
    homeCss.includes(".latest-strip.is-marquee .latest-marquee-track") &&
    includesCompact(homeCss, "@media (prefers-reduced-motion: reduce)") &&
    includesCode(homeCss, "animation: none;") &&
    includesCode(homeCss, "animation-play-state: paused;") &&
    homeCss.includes(".home-story-visual img") &&
    homeCss.includes(".story-fallback") &&
    includesCode(homeCss, "display:block;") &&
    includesCode(homeCss, "width:100%;") &&
    includesCode(homeCss, "height:100%;") &&
    includesCode(homeCss, "grid-template-rows: auto auto;") &&
    includesCode(homeCss, "aspect-ratio: 4 / 5.28;")
  ) {
    pass("home story rail stays compact and horizontal");
  } else {
    fail("home story rail stays compact and horizontal");
  }

  if (
    includesCompact(listingsCss, "scroll-snap-type:x proximity;") &&
    includesCompact(listingsCss, "-webkit-overflow-scrolling:touch;") &&
    listingsCss.includes(".listings-stat{") &&
    listingsCss.includes("scroll-snap-align")
  ) {
    pass("listings mobile rails use touch snap polish");
  } else {
    fail("listings mobile rails use touch snap polish");
  }

  if (
    includesCompact(categoriesCss, "scroll-snap-type:x proximity;") &&
    categoriesCss.includes(".categories-hero-side{") &&
    categoriesCss.includes(".categories-side-panel{") &&
    categoriesCss.includes("scroll-snap-align")
  ) {
    pass("categories mobile rails use touch snap polish");
  } else {
    fail("categories mobile rails use touch snap polish");
  }

  if (
    landingCss.includes(".landing-surface{") &&
    includesCompact(landingCss, "content-visibility:auto;") &&
    landingCss.includes(".category-detail-grid{") &&
    includesCompact(landingCss, "scroll-snap-type:x proximity;") &&
    landingCss.includes(".landing-hero .landing-mini-card{") &&
    landingCss.includes("scroll-snap-align")
  ) {
    pass("landing sections use content-visibility and touch snap polish");
  } else {
    fail("landing sections use content-visibility and touch snap polish");
  }

  if (
    detailCss.includes(".detail-thumbs{") &&
    includesCompact(detailCss, "scroll-snap-type:x proximity;") &&
    detailCss.includes(".related-section{") &&
    includesCode(detailCss, "contain-intrinsic-size:460px;") &&
    detailCss.includes(".detail-thumb-button{") &&
    detailCss.includes("scroll-snap-align")
  ) {
    pass("detail gallery and lower sections use touch snap polish");
  } else {
    fail("detail gallery and lower sections use touch snap polish");
  }

  if (
    contactCss.includes(".contact-guides,") &&
    includesCompact(contactCss, "content-visibility:auto;") &&
    contactCss.includes(".contact-inline-links{") &&
    includesCompact(contactCss, "scroll-snap-type:x proximity;") &&
    contactCss.includes("scroll-snap-align")
  ) {
    pass("contact lower sections and rail use performance polish");
  } else {
    fail("contact lower sections and rail use performance polish");
  }
}

async function assertMobileOverflowContainmentContracts() {
  const [coreCss, homeCss, listingsCss, detailCss] = await Promise.all([
    readFile(new URL("../public/css/core.css", import.meta.url), "utf8"),
    readFile(new URL("../public/css/home-redesign.css", import.meta.url), "utf8"),
    readFile(new URL("../public/css/listings-hub.css", import.meta.url), "utf8"),
    readFile(new URL("../public/css/detail-final.css", import.meta.url), "utf8")
  ]);

  if (includesCode(coreCss, "--container:calc(100% - 14px);")) {
    pass("mobile container width uses valid calc syntax");
  } else {
    fail("mobile container width uses valid calc syntax");
  }

  if (
    homeCss.includes(".home-shell") &&
    includesCode(homeCss, "overflow-x: hidden;") &&
    homeCss.includes(".hero-cta-row") &&
    includesCode(homeCss, "grid-template-columns: repeat(2, minmax(0, 1fr));") &&
    includesCode(homeCss, "overflow-wrap: break-word;") &&
    includesCode(homeCss, "white-space: normal;")
  ) {
    pass("home mobile hero prevents viewport overflow");
  } else {
    fail("home mobile hero prevents viewport overflow");
  }

  if (
    listingsCss.includes(".listings-page") &&
    includesCode(listingsCss, "overflow-x:hidden;") &&
    listingsCss.includes(".listings-hero") &&
    includesCode(listingsCss, "min-width:0;")
  ) {
    pass("listings mobile shell prevents viewport overflow");
  } else {
    fail("listings mobile shell prevents viewport overflow");
  }

  if (
    detailCss.includes(".detail-page") &&
    includesCode(detailCss, "overflow-x:hidden;") &&
    detailCss.includes(".detail-shell") &&
    detailCss.includes(".detail-gallery-card") &&
    includesCode(detailCss, "min-width:0;")
  ) {
    pass("detail mobile shell prevents viewport overflow");
  } else {
    fail("detail mobile shell prevents viewport overflow");
  }
}

async function assertSkipLinkContracts() {
  const contractProfilePath = await getContractProfilePath();
  const [headerHtml, coreCss, homeCss, indexHtml] = await Promise.all([
    readFile(new URL("../public/components/header.html", import.meta.url), "utf8"),
    readFile(new URL("../public/css/core.css", import.meta.url), "utf8"),
    readFile(new URL("../public/css/home-redesign.css", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8")
  ]);

  if (
    headerHtml.includes('href="#mainContent"') &&
    coreCss.includes(".skip-link{") &&
    coreCss.includes(".skip-link:focus{") &&
    (homeCss.includes(".skip-link {") || homeCss.includes(".skip-link{")) &&
    indexHtml.includes('href="#mainContent" class="skip-link"')
  ) {
    pass("shared and home skip links exist");
  } else {
    fail("shared and home skip links exist");
  }

  const templateFiles = [
    "index.html",
    "guven-ve-politikalar.html",
    "ilanlar.html",
    "kategori.html",
    "istanbul.html",
    "bolge.html",
    "kategori-landing.html",
    "detay.html",
    "iletisim.html",
    "404.html"
  ];

  for (const file of templateFiles) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    if (html.includes('id="mainContent"') && html.includes('tabindex="-1"')) {
      pass(`${file} main target supports skip link`);
    } else {
      fail(`${file} main target supports skip link`);
    }
  }

  for (const path of ["/", "/guven-ve-politikalar", "/iletisim", "/ilanlar", "/kategoriler", "/istanbul-escort", contractProfilePath, "/olmayan-yuzey-404"]) {
    const expectedStatus = path === "/olmayan-yuzey-404" ? 404 : 200;
    const html = await text(path, expectedStatus, "text/html");
    if (!html) continue;

    if (html.includes('href="#mainContent"') && html.includes('id="mainContent"') && html.includes('tabindex="-1"')) {
      pass(`${path} runtime skip link target exists`);
    } else {
      fail(`${path} runtime skip link target exists`);
    }
  }
}

async function assertDetailInteractionContracts() {
  const [detailCss, detailView, detailRenderer, detailUtils, profileSeo] = await Promise.all([
    readFile(new URL("../public/css/detail-final.css", import.meta.url), "utf8"),
    readFile(new URL("../public/js/detail/view.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/render/detailRenderer.js", import.meta.url), "utf8"),
    readFile(new URL("../public/js/detail/utils.js", import.meta.url), "utf8"),
    readFile(new URL("../src/utils/profileSeo.js", import.meta.url), "utf8")
  ]);

  if (
    detailCss.includes(".detail-thumb-button") &&
    detailCss.includes(".detail-thumb-button:focus-visible") &&
    detailView.includes('document.querySelectorAll(".detail-thumb-button")') &&
    detailRenderer.includes('class="detail-thumb-button')
  ) {
    pass("detail gallery thumbs are button-accessible");
  } else {
    fail("detail gallery thumbs are button-accessible");
  }

  if (
    detailCss.includes(".detail-thumbs::-webkit-scrollbar") &&
    includesCode(detailView, 'event.key === "ArrowRight"') &&
    includesCode(detailView, 'event.key === "ArrowLeft"') &&
    includesCode(detailView, 'event.key === "Home"') &&
    includesCode(detailView, 'event.key === "End"') &&
    includesCode(detailView, 'button.scrollIntoView({ inline: "center", block: "nearest"') &&
    includesCode(detailView, 'main.alt = `${profileName || "Profil"} görsel ${index + 1}`;')
  ) {
    pass("detail gallery keyboard and scroll sync exists");
  } else {
    fail("detail gallery keyboard and scroll sync exists");
  }

  if (
    includesCode(detailView, "document.title = profilePageTitle(profile);") &&
    detailUtils.includes("export function profilePageTitle(profile)") &&
    detailUtils.includes("Escort İlanı | VIP GECE") &&
    profileSeo.includes("function buildProfilePageTitle(profile = {})") &&
    profileSeo.includes("function buildProfilePageDescription(profile = {})") &&
    profileSeo.includes("function isLegacyGeneratedProfileTitle(profile = {}, value = profile.seo_title)") &&
    profileSeo.includes("/profil\\s+ilan[ıi]/i.test(stored)") &&
    profileSeo.includes("Escort İlanı | VIP GECE") &&
    detailRenderer.includes("const title = buildProfilePageTitle(profile);") &&
    detailRenderer.includes("const description = buildProfilePageDescription(profile);")
  ) {
    pass("profile titles target escort listing intent without preserving stale profile-only copy");
  } else {
    fail("profile titles target escort listing intent without preserving stale profile-only copy");
  }

  if (
    detailRenderer.includes("filterProfilesForLanding(district.slug, active)") &&
    !detailRenderer.includes("listIndexableLandingSlugs(active)")
  ) {
    pass("profile detail nearby links avoid a full landing inventory scan");
  } else {
    fail("profile detail nearby links avoid a full landing inventory scan");
  }

  if (
    includesCode(detailView, 'document.title = "Profil bulunamadı | VIP GECE";') &&
    includesCode(detailView, 'renderChipCloud("detailQuickLinks", quickLinks);') &&
    detailView.includes('createEmptyStatePanel(') &&
    includesCode(detailView, 'const seoPanel = document.getElementById("detailSeoPanel");')
  ) {
    pass("detail missing-profile state is editorialized");
  } else {
    fail("detail missing-profile state is editorialized");
  }
}

async function assertMobileConversionRecoveryContracts() {
  const [detailCss, detailView, detailRenderer, categoriesCss, layoutCss, headerHtml, policyHtml] = await Promise.all([
    readFile(new URL("../public/css/detail-final.css", import.meta.url), "utf8"),
    readFile(new URL("../public/js/detail/view.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/render/detailRenderer.js", import.meta.url), "utf8"),
    readFile(new URL("../public/css/categories-hub.css", import.meta.url), "utf8"),
    readFile(new URL("../public/css/layout.css", import.meta.url), "utf8"),
    readFile(new URL("../public/components/header.html", import.meta.url), "utf8"),
    readFile(new URL("../guven-ve-politikalar.html", import.meta.url), "utf8")
  ]);
  const demoProfiles = getDemoProfiles();
  const generalProfile = {
    ...demoProfiles[0],
    city: "İstanbul",
    district: "İstanbul Geneli",
    neighborhood: "",
    location: "İstanbul Geneli",
    whatsapp: "+90 (555) 555 55 55",
    is_active: true
  };
  const detailHtml = renderProfileDetailHtml(generalProfile, [generalProfile]);
  const repeatedDetailHtml = renderProfileDetailHtml(generalProfile, [generalProfile]);
  const unsafeDetailHtml = renderProfileDetailHtml({
    ...generalProfile,
    name: '\"><img src=x onerror=alert(1)>',
    whatsapp: "123456"
  }, [generalProfile]);
  const whatsappTag = detailHtml.match(/<a id="whatsappBtn"[^>]*>/i)?.[0] || "";
  const repeatedWhatsappTag = repeatedDetailHtml.match(/<a id="whatsappBtn"[^>]*>/i)?.[0] || "";

  if (
    !whatsappTag.includes(" hidden") &&
    whatsappTag.includes('href="https://wa.me/905555555555?text=') &&
    /data-lead-reference="VG-WEB[A-F0-9]{9}"/.test(whatsappTag) &&
    repeatedWhatsappTag.match(/data-lead-reference="([^"]+)"/)?.[1]
      === whatsappTag.match(/data-lead-reference="([^"]+)"/)?.[1] &&
    !unsafeDetailHtml.match(/<a id="whatsappBtn"[^>]*href=/i) &&
    !unsafeDetailHtml.includes("<img src=x onerror=alert(1)>") &&
    whatsappTag.includes('data-ssr-contact="true"') &&
    detailRenderer.includes("cleanContactDigits") &&
    detailView.includes("?text=${encodeURIComponent(message)}")
  ) {
    pass("profile WhatsApp CTA has an SSR fallback and client enhancement");
  } else {
    fail("profile WhatsApp CTA has an SSR fallback and client enhancement");
  }

  if (
    includesCompact(detailCss, ".detail-main-image{ display:block; width:100%; height:auto;") &&
    detailCss.includes('#whatsappBtn:not(.hidden)') &&
    includesCode(detailCss, "position:fixed;") &&
    includesCode(detailCss, "min-height:52px;") &&
    detailCss.includes("env(safe-area-inset-bottom)")
  ) {
    pass("mobile profile image and sticky WhatsApp CTA preserve the first-screen conversion path");
  } else {
    fail("mobile profile image and sticky WhatsApp CTA preserve the first-screen conversion path");
  }

  const categoriesHtml = renderCategoriesHubHtml([generalProfile]);
  const blankAreaCategoriesHtml = renderCategoriesHubHtml([{ ...generalProfile, district: "", location: "" }]);
  const allDistrictLinksPresent = districtRows().every((district) => (
    categoriesHtml.includes(`href="/${district.slug}"`)
  ));
  const blankAreaDistrictLinksPresent = districtRows().every((district) => (
    blankAreaCategoriesHtml.includes(`href="/${district.slug}"`)
  ));
  if (
    categoriesHtml.includes("<strong>39</strong><span>ilçe bağlantısı</span>") &&
    allDistrictLinksPresent &&
    blankAreaDistrictLinksPresent
  ) {
    pass("Istanbul-general inventory exposes all 39 district links in the categories hub");
  } else {
    fail("Istanbul-general inventory exposes all 39 district links in the categories hub");
  }

  if (
    categoriesCss.includes(".categories-hero-copy,") &&
    categoriesCss.includes(".categories-side-groups{") &&
    includesCode(categoriesCss, "min-width:0;") &&
    includesCode(categoriesCss, "max-width:100%;") &&
    includesCode(categoriesCss, "overflow-x:hidden;")
  ) {
    pass("categories mobile hub contains wide rails inside the viewport");
  } else {
    fail("categories mobile hub contains wide rails inside the viewport");
  }

  if (
    headerHtml.includes('/public/assets/vip-gece-brand-banner-20260726-720.webp') &&
    headerHtml.includes('/public/assets/vip-gece-brand-banner-20260726-720.avif') &&
    headerHtml.includes('srcset="/public/assets/vip-gece-brand-banner-20260726-720.webp 720w, /public/assets/vip-gece-brand-banner-20260726.webp 1540w"') &&
    headerHtml.includes('width="720"') &&
    headerHtml.includes('height="226"') &&
    headerHtml.includes('fetchpriority="high"') &&
    !headerHtml.includes("site-brand-copy") &&
    policyHtml.includes('/public/css/layout.css?v=20260806-pagespeed1') &&
    layoutCss.includes("@media(max-width:820px)") &&
    layoutCss.includes(".site-header-actions{") &&
    includesCode(layoutCss, "display:none;")
  ) {
    pass("shared mobile header uses the compact wide brand banner without the top CTA");
  } else {
    fail("shared mobile header uses the compact wide brand banner without the top CTA");
  }
}

function isTransientFetchError(error) {
  const text = `${error?.message || ""} ${error?.cause?.code || ""} ${error?.cause?.message || ""}`.toLowerCase();
  return (
    text.includes("fetch failed") ||
    text.includes("econnreset") ||
    text.includes("econnrefused") ||
    text.includes("etimedout")
  );
}

async function request(path, options) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetch(`${BASE_URL}${path}`, options);
    } catch (error) {
      lastError = error;
      if (!isTransientFetchError(error) || attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  throw lastError;
}

function hasPrivateAdminHeaders(response) {
  const cacheControl = response.headers.get("cache-control") || "";
  const robots = response.headers.get("x-robots-tag") || "";
  return (
    cacheControl.includes("no-store") &&
    cacheControl.includes("private") &&
    (response.headers.get("pragma") || "").toLowerCase() === "no-cache" &&
    robots.includes("noindex") &&
    !response.headers.get("cdn-cache-control") &&
    !response.headers.get("cloudflare-cdn-cache-control")
  );
}

async function json(path, expectedStatus, options) {
  const response = await request(path, options);
  const contentType = response.headers.get("content-type") || "";

  if (response.status !== expectedStatus) {
    fail(`${path} status ${response.status}, expected ${expectedStatus}`);
    return null;
  }

  if (!contentType.includes("application/json")) {
    fail(`${path} content-type ${contentType || "missing"}, expected JSON`);
    return null;
  }

  try {
    const body = await response.json();
    pass(`${path} JSON ${expectedStatus}`);
    return body;
  } catch (err) {
    fail(`${path} invalid JSON: ${err.message}`);
    return null;
  }
}

async function text(path, expectedStatus, expectedType) {
  const response = await request(path);
  const contentType = response.headers.get("content-type") || "";

  if (response.status !== expectedStatus) {
    fail(`${path} status ${response.status}, expected ${expectedStatus}`);
    return "";
  }

  if (expectedType && !contentType.includes(expectedType)) {
    fail(`${path} content-type ${contentType || "missing"}, expected ${expectedType}`);
    return "";
  }

  const body = await response.text();
  pass(`${path} text ${expectedStatus}`);
  return body;
}

async function assertRedirect(path, expectedLocation) {
  const response = await request(path, { redirect: "manual" });
  const location = response.headers.get("location") || "";

  if (response.status === 301 && location === expectedLocation) {
    pass(`${path} redirects to ${expectedLocation}`);
  } else {
    fail(`${path} redirect status ${response.status} location ${location || "missing"}`);
  }
}

async function assertDirectHtml(path) {
  const response = await request(path, { redirect: "manual" });
  const contentType = response.headers.get("content-type") || "";

  if (response.status === 200 && contentType.includes("text/html")) {
    pass(`${path} serves HTML without redirect`);
  } else {
    fail(`${path} status ${response.status} type ${contentType || "missing"}, expected direct HTML`);
  }
}

async function assertPublicCrawlerCache(path) {
  const response = await request(path, { redirect: "manual" });
  const cacheControl = response.headers.get("cache-control") || "";
  const pragma = response.headers.get("pragma") || "";

  if (response.status === 200 && /^public,\s*max-age=\d+,\s*must-revalidate$/i.test(cacheControl) && !pragma) {
    pass(`${path} sends public crawler cache headers`);
  } else {
    fail(`${path} crawler cache headers ${cacheControl || "missing"} pragma ${pragma || "none"}`);
  }
}

async function assertNoindexHeader(path) {
  const response = await request(path, { redirect: "manual" });
  const robots = response.headers.get("x-robots-tag") || "";

  if (/noindex/i.test(robots)) {
    pass(`${path} sends X-Robots-Tag noindex`);
  } else {
    fail(`${path} is missing X-Robots-Tag noindex`);
  }
}

async function assertNoNoindexHeader(path) {
  const response = await request(path, { redirect: "manual" });
  const robots = response.headers.get("x-robots-tag") || "";

  if (!/noindex/i.test(robots)) {
    pass(`${path} does not send X-Robots-Tag noindex`);
  } else {
    fail(`${path} unexpectedly sends X-Robots-Tag noindex`);
  }
}

async function assertReadinessContracts() {
  const getResponse = await request("/api/ready", { redirect: "manual" });
  const cacheControl = getResponse.headers.get("cache-control") || "";
  const robots = getResponse.headers.get("x-robots-tag") || "";
  let body = null;

  try {
    body = await getResponse.json();
  } catch {
    // The assertions below report a single stable contract failure.
  }

  const expectedStatus = getResponse.status === 200 ? "ready" : "unavailable";
  if (
    [200, 503].includes(getResponse.status) &&
    body &&
    Object.keys(body).length === 1 &&
    body.status === expectedStatus &&
    cacheControl.includes("no-store") &&
    /noindex/i.test(robots)
  ) {
    pass(`/api/ready GET ${getResponse.status} minimal readiness contract`);
  } else {
    fail(`/api/ready GET contract status ${getResponse.status}`);
  }

  if (body) {
    assertNoSensitiveHealthFields("/api/ready", body);
  }

  const headResponse = await request("/api/ready", {
    method: "HEAD",
    redirect: "manual"
  });
  const headBody = await headResponse.text();
  const headCacheControl = headResponse.headers.get("cache-control") || "";
  const headRobots = headResponse.headers.get("x-robots-tag") || "";

  if (
    [200, 503].includes(headResponse.status) &&
    headBody === "" &&
    headCacheControl.includes("no-store") &&
    /noindex/i.test(headRobots)
  ) {
    pass(`/api/ready HEAD ${headResponse.status} has no body`);
  } else {
    fail(`/api/ready HEAD contract status ${headResponse.status}`);
  }
}

function assertNoSensitiveHealthFields(path, body) {
  const serialized = JSON.stringify(body);
  const forbidden = [
    "SUPABASE",
    "API_KEY",
    "TOKEN",
    "SECRET",
    "postgres",
    "127.0.0.1",
    "localhost"
  ];

  for (const item of forbidden) {
    if (serialized.toLowerCase().includes(item.toLowerCase())) {
      fail(`${path} leaks forbidden marker ${item}`);
      return;
    }
  }

  pass(`${path} has no sensitive health markers`);
}

function assertProfileCardShape(profile, label, options = {}) {
  const required = [
    "slug",
    "name",
    "city",
    "district",
    "age",
    "height",
    "weight",
    "description",
    "images",
    "card_label",
    "tags",
    "type",
    "is_featured"
  ];

  for (const field of required) {
    if (!(field in profile)) {
      fail(`${label} missing card field ${field}`);
      return;
    }
  }

  if (!options.allowDetailFields) {
    for (const field of ["id", "phone", "whatsapp", "telegram"]) {
      if (field in profile) {
        fail(`${label} exposes ${field}`);
        return;
      }
    }
  }

  if (!Array.isArray(profile.images)) {
    fail(`${label} images is not an array`);
    return;
  }

  if (!Array.isArray(profile.tags)) {
    fail(`${label} tags is not an array`);
    return;
  }

  if (typeof profile.is_featured !== "boolean") {
    fail(`${label} is_featured is not boolean`);
    return;
  }

  pass(`${label} public card shape`);
}

function assertProfileDetailShape(profile, label) {
  assertProfileCardShape(profile, label, { allowDetailFields: true });

  const required = ["id", "phone", "whatsapp", "telegram"];
  for (const field of required) {
    if (!(field in profile)) {
      fail(`${label} missing detail field ${field}`);
      return;
    }
  }

  pass(`${label} public detail shape`);
}

function assertInputSanitizers() {
  const profile = sanitizeProfilePayload({
    name: "  Ada\nVIP  ",
    slug: "Ada VIP<script>",
    role: "admin",
    is_admin: true,
    images: ["javascript:alert(1)", "http://cdn.example.com/insecure.jpg", "https://cdn.example.com/ada.jpg", "/logo.png.webp"],
    tags: [" vip ", " ".repeat(10), "sisli"],
    whatsapp: "+90 (555) 000 00 01",
    telegram: "@ada.vip<script>",
    priority_order: "3.8",
    updated_at: "client-controlled"
  });

  if (
    profile.name === "Ada VIP" &&
    profile.slug === "ada-vip-script" &&
    !("role" in profile) &&
    !("is_admin" in profile) &&
    !("updated_at" in profile) &&
    profile.images.length === 2 &&
    profile.images[0] === "https://cdn.example.com/ada.jpg" &&
    profile.images[1] === "/logo.png.webp" &&
    profile.whatsapp === "+905550000001" &&
    profile.telegram === "adavipscript" &&
    profile.priority_order === 3
  ) {
    pass("profile input sanitizer allowlist");
  } else {
    fail("profile input sanitizer allowlist");
  }

  const customer = sanitizeCustomerRequestPayload({
    description_request: "  Güncelleme\nisteği  ",
    owner_user_id: "attacker",
    is_active: true,
    customer_note: "x".repeat(1200)
  }, "user-123");

  if (
    customer.description_request === "Güncelleme isteği" &&
    customer.customer_note.length === 1000 &&
    customer.requested_by === "user-123" &&
    !("owner_user_id" in customer) &&
    !("is_active" in customer)
  ) {
    pass("customer request sanitizer allowlist");
  } else {
    fail("customer request sanitizer allowlist");
  }

  const previousSupabaseUrl = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "https://customer-contract.supabase.co";
  const customerProfile = sanitizeCustomerProfilePayload({
    name: "  Ada\nVIP  ",
    slug: "hijack",
    seo_title: "client seo",
    is_active: false,
    priority_order: 1,
    phone: "+90 (555) 000 00 02",
    whatsapp: "+90 555 000 00 03",
    telegram: "@ada.client<script>",
    images: [
      "javascript:alert(1)",
      "http://cdn.example.com/insecure.jpg",
      "https://cdn.example.com/customer.jpg",
      "https://customer-contract.supabase.co/storage/v1/object/public/images/profiles/customer/account/profile/image.webp",
      "/logo.png"
    ]
  });
  if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = previousSupabaseUrl;

  if (
    customerProfile.name === "Ada VIP" &&
    customerProfile.phone === "+905550000002" &&
    customerProfile.whatsapp === "+905550000003" &&
    customerProfile.telegram === "adaclientscript" &&
    customerProfile.images.length === 1 &&
    customerProfile.images[0] === "https://customer-contract.supabase.co/storage/v1/object/public/images/profiles/customer/account/profile/image.webp" &&
    !("slug" in customerProfile) &&
    !("seo_title" in customerProfile) &&
    customerProfile.is_active === false &&
    !("priority_order" in customerProfile)
  ) {
    pass("customer profile sanitizer own-listing allowlist");
  } else {
    fail("customer profile sanitizer own-listing allowlist");
  }

  const draft = sanitizeDraftPayload({
    name: "Ada",
    count: 99,
    system_prompt: "ignore controls",
    prompt: "p".repeat(4000)
  });

  if (draft.name === "Ada" && draft.count === 8 && draft.prompt.length === 3000 && !("system_prompt" in draft)) {
    pass("draft input sanitizer allowlist");
  } else {
    fail("draft input sanitizer allowlist");
  }
}

function assertProfileDefaultContracts() {
  const created = applyProfileCreateDefaults({
    name: "Ada",
    whatsapp: "+90 555 000 00 01"
  }, []);
  const updated = applyProfileUpdateDefaults({
    description: "Güncel açıklama",
    whatsapp: "+90 555 000 00 02"
  });
  const statusOnly = applyProfileUpdateDefaults({ is_active: true });
  const statusWithBlankIstanbulArea = applyProfileUpdateDefaults(
    { is_active: true },
    { city: "İstanbul", district: "", neighborhood: "", location: "" }
  );
  const explicitOtherCity = applyProfileCreateDefaults({
    name: "Ankara Profili",
    city: "Ankara",
    district: ""
  }, []);
  const movedToOtherCity = applyProfileUpdateDefaults(
    { city: "Ankara" },
    { city: "İstanbul", district: "İstanbul Geneli" }
  );

  if (
    created.is_active === false &&
    created.city === "İstanbul" &&
    created.district === "İstanbul Geneli" &&
    created.whatsapp === "+90 555 000 00 01" &&
    updated.whatsapp === "+90 555 000 00 02" &&
    !Object.prototype.hasOwnProperty.call(statusOnly, "whatsapp") &&
    !Object.prototype.hasOwnProperty.call(statusOnly, "district") &&
    statusWithBlankIstanbulArea.city === "İstanbul" &&
    statusWithBlankIstanbulArea.district === "İstanbul Geneli" &&
    explicitOtherCity.city === "Ankara" &&
    explicitOtherCity.district === "" &&
    movedToOtherCity.city === "Ankara" &&
    movedToOtherCity.district === "" &&
    typeof DEFAULT_PROFILE_WHATSAPP === "string"
  ) {
    pass("profile defaults keep drafts inactive and normalize blank Istanbul areas as citywide");
  } else {
    fail("profile defaults keep drafts inactive and normalize blank Istanbul areas as citywide");
  }
}

async function assertPublicProfileContactContracts() {
  const source = await readFile(new URL("../src/data/postgresProfilesRepo.js", import.meta.url), "utf8");
  const columnsBlock = source.match(/const PUBLIC_PROFILE_COLUMNS = \[([\s\S]*?)\]\.join\(","\);/)?.[1] || "";

  if (
    columnsBlock.includes('"phone"') &&
    columnsBlock.includes('"whatsapp"') &&
    columnsBlock.includes('"telegram"')
  ) {
    pass("Postgres public detail projection includes profile contact fields");
  } else {
    fail("Postgres public detail projection includes profile contact fields");
  }
}

async function assertFullCardLinkContracts() {
  const contractProfilePath = await getContractProfilePath();
  const [homeHtml, landingHtml, listingsHtml, detailHtml, homeClient, landingClient, detailClient, customerPanel] = await Promise.all([
    text("/", 200, "text/html"),
    text("/istanbul-escort", 200, "text/html"),
    text("/ilanlar", 200, "text/html"),
    text(contractProfilePath, 200, "text/html"),
    readFile(new URL("../public/js/home/sections.js", import.meta.url), "utf8"),
    readFile(new URL("../public/js/landing/view.js", import.meta.url), "utf8"),
    readFile(new URL("../public/js/detail/view.js", import.meta.url), "utf8"),
    readFile(new URL("../customer-panel.html", import.meta.url), "utf8")
  ]);

  const forbiddenCtas = /Profilini Gör|Profili Gör|İlana Git|featured-cta|selected-cta|category-card-btn|landing-mini-link|listings-card-btn|detail-related-btn/;
  const publicMarkup = [homeHtml, landingHtml, listingsHtml, detailHtml].join("\n");
  const clientSources = [homeClient, landingClient, detailClient].join("\n");
  const hasLinkedCards =
    /<a class="selected-card"[^>]+href="\/profil\//.test(homeHtml) &&
    /<a class="category-card"[^>]+href="\/profil\//.test(landingHtml) &&
    /<a class="listings-card"[^>]+href="\/profil\//.test(listingsHtml) &&
    /<a class="detail-related-card"[^>]+href="\/profil\//.test(detailHtml);

  if (hasLinkedCards && !forbiddenCtas.test(publicMarkup) && !forbiddenCtas.test(clientSources)) {
    pass("public profile cards are full-card links without nested CTA buttons");
  } else {
    fail("public profile cards are full-card links without nested CTA buttons");
  }

  if (
    /id="profileWhatsapp"[^>]+maxlength="40"[^>]+inputmode="tel"/.test(customerPanel) &&
    !/id="profileWhatsapp"[^>]+readonly/.test(customerPanel)
  ) {
    pass("customer panel preserves the profile-specific WhatsApp number");
  } else {
    fail("customer panel preserves the profile-specific WhatsApp number");
  }
}

function assertSitemapEscaping() {
  const sitemap = buildSitemapXml([
    { name: "Ada <VIP>", slug: "ada <vip>", is_active: true }
  ]);
  const visibilitySitemap = buildSitemapXml([
    { name: "Aktif", slug: "aktif", is_active: true },
    { name: "SEO", slug: "seo-only", is_active: false },
    { name: "Taslak", slug: "private-draft", is_active: false }
  ]);
  const imageSitemap = buildImageSitemapXml([
    {
      name: "Ada <VIP>",
      slug: "ada-vip",
      is_active: true,
      images: [
        "https://cdn.example.com/a.jpg?x=<tag>&q=1",
        "/media/ada.jpg",
        "/media/customer-upload/17/missing.webp"
      ]
    }
  ]);

  if (sitemap.includes("<loc>") && !sitemap.includes("<vip>")) {
    pass("sitemap loc escaping");
  } else {
    fail("sitemap loc escaping");
  }

  if (
    visibilitySitemap.includes(`${EXPECTED_SITE_URL}/profil/aktif`) &&
    !visibilitySitemap.includes(`${EXPECTED_SITE_URL}/profil/seo-only`) &&
    !visibilitySitemap.includes(`${EXPECTED_SITE_URL}/profil/private-draft`)
  ) {
    pass("sitemap indexes active profiles without exposing inactive rows");
  } else {
    fail("sitemap indexes active profiles without exposing inactive rows");
  }

  if (
    imageSitemap.includes("Ada &lt;VIP&gt;") &&
    imageSitemap.includes("x=&lt;tag&gt;&amp;q=1") &&
    imageSitemap.includes(`${EXPECTED_SITE_URL}/media/ada.jpg`) &&
    !imageSitemap.includes("customer-upload/17/missing.webp")
  ) {
    pass("image sitemap XML escaping");
  } else {
    fail("image sitemap XML escaping");
  }
}

function assertGoogleSearchConsoleContracts() {
  const status = searchConsoleStatus();
  const serializedStatus = JSON.stringify(status);

  if (
    status.ok === true &&
    status.provider === "google_search_console" &&
    status.site_url &&
    !/"private_key"\s*:|access_token|authorization|bearer|-----BEGIN/i.test(serializedStatus)
  ) {
    pass("Google Search Console status is secret-safe");
  } else {
    fail("Google Search Console status is secret-safe");
  }

  const siteUrl = normalizeSearchConsoleSiteUrl("sc-domain:VIP-GECE.SITE");
  const listUrl = buildSitemapsListUrl(siteUrl);
  const submitUrl = buildSitemapSubmitUrl(siteUrl, "https://vip-gece.site/sitemap.xml");

  if (
    siteUrl === "sc-domain:vip-gece.site" &&
    listUrl.includes("sc-domain%3Avip-gece.site") &&
    submitUrl.includes("https%3A%2F%2Fvip-gece.site%2Fsitemap.xml")
  ) {
    pass("Google Search Console sitemap endpoints encode domain property");
  } else {
    fail("Google Search Console sitemap endpoints encode domain property");
  }

  const inspectionUrls = defaultInspectionUrls();
  const inspectionText = inspectionUrls.join("\n");
  const locs = extractSitemapLocs("<urlset><url><loc>https://vip-gece.site/</loc></url><url><loc>https://vip-gece.site/sarisin-escort?x=1&amp;y=2</loc></url></urlset>");

  if (
    inspectionUrls.every((url) => url.startsWith(`${EXPECTED_SITE_URL}/`)) &&
    inspectionText.includes("/sarisin-escort") &&
    inspectionText.includes("/balik-etli-escort") &&
    inspectionText.includes("/kapali-escort")
  ) {
    pass("Google Search Console default inspection list covers new category URLs");
  } else {
    fail("Google Search Console default inspection list covers new category URLs");
  }

  if (
    locs.length === 2 &&
    locs[0] === "https://vip-gece.site/" &&
    locs[1] === "https://vip-gece.site/sarisin-escort?x=1&y=2"
  ) {
    pass("Google Search Console sitemap loc extraction supports full-site sync");
  } else {
    fail("Google Search Console sitemap loc extraction supports full-site sync");
  }

  const planText = JSON.stringify(publicFastDiscoveryPlan());
  if (
    planText.includes("Submit sitemap.xml") &&
    planText.includes("Inspect changed canonical URLs") &&
    planText.includes("Cloaking") &&
    planText.includes("Indexing API abuse")
  ) {
    pass("Google fast discovery plan uses allowed channels only");
  } else {
    fail("Google fast discovery plan uses allowed channels only");
  }
}

function assertDistrictSeoTargetContracts() {
  const districts = districtRows();
  const aliases = landingAliasRows();
  const categories = categoryRows();
  const clusters = seoClusterRows();
  const keywordText = buildHomeKeywords(districts);
  const sitemap = buildSitemapXml([]);
  const cityContext = buildLandingContext("istanbul-escort", []);
  const beyogluAliases = getDistrictAliases("Beyoğlu");
  const indexableSlugs = listIndexableLandingSlugs([]);
  const normalize = (value) => String(value || "").toLocaleLowerCase("tr-TR");
  const clusterQueries = new Set(clusters.map((cluster) => normalize(cluster.query)));
  const slugs = new Set(districts.map((district) => district.slug));
  const categorySlugs = new Set(categories.map((category) => category.slug));
  const districtSlugs = new Set(districts.map((district) => district.slug));
  const aliasSlugs = new Set(aliases.map((alias) => alias.slug));
  const profileCategorySlugs = [
    "esmer-escort",
    "sarisin-escort",
    "kumral-escort",
    "zayif-escort",
    "balik-etli-escort",
    "kapali-escort"
  ];
  const intentProofProfiles = [
    {
      id: "proof-vip-sarisin",
      slug: "proof-vip-sarisin",
      name: "Sarı VIP",
      city: "İstanbul",
      district: "Şişli",
      type: "vip",
      is_featured: true,
      is_active: true,
      tags: ["vip", "sarisin", "otel"],
      description: "VIP sarışın otel ilanı",
      created_at: "2026-07-01T00:00:00.000Z"
    },
    {
      id: "proof-esmer-genc",
      slug: "proof-esmer-genc",
      name: "Esmer Genç",
      city: "İstanbul",
      district: "Kadıköy",
      type: "normal",
      is_active: true,
      tags: ["esmer", "genc", "gfe"],
      description: "Esmer genç GFE profil",
      created_at: "2026-07-02T00:00:00.000Z"
    },
    {
      id: "proof-yabanci-otel",
      slug: "proof-yabanci-otel",
      name: "Yabancı Otel",
      city: "İstanbul",
      district: "Beyoğlu",
      type: "normal",
      is_active: true,
      tags: ["yabanci", "otel"],
      description: "Yabancı otel odaklı profil",
      created_at: "2026-07-03T00:00:00.000Z"
    },
    {
      id: "proof-taksim",
      slug: "proof-taksim",
      name: "Taksim Profil",
      city: "İstanbul",
      district: "Taksim",
      type: "normal",
      is_active: true,
      tags: ["vip"],
      description: "Taksim konumu doğrulanmış profil",
      created_at: "2026-07-03T12:00:00.000Z"
    }
  ];
  const generalProofProfile = {
    id: "proof-general",
    slug: "proof-general",
    name: "İstanbul Geneli",
    city: "İstanbul",
    district: "GENELİ",
    type: "normal",
    is_active: true,
    tags: ["vip"],
    description: "İstanbul geneli aktif profil",
    created_at: "2026-07-04T00:00:00.000Z"
  };
  const blankDistrictGeneralProofProfile = {
    ...generalProofProfile,
    id: "proof-general-blank-district",
    slug: "proof-general-blank-district",
    name: "İstanbul Geneli Boş İlçe",
    district: "",
    neighborhood: "",
    location: ""
  };
  const nonIstanbulGeneralProofProfile = {
    ...generalProofProfile,
    id: "proof-ankara-general",
    slug: "proof-ankara-general",
    name: "Ankara Geneli",
    city: "Ankara",
    district: "İstanbul Geneli"
  };
  const nonIstanbulLocalProofProfile = {
    ...generalProofProfile,
    id: "proof-ankara-sisli",
    slug: "proof-ankara-sisli",
    name: "Ankara Şişli",
    city: "Ankara",
    district: "Şişli"
  };
  const localCoverageProofProfiles = [...intentProofProfiles, generalProofProfile];

  if (
    districts.length === 39 &&
    slugs.size === 39 &&
    districts.every((district) => district.slug.endsWith("-escort"))
  ) {
    pass("39 district escort slugs are active");
  } else {
    fail("39 district escort slugs are active");
  }

  if (
    indexableSlugs.length === districts.length + aliases.length + categories.length &&
    new Set(indexableSlugs).size === indexableSlugs.length &&
    districts.every((district) => indexableSlugs.includes(district.slug)) &&
    aliases.every((alias) => indexableSlugs.includes(alias.slug)) &&
    categories.every((category) => indexableSlugs.includes(category.slug))
  ) {
    pass("empty inventory keeps every public landing indexable (owner policy 2026-09-24)");
  } else {
    fail(`empty inventory must keep every public landing indexable (${indexableSlugs.length})`);
  }

  if (
    aliases.length === 188 &&
    new Set(aliases.map((alias) => alias.slug)).size === 188 &&
    aliases.every((alias) => alias.slug.endsWith("-escort") && alias.parent_district)
  ) {
    pass("188 neighborhood escort alias slugs are active");
  } else {
    fail("188 neighborhood escort alias slugs are active");
  }

  if (
    clusters.length === 40 + aliases.length &&
    clusterQueries.has("istanbul escort") &&
    districts.every((district) => clusterQueries.has(`${normalize(district.name)} escort`)) &&
    aliases.every((alias) => clusterQueries.has(`${normalize(alias.name)} escort`))
  ) {
    pass("Istanbul, district and neighborhood escort SEO clusters are active");
  } else {
    fail("Istanbul, district and neighborhood escort SEO clusters are active");
  }

  if (
    profileCategorySlugs.every((slug) => categorySlugs.has(slug)) &&
    profileCategorySlugs.every((slug) => !districtSlugs.has(slug) && !aliasSlugs.has(slug)) &&
    profileCategorySlugs.every((slug) => resolveLandingTarget(slug)?.type === "category") &&
    clusters.length === 228
  ) {
    pass("profile trait escort slugs resolve as categories outside local SEO clusters");
  } else {
    fail("profile trait escort slugs resolve as categories outside local SEO clusters");
  }

  if (
    districts.every((district) => {
      const exactQuery = `${normalize(district.name)} escort`;
      const aliasNames = getDistrictAliases(district.name).slice(0, 2).map((alias) => normalize(alias.name));
      return normalize(district.seo_title).includes(exactQuery) &&
        normalize(district.seo_description).includes(exactQuery) &&
        aliasNames.every((name) => normalize(district.seo_description).includes(name));
    })
  ) {
    pass("district metadata carries exact escort target phrases and neighborhood signals");
  } else {
    fail("district metadata carries exact escort target phrases and neighborhood signals");
  }

  if (
    normalize(keywordText).includes("istanbul escort") &&
    districts.every((district) => normalize(keywordText).includes(`${normalize(district.name)} escort`))
  ) {
    pass("home keyword list covers Istanbul and all 39 district escort phrases");
  } else {
    fail("home keyword list covers Istanbul and all 39 district escort phrases");
  }

  if (
    sitemap.includes(`<loc>${EXPECTED_SITE_URL}/istanbul-escort</loc>`) &&
    districts.every((district) => sitemap.includes(`<loc>${EXPECTED_SITE_URL}/${district.slug}</loc>`))
  ) {
    pass("empty inventory sitemap includes every district landing URL");
  } else {
    fail("empty inventory sitemap includes every district landing URL");
  }

  if (aliases.every((alias) => sitemap.includes(`<loc>${EXPECTED_SITE_URL}/${alias.slug}</loc>`))) {
    pass("empty inventory sitemap includes every neighborhood landing URL");
  } else {
    fail("empty inventory sitemap includes every neighborhood landing URL");
  }

  const proofIndexableSlugs = listIndexableLandingSlugs(localCoverageProofProfiles);
  const proofSitemap = buildSitemapXml(localCoverageProofProfiles);
  const proofDistrictSlugs = new Set(districts.map((district) => district.slug));
  const proofAliasSlugs = new Set(aliases.map((alias) => alias.slug));
  const proofCategorySlugs = new Set(categories.map((category) => category.slug));

  if (
    proofSitemap.match(/<loc>/g)?.length === 5 + proofIndexableSlugs.length + localCoverageProofProfiles.length &&
    [...proofDistrictSlugs].every((slug) => proofIndexableSlugs.includes(slug)) &&
    [...proofAliasSlugs].every((slug) => proofIndexableSlugs.includes(slug)) &&
    [...proofCategorySlugs].every((slug) => proofIndexableSlugs.includes(slug)) &&
    [...proofCategorySlugs].every((slug) => proofSitemap.includes(`<loc>${EXPECTED_SITE_URL}/${slug}</loc>`))
  ) {
    pass("active inventory sitemap includes every district, neighborhood and category landing URL");
  } else {
    fail("active inventory sitemap includes every district, neighborhood and category landing URL");
  }

  const cityProofContext = buildLandingContext("istanbul-escort", intentProofProfiles);
  const beyogluContext = buildLandingContext("beyoglu-escort", intentProofProfiles);
  if (
    cityContext?.districtLinks?.length === 0 &&
    cityProofContext?.districtLinks?.length === districts.length &&
    [...proofDistrictSlugs].every((slug) =>
      cityProofContext.districtLinks.some((link) => link.href === `/${slug}`))
  ) {
    pass("Istanbul hub links every legacy district landing when inventory is active");
  } else {
    fail("Istanbul hub links every legacy district landing when inventory is active");
  }

  if (
    beyogluAliases.some((alias) => alias.slug === "taksim-escort") &&
    beyogluContext?.internalLinks?.some((link) => link.href === "/taksim-escort") &&
    beyogluContext?.searchTerms?.some((term) => normalize(term) === "taksim escort") &&
    beyogluContext?.localIntentRows?.some((row) => row.href === "/taksim-escort" && normalize(row.title) === "taksim escort") &&
    JSON.stringify(beyogluContext.faqItems || []).includes("Taksim")
  ) {
    pass("district landing carries neighborhood alias intent");
  } else {
    fail("district landing carries neighborhood alias intent");
  }

  if (districts.every((district) => {
    const context = buildLandingContext(district.slug, []);
    const unsupportedAliasPaths = getDistrictAliases(district.name).map((alias) => `/${alias.slug}`);
    return (
      context?.localIntentRows?.length === 0 &&
      unsupportedAliasPaths.every((href) =>
        !context.internalLinks.some((link) => link.href === href))
    );
  })) {
    pass("district landings do not link unsupported neighborhood URLs");
  } else {
    fail("district landings do not link unsupported neighborhood URLs");
  }

  const sisliContext = buildLandingContext("sisli-escort", localCoverageProofProfiles);
  const kadikoyContext = buildLandingContext("kadikoy-escort", localCoverageProofProfiles);
  const taksimContext = buildLandingContext("taksim-escort", localCoverageProofProfiles);
  const galataContext = buildLandingContext("galata-escort", localCoverageProofProfiles);
  const pendikUnrelatedContext = buildLandingContext("pendik-escort", intentProofProfiles);
  const citywideIndexableSlugs = listIndexableLandingSlugs([generalProofProfile]);
  const blankDistrictCitywideIndexableSlugs =
    listIndexableLandingSlugs([blankDistrictGeneralProofProfile]);
  const blankDistrictSisliContext =
    buildLandingContext("sisli-escort", [blankDistrictGeneralProofProfile]);
  const nonIstanbulSisliContext = buildLandingContext(
    "sisli-escort",
    [nonIstanbulGeneralProofProfile, nonIstanbulLocalProofProfile]
  );
  const nonIstanbulCityContext = buildLandingContext(
    "istanbul-escort",
    [nonIstanbulGeneralProofProfile, nonIstanbulLocalProofProfile]
  );
  // Hybrid product rule: primary = exact + parent + citywide geneli (or category
  // match); secondary = other Istanbul inventory for discovery only. Unrelated
  // locals stay out of primary; non-Istanbul stays out entirely.
  const localPrimaryOnly =
    sisliContext?.indexable === true &&
    sisliContext.totalProfileCount === 2 &&
    sisliContext.primaryProfiles.some((profile) => profile.id === "proof-vip-sarisin") &&
    sisliContext.primaryProfiles.some((profile) => profile.id === "proof-general") &&
    !sisliContext.primaryProfiles.some((profile) => profile.id === "proof-esmer-genc") &&
    Array.isArray(sisliContext.secondaryProfiles) &&
    sisliContext.secondaryProfiles.some((profile) => profile.id === "proof-esmer-genc") &&
    kadikoyContext?.indexable === true &&
    kadikoyContext.totalProfileCount === 2 &&
    kadikoyContext.primaryProfiles.some((profile) => profile.id === "proof-esmer-genc") &&
    kadikoyContext.primaryProfiles.some((profile) => profile.id === "proof-general") &&
    !kadikoyContext.primaryProfiles.some((profile) => profile.id === "proof-vip-sarisin") &&
    Array.isArray(kadikoyContext.secondaryProfiles) &&
    kadikoyContext.secondaryProfiles.some((profile) => profile.id === "proof-vip-sarisin") &&
    taksimContext?.indexable === true &&
    taksimContext.totalProfileCount === 3 &&
    taksimContext.primaryProfiles.some((profile) => profile.id === "proof-taksim") &&
    taksimContext.primaryProfiles.some((profile) => profile.id === "proof-yabanci-otel") &&
    taksimContext.primaryProfiles.some((profile) => profile.id === "proof-general") &&
    !taksimContext.primaryProfiles.some((profile) => profile.id === "proof-vip-sarisin") &&
    galataContext?.indexable === true &&
    galataContext.totalProfileCount === 3;
  // Owner karari (2026-09-24): profile envanterinden bagimsiz olarak tum public
  // landing'ler indexlenebilir; secondary blok yalnizca kesif amaclidir.
  const unsupportedPrimaryStaysOut =
    pendikUnrelatedContext?.indexable === true &&
    pendikUnrelatedContext.totalProfileCount === 0 &&
    listIndexableLandingSlugs(intentProofProfiles).includes("pendik-escort") &&
    Array.isArray(pendikUnrelatedContext?.secondaryProfiles) &&
    pendikUnrelatedContext.secondaryProfiles.length === intentProofProfiles.length;
  const citywidePreservesLegacyLocals =
    [...proofDistrictSlugs].every((slug) => citywideIndexableSlugs.includes(slug)) &&
    [...proofAliasSlugs].every((slug) => citywideIndexableSlugs.includes(slug));
  const blankDistrictPreservesLegacyLocals =
    [...proofDistrictSlugs].every((slug) => blankDistrictCitywideIndexableSlugs.includes(slug)) &&
    [...proofAliasSlugs].every((slug) => blankDistrictCitywideIndexableSlugs.includes(slug)) &&
    blankDistrictSisliContext?.indexable === true &&
    blankDistrictSisliContext.primaryProfiles.some(
      (profile) => profile.id === blankDistrictGeneralProofProfile.id
    );
  const nonIstanbulProfilesStayOut =
    nonIstanbulSisliContext?.indexable === true &&
    nonIstanbulSisliContext.totalProfileCount === 0 &&
    nonIstanbulCityContext?.totalProfileCount === 0 &&
    listIndexableLandingSlugs([
      nonIstanbulGeneralProofProfile,
      nonIstanbulLocalProofProfile
    ]).includes("sisli-escort");
  // Primary membership is always a subset of supporting inventory. Pure-citywide
  // landings may cap the primary grid while support stays full for indexability.
  const primarySubsetOfSupport = [
    ["istanbul-escort", localCoverageProofProfiles],
    ["sisli-escort", localCoverageProofProfiles],
    ["taksim-escort", localCoverageProofProfiles],
    ["vip-escort", localCoverageProofProfiles],
    ["pendik-escort", intentProofProfiles],
    ["sisli-escort", [nonIstanbulGeneralProofProfile, nonIstanbulLocalProofProfile]]
  ].every(([slug, profiles]) => {
    const primaryIds = filterProfilesForLanding(slug, profiles).map((profile) => profile.id);
    const supportIds = new Set(profilesSupportingLanding(slug, profiles).map((profile) => profile.id));
    return primaryIds.every((id) => supportIds.has(id));
  });
  const copyText = JSON.stringify([
    sisliContext?.heroText,
    sisliContext?.sectionText,
    sisliContext?.faqItems,
    taksimContext?.heroText,
    taksimContext?.sectionText
  ]);
  const sisliOrder = rankProfilesForLocalIntent(intentProofProfiles, "sisli-escort").map((profile) => profile.id).join(",");
  const kadikoyOrder = rankProfilesForLocalIntent(intentProofProfiles, "kadikoy-escort").map((profile) => profile.id).join(",");
  const taksimOrder = rankProfilesForLocalIntent(intentProofProfiles, "taksim-escort").map((profile) => profile.id).join(",");
  const demoProfiles = getDemoProfiles();
  const demoOrders = ["sisli-escort", "kadikoy-escort", "besiktas-escort", "taksim-escort", "avcilar-escort"]
    .map((slug) => rankProfilesForLocalIntent(demoProfiles, slug).map((profile) => profile.slug).join(","));
  const demoLocalSlugsVary = new Set(demoOrders).size >= 3;

  if (
    localPrimaryOnly &&
    unsupportedPrimaryStaysOut &&
    citywidePreservesLegacyLocals &&
    blankDistrictPreservesLegacyLocals &&
    nonIstanbulProfilesStayOut &&
    primarySubsetOfSupport &&
    copyText.includes("Toplam") &&
    copyText.includes("İstanbul Geneli") &&
    !copyText.includes("doğrulanmış") &&
    !copyText.includes("tüm aktif İstanbul profilleri") &&
    sisliOrder !== kadikoyOrder &&
    kadikoyOrder !== taksimOrder &&
    demoLocalSlugsVary
  ) {
    pass("local landings use hybrid primary local+geneli and secondary citywide discovery");
  } else {
    fail("local landings use hybrid primary local+geneli and secondary citywide discovery");
  }
}

function assertPublicOutputSanitizers() {
  const source = {
    id: "demo-<id>",
    slug: "Ada VIP<script>",
    name: "Ada <script>",
    city: "İstanbul <x>",
    district: "Şişli <x>",
    age: "24<script>",
    height: "170<script>",
    weight: "55<script>",
    description: "Açıklama <script>alert(1)</script>",
    card_label: "VIP <label>",
    images: ["javascript:alert(1)", "http://cdn.example.com/insecure.jpg", "https://cdn.example.com/ada.jpg?x=<tag>", "/logo.png.webp"],
    phone: "+90 (555) 000 00 01<script>",
    whatsapp: "+90 (555) 000 00 02<script>",
    telegram: "@ada.vip<script>",
    tags: ["vip <tag>", "istanbul"],
    type: "vip<script>",
    is_featured: true,
    priority_order: "bad",
    display_priority: "7",
    vip_slot: "<bad>",
    normal_slot: "3",
    created_at: "2026-06-06T10:00:00Z"
  };
  const card = publicProfileCard(source, getProfileSlug);
  const detail = publicProfile(source, getProfileSlug);
  const cardText = JSON.stringify(card);
  const detailText = JSON.stringify(detail);

  if (
    !("phone" in card) &&
    !("whatsapp" in card) &&
    !("telegram" in card) &&
    !cardText.includes("<") &&
    !detailText.includes("<") &&
    card.images.length === 2 &&
    card.images[0].startsWith("https://cdn.example.com/ada.jpg") &&
    card.images[1] === "/logo.png.webp" &&
    detail.phone === "+905550000001" &&
    detail.whatsapp === "+905550000002" &&
    detail.telegram === "adavipscript" &&
    card.priority_order === 0 &&
    card.display_priority === 7 &&
    card.vip_slot === null &&
    card.normal_slot === 3 &&
    card.created_at === "2026-06-06T10:00:00.000Z"
  ) {
    pass("public API output sanitizer");
  } else {
    fail("public API output sanitizer");
  }
}

async function assertAuthAndErrorHygiene() {
  const bearerReq = { get: () => "Bearer valid-token" };
  const basicReq = { get: () => "Basic valid-token" };
  const emptyReq = { get: () => "Bearer" };
  const smuggledReq = { get: () => "Bearer valid-token extra" };

  if (
    getBearerToken(bearerReq) === "valid-token" &&
    getBearerToken(basicReq) === "" &&
    getBearerToken(emptyReq) === "" &&
    getBearerToken(smuggledReq) === ""
  ) {
    pass("auth bearer parser requires strict Bearer token");
  } else {
    fail("auth bearer parser requires strict Bearer token");
  }

  const routeFiles = await Promise.all([
    readFile(new URL("../src/routes/adminRoutes.js", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/adminMobileRoutes.js", import.meta.url), "utf8")
  ]);

  if (!routeFiles.join("\n").includes("error.message || fallback")) {
    pass("database errors use public fallback messages");
  } else {
    fail("database errors use public fallback messages");
  }
}

function assertLeakedPasswordHelpers() {
  const hash = sha1UpperHex("password");
  const suffix = hash.slice(5);
  const rangeText = [
    "00000000000000000000000000000000000:0",
    `${suffix}:3303003`,
    "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:12"
  ].join("\r\n");

  if (
    hash === "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8" &&
    parsePwnedRangeResponse(rangeText, suffix) === 3303003 &&
    parsePwnedRangeResponse(rangeText, "11111111111111111111111111111111111") === 0
  ) {
    pass("leaked password helper uses SHA-1 range suffix matching");
  } else {
    fail("leaked password helper uses SHA-1 range suffix matching");
  }
}

async function assertCachePolicy(path, expected) {
  const response = await request(path);
  const cacheControl = response.headers.get("cache-control") || "";
  const cdnCacheControl = response.headers.get("cloudflare-cdn-cache-control") || response.headers.get("cdn-cache-control") || "";
  const pragma = response.headers.get("pragma") || "";

  if (expected === "private") {
    if (/no-store|no-cache/i.test(cacheControl)) {
      pass(`${path} private cache policy`);
    } else {
      fail(`${path} cache-control ${cacheControl || "missing"}, expected no-store/no-cache`);
    }
    return;
  }

  if (expected === "public-html") {
    if (
      /public/i.test(cacheControl) &&
      /must-revalidate/i.test(cacheControl) &&
      /no-transform/i.test(cacheControl) &&
      /max-age=60(?:,|$)/i.test(cdnCacheControl) &&
      /must-revalidate/i.test(cdnCacheControl) &&
      !/stale-while-revalidate/i.test(cdnCacheControl)
    ) {
      pass(`${path} public HTML cache policy`);
    } else {
      fail(`${path} cache-control ${cacheControl || "missing"} cdn-cache-control ${cdnCacheControl || "missing"}, expected public HTML no-transform + CDN TTL`);
    }
    return;
  }

  if (expected === "asset") {
    if (/max-age=/i.test(cacheControl) && !pragma) {
      pass(`${path} asset cache policy`);
    } else {
      fail(`${path} cache-control ${cacheControl || "missing"} pragma ${pragma || "none"}, expected public max-age without pragma`);
    }
  }
}

function extractVisibleText(html) {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function assertPublicCopyHygieneContracts() {
  const contractProfilePath = await getContractProfilePath();
  const routeChecks = [
    "/",
    "/iletisim",
    "/ilanlar",
    "/kategoriler",
    "/istanbul-escort",
    "/sisli-escort",
    "/vip-escort",
    "/esmer-escort",
    contractProfilePath
  ];
  const forbiddenVisibleTerms = [
    "seo zinciri",
    "hub mimarisi",
    "kategori hub",
    "city hub",
    "landing",
    "viewport",
    "mimari",
    "omurga",
    "katman",
    "geçiş",
    "köprüleri",
    "schema",
    "json-ld",
    "sinyal"
  ];

  for (const path of routeChecks) {
    const html = await text(path, 200, "text/html");
    if (!html) continue;

    const visibleText = extractVisibleText(html).toLocaleLowerCase("tr-TR");
    const leaked = forbiddenVisibleTerms.filter((term) => visibleText.includes(term));

    if (!leaked.length) {
      pass(`${path} public copy hides internal SEO language`);
    } else {
      fail(`${path} public copy leaks ${leaked.join(", ")}`);
    }
  }
}

async function assertClientBundleSafety() {
  const adminSources = await Promise.all([
    "../admin.js",
    "../public/js/admin/shared.js",
    "../public/js/admin/settings.js",
    "../public/js/admin/profiles.js",
    "../public/js/admin/customers.js",
    "../public/js/admin/analytics.js",
    "../public/js/admin/ads.js",
    "../public/js/admin/tools.js",
    "../public/js/admin/auth.js",
    "../public/js/admin/index.js",
    "../public/js/admin/pwa.js"
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  const adminCss = await readFile(new URL("../admin.css", import.meta.url), "utf8");
  const customerPanelCss = await readFile(new URL("../customer-panel.css", import.meta.url), "utf8");
  const adminHtml = await readFile(new URL("../vg-panel-91x.html", import.meta.url), "utf8");
  const adminManifest = await readFile(new URL("../admin.webmanifest", import.meta.url), "utf8");
  const adminServiceWorker = await readFile(new URL("../admin-sw.js", import.meta.url), "utf8");
  const adminReleaseManifest = await readFile(new URL("../public/downloads/vip-gece-admin-latest.json", import.meta.url), "utf8");
  const customerPanelHtml = await readFile(new URL("../customer-panel.html", import.meta.url), "utf8");
  const customerPanelJs = await readFile(new URL("../public/js/customer-panel.js", import.meta.url), "utf8");
  const homeSources = await Promise.all([
    "../public/js/home-render.js",
    "../public/js/home/index.js",
    "../public/js/home/utils.js"
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const detailHtml = await readFile(new URL("../detay.html", import.meta.url), "utf8");
  const categoryHtml = await readFile(new URL("../kategori.html", import.meta.url), "utf8");
  const contactHtml = await readFile(new URL("../iletisim.html", import.meta.url), "utf8");
  const publicHtmlSources = await Promise.all([
    "../404.html",
    "../bolge.html",
    "../detay.html",
    "../ilanlar.html",
    "../index.html",
    "../istanbul.html",
    "../iletisim.html",
    "../kategori.html",
    "../kategori-landing.html"
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  const categorySources = await Promise.all([
    "../public/js/category-final.js",
    "../public/js/landing/context.js",
    "../public/js/landing/index.js",
    "../public/js/landing/metadata.js",
    "../public/js/landing/state.js",
    "../public/js/landing/utils.js",
    "../public/js/landing/view.js"
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  const detailSources = await Promise.all([
    "../public/js/detail-final.js",
    "../public/js/detail/index.js",
    "../public/js/detail/state.js",
    "../public/js/detail/utils.js",
    "../public/js/detail/view.js"
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  const publicCoreCss = await readFile(new URL("../public/css/core.css", import.meta.url), "utf8");
  const homeCss = await readFile(new URL("../public/css/home-redesign.css", import.meta.url), "utf8");
  const deferredCssSource = await readFile(new URL("../public/js/deferred-css.js", import.meta.url), "utf8");
  const homeRendererSource = await readFile(new URL("../src/services/render/homeRenderer.js", import.meta.url), "utf8");
  const iconsCss = await readFile(new URL("../public/css/icons.css", import.meta.url), "utf8");
  const styleCss = await readFile(new URL("../style.css", import.meta.url), "utf8");
  const homeBrandBanner = await readFile(new URL("../public/assets/vip-gece-brand-banner-20260726.webp", import.meta.url));
  const homeMobileBrandBanner = await readFile(new URL("../public/assets/vip-gece-brand-banner-20260726-720.webp", import.meta.url));
  const siteConfigSource = await readFile(new URL("../config.js", import.meta.url), "utf8");
  const adminBundleText = adminSources.join("\n");
  const publicHtmlText = publicHtmlSources.join("\n");
  const publicImageClientText = [...homeSources, ...categorySources, ...detailSources].join("\n");
  const cardFirstHomeCss = homeCss.slice(homeCss.indexOf("/* Card-first home: listings lead the page, discovery content supports them. */"));
  const cardFirstDesktopCss = cardFirstHomeCss.slice(0, cardFirstHomeCss.indexOf("@media (max-width: 1280px)"));
  const cardFirstTabletCss = cardFirstHomeCss.slice(
    cardFirstHomeCss.indexOf("@media (max-width: 1024px)"),
    cardFirstHomeCss.indexOf("@media (max-width: 720px)")
  );
  const mobileHomeCss = homeCss.slice(homeCss.lastIndexOf("@media (max-width: 720px)"));

  if (
    !/await\s+legacy(?:SaveProfile|DeleteProfile|LoadProfiles)\b/.test(adminBundleText) &&
    !/\.from\(["']profiles["']\)/.test(adminBundleText)
  ) {
    pass("admin profile writes do not fall back to direct Supabase profiles access");
  } else {
    fail("admin profile writes do not fall back to direct Supabase profiles access");
  }

  if (
    adminBundleText.includes("/api/v1/admin/site-settings") &&
    adminBundleText.includes("/api/v1/admin/profile-images") &&
    adminBundleText.includes("/api/v1/admin/customer-accounts") &&
    adminBundleText.includes("/api/admin/analytics/overview") &&
    !adminBundleText.includes('sb.from("settings")') &&
    !adminBundleText.includes('.storage.from("images").upload')
  ) {
    pass("admin settings, media, customers and analytics use authenticated server APIs");
  } else {
    fail("admin settings, media, customers and analytics use authenticated server APIs");
  }

  if (
    adminBundleText.includes('await adminApi("/api/v1/admin/status");') &&
    adminBundleText.includes("loginErrorMessage(error)") &&
    adminBundleText.includes("await sb.auth.signOut();")
  ) {
    pass("admin login verifies Supabase session against server allowlist");
  } else {
    fail("admin login verifies Supabase session against server allowlist");
  }

  if (
    !adminBundleText.includes("+62 851 2407 7760") &&
    !adminHtml.includes("+62 851 2407 7760") &&
    !/<input[^>]+id=["']whatsapp["'][^>]+readonly/i.test(adminHtml)
  ) {
    pass("admin profile form has no forced shared WhatsApp number");
  } else {
    fail("admin profile form has no forced shared WhatsApp number");
  }

  if (!/(?:onclick|oninput|onchange)\s*=|onerror=|innerHTML/.test(adminBundleText)) {
    pass("admin bundle avoids inline handlers and raw innerHTML");
  } else {
    fail("admin bundle avoids inline handlers and raw innerHTML");
  }

  if (
    adminCss.includes(':root[data-theme="bordo"]') &&
    adminCss.includes(':root[data-theme="yuksek-kontrast"]') &&
    customerPanelCss.includes(':root[data-theme="bordo"]') &&
    customerPanelCss.includes(':root[data-theme="yuksek-kontrast"]') &&
    adminHtml.includes('id="adminTheme"') &&
    customerPanelHtml.includes('id="customerTheme"') &&
    !/#7c3aed|#a855f7|124,58,237|168,85,247/i.test(`${adminCss}\n${customerPanelCss}`)
  ) {
    pass("private panels expose customer-selectable themes without legacy purple tokens");
  } else {
    fail("private panels expose customer-selectable themes without legacy purple tokens");
  }

  if (
    publicHtmlSources.every((source) => source.includes("/public/css/icons.css?v=20260710-cardfirst")) &&
    !/cdn\.jsdelivr\.net\/npm\/remixicon|remixicon\.css/i.test(publicHtmlText) &&
    iconsCss.includes(".ri-sparkling-2-line::before") &&
    iconsCss.includes(".ri-map-pin-line::before")
  ) {
    pass("public pages use local icon CSS instead of Remixicon CDN");
  } else {
    fail("public pages use local icon CSS instead of Remixicon CDN");
  }

  if (!/innerHTML|onclick\s*=|onerror=/.test(`${detailSources.join("\n")}\n${categorySources.join("\n")}`)) {
    pass("detail/category bundles avoid raw innerHTML and inline handlers");
  } else {
    fail("detail/category bundles avoid raw innerHTML and inline handlers");
  }

  if (
    !publicImageClientText.includes("btoa(") &&
    !/\/media\/profile-image\/\$\{/.test(publicImageClientText) &&
    publicImageClientText.includes('raw.startsWith("/media/profile-image/")')
  ) {
    pass("browser clients consume only server-signed profile image URLs");
  } else {
    fail("browser clients consume only server-signed profile image URLs");
  }

  if (
    compactCode(cardFirstDesktopCss).includes(compactCode(".selected-grid { grid-template-columns: repeat(5, minmax(0, 1fr));")) &&
    compactCode(cardFirstTabletCss).includes(compactCode(".selected-grid { grid-template-columns: repeat(5, minmax(0, 1fr));")) &&
    compactCode(mobileHomeCss).includes(compactCode(".selected-grid { grid-template-columns: repeat(5, minmax(0, 1fr));")) &&
    includesCompact(siteConfigSource, "normalCount: 50,") &&
    includesCompact(adminBundleText, "homepageSlot >= 1 && homepageSlot <= 50") &&
    adminHtml.includes('placeholder="1-50 vitrin, 51+ yalnız Tüm İlanlar"')
  ) {
    pass("home selected grid keeps five columns across desktop, tablet and mobile with slots 1-50");
  } else {
    fail("home five-column responsive parity and slots 1-50");
  }

  if (
    indexHtml.includes('body[data-page="home"][data-server-rendered="true"] .selected-board') &&
    indexHtml.includes("content-visibility:visible!important") &&
    indexHtml.includes("contain-intrinsic-size:auto!important") &&
    indexHtml.includes('[data-home-deferred-card="true"]') &&
    indexHtml.includes("content-visibility:hidden") &&
    indexHtml.includes("contain-intrinsic-block-size") &&
    homeRendererSource.includes("const HOME_STORY_PROFILE_LIMIT = 5;") &&
    homeRendererSource.includes("const HOME_DEFERRED_SELECTED_CARD_START = 10;") &&
    homeRendererSource.includes('data-home-deferred-card="true"') &&
    deferredCssSource.includes("IntersectionObserver") &&
    deferredCssSource.includes('window.addEventListener("scroll"') &&
    deferredCssSource.includes('removeAttribute("data-home-deferred-card")')
  ) {
    pass("home SSR keeps two visible rows and progressively renders stable deferred cards");
  } else {
    fail("home SSR keeps two visible rows and progressively renders stable deferred cards");
  }

  if (
    indexHtml.includes('<source type="image/avif" srcset="/public/assets/vip-gece-brand-banner-20260726-720.avif 720w" sizes="(max-width: 720px) calc(100vw - 50px), 634px" width="720" height="226">') &&
    indexHtml.includes('<source type="image/webp" srcset="/public/assets/vip-gece-brand-banner-20260726-720.webp 720w, /public/assets/vip-gece-brand-banner-20260726.webp 1540w" sizes="(max-width: 720px) calc(100vw - 50px), 634px" width="720" height="226">') &&
    indexHtml.includes('<img src="/public/assets/vip-gece-brand-banner-20260726-720.webp" alt="VIP Gece" class="site-logo" width="720" height="226" loading="eager" decoding="async" fetchpriority="high">') &&
    !indexHtml.includes('/public/assets/vip-gece-logo-336.avif') &&
    !indexHtml.includes('srcset="/logo.png.webp?v=20260725-audit2"') &&
    indexHtml.includes('data-home-brand-ratio') &&
    indexHtml.includes('.brand-mark{display:block;width:100%;max-width:634px;min-width:0;line-height:0}') &&
    indexHtml.includes('.brand-picture{display:block;width:100%;max-width:100%;min-width:0') &&
    indexHtml.includes('.site-logo{display:block;width:100%;max-width:100%') &&
    indexHtml.includes('aspect-ratio:720/226') &&
    indexHtml.includes('body[data-page="home"] .brand-copy{display:none}') &&
    indexHtml.includes('/public/css/home-redesign.css?v=20260808-fivecolumn1') &&
    !indexHtml.includes('class="home-nav"') &&
    !indexHtml.includes('id="randomProfileBtn"') &&
    !indexHtml.includes('id="quickSearchBtn"') &&
    indexHtml.includes('class="footer-legal-links"') &&
    indexHtml.includes('href="/guven-ve-politikalar">Hakkımızda ve Politikalar</a>') &&
    indexHtml.includes('href="/iletisim">İletişim</a>') &&
    includesCompact(mobileHomeCss, 'body[data-page="home"] .home-header::after { display: none') &&
    includesCompact(mobileHomeCss, 'body[data-page="home"] .story-board { order: 0;') &&
    homeBrandBanner.length > 20000 &&
    homeMobileBrandBanner.length > 8000 &&
    homeMobileBrandBanner.length < homeBrandBanner.length / 3
  ) {
    pass("home header keeps only the wide VIP Gece banner and moves secondary links to footer");
  } else {
    fail("home header keeps only the wide VIP Gece banner and moves secondary links to footer");
  }

  if (
    includesCompact(homeCss, "--home-color-accent: #ff3f57") &&
    includesCompact(homeCss, "--home-color-accent-strong: #ff7a18") &&
    adminCss.includes("--primary:#ff3f57") &&
    adminCss.includes("--primary-2:#ff7a18") &&
    customerPanelCss.includes("--primary:#ff3f57") &&
    customerPanelCss.includes("--primary-hot:#ff7a18") &&
    adminCss.includes("linear-gradient(180deg,#070205 0%,#140508 42%,#1b0709 100%)") &&
    customerPanelCss.includes("linear-gradient(180deg,#070205 0%,#140508 42%,#1b0709 100%)")
  ) {
    pass("private panels inherit the live homepage night palette");
  } else {
    fail("private panels inherit the live homepage night palette");
  }

  const mobileNav = await readFile(new URL("../public/components/mobile-nav.html", import.meta.url), "utf8");
  const componentLoader = await readFile(new URL("../public/js/components-loader.js", import.meta.url), "utf8");
  if (
    !/class=["']active["']/.test(mobileNav) &&
    mobileNav.includes('<nav class="mobile-nav" aria-label="Alt gezinme">') &&
    componentLoader.includes("activateMobileNav") &&
    componentLoader.includes("isCategoryRoute")
  ) {
    pass("mobile nav active state is route-driven");
  } else {
    fail("mobile nav active state is route-driven");
  }

  if (
    homeSources.join("\n").includes("function isAdvertisingImage") &&
    homeSources.join("\n").includes("function getImages") &&
    includesCompact(homeSources.join("\n"), "window.open(url, \"_blank\", \"noopener,noreferrer\")")
  ) {
    pass("client bundle removes legacy ad shells");
  } else {
    fail("client bundle removes legacy ad shells");
  }

  if (
    styleCss.includes(".ad-zone") &&
    styleCss.includes(".ad-banner") &&
    styleCss.includes('img[alt*="Reklam"]') &&
    styleCss.includes('img[src*="banner-middle"]') &&
    styleCss.includes('img[src*="empty-box-logo"]')
  ) {
    pass("CSS hides legacy ad shells");
  } else {
    fail("CSS hides legacy ad shells");
  }

  const htmlAssets = `${indexHtml}\n${detailHtml}\n${categoryHtml}\n${contactHtml}\n${adminHtml}`;
  const latestAssetVersion = "20260729-conversion1";
  const latestHomeAssetVersion = "20260806-pagespeed1";
  const staleAssetVersionPattern = /20260606-2345|20260607-0045|20260627-icons|20260630-admin-app|20260630-ga|20260702-minify|20260702-visual4/;
  if (
    !staleAssetVersionPattern.test(htmlAssets) &&
    indexHtml.includes(`/public/js/home-render.js?v=${latestHomeAssetVersion}`) &&
    detailHtml.includes(`/public/js/detail-final.js?v=${latestAssetVersion}`) &&
    indexHtml.includes('type="module"')
  ) {
    pass("HTML assets use latest cache-bust version");
  } else {
    fail("HTML assets use latest cache-bust version");
  }

  if (!htmlAssets.includes("modal.css")) {
    pass("public HTML avoids legacy modal stylesheet");
  } else {
    fail("public HTML avoids legacy modal stylesheet");
  }

  if (
    !adminHtml.includes("/musteri.html") &&
    !adminHtml.includes("customerCode") &&
    adminHtml.includes("customerAccessEmail") &&
    adminHtml.includes("customerAccessPassword") &&
    adminHtml.includes("customerAccessLink")
  ) {
    pass("admin UI exposes hidden customer access controls without legacy membership");
  } else {
    fail("admin UI exposes hidden customer access controls without legacy membership");
  }

  if (
    adminHtml.includes('id="analyticsPanel"') &&
    adminHtml.includes('id="customersPanel"') &&
    adminHtml.includes('id="profileOwnerAccount"') &&
    adminHtml.includes('id="customerFilterSelect"') &&
    adminHtml.includes('id="analyticsProfileFilter"')
  ) {
    pass("admin UI exposes site-wide analytics and customer ownership controls");
  } else {
    fail("admin UI exposes site-wide analytics and customer ownership controls");
  }

  if (
    adminHtml.includes('id="searchSyncBtn"') &&
    adminSources.join("\n").includes("/api/admin/google/sync") &&
    includesCompact(adminSources.join("\n"), "inspectAllSitemapUrls: true") &&
    adminSources.join("\n").includes("Search eşzamanlama")
  ) {
    pass("admin UI exposes one-click Search Console sync");
  } else {
    fail("admin UI exposes one-click Search Console sync");
  }

  if (
    adminHtml.includes('id="imageFiles"') &&
    adminHtml.includes('id="images"') &&
    adminHtml.includes('id="imagePreview"')
  ) {
    pass("admin panel keeps profile photo management");
  } else {
    fail("admin panel keeps profile photo management");
  }

  if (
    !adminHtml.includes('rel="manifest"') &&
    !adminHtml.includes("cdn.jsdelivr.net") &&
    !adminHtml.includes("fonts.googleapis.com") &&
    adminHtml.includes('/public/vendor/supabase-js/supabase.js?v=20260911-fido1') &&
    adminHtml.includes('id="installAdminAppBtn"') &&
    adminHtml.includes('aria-hidden="true"') &&
    adminHtml.includes('id="adminAppUpdateBtn"') &&
    adminBundleText.includes("removeAdminBrowserWorkers") &&
    !includesCompact(adminBundleText, "serviceWorker.register(") &&
    adminBundleText.includes("/api/mobile/admin/update") &&
    adminReleaseManifest.includes('"app": "vip-gece-admin"') &&
    adminReleaseManifest.includes('"apk_url": "/public/downloads/vip-gece-admin-latest.apk"') &&
    adminHtml.includes('class="mobile-app-nav"') &&
    adminServiceWorker.includes("registration.unregister()") &&
    !adminServiceWorker.includes("addEventListener(\"fetch\"") &&
    !publicHtmlText.includes("admin.webmanifest") &&
    !publicHtmlText.includes("installAdminAppBtn")
  ) {
    pass("admin panel disables browser workers, PWA install, and third-party admin shell assets");
  } else {
    fail("admin panel disables browser workers, PWA install, and third-party admin shell assets");
  }

  if (
    customerPanelHtml.includes('meta name="robots" content="noindex, nofollow, noarchive, nosnippet"') &&
    !/üye ol|üyelik|register|signup/i.test(customerPanelHtml) &&
    !/seo|slug|vip_slot|normal_slot|priority_order|is_active|is_sponsored/i.test(`${customerPanelHtml}\n${customerPanelJs}`) &&
    customerPanelJs.includes("/api/customer/access/") &&
    customerPanelJs.includes("sessionStorage")
  ) {
    pass("hidden customer panel is direct-link only and own-listing scoped");
  } else {
    fail("hidden customer panel is direct-link only and own-listing scoped");
  }
}

function assertRuntimeConfigContracts() {
  const source = buildRuntimeConfigSource({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "public-anon-demo",
    SUPABASE_SERVICE_ROLE_KEY: "must-not-render"
  });

  if (
    source.includes("https://example.supabase.co") &&
    source.includes("public-anon-demo") &&
    !source.includes("must-not-render")
  ) {
    pass("runtime config injects only public Supabase auth settings");
  } else {
    fail("runtime config injects only public Supabase auth settings");
  }
}

async function assertProfileDataFallbackContracts() {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const profilesRepo = await readFile(new URL("../src/data/profilesRepo.js", import.meta.url), "utf8");
  const postgresClient = await readFile(new URL("../src/data/postgresClient.js", import.meta.url), "utf8");
  const postgresProfilesRepo = await readFile(new URL("../src/data/postgresProfilesRepo.js", import.meta.url), "utf8");

  if (packageJson.dependencies && packageJson.dependencies.pg) {
    pass("Postgres fallback dependency is declared");
  } else {
    fail("Postgres fallback dependency is declared");
  }

  if (
    profilesRepo.includes("getPostgresProfiles") &&
    profilesRepo.includes("fallbackProfiles") &&
    profilesRepo.indexOf("getPostgresProfiles") < profilesRepo.lastIndexOf("fallbackProfiles")
  ) {
    pass("public profiles use Postgres before demo fallback");
  } else {
    fail("public profiles use Postgres before demo fallback");
  }

  const previousDatabaseUrl = process.env.DATABASE_URL;
  const unsafeTlsModes = ["require", "no-verify", "disable"];
  const sanitizedTlsUrls = unsafeTlsModes.every((mode) => {
    process.env.DATABASE_URL =
      `postgresql:${"//"}contract:secret@db.example.com:5432/app?sslmode=${mode}&sslrootcert=/tmp/untrusted.pem&uselibpqcompat=true&application_name=contract`;
    const parsed = new URL(databaseConnectionString());
    const keys = [...parsed.searchParams.keys()].map((key) => key.toLowerCase());
    return (
      parsed.searchParams.get("application_name") === "contract" &&
      !keys.some((key) => key.startsWith("ssl") || key === "uselibpqcompat")
    );
  });
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;

  if (sanitizedTlsUrls) {
    pass("Postgres connection URL cannot override explicit TLS verification settings");
  } else {
    fail("Postgres connection URL cannot override explicit TLS verification settings");
  }

  if (
    postgresClient.includes('require("pg")') &&
    postgresClient.includes("process.env.DATABASE_URL") &&
    postgresClient.includes("shouldVerifySslCertificate()") &&
    postgresClient.includes('process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false"') &&
    postgresClient.includes("process.env.DATABASE_SSL_CA_FILE") &&
    postgresClient.includes("databaseSslConfig()") &&
    postgresClient.includes("supabase-root-2021-ca.crt")
  ) {
    pass("Postgres client uses DATABASE_URL server-side with certificate verification by default");
  } else {
    fail("Postgres client uses DATABASE_URL server-side with certificate verification by default");
  }

  if (
    postgresProfilesRepo.includes("from public.profiles") &&
    postgresProfilesRepo.includes("where is_active = true") &&
    postgresProfilesRepo.includes("PUBLIC_PROFILE_COLUMNS")
  ) {
    pass("Postgres profile fallback reads public active profile projection");
  } else {
    fail("Postgres profile fallback reads public active profile projection");
  }

  if (
    postgresProfilesRepo.includes("PROFILE_CACHE_STALE_MAX_MS") &&
    postgresProfilesRepo.includes("PROFILE_CACHE_TTL_MS + 120_000") &&
    postgresProfilesRepo.includes("fetchedAt") &&
    postgresProfilesRepo.includes("failedAt - profileCache.fetchedAt <= PROFILE_CACHE_STALE_MAX_MS") &&
    postgresProfilesRepo.includes("profileCacheRefresh") &&
    postgresProfilesRepo.includes("profileCacheGeneration") &&
    postgresProfilesRepo.includes("return filterIndexableProfiles(await getPostgresProfiles())")
  ) {
    pass("Postgres public profile cache coalesces refreshes and has a bounded stale outage window");
  } else {
    fail("Postgres public profile cache coalesces refreshes and has a bounded stale outage window");
  }
}

async function assertReleaseScriptSafety() {
  const packageStaging = await readFile(new URL("../scripts/package-staging.mjs", import.meta.url), "utf8");
  const verifyPackage = await readFile(new URL("../scripts/verify-package-artifact.mjs", import.meta.url), "utf8");
  const listCompletionAudit = await readFile(new URL("../scripts/vip-gece-list-completion-audit.mjs", import.meta.url), "utf8");
  const fullGoalReadiness = await readFile(new URL("../scripts/full-goal-readiness.mjs", import.meta.url), "utf8");
  const externalProofContract = await readFile(new URL("../scripts/external-proof-contract.mjs", import.meta.url), "utf8");
  const externalProofIntake = await readFile(new URL("../scripts/external-proof-intake.mjs", import.meta.url), "utf8");
  const reviewUrl = await readFile(new URL("../scripts/review-url.mjs", import.meta.url), "utf8");
  const liveSeoAudit = await readFile(new URL("../scripts/live-domain-seo-audit.mjs", import.meta.url), "utf8");

  if (
    packageStaging.includes('PACKAGE_DATE_LABEL || "20260810"') &&
    verifyPackage.includes('PACKAGE_DATE_LABEL || "20260810"')
  ) {
    pass("release scripts default to latest package date");
  } else {
    fail("release scripts default to latest package date");
  }

  if (packageStaging.includes('name.startsWith(".env.")')) {
    pass("package script excludes generic env files");
  } else {
    fail("package script excludes generic env files");
  }

  if (
    packageStaging.includes('"build-readable-whatsapp-export.mjs"') &&
    packageStaging.includes('"build-whatsapp-archive.mjs"')
  ) {
    pass("package script excludes unrelated WhatsApp archive utilities");
  } else {
    fail("package script excludes unrelated WhatsApp archive utilities");
  }

  if (
    packageStaging.includes("syncPackageShaDocs")
    && packageStaging.includes("Guncel paket SHA")
    && packageStaging.includes("VIP_GECE_DEPLOYED_PACKAGE_SHA")
  ) {
    pass("package script syncs package SHA into local proof docs");
  } else {
    fail("package script syncs package SHA into local proof docs");
  }

  if (!reviewUrl.includes("ALLOW_PROD_REVIEW_URL") && reviewUrl.includes("refusing to run write-capable review against live")) {
    pass("review URL gate cannot be overridden for production");
  } else {
    fail("review URL gate cannot be overridden for production");
  }

  if (
    liveSeoAudit.includes("function expectedPublicProfileCount(siteUrl)") &&
    liveSeoAudit.includes('"VIP_GECE_EXPECTED_PUBLIC_PROFILE_COUNT"') &&
    liveSeoAudit.includes('"VIP_GECE_EXPECTED_INDEXABLE_PROFILE_COUNT"') &&
    liveSeoAudit.includes('"VIP_GECE_EXPECTED_SITEMAP_URL_COUNT"') &&
    !liveSeoAudit.includes("if (strict && !local)")
  ) {
    pass("strict promotion audit accepts deployment-specific profile and sitemap counts");
  } else {
    fail("strict promotion audit accepts deployment-specific profile and sitemap counts");
  }

  if (
    verifyPackage.includes("packageFileEntries") &&
    verifyPackage.includes("package source exists as file") &&
    verifyPackage.includes("runtime/ops/postgres/001-analytics-events.sql") &&
    packageStaging.includes('"ops"')
  ) {
    pass("package verifier checks all runtime source hashes and required database migrations");
  } else {
    fail("package verifier checks all runtime source hashes and required database migrations");
  }

  if (
    verifyPackage.includes("DOC_HASH_SYNC_TARGETS")
    && verifyPackage.includes("matches package sha")
    && verifyPackage.includes("vip-gece-external-proof-runbook-20260626.md")
  ) {
    pass("package verifier checks synced local proof doc hashes");
  } else {
    fail("package verifier checks synced local proof doc hashes");
  }

  if (
    verifyPackage.includes("runtime/scripts/vip-gece-list-completion-audit.mjs") &&
    verifyPackage.includes("runtime/scripts/full-goal-readiness.mjs") &&
    verifyPackage.includes("runtime/scripts/pagespeed-api-audit.mjs") &&
    verifyPackage.includes("runtime/scripts/external-proof-contract.mjs") &&
    verifyPackage.includes("runtime/scripts/external-proof-intake.mjs") &&
    packageStaging.includes("npm run external-proof-contract") &&
    packageStaging.includes("npm run pagespeed-api-audit -- --strict") &&
    packageStaging.includes("npm run external-proof-intake -- --markdown") &&
    packageStaging.includes("npm run list-completion-audit -- --markdown")
    && packageStaging.includes("npm run full-goal-readiness -- --markdown")
  ) {
    pass("release package carries completion and full-goal readiness gates");
  } else {
    fail("release package carries completion and full-goal readiness gates");
  }

  if (
    listCompletionAudit.includes("requirements_total")
    && listCompletionAudit.includes("full_goal_complete")
    && listCompletionAudit.includes("planned_external")
    && listCompletionAudit.includes("pluginRecord")
    && listCompletionAudit.includes("validateProofFile")
    && listCompletionAudit.includes("_templates")
    && listCompletionAudit.includes("proofRules")
  ) {
    pass("old-list audit separates local gate from validated full external completion");
  } else {
    fail("old-list audit separates local gate from validated full external completion");
  }

  if (
    listCompletionAudit.includes('packageJson?.name === "vip-gece-rebuild"')
    && listCompletionAudit.includes('exists(repoPath("server.modular.js"))')
    && !listCompletionAudit.includes("workspacePathReady: ROOT_DIR ===")
  ) {
    pass("VIP workspace audit is repo-identity based and checkout-path independent");
  } else {
    fail("VIP workspace audit is repo-identity based and checkout-path independent");
  }

  if (
    fullGoalReadiness.includes("ok: fileValidation.ok")
    && fullGoalReadiness.includes("boolean flags alone do not close")
    && listCompletionAudit.includes("return fileReady;")
  ) {
    pass("external marketing and image proof cannot be closed by boolean flags alone");
  } else {
    fail("external marketing and image proof cannot be closed by boolean flags alone");
  }

  if (
    fullGoalReadiness.includes("production-deploy-vip-gece.md")
    && fullGoalReadiness.includes("Production completion requires a validated production-deploy proof file")
    && fullGoalReadiness.includes("liveSeoResultOk")
    && fullGoalReadiness.includes("normalizeSha")
    && listCompletionAudit.includes("productionProofReady")
    && listCompletionAudit.includes("liveSeoResultOk")
    && listCompletionAudit.includes("Live SEO result")
  ) {
    pass("production completion requires validated deploy proof file");
  } else {
    fail("production completion requires validated deploy proof file");
  }

  if (
    externalProofContract.includes("boolean proof flags alone do not complete full goal")
    && externalProofContract.includes("template path is rejected as SEO proof")
    && externalProofContract.includes("draft path is rejected as SEO proof")
    && externalProofContract.includes("equivalent external SEO audit proof can replace Semrush")
    && externalProofContract.includes("production proof requires explicit ok=true SEO result")
    && externalProofContract.includes("production proof alone does not complete full goal")
  ) {
    pass("external proof behavior is covered by executable negative contracts");
  } else {
    fail("external proof behavior is covered by executable negative contracts");
  }

  if (
    externalProofIntake.includes("DRAFT_DIR")
    && externalProofIntake.includes("_drafts")
    && externalProofIntake.includes("--write-drafts")
    && externalProofIntake.includes("--promote")
    && externalProofIntake.includes("No secrets included")
    && externalProofIntake.includes("draft is not valid proof yet")
  ) {
    pass("external proof intake writes drafts without closing proof gates");
  } else {
    fail("external proof intake writes drafts without closing proof gates");
  }

  if (
    fullGoalReadiness.includes("full_goal_ready")
    && fullGoalReadiness.includes("VIP_GECE_PRODUCTION_PROOF")
    && fullGoalReadiness.includes("production-deploy-vip-gece.md")
    && fullGoalReadiness.includes("VIP_GECE_SEMRUSH_READY")
    && fullGoalReadiness.includes("validateProofFile")
    && fullGoalReadiness.includes("Proof files must pass required-field validation")
    && fullGoalReadiness.includes("No secret values are printed")
  ) {
    pass("full-goal readiness preflight tracks validated external proof without printing secrets");
  } else {
    fail("full-goal readiness preflight tracks validated external proof without printing secrets");
  }
}

async function assertPublicPagesHaveNoAdShells() {
  const forbidden = /ad-zone|ad-banner|banner-(?:top|middle|bottom)|empty-box-logo|Reklam Alan/i;

  for (const path of ["/", "/anasayfa"]) {
    const html = await text(path, 200, "text/html");
    if (!html) continue;

    if (!forbidden.test(html)) {
      pass(`${path} has no rendered ad shell HTML`);
    } else {
      fail(`${path} contains legacy ad shell HTML`);
    }
  }
}

async function assertSecurityHeader(path) {
  const response = await request(path);
  const csp = response.headers.get("content-security-policy") || "";
  const permissionsPolicy = response.headers.get("permissions-policy") || "";

  if (path === "/vg-panel-91x") {
    if (
      csp.includes("default-src 'self'") &&
      csp.includes("script-src 'self'") &&
      csp.includes("worker-src 'none'") &&
      csp.includes("manifest-src 'none'") &&
      csp.includes("frame-src 'none'") &&
      !csp.includes("cdn.jsdelivr.net") &&
      !csp.includes("googletagmanager.com") &&
      !csp.includes("fonts.googleapis.com") &&
      response.headers.get("cache-control")?.includes("no-store") &&
      permissionsPolicy.includes("camera=()") &&
      permissionsPolicy.includes("microphone=()") &&
      permissionsPolicy.includes("geolocation=()") &&
      permissionsPolicy.includes("publickey-credentials-get=(self)")
    ) {
      pass(`${path} enforced hardened admin browser policy`);
    } else {
      fail(`${path} enforced hardened admin browser policy`);
    }

    return;
  }

  if (
    csp.includes("default-src 'self'") &&
    csp.includes("script-src 'self' https://cdn.jsdelivr.net") &&
    csp.includes("https://www.googletagmanager.com") &&
    csp.includes("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com") &&
    csp.includes("font-src 'self' data: https://fonts.gstatic.com") &&
    !csp.includes("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net") &&
    !csp.includes("font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net")
  ) {
    pass(`${path} enforced public CSP header`);
  } else {
    fail(`${path} enforced public CSP header`);
  }
}

async function assertBodyLimit() {
  const response = await request("/api/analytics/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_type: "page_view", payload: "x".repeat(300 * 1024) })
  });

  if (response.status === 413) {
    pass("/api/analytics/event oversized body rejected");
  } else {
    fail(`/api/analytics/event oversized body status ${response.status}, expected 413`);
  }
}

async function assertMalformedJsonHandled() {
  const response = await request("/api/analytics/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{\"event_type\":"
  });
  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();

  if (
    response.status === 400 &&
    contentType.includes("application/json") &&
    body.includes("Geçersiz JSON gövdesi.") &&
    !/SyntaxError|node_modules|\/Volumes\//.test(body)
  ) {
    pass("/api/analytics/event malformed JSON error hygiene");
  } else {
    fail(`/api/analytics/event malformed JSON status ${response.status} type ${contentType || "missing"}`);
  }
}

const health = await json("/health", 200);
await assertReadinessContracts();
assertInputSanitizers();
assertProfileDefaultContracts();
await assertPublicProfileContactContracts();
assertSitemapEscaping();
assertGoogleSearchConsoleContracts();
assertDistrictSeoTargetContracts();
assertPublicOutputSanitizers();
assertLeakedPasswordHelpers();
await assertAuthAndErrorHygiene();
await assertClientBundleSafety();
assertRuntimeConfigContracts();
await assertProfileDataFallbackContracts();
await assertSeoHeadContracts();
await assertStructuredDataContracts();
await assertGoogleAnalyticsContracts();
await assertPublicImagePriorityContracts();
await assertHomePageSpeedContracts();
assertHomeImagePriorityContracts();
await assertPublicShellSsrContracts();
await assertPublicCopyHygieneContracts();
await assertHomeTabBehaviorContracts();
await assertHomeSearchAccessibilityContracts();
await assertHomeSsrContracts();
await assertPublicFallbackPolishContracts();
await assertClientImagePriorityContracts();
await assertMobileSafeAreaContracts();
await assertRuntimeEmptyStateContracts();
await assertMobileRailPolishContracts();
await assertMobileOverflowContainmentContracts();
await assertSkipLinkContracts();
await assertDetailInteractionContracts();
await assertMobileConversionRecoveryContracts();
await assertFullCardLinkContracts();
await assertReleaseScriptSafety();
await assertSecurityHeader("/");
await assertSecurityHeader("/vg-panel-91x");
await assertPublicPagesHaveNoAdShells();
await assertBodyLimit();
await assertMalformedJsonHandled();
if (health) {
  if (health.status === "ok" && health.service === "vip-gece" && typeof health.env === "string" && health.env.length > 0) {
    pass("/health body shape");
  } else {
    fail("/health body shape");
  }
  assertNoSensitiveHealthFields("/health", health);
}

const apiHealth = await json("/api/health", 200);
if (apiHealth) {
  if (apiHealth.status === "ok" && apiHealth.api === "available" && typeof apiHealth.env === "string" && apiHealth.env.length > 0) {
    pass("/api/health body shape");
  } else {
    fail("/api/health body shape");
  }
  assertNoSensitiveHealthFields("/api/health", apiHealth);
}

const systemDistricts = await json("/api/system/districts", 200);
if (systemDistricts && Array.isArray(systemDistricts.districts) && systemDistricts.districts.length >= 39) {
  pass("/api/system/districts district shape");
} else {
  fail("/api/system/districts district shape");
}

const systemLanguages = await json("/api/system/languages", 200);
if (systemLanguages && Array.isArray(systemLanguages.languages) && systemLanguages.languages.some((item) => item.code === "tr")) {
  pass("/api/system/languages language shape");
} else {
  fail("/api/system/languages language shape");
}

const legacyProfileList = await json("/api/public/profiles", 200);
if (legacyProfileList && Array.isArray(legacyProfileList.profiles)) {
  pass("/api/public/profiles compatibility shape");
} else {
  fail("/api/public/profiles compatibility shape");
}

const removedCustomerLogin = await json("/api/customer/login", 404, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}"
});
if (removedCustomerLogin && removedCustomerLogin.error === "API endpoint bulunamadı.") {
  pass("/api/customer/login removed from runtime");
} else {
  fail("/api/customer/login removed from runtime");
}

await text("/musteri", 404, "text/html");

await text("/m-panel/contract-token", 404, "text/plain");
pass("/m-panel/:token rejects unknown customer links");

const customerAccessLogin = await json("/api/customer/access/contract-token/login", 401, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "missing@example.com", password: "wrong" })
});
if (customerAccessLogin && customerAccessLogin.error === "Giriş bilgileri geçersiz.") {
  pass("/api/customer/access/:token/login is token-scoped");
} else {
  fail("/api/customer/access/:token/login is token-scoped");
}

const analyticsEvent = await json("/api/analytics/event", 202, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ event_type: "page_view", path: "/" })
});
if (
  analyticsEvent &&
  analyticsEvent.accepted === false &&
  analyticsEvent.tracked === false &&
  analyticsEvent.reason === "untrusted_client_context"
) {
  pass("/api/analytics/event rejects non-browser event context");
} else {
  fail("/api/analytics/event non-browser event rejection");
}

const profileList = await json("/api/v1/public/profiles", 200);
if (profileList) {
  if (!Array.isArray(profileList.profiles) || !profileList.profiles.length) {
    fail("/api/v1/public/profiles profiles array");
  } else {
    pass("/api/v1/public/profiles profiles array");
    assertProfileCardShape(profileList.profiles[0], "public list first profile");
    const publicImages = profileList.profiles.flatMap((profile) =>
      Array.isArray(profile.images) ? profile.images : []
    );
    if (
      publicImages.length > 0 &&
      publicImages.every((image) =>
        image.startsWith("/media/profile-image/") ||
        (/^\/[^/\\]/.test(image) && !image.startsWith("//"))
      ) &&
      !publicImages.some((image) => /\.supabase\.(?:co|com)\//i.test(image))
    ) {
      pass("/api/v1/public/profiles emits same-origin signed image URLs");
    } else {
      fail("/api/v1/public/profiles emits same-origin signed image URLs");
    }
    if (profileList.profiles[0].description && profileList.profiles[0].description !== profileList.profiles[0].card_label) {
      pass("/api/v1/public/profiles preserves full description");
    } else {
      fail("/api/v1/public/profiles preserves full description");
    }
  }
}

const contractProfileSlugForApi = await getContractProfileSlug();
const contractProfilePathForApi = `/profil/${contractProfileSlugForApi}`;
const profileDetail = await json(`/api/v1/public/profiles/${encodeURIComponent(contractProfileSlugForApi)}`, 200);
if (profileDetail && profileDetail.profile) {
  assertProfileDetailShape(profileDetail.profile, "public detail profile");
} else {
  fail(`/api/v1/public/profiles/${contractProfileSlugForApi} profile body`);
}

if (contractProfileSlugForApi === "ada-vip") {
  await assertRedirect("/escort-ada-vip", "/profil/ada-vip");
  await assertRedirect("/sisli-escort/ada-vip", "/profil/ada-vip");
} else {
  pass("legacy demo profile redirects skipped for live profile dataset");
}
await assertRedirect("/index.html", "/");
await assertRedirect("/guven-ve-politikalar.html", "/guven-ve-politikalar");
await assertRedirect("/iletisim.html", "/iletisim");
await assertRedirect("/ilanlar.html", "/ilanlar");
await assertRedirect("/kategori.html", "/kategoriler");
await assertRedirect("/istanbul.html", "/istanbul-escort");
await assertRedirect("/bolge.html", "/istanbul-escort");
await assertRedirect("/kategori-landing.html", "/kategoriler");
await assertRedirect("/detay.html", "/ilanlar");
await assertRedirect(`/detay.html?slug=${encodeURIComponent(contractProfileSlugForApi)}&utm_source=legacy`, `${contractProfilePathForApi}?utm_source=legacy`);
await assertRedirect("/index.html?utm_source=legacy", "/?utm_source=legacy");
await assertRedirect("/anasayfa", "/");
await assertRedirect("/home", "/");
await assertRedirect("/istanbul", "/istanbul-escort");
await assertRedirect("/bolge", "/istanbul-escort");
await assertRedirect("/bolgeler", "/istanbul-escort");
await assertRedirect("/escort", "/istanbul-escort");
await assertRedirect("/escortlar", "/ilanlar");
await assertRedirect("/profiller", "/ilanlar");
await assertRedirect("/profil", "/ilanlar");
await assertRedirect("/contact", "/iletisim");
await assertRedirect("/iletisim-bilgileri", "/iletisim");
await assertRedirect("/kategori", "/kategoriler");
await text("/index", 404);
await text("/detay", 404);
await text("/404", 404);
await text("/CNAME", 404);
await text("/mobile-admin/android/gradlew", 404);
await text("/mobile-admin/www/", 404);
await text("/vg-panel-91x", 404, "text/plain");
await text("/vg-panel-91x.html", 404, "text/html");
await text("/customer-panel.html", 404, "text/html");
await text("/ops/nginx/", 404);
await assertNoindexHeader("/api/health");
await assertNoindexHeader("/vg-panel-91x");
await assertNoindexHeader("/m-panel/contract-token");
await text("/bahcelievler-escort/bahcelievler-irem", 404, "text/html");
await assertDirectHtml("/istanbul-escort");
await assertDirectHtml("/esmer-escort");

const robotsTxt = await text("/robots.txt", 200, "text/plain");
const robotsPolicy = robotsTxt.replace(/\r\n/g, "\n");
if (
  robotsPolicy.includes("User-agent: *\nAllow: /") &&
  !/^Disallow:\s*\/\s*$/im.test(robotsPolicy) &&
  !robotsPolicy.includes("User-agent: Googlebot\n") &&
  !robotsPolicy.includes("User-agent: Google-InspectionTool\n") &&
  robotsPolicy.includes(`Sitemap: ${EXPECTED_SITE_URL}/sitemap.xml`) &&
  robotsPolicy.includes(`Sitemap: ${EXPECTED_SITE_URL}/image-sitemap.xml`)
) {
  pass("/robots.txt allows public search crawlers and advertises sitemaps");
} else {
  fail("/robots.txt public search crawler policy");
}
await assertPublicCrawlerCache("/robots.txt");

const sitemap = await text("/sitemap.xml", 200, "application/xml");
if (sitemap) {
  const requiredLocs = [
    `${EXPECTED_SITE_URL}/`,
    `${EXPECTED_SITE_URL}/iletisim`,
    `${EXPECTED_SITE_URL}${contractProfilePathForApi}`
  ];
  const hasRequiredLocs = requiredLocs.every((loc) => sitemap.includes(`<loc>${loc}</loc>`));

  if (sitemap.includes("<urlset") && hasRequiredLocs) {
    pass("/sitemap.xml sitemap shape");
  } else {
    fail("/sitemap.xml sitemap shape");
  }
}
await assertPublicCrawlerCache("/sitemap.xml");

const imageSitemap = await text("/image-sitemap.xml", 200, "application/xml");
if (imageSitemap) {
  if (imageSitemap.includes("<urlset") && imageSitemap.includes("schemas/sitemap-image")) {
    pass("/image-sitemap.xml sitemap shape");
  } else {
    fail("/image-sitemap.xml sitemap shape");
  }
}
await assertPublicCrawlerCache("/image-sitemap.xml");

const adminStatus = await json("/api/v1/admin/status", adminGuardStatus);
if (adminStatus && adminStatus.error === adminGuardError) {
  pass("/api/v1/admin/status unauthenticated error shape");
} else {
  fail("/api/v1/admin/status unauthenticated error shape");
}

const adminCoreRoutes = [
  ["GET", "/api/v1/admin/site-settings"],
  ["PUT", "/api/v1/admin/site-settings"],
  ["POST", "/api/v1/admin/profile-images"],
  ["GET", "/api/v1/admin/customer-accounts"],
  ["POST", "/api/v1/admin/customer-accounts"],
  ["PUT", "/api/v1/admin/customer-accounts/missing-account"]
];

for (const [method, route] of adminCoreRoutes) {
  const response = await request(route, { method });
  const result = await response.json().catch(() => null);
  if (
    response.status === adminGuardStatus &&
    result?.error === adminGuardError &&
    hasPrivateAdminHeaders(response)
  ) {
    pass(`${route} unauthenticated admin core guard`);
  } else {
    fail(`${route} unauthenticated admin core guard`);
  }
}

const adminOpsRoutes = [
  ["GET", "/api/admin/analytics/overview"],
  ["GET", "/api/admin/google/status"],
  ["GET", "/api/admin/google/sitemaps"],
  ["POST", "/api/admin/google/sync"],
  ["POST", "/api/admin/google/inspect"]
];

for (const [method, route] of adminOpsRoutes) {
  const response = await request(route, { method });
  const result = await response.json().catch(() => null);
  if (
    response.status === adminGuardStatus &&
    result?.error === adminGuardError &&
    hasPrivateAdminHeaders(response)
  ) {
    pass(`${route} unauthenticated admin ops guard`);
  } else {
    fail(`${route} unauthenticated admin ops guard`);
  }
}

const adminMobileRoutes = [
  ["GET", "/api/admin/mobile/health"],
  ["GET", "/api/admin/mobile/bootstrap"],
  ["GET", "/api/admin/mobile/profiles"],
  ["GET", "/api/admin/mobile/ads"],
  ["GET", "/api/admin/mobile/taxonomy"],
  ["GET", "/api/admin/mobile/google/status"],
  ["GET", "/api/admin/mobile/audit"],
  ["PATCH", "/api/admin/mobile/profiles/demo-ada"],
  ["DELETE", "/api/admin/mobile/profiles/demo-ada"],
  ["PATCH", "/api/admin/mobile/settings"],
  ["POST", "/api/admin/mobile/ads"],
  ["PATCH", "/api/admin/mobile/ads/demo-ad"],
  ["DELETE", "/api/admin/mobile/ads/demo-ad"]
];

for (const [method, route] of adminMobileRoutes) {
  const result = await json(route, adminGuardStatus, { method });
  if (result && result.error === adminGuardError) {
    pass(`${route} unauthenticated mobile admin guard`);
  } else {
    fail(`${route} unauthenticated mobile admin guard`);
  }
}

if (profileList && profileList.profiles && profileList.profiles.length >= 3) {
  pass("missing Supabase env public demo fallback");
} else {
  fail("missing Supabase env public demo fallback");
}

const privateStatic = await request("/src/app.js");
if (privateStatic.status === 404) {
  pass("/src/app.js remains blocked");
} else {
  fail(`/src/app.js status ${privateStatic.status}, expected 404`);
}

await assertCachePolicy("/", "public-html");
await assertCachePolicy("/kategoriler", "public-html");
await assertCachePolicy("/api/v1/public/profiles", "private");
await assertCachePolicy("/config.js", "private");
await assertCachePolicy("/admin.js", "private");
await assertCachePolicy(`/public/js/admin/auth.js?v=${Date.now()}`, "private");
await assertCachePolicy("/public/css/core.css", "asset");
await assertCachePolicy("/public/js/detail-final.js", "asset");
await assertCachePolicy("/logo.png.webp", "asset");

if (failures.length) {
  process.exitCode = 1;
}
