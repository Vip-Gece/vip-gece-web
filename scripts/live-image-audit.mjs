#!/usr/bin/env node

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const baseUrl = new URL(
  args.find((arg) => !arg.startsWith("--")) ||
  process.env.VIP_GECE_LIVE_URL ||
  "https://vip-gece.site"
);
const requestTimeoutMs = 20_000;
const concurrency = 2;
const imageRequestIntervalMs = 450;
const pagePaths = ["/", "/istanbul-escort", "/ilanlar"];
let nextImageRequestAt = 0;

function clean(value) {
  return String(value || "").trim();
}

function decodeHtmlAttribute(value) {
  return clean(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function imageValue(candidate) {
  return clean(candidate && typeof candidate === "object" ? candidate.url : candidate);
}

function absoluteUrl(value, pageUrl = baseUrl) {
  const raw = decodeHtmlAttribute(imageValue(value));
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return "";
  try {
    return new URL(raw, pageUrl).href;
  } catch {
    return "";
  }
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
    if (
      parsed.hostname.endsWith(".supabase.co") &&
      parsed.pathname.includes("/storage/v1/")
    ) {
      return `${parsed.origin}${parsed.pathname.replace("/render/image/", "/object/")}`;
    }
    return parsed.href;
  } catch {
    return clean(value);
  }
}

async function waitForImageRequestSlot() {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextImageRequestAt);
  nextImageRequestAt = scheduledAt + imageRequestIntervalMs;
  const waitMs = scheduledAt - now;
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
}

async function fetchResponse(url, accept) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        Accept: accept,
        "User-Agent": "VIP-Gece-Live-Image-Audit/1.0"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
    const body = Buffer.from(await response.arrayBuffer());
    return {
      ok: response.ok,
      status: response.status,
      content_type: clean(response.headers.get("content-type")),
      bytes: body.length,
      elapsed_ms: Date.now() - startedAt,
      body
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      content_type: "",
      bytes: 0,
      elapsed_ms: Date.now() - startedAt,
      error: clean(error?.message || error),
      body: Buffer.alloc(0)
    };
  }
}

function collectHtmlImageUrls(html, pageUrl) {
  const urls = new Set();
  const attributePattern = /\b(?:src|content)=["']([^"']+)["']/gi;
  const srcsetPattern = /\bsrcset=["']([^"']+)["']/gi;

  for (const match of html.matchAll(attributePattern)) {
    const value = clean(match[1]);
    if (value.length > 2_000) continue;
    if (!/\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#]|$)|\/media\//i.test(value)) continue;
    const url = absoluteUrl(value, pageUrl);
    if (url) urls.add(url);
  }

  for (const match of html.matchAll(srcsetPattern)) {
    for (const candidate of match[1].split(",")) {
      const value = clean(candidate).split(/\s+/)[0];
      if (value.length > 2_000) continue;
      const url = absoluteUrl(value, pageUrl);
      if (url) urls.add(url);
    }
  }

  return [...urls];
}

function collectProfileImageUrls(profiles) {
  const rows = [];
  const seen = new Set();

  for (const profile of profiles) {
    const candidates = [
      ...(Array.isArray(profile?.images) ? profile.images : []),
      clean(profile?.cover_preview_url),
      ...(Array.isArray(profile?.image_preview_urls) ? profile.image_preview_urls : [])
    ];

    for (const candidate of candidates) {
      const url = absoluteUrl(candidate);
      const key = logicalImageKey(url);
      if (!url || seen.has(key)) continue;
      seen.add(key);
      rows.push({
        url,
        source: "profile_api",
        profile_id: clean(profile?.id),
        profile_slug: clean(profile?.slug)
      });
    }
  }

  return rows;
}

async function mapConcurrent(items, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

const pageResults = [];
const imageCandidates = [];

for (const pagePath of pagePaths) {
  const pageUrl = new URL(pagePath, baseUrl).href;
  const response = await fetchResponse(pageUrl, "text/html");
  pageResults.push({
    url: pageUrl,
    ok: response.ok,
    status: response.status,
    content_type: response.content_type,
    bytes: response.bytes,
    elapsed_ms: response.elapsed_ms,
    error: response.error || ""
  });

  if (response.ok && response.content_type.toLowerCase().startsWith("text/html")) {
    for (const url of collectHtmlImageUrls(response.body.toString("utf8"), pageUrl)) {
      imageCandidates.push({ url, source: `html:${pagePath}` });
    }
  }
}

const apiUrl = new URL("/api/v1/public/profiles", baseUrl).href;
const apiResponse = await fetchResponse(apiUrl, "application/json");
let profiles = [];
let apiParseError = "";

if (apiResponse.ok) {
  try {
    const payload = JSON.parse(apiResponse.body.toString("utf8"));
    profiles = Array.isArray(payload?.profiles) ? payload.profiles : [];
  } catch (error) {
    apiParseError = clean(error?.message || error);
  }
}

imageCandidates.push(...collectProfileImageUrls(profiles));

const uniqueCandidates = [
  ...new Map(imageCandidates.map((row) => [logicalImageKey(row.url), row])).values()
];
const images = await mapConcurrent(uniqueCandidates, async (candidate) => {
  await waitForImageRequestSlot();
  const response = await fetchResponse(candidate.url, "image/avif,image/webp,image/*,*/*;q=0.8");
  const isImage = response.content_type.toLowerCase().startsWith("image/");
  return {
    ...candidate,
    ok: response.ok && isImage && response.bytes > 0,
    status: response.status,
    content_type: response.content_type,
    bytes: response.bytes,
    elapsed_ms: response.elapsed_ms,
    error: response.error || (!isImage && response.ok ? "response is not an image" : "")
  };
});

const brokenImages = images.filter((image) => !image.ok);
const statusCounts = Object.fromEntries(
  [...new Set(images.map((image) => String(image.status)))].sort().map((status) => [
    status,
    images.filter((image) => String(image.status) === status).length
  ])
);
const report = {
  ok: pageResults.every((page) => page.ok) && apiResponse.ok && !apiParseError && brokenImages.length === 0,
  base_url: baseUrl.href,
  pages: pageResults,
  profile_api: {
    url: apiUrl,
    ok: apiResponse.ok && !apiParseError,
    status: apiResponse.status,
    content_type: apiResponse.content_type,
    bytes: apiResponse.bytes,
    profile_count: profiles.length,
    parse_error: apiParseError
  },
  image_count: images.length,
  broken_image_count: brokenImages.length,
  image_status_counts: statusCounts,
  broken_images: brokenImages,
  ...(verbose ? { images } : {})
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
