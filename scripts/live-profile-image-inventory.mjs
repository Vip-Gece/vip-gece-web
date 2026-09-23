#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const runtimeRoot = args.find((arg) => arg.startsWith("--runtime-root="))?.slice("--runtime-root=".length);
const require = createRequire(runtimeRoot ? resolve(runtimeRoot, "package.json") : new URL("../package.json", import.meta.url));
const sharp = require("sharp");
const outputArg = args.find((arg) => arg.startsWith("--output="));
const expectedArg = args.find((arg) => arg.startsWith("--expected-profiles="));
const expectedProfiles = expectedArg ? Number(expectedArg.slice("--expected-profiles=".length)) : null;
if (expectedArg && (!Number.isInteger(expectedProfiles) || expectedProfiles < 1)) {
  throw new Error("--expected-profiles must be a positive integer");
}
const summaryOnly = args.includes("--summary");
const baseUrl = new URL(args.find((arg) => !arg.startsWith("--")) || "https://vip-gece.site");
const requestTimeoutMs = 20_000;
const concurrency = 2;
const requestIntervalMs = 350;
let nextRequestAt = 0;

function clean(value) {
  return String(value || "").trim();
}

function absoluteUrl(value) {
  try {
    return new URL(clean(value), baseUrl).href;
  } catch {
    return "";
  }
}

function imageKind(value) {
  const image = clean(value);
  const url = absoluteUrl(image);
  if (url && /^\/(?:logo|favicon)\.(?:png|ico)(?:\.webp)?$/i.test(new URL(url).pathname)) return "fallback";
  if (image.startsWith("/media/customer-profile/")) return "customer_profile";
  if (image.startsWith("/media/customer-upload/")) return "customer_upload";
  if (/^https?:/i.test(image)) return "remote";
  return image.startsWith("/") ? "local" : "invalid";
}

async function waitForSlot() {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextRequestAt);
  nextRequestAt = scheduledAt + requestIntervalMs;
  if (scheduledAt > now) {
    await new Promise((resolve) => setTimeout(resolve, scheduledAt - now));
  }
}

async function requestOnce(url, accept) {
  await waitForSlot();
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        Accept: accept,
        "User-Agent": "VIP-Gece-Profile-Image-Inventory/1.0"
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
      error: clean(error?.cause?.code || error?.code || error?.message || error),
      body: Buffer.alloc(0)
    };
  }
}

async function request(url, accept) {
  const first = await requestOnce(url, accept);
  if (first.status !== 0 && first.status < 500) return { ...first, attempts: 1 };
  const retry = await requestOnce(url, accept);
  return { ...retry, attempts: 2, initial_status: first.status, initial_error: first.error || "" };
}

async function mapConcurrent(items, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

const apiUrl = new URL("/api/v1/public/profiles", baseUrl).href;
const apiResponse = await request(apiUrl, "application/json");
if (!apiResponse.ok) {
  throw new Error(`Profile API failed with HTTP ${apiResponse.status}`);
}

const payload = JSON.parse(apiResponse.body.toString("utf8"));
const profiles = Array.isArray(payload?.profiles) ? payload.profiles : [];
const uniqueImageUrls = [
  ...new Set(
    profiles.flatMap((profile) =>
      (Array.isArray(profile.images) ? profile.images : []).map(absoluteUrl).filter(Boolean)
    )
  )
];

const imageChecks = await mapConcurrent(uniqueImageUrls, async (url) => {
  const response = await request(url, "image/avif,image/webp,image/*,*/*;q=0.8");
  const isImage = response.content_type.toLowerCase().startsWith("image/");
  let metadata = null;
  let decodeError = "";
  if (response.ok && isImage && response.bytes > 0) {
    try {
      metadata = await sharp(response.body, { limitInputPixels: 40_000_000 }).metadata();
      await sharp(response.body, { limitInputPixels: 40_000_000 }).stats();
    } catch {
      decodeError = "image body could not be decoded";
    }
  }
  return {
    url,
    ok: response.ok && isImage && response.bytes > 0 && Boolean(metadata?.width && metadata?.height) && !decodeError,
    status: response.status,
    content_type: response.content_type,
    bytes: response.bytes,
    width: metadata?.width || 0,
    height: metadata?.height || 0,
    attempts: response.attempts,
    elapsed_ms: response.elapsed_ms,
    error: response.error || decodeError || (!isImage && response.ok ? "response is not an image" : "")
  };
});
const imageCheckByUrl = new Map(imageChecks.map((row) => [row.url, row]));

const pageChecks = await mapConcurrent(profiles, async (profile) => {
  const url = new URL(`/profil/${encodeURIComponent(clean(profile.slug))}`, baseUrl).href;
  const response = await request(url, "text/html");
  const html = response.body.toString("utf8");
  return {
    slug: clean(profile.slug),
    url,
    ok: response.ok && response.content_type.toLowerCase().startsWith("text/html"),
    status: response.status,
    content_type: response.content_type,
    bytes: response.bytes,
    legacy_host_refs: (html.match(/hofblpqaxzhybozavtaz\.supabase\.co/gi) || []).length,
    error: response.error || ""
  };
});
const pageCheckBySlug = new Map(pageChecks.map((row) => [row.slug, row]));

const profileRows = profiles.map((profile) => {
  const images = Array.isArray(profile.images) ? profile.images : [];
  const checks = images.map((image) => imageCheckByUrl.get(absoluteUrl(image))).filter(Boolean);
  const kinds = images.map(imageKind);
  const page = pageCheckBySlug.get(clean(profile.slug));
  return {
    slug: clean(profile.slug),
    name: clean(profile.name),
    registered_live_images: images.length,
    real_images: kinds.filter((kind) => kind !== "fallback").length,
    verified_real_images: images.filter((image) => imageKind(image) !== "fallback" && imageCheckByUrl.get(absoluteUrl(image))?.ok).length,
    fallback_images: kinds.filter((kind) => kind === "fallback").length,
    customer_profile_images: kinds.filter((kind) => kind === "customer_profile").length,
    customer_upload_images: kinds.filter((kind) => kind === "customer_upload").length,
    working_images: checks.filter((check) => check.ok).length,
    broken_images: checks.filter((check) => !check.ok).length,
    detail_page_status: page?.status || 0,
    detail_page_ok: page?.ok === true,
    legacy_host_refs: page?.legacy_host_refs || 0
  };
});

const totals = profileRows.reduce(
  (result, row) => {
    for (const key of [
      "registered_live_images",
      "real_images",
      "verified_real_images",
      "fallback_images",
      "customer_profile_images",
      "customer_upload_images",
      "working_images",
      "broken_images",
      "legacy_host_refs"
    ]) {
      result[key] += row[key];
    }
    return result;
  },
  {
    profile_count: profileRows.length,
    registered_live_images: 0,
    real_images: 0,
    verified_real_images: 0,
    fallback_images: 0,
    customer_profile_images: 0,
    customer_upload_images: 0,
    working_images: 0,
    broken_images: 0,
    legacy_host_refs: 0,
    unique_image_requests: imageChecks.length,
    unique_broken_image_requests: imageChecks.filter((row) => !row.ok).length,
    image_transport_failures: imageChecks.filter((row) => row.status === 0).length,
    retried_image_requests: imageChecks.filter((row) => row.attempts > 1).length,
    profiles_without_verified_real_images: profileRows.filter((row) => row.verified_real_images === 0).length,
    detail_pages_ok: pageChecks.filter((row) => row.ok).length,
    detail_pages_broken: pageChecks.filter((row) => !row.ok).length
  }
);

const report = {
      checked_at: new Date().toISOString(),
      base_url: baseUrl.href,
      expected_profiles: expectedProfiles,
      ok:
        (expectedProfiles === null ? profiles.length > 0 : profiles.length === expectedProfiles) &&
        totals.broken_images === 0 &&
        totals.fallback_images === 0 &&
        totals.profiles_without_verified_real_images === 0 &&
        totals.detail_pages_broken === 0 &&
        totals.legacy_host_refs === 0,
      totals,
      profiles: profileRows,
      broken_image_requests: imageChecks.filter((row) => !row.ok),
      broken_detail_pages: pageChecks.filter((row) => !row.ok)
};
if (outputArg) {
  await writeFile(outputArg.slice("--output=".length), JSON.stringify(report, null, 2) + "\n", "utf8");
}
console.log(JSON.stringify(summaryOnly ? {
  checked_at: report.checked_at,
  ok: report.ok,
  totals,
  incomplete_profiles: profileRows.filter((row) => row.verified_real_images === 0 || row.broken_images > 0)
    .map(({ slug, name, verified_real_images, fallback_images, broken_images }) => ({ slug, name, verified_real_images, fallback_images, broken_images })),
  broken_image_requests: report.broken_image_requests
} : report, null, 2));
process.exitCode = report.ok ? 0 : 1;
