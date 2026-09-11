"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  GOOGLE_ANALYTICS_MEASUREMENT_ID,
  GOOGLE_SITE_VERIFICATION_CODE,
  ROOT_DIR,
  SITE_URL
} = require("../../config/env");
const { esc, safeSlug } = require("../../utils/text");
const { buildProfileImageProxyUrl } = require("../profileImageProxyService");
const {
  readSiteSettingsSync,
  siteConfigOverlay
} = require("../siteSettingsService");

const HOME_CATEGORY_LINKS = [
  { title: "Tüm Kategoriler", href: "/kategoriler" },
  { title: "İstanbul Escort", href: "/istanbul-escort" },
  { title: "VIP Escort", href: "/vip-escort" },
  { title: "Anal Escort", href: "/anal-escort" },
  { title: "Otel Escort", href: "/otel-escort" },
  { title: "Yabancı Escort", href: "/yabanci-escort" },
  { title: "Türbanlı Escort", href: "/turbanli-escort" },
  { title: "GFE Escort", href: "/gfe-escort" },
  { title: "Esmer Escort", href: "/esmer-escort" },
  { title: "Sarışın Escort", href: "/sarisin-escort" },
  { title: "Kumral Escort", href: "/kumral-escort" },
  { title: "Genç Escort", href: "/genc-escort" }
];

const BRAND_ASSET_VERSION = "20260725-audit2";
const SITE_ICON_PATH = `/public/assets/vip-gece-woman-icon-512.png?v=${BRAND_ASSET_VERSION}`;

const PUBLIC_SHELL_COMPONENTS = Object.freeze({
  header: "public/components/header.html",
  footer: "public/components/footer.html",
  "mobile-nav": "public/components/mobile-nav.html"
});

function jsonLd(data) {
  const serialized = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  return `<script type="application/ld+json">${serialized}</script>`;
}

function readView(fileName) {
  return fs.readFileSync(path.join(ROOT_DIR, fileName), "utf8");
}

function readSiteConfig() {
  try {
    const source = fs.readFileSync(path.join(ROOT_DIR, "config.js"), "utf8");
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: "config.js" });
    const config = typeof sandbox.window.SITE_CONFIG === "object"
      ? sandbox.window.SITE_CONFIG
      : {};
    return {
      ...config,
      ...siteConfigOverlay(readSiteSettingsSync(config)),
      googleVerificationCode: clean(config.googleVerificationCode) || GOOGLE_SITE_VERIFICATION_CODE
    };
  } catch (error) {
    console.error("Config read error:", error);
    return {
      ...siteConfigOverlay(readSiteSettingsSync()),
      googleVerificationCode: GOOGLE_SITE_VERIFICATION_CODE
    };
  }
}

function clean(value) {
  return String(value || "").trim();
}

function absoluteUrl(value) {
  const raw = clean(value);
  if (!raw) return `${SITE_URL}/logo.png.webp?v=${BRAND_ASSET_VERSION}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  const pathname = `${raw.startsWith("/") ? "" : "/"}${raw}`;
  const versionedPath = pathname === "/logo.png.webp" || pathname === "/logo.png"
    ? `${pathname}?v=${BRAND_ASSET_VERSION}`
    : pathname;
  return `${SITE_URL}${versionedPath}`;
}

function isSupabasePublicStorageUrl(value) {
  return /^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\//i.test(clean(value));
}

function signedProfileImageUrl(value, options = {}) {
  try {
    const parsed = new URL(clean(value), SITE_URL);
    const siteOrigin = new URL(SITE_URL).origin;
    if (
      parsed.origin !== siteOrigin ||
      !/^\/media\/profile-image\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(parsed.pathname)
    ) {
      return "";
    }

    const width = Math.min(1600, Math.max(96, Math.round(Number(options.width) || Number(parsed.searchParams.get("width")) || 720)));
    const quality = Math.min(85, Math.max(45, Math.round(Number(options.quality) || Number(parsed.searchParams.get("quality")) || 72)));
    const requestedResize = clean(options.resize || parsed.searchParams.get("resize") || "cover").toLowerCase();
    const resize = ["contain", "cover", "fill"].includes(requestedResize) ? requestedResize : "cover";
    parsed.search = "";
    parsed.searchParams.set("width", String(width));
    parsed.searchParams.set("quality", String(quality));
    parsed.searchParams.set("resize", resize);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "";
  }
}

function optimizedImageUrl(value, options = {}) {
  const url = absoluteUrl(value);
  try {
    const parsed = new URL(url);
    if (
      parsed.origin === new URL(SITE_URL).origin &&
      parsed.pathname.startsWith("/media/customer-profile/")
    ) {
      const width = Math.min(1600, Math.max(96, Math.round(Number(options.width) || 720)));
      const quality = Math.min(85, Math.max(45, Math.round(Number(options.quality) || 72)));
      return `${parsed.pathname}?width=${width}&quality=${quality}`;
    }
  } catch {
    // Fall through to the existing optimized-source handling.
  }
  const signedUrl = signedProfileImageUrl(url, options);
  if (signedUrl) return signedUrl;
  if (!isSupabasePublicStorageUrl(url)) return url;
  return buildProfileImageProxyUrl(url, options);
}

function optimizedImageSrcset(value, widths = [320, 480, 640, 720], options = {}) {
  const url = absoluteUrl(value);
  let customerProfileImage = false;
  try {
    const parsed = new URL(url);
    customerProfileImage = (
      parsed.origin === new URL(SITE_URL).origin &&
      parsed.pathname.startsWith("/media/customer-profile/")
    );
  } catch {
    customerProfileImage = false;
  }
  const signedUrl = signedProfileImageUrl(url, options);
  if (!customerProfileImage && !signedUrl && !isSupabasePublicStorageUrl(url)) return "";
  const firstProxyUrl = signedUrl || buildProfileImageProxyUrl(url, options);
  if (!customerProfileImage && !firstProxyUrl.startsWith("/media/profile-image/")) return "";

  return [...new Set((widths || []).map((width) => Number(width)).filter((width) => Number.isFinite(width) && width > 0))]
    .sort((left, right) => left - right)
    .map((width) => `${optimizedImageUrl(url, { ...options, width })} ${Math.round(width)}w`)
    .join(", ");
}

function activeProfiles(profiles) {
  return (profiles || []).filter((profile) => profile?.is_active === true);
}

function sortProfiles(profiles) {
  return [...activeProfiles(profiles)].sort((left, right) => {
    const leftOrder = Number(left.vip_slot ?? left.normal_slot ?? left.priority_order ?? left.display_priority ?? 999);
    const rightOrder = Number(right.vip_slot ?? right.normal_slot ?? right.priority_order ?? right.display_priority ?? 999);

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return clean(left.name).localeCompare(clean(right.name), "tr");
  });
}

function replaceHeadValue(html, pattern, replacement) {
  return pattern.test(html) ? html.replace(pattern, replacement) : html;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertHeadTag(html, pattern, replacement) {
  if (pattern.test(html)) {
    return html.replace(pattern, replacement);
  }

  return html.replace("</head>", `\n${replacement}\n</head>`);
}

function googleAnalyticsMeasurementId() {
  const id = clean(GOOGLE_ANALYTICS_MEASUREMENT_ID).toUpperCase();
  return /^G-[A-Z0-9]+$/.test(id) ? id : "";
}

function buildGoogleAnalyticsTags() {
  const measurementId = googleAnalyticsMeasurementId();
  if (!measurementId) return "";

  return [
    `<script defer src="/public/js/google-analytics.js?v=20260813-live-data1" data-ga-measurement-id="${esc(measurementId)}"></script>`
  ].join("\n");
}

function compactPublicHtml(html) {
  const protectedBlocks = [];
  let output = String(html || "").replace(/<(script|style|pre|textarea)\b[\s\S]*?<\/\1>/gi, (block) => {
    const index = protectedBlocks.push(block) - 1;
    return `@@VIP_GECE_HTML_BLOCK_${index}@@`;
  });

  output = output
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+>/g, ">")
    .trim();

  output = output.replace(/@@VIP_GECE_HTML_BLOCK_(\d+)@@/g, (match, index) => protectedBlocks[Number(index)] || "");
  return output ? `${output}\n` : "";
}

function injectPublicBrandHeadTags(html) {
  if (!String(html || "").includes("</head>")) return String(html || "");

  let output = String(html || "");

  output = upsertHeadTag(
    output,
    /<link\s+rel="icon"[^>]*>/i,
    `<link rel="icon" type="image/png" sizes="32x32" href="/public/assets/favicon-32.png?v=20260810-perf1">`
  );
  output = upsertHeadTag(
    output,
    /<link\s+rel="apple-touch-icon"[^>]*>/i,
    `<link rel="apple-touch-icon" sizes="512x512" href="${SITE_ICON_PATH}">`
  );

  return output;
}

function injectPublicHeadIntegrations(html) {
  const source = injectPublicBrandHeadTags(html);
  const measurementId = googleAnalyticsMeasurementId();
  if (!measurementId || !source.includes("</head>")) return compactPublicHtml(source);
  if (source.includes(`googletagmanager.com/gtag/js?id=${measurementId}`) || source.includes("/public/js/google-analytics.js")) {
    return compactPublicHtml(source);
  }

  return compactPublicHtml(source.replace("</head>", `\n${buildGoogleAnalyticsTags()}\n</head>`));
}

function upsertMetaName(html, name, content) {
  return upsertHeadTag(
    html,
    new RegExp(`<meta\\s+name="${escapeRegex(name)}"\\s+content="[^"]*">`, "i"),
    `<meta name="${esc(name)}" content="${esc(content)}">`
  );
}

function upsertMetaProperty(html, property, content) {
  return upsertHeadTag(
    html,
    new RegExp(`<meta\\s+property="${escapeRegex(property)}"\\s+content="[^"]*">`, "i"),
    `<meta property="${esc(property)}" content="${esc(content)}">`
  );
}

function replaceNodeInnerHtml(html, id, innerHtml) {
  const searchFrom = html.indexOf(`id="${id}"`);
  if (searchFrom < 0) return html;
  const tagStart = html.lastIndexOf("<", searchFrom);
  if (tagStart < 0) return html;
  const openPattern = new RegExp(`^<([a-z0-9]+)[^>]*id="${id}"[^>]*>`, "i");
  const slice = html.slice(tagStart);
  const match = openPattern.exec(slice);
  if (!match) return html;
  const tagName = match[1].toLowerCase();
  const openEnd = tagStart + match[0].length;
  const closeTag = `</${tagName}>`;
  const openTagRe = new RegExp(`^<${tagName}[\\s>/]`, "i");
  let depth = 1;
  let pos = openEnd;
  while (depth > 0 && pos < html.length) {
    const nextOpen = html.indexOf(`<`, pos);
    if (nextOpen < 0) break;
    if (html[nextOpen + 1] === "/") {
      const closeEnd = html.indexOf(">", nextOpen);
      if (closeEnd < 0) break;
      const closeContent = html.slice(nextOpen, closeEnd + 1).toLowerCase();
      if (closeContent === closeTag.toLowerCase()) {
        depth--;
        if (depth === 0) {
          return html.slice(0, openEnd) + innerHtml + html.slice(nextOpen);
        }
      }
      pos = closeEnd + 1;
    } else {
      const tagMatch = html.slice(nextOpen).match(openTagRe);
      if (tagMatch) {
        const tagEnd = html.indexOf(">", nextOpen);
        if (tagEnd < 0) break;
        const selfClose = html[tagEnd - 1] === "/";
        if (!selfClose) depth++;
        pos = tagEnd + 1;
      } else {
        pos = nextOpen + 1;
      }
    }
  }
  return html;
}

function replaceComponentSlot(html, componentName, replacement) {
  const pattern = new RegExp(`<[a-z0-9-]+[^>]*data-component="${escapeRegex(componentName)}"[^>]*>[\\s\\S]*?<\\/[a-z0-9-]+>`, "i");
  return pattern.test(html) ? html.replace(pattern, replacement) : html;
}

function stripScriptBySrc(html, srcPattern) {
  const pattern = new RegExp(`<script\\s+src="${srcPattern}"[^>]*><\\/script>\\s*`, "gi");
  return String(html || "").replace(pattern, "");
}

function stripNonHomeRuntimeScripts(html) {
  let output = String(html || "");
  output = stripScriptBySrc(output, `${escapeRegex("/config.js")}[^"]*`);
  output = stripScriptBySrc(output, `${escapeRegex("/public/js/components-loader.js")}[^"]*`);
  return output;
}

function readPublicShellComponent(name) {
  const fileName = PUBLIC_SHELL_COMPONENTS[name];
  if (!fileName) return "";
  return fs.readFileSync(path.join(ROOT_DIR, fileName), "utf8")
    .replaceAll("/logo.png.webp", `/logo.png.webp?v=${BRAND_ASSET_VERSION}`);
}

function withActiveNav(markup, activeKey) {
  return String(markup || "").replace(/<a\b([^>]*\bdata-nav="([^"]+)"[^>]*)>/gi, (match, attrs, navKey) => {
    let nextAttrs = attrs
      .replace(/\saria-current="page"/gi, "")
      .replace(/\sclass="([^"]*)"/i, (classMatch, classValue) => {
        const normalized = String(classValue || "")
          .split(/\s+/)
          .filter(Boolean)
          .filter((entry) => entry !== "active")
          .join(" ");

        return normalized ? ` class="${normalized}"` : "";
      });

    if (activeKey && navKey === activeKey) {
      if (/\sclass="/i.test(nextAttrs)) {
        nextAttrs = nextAttrs.replace(/\sclass="([^"]*)"/i, (classMatch, classValue) => {
          const merged = [...new Set(String(classValue || "").split(/\s+/).filter(Boolean).concat("active"))].join(" ");
          return ` class="${merged}"`;
        });
      } else {
        nextAttrs += ' class="active"';
      }

      nextAttrs += ' aria-current="page"';
    }

    return `<a${nextAttrs}>`;
  });
}

function injectPublicShell(html, activeNav = "") {
  const output = Object.keys(PUBLIC_SHELL_COMPONENTS).reduce((currentHtml, componentName) => {
    const markup = withActiveNav(readPublicShellComponent(componentName), activeNav);
    return replaceComponentSlot(currentHtml, componentName, markup);
  }, String(html || ""));

  return injectPublicHeadIntegrations(stripNonHomeRuntimeScripts(output));
}

function siteUrlForPath(value) {
  try {
    const parsed = new URL(value);
    return `${SITE_URL}${parsed.pathname === "/" ? "/" : parsed.pathname.replace(/\/+$/, "")}${parsed.search}${parsed.hash}`;
  } catch {
    return value;
  }
}

function normalizeStaticSeoUrls(html) {
  let output = String(html || "");
  const canonicalOrigin = output.match(
    /<link\s+rel="canonical"\s+href="(https?:\/\/[^/"]+)/i
  )?.[1];

  if (canonicalOrigin && canonicalOrigin !== SITE_URL) {
    output = output.replace(new RegExp(escapeRegex(canonicalOrigin), "g"), SITE_URL);
  }

  return output
    .replace(/<link\s+rel="canonical"\s+href="([^"]*)">/i, (match, href) => (
      `<link rel="canonical" href="${esc(siteUrlForPath(href))}">`
    ))
    .replace(/<meta\s+property="og:url"\s+content="([^"]*)">/i, (match, content) => (
      `<meta property="og:url" content="${esc(siteUrlForPath(content))}">`
    ));
}

function renderStaticPublicHtml(fileName, activeNav = "") {
  return injectPublicShell(normalizeStaticSeoUrls(readView(fileName)), activeNav);
}

module.exports = {
  HOME_CATEGORY_LINKS,
  SITE_ICON_PATH,
  SITE_URL,
  absoluteUrl,
  activeProfiles,
  buildGoogleAnalyticsTags,
  clean,
  compactPublicHtml,
  esc,
  injectPublicHeadIntegrations,
  jsonLd,
  injectPublicShell,
  optimizedImageSrcset,
  optimizedImageUrl,
  readSiteConfig,
  renderStaticPublicHtml,
  readView,
  replaceHeadValue,
  replaceNodeInnerHtml,
  safeSlug,
  sortProfiles,
  upsertMetaName,
  upsertMetaProperty
};
