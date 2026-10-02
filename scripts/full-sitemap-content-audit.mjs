#!/usr/bin/env node

"use strict";

const DEFAULT_SITE_URL = "https://vip-gece.site";
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_FETCH_ATTEMPTS = 2;
const DEFAULT_MIN_WORDS = 250;
const DEFAULT_MIN_TEXT_RATIO = 4;
const DEFAULT_IMAGE_CONCURRENCY = 8;

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const jsonOnly = args.includes("--json");
const skipImages = args.includes("--skip-images");

function argValue(name, fallback = "") {
  const direct = args.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).trim();
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : fallback;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeSiteUrl(raw) {
  const value = String(raw || DEFAULT_SITE_URL).trim().replace(/\/+$/, "");
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("site url must use http or https");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeComparableUrl(value) {
  try {
    const parsed = new URL(decodeEntities(value));
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = parsed.pathname === "/" ? "/" : parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch {
    return String(value || "").trim();
  }
}

function absoluteUrl(siteUrl, value, pageUrl = siteUrl) {
  const raw = decodeEntities(String(value || "").trim());
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return "";
  try {
    return new URL(raw, pageUrl).href;
  } catch {
    return "";
  }
}

function stripVisibleText(html) {
  return decodeEntities(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(text) {
  return (String(text || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || []).length;
}

function attributeValue(tag, name) {
  const match = String(tag || "").match(new RegExp(`${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? String(match[2] || "").trim() : "";
}

function htmlImageRows(html, pageUrl, siteOrigin) {
  const rows = [];
  const tags = String(html || "").match(/<img\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const src = absoluteUrl(siteOrigin, attributeValue(tag, "src"), pageUrl);
    const alt = decodeEntities(attributeValue(tag, "alt")).trim();
    if (!src) continue;
    rows.push({
      page_url: pageUrl,
      image_url: src,
      missing_alt: !alt,
      source: "img"
    });
  }

  for (const match of String(html || "").matchAll(/\bsrcset\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    const rawSrcset = String(match[2] || "").trim();
    if (/^data:/i.test(rawSrcset)) continue;

    for (const candidate of rawSrcset.split(",")) {
      const value = candidate.trim().split(/\s+/)[0];
      const src = absoluteUrl(siteOrigin, value, pageUrl);
      if (!src) continue;
      rows.push({
        page_url: pageUrl,
        image_url: src,
        missing_alt: false,
        source: "srcset"
      });
    }
  }

  for (const match of String(html || "").matchAll(/<meta\b[^>]*\b(?:property|name)\s*=\s*(["'])(?:og:image|twitter:image)\1[^>]*>/gi)) {
    const src = absoluteUrl(siteOrigin, attributeValue(match[0], "content"), pageUrl);
    if (!src) continue;
    rows.push({
      page_url: pageUrl,
      image_url: src,
      missing_alt: false,
      source: "meta"
    });
  }

  return rows;
}

function logicalImageKey(value) {
  try {
    const parsed = new URL(value);
    if (
      parsed.pathname.startsWith("/media/profile-image/") ||
      parsed.pathname.startsWith("/media/customer-profile/")
    ) {
      return `${parsed.origin}${parsed.pathname}`;
    }
    if (parsed.hostname.endsWith(".supabase.co") && parsed.pathname.includes("/storage/v1/")) {
      return `${parsed.origin}${parsed.pathname.replace("/render/image/", "/object/")}`;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return String(value || "").trim();
  }
}

function parseSitemap(xml, siteUrl) {
  const urls = [];
  const seen = new Set();
  for (const match of String(xml || "").matchAll(/<loc>([\s\S]*?)<\/loc>/gi)) {
    const url = absoluteUrl(siteUrl, match[1], `${siteUrl}/sitemap.xml`);
    const comparable = normalizeComparableUrl(url);
    if (!url || seen.has(comparable)) continue;
    seen.add(comparable);
    urls.push(url);
  }
  return urls;
}

async function fetchText(url, timeoutMs, attempts = DEFAULT_FETCH_ATTEMPTS) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8",
          "User-Agent": "VIP-Gece-Full-Sitemap-Content-Audit/2026-10-02"
        }
      });
      const text = await response.text();
      const result = {
        ok: response.ok,
        status: response.status,
        final_url: response.url,
        content_type: response.headers.get("content-type") || "",
        bytes: Buffer.byteLength(text),
        text
      };
      if (result.ok || ![429, 502, 503, 504].includes(result.status) || attempt === attempts) {
        return result;
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
  }
  throw lastError || new Error("fetch failed");
}

async function fetchImage(url, timeoutMs, attempts = DEFAULT_FETCH_ATTEMPTS) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
          "User-Agent": "VIP-Gece-Full-Sitemap-Content-Audit/2026-10-02"
        }
      });
      const body = Buffer.from(await response.arrayBuffer());
      const result = {
        ok: response.ok,
        status: response.status,
        content_type: response.headers.get("content-type") || "",
        bytes: body.length
      };
      if (result.ok || ![429, 502, 503, 504].includes(result.status) || attempt === attempts) {
        return result;
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        return {
          ok: false,
          status: 0,
          content_type: "",
          bytes: 0,
          error: error.message || "fetch failed"
        };
      }
    }
  }
  return {
    ok: false,
    status: 0,
    content_type: "",
    bytes: 0,
    error: lastError?.message || "fetch failed"
  };
}

async function mapLimit(items, limit, iteratee) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await iteratee(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return output;
}

function auditPage(url, result, options) {
  const findings = [];
  const visibleText = stripVisibleText(result.text);
  const words = wordCount(visibleText);
  const textBytes = Buffer.byteLength(visibleText);
  const textRatio = Number(((textBytes / Math.max(1, result.bytes)) * 100).toFixed(2));
  const missingAltCount = htmlImageRows(result.text, result.final_url || url, options.siteOrigin)
    .filter((row) => row.source === "img" && row.missing_alt)
    .length;

  if (!result.ok) findings.push(`HTTP ${result.status}`);
  if (!/^text\/html\b/i.test(result.content_type)) findings.push(`content-type ${result.content_type || "missing"}`);
  if (normalizeComparableUrl(result.final_url) !== normalizeComparableUrl(url)) {
    findings.push(`redirects to ${result.final_url}`);
  }
  if (words < options.minWords) findings.push(`low visible word count ${words}`);
  if (textRatio < options.minTextRatio) findings.push(`low visible text/html ratio ${textRatio}%`);
  if (/vip gece geçici olarak hazırlanıyor|hazırlanıyor|hazirlaniyor|undefined|null|\[object object\]/i.test(visibleText)) {
    findings.push("placeholder or leaked token text");
  }
  if (/<img\b/i.test(result.text) && missingAltCount > 0) {
    findings.push(`image alt missing ${missingAltCount}`);
  }
  if (/<title[^>]*>\s*<\/title>/i.test(result.text)) findings.push("empty title tag");
  if (/<meta\b[^>]*name=["']description["'][^>]*content=["']\s*["'][^>]*>/i.test(result.text)) {
    findings.push("empty meta description");
  }

  return {
    url,
    ok: findings.length === 0,
    status: result.status,
    words,
    text_html_ratio_percent: textRatio,
    html_bytes: result.bytes,
    image_missing_alt_count: missingAltCount,
    findings
  };
}

async function main() {
  const siteUrl = normalizeSiteUrl(argValue("--site", process.env.LIVE_SITE_URL || DEFAULT_SITE_URL));
  const sitemapPath = argValue("--sitemap", "/sitemap.xml");
  const sitemapUrl = `${siteUrl}${sitemapPath.startsWith("/") ? "" : "/"}${sitemapPath}`;
  const concurrency = boundedInteger(argValue("--concurrency", DEFAULT_CONCURRENCY), DEFAULT_CONCURRENCY, 1, 32);
  const imageConcurrency = boundedInteger(argValue("--image-concurrency", DEFAULT_IMAGE_CONCURRENCY), DEFAULT_IMAGE_CONCURRENCY, 1, 24);
  const timeoutMs = boundedInteger(argValue("--timeout-ms", "30000"), 30000, 5000, 120000);
  const minWords = boundedInteger(argValue("--min-words", String(DEFAULT_MIN_WORDS)), DEFAULT_MIN_WORDS, 1, 3000);
  const minTextRatio = boundedNumber(argValue("--min-text-ratio", String(DEFAULT_MIN_TEXT_RATIO)), DEFAULT_MIN_TEXT_RATIO, 0.1, 80);
  const siteOrigin = new URL(siteUrl).origin;

  const sitemap = await fetchText(sitemapUrl, timeoutMs);
  const urls = parseSitemap(sitemap.text, siteUrl);
  if (!urls.length) throw new Error("sitemap has no URLs");

  const imageCandidates = [];
  const pages = await mapLimit(urls, concurrency, async (url) => {
    try {
      const result = await fetchText(url, timeoutMs);
      imageCandidates.push(...htmlImageRows(result.text, result.final_url || url, siteOrigin));
      return auditPage(url, result, { minWords, minTextRatio, siteOrigin });
    } catch (error) {
      return {
        url,
        ok: false,
        status: 0,
        words: 0,
        text_html_ratio_percent: 0,
        html_bytes: 0,
        image_missing_alt_count: 0,
        findings: [error.message || "fetch failed"]
      };
    }
  });

  const uniqueImages = skipImages
    ? []
    : [...new Map(imageCandidates.map((row) => [logicalImageKey(row.image_url), row])).values()];
  const images = skipImages
    ? []
    : await mapLimit(uniqueImages, imageConcurrency, async (row) => {
      const result = await fetchImage(row.image_url, timeoutMs);
      const isImage = /^image\//i.test(result.content_type);
      return {
        ...row,
        ok: result.ok && isImage && result.bytes > 0,
        status: result.status,
        content_type: result.content_type,
        bytes: result.bytes,
        error: result.error || (!isImage && result.ok ? "response is not an image" : "")
      };
    });

  const failingPages = pages.filter((page) => !page.ok);
  const brokenImages = images.filter((image) => !image.ok);
  const missingAltPages = pages.filter((page) => page.image_missing_alt_count > 0);
  const report = {
    ok: sitemap.ok && failingPages.length === 0 && brokenImages.length === 0,
    site_url: siteUrl,
    checked_at: new Date().toISOString(),
    sitemap: {
      ok: sitemap.ok,
      status: sitemap.status,
      url_count: urls.length
    },
    thresholds: {
      min_words: minWords,
      min_text_html_ratio_percent: minTextRatio
    },
    page_count: pages.length,
    failing_page_count: failingPages.length,
    broken_image_count: brokenImages.length,
    unique_image_count: images.length,
    missing_alt_page_count: missingAltPages.length,
    lowest_words: [...pages].sort((a, b) => a.words - b.words).slice(0, 20),
    lowest_text_ratio: [...pages].sort((a, b) => a.text_html_ratio_percent - b.text_html_ratio_percent).slice(0, 20),
    failing_pages: failingPages.slice(0, 100),
    broken_images: brokenImages.slice(0, 100)
  };

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`site=${report.site_url}`);
    console.log(`ok=${report.ok}`);
    console.log(`sitemap_status=${report.sitemap.status}`);
    console.log(`sitemap_urls=${report.sitemap.url_count}`);
    console.log(`pages=${report.page_count}`);
    console.log(`failing_pages=${report.failing_page_count}`);
    console.log(`unique_images=${report.unique_image_count}`);
    console.log(`broken_images=${report.broken_image_count}`);
    console.log(`missing_alt_pages=${report.missing_alt_page_count}`);
    for (const page of failingPages.slice(0, 40)) {
      console.log(`warn ${page.url} findings=${page.findings.join("; ")}`);
    }
    for (const image of brokenImages.slice(0, 40)) {
      console.log(`broken ${image.image_url} status=${image.status} source=${image.source} page=${image.page_url}`);
    }
  }

  if (strict && !report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
