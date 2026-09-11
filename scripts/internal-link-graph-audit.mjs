"use strict";

import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_SITE = "https://vip-gece.site";
const DEFAULT_CONCURRENCY = 12;
const DEFAULT_FETCH_ATTEMPTS = 2;
const args = process.argv.slice(2);

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

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeUrl(value, origin) {
  try {
    const parsed = new URL(decodeEntities(value), origin);
    if (parsed.origin !== origin) return "";
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = parsed.pathname === "/" ? "/" : parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch {
    return "";
  }
}

function sitemapUrls(xml, origin) {
  const seen = new Set();
  const urls = [];
  for (const match of String(xml || "").matchAll(/<loc>([\s\S]*?)<\/loc>/gi)) {
    const url = normalizeUrl(match[1], origin);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function anchorUrls(html, origin, inventory) {
  const links = new Set();
  for (const match of String(html || "").matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])([\s\S]*?)\1[^>]*>/gi)) {
    const url = normalizeUrl(match[2], origin);
    if (url && inventory.has(url)) links.add(url);
  }
  return [...links];
}

async function fetchText(url, attempts = DEFAULT_FETCH_ATTEMPTS) {
  let lastResult = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "VIP-Gece-Internal-Link-Graph-Audit/1.0" },
        signal: AbortSignal.timeout(30000)
      });
      const result = {
        ok: response.ok,
        status: response.status,
        finalUrl: response.url,
        text: await response.text()
      };
      if (result.ok || ![429, 502, 503, 504].includes(result.status) || attempt === attempts) {
        return result;
      }
      lastResult = result;
    } catch (error) {
      lastResult = {
        ok: false,
        status: 0,
        finalUrl: url,
        text: "",
        error: error.message || "fetch failed"
      };
      if (attempt === attempts) return lastResult;
    }
  }
  return lastResult;
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

function reachableFrom(start, graph) {
  const reached = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    for (const next of graph.get(current) || []) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return reached;
}

async function writeJsonAtomic(file, payload) {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(temporary, target);
}

async function main() {
  const strict = args.includes("--strict");
  const jsonOnly = args.includes("--json");
  const site = new URL(argValue("--site", DEFAULT_SITE)).origin;
  const home = `${site}/`;
  const concurrency = boundedInteger(argValue("--concurrency", DEFAULT_CONCURRENCY), DEFAULT_CONCURRENCY, 1, 24);
  const expectedCountRaw = argValue("--expected-count", "");
  const expectedCount = expectedCountRaw === "" ? null : boundedInteger(expectedCountRaw, -1, 0, 100000);
  const outputPath = argValue("--output", "");
  const sitemapResult = await fetchText(`${site}/sitemap.xml`);
  if (!sitemapResult.ok) throw new Error(`sitemap returned HTTP ${sitemapResult.status}`);
  const urls = sitemapUrls(sitemapResult.text, site);
  if (!urls.length) throw new Error("sitemap has no same-origin URLs");
  const inventory = new Set(urls);
  const pages = await mapLimit(urls, concurrency, async (url) => {
    const result = await fetchText(url);
    return {
      url,
      status: result.status,
      ok: result.ok && normalizeUrl(result.finalUrl, site) === url,
      error: result.error || "",
      links: result.ok ? anchorUrls(result.text, site, inventory) : []
    };
  });

  const graph = new Map(pages.map((page) => [page.url, page.links]));
  const reverse = new Map(urls.map((url) => [url, []]));
  const inbound = new Map(urls.map((url) => [url, 0]));
  for (const [source, targets] of graph) {
    for (const target of targets) {
      reverse.get(target).push(source);
      inbound.set(target, (inbound.get(target) || 0) + 1);
    }
  }

  const fromHome = reachableFrom(home, graph);
  const toHome = reachableFrom(home, reverse);
  const failed = pages.filter((page) => !page.ok).map((page) => ({ url: page.url, status: page.status, error: page.error }));
  const missingDirectHome = pages.filter((page) => !page.links.includes(home)).map((page) => page.url);
  const orphanNoInbound = urls.filter((url) => url !== home && (inbound.get(url) || 0) === 0);
  const unreachableFromHome = urls.filter((url) => !fromHome.has(url));
  const cannotReachHome = urls.filter((url) => !toHome.has(url));
  const degrees = pages.map((page) => page.links.length);
  const countMatches = expectedCount === null || urls.length === expectedCount;
  const ok = countMatches && failed.length === 0 && missingDirectHome.length === 0 &&
    orphanNoInbound.length === 0 && unreachableFromHome.length === 0 && cannotReachHome.length === 0;
  const report = {
    ok,
    checked_at: new Date().toISOString(),
    site,
    sitemap_url_count: urls.length,
    expected_url_count: expectedCount,
    count_matches: countMatches,
    failed,
    missing_direct_home: missingDirectHome,
    orphan_no_inbound: orphanNoInbound,
    unreachable_from_home: unreachableFromHome,
    cannot_reach_home: cannotReachHome,
    outdegree: {
      min: Math.min(...degrees),
      max: Math.max(...degrees),
      average: Number((degrees.reduce((sum, value) => sum + value, 0) / degrees.length).toFixed(2))
    }
  };

  if (outputPath) await writeJsonAtomic(outputPath, report);
  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`ok=${report.ok}`);
    console.log(`sitemap_urls=${report.sitemap_url_count}`);
    console.log(`failed=${report.failed.length}`);
    console.log(`missing_direct_home=${report.missing_direct_home.length}`);
    console.log(`orphan_no_inbound=${report.orphan_no_inbound.length}`);
    console.log(`unreachable_from_home=${report.unreachable_from_home.length}`);
    console.log(`cannot_reach_home=${report.cannot_reach_home.length}`);
    console.log(`outdegree=${report.outdegree.min}/${report.outdegree.average}/${report.outdegree.max}`);
  }
  if (strict && !ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
