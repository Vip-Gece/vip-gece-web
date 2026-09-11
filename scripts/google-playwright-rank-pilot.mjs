"use strict";

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const DEFAULT_SITE_HOST = "vip-gece.site";
const DEFAULT_OUT_DIR = "output/external-audits";
const DEFAULT_QUERIES = [
  "istanbul escort",
  "şişli escort",
  "beşiktaş escort",
  "beyoğlu escort",
  "bakırköy escort",
  "avcılar escort",
  "esenyurt escort"
];

const args = process.argv.slice(2);

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const direct = args.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length).trim();
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : fallback;
}

function splitList(value, fallback = []) {
  const list = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? [...new Set(list)] : fallback;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function cleanHost(value) {
  return String(value || DEFAULT_SITE_HOST).trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
}

function normalizeUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return String(value || "");
  }
}

function resultHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function isTargetUrl(value, siteHost) {
  const host = resultHost(value);
  return host === siteHost || host.endsWith(`.${siteHost}`);
}

function resultPage(rank) {
  return rank ? Math.floor((rank - 1) / 10) + 1 : "";
}

function pagePosition(rank) {
  return rank ? ((rank - 1) % 10) + 1 : "";
}

async function acceptConsent(page) {
  const candidates = [
    "button:has-text('Tümünü kabul et')",
    "button:has-text('Kabul ediyorum')",
    "button:has-text('Accept all')",
    "button:has-text('I agree')",
    "text=Tümünü kabul et",
    "text=Kabul ediyorum"
  ];
  for (const selector of candidates) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 1500 })) {
        await locator.click({ timeout: 3000 });
        await page.waitForTimeout(1000);
        return true;
      }
    } catch {
      // Try the next consent selector.
    }
  }
  return false;
}

async function extractOrganic(page) {
  return page.evaluate(() => {
    function normalize(value) {
      try {
        const url = new URL(value);
        url.hash = "";
        return url.toString();
      } catch {
        return String(value || "");
      }
    }

    function cleanText(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }

    function isGoogleUrl(value) {
      try {
        const host = new URL(value).hostname;
        return /(^|\.)google\./i.test(host) || /(^|\.)gstatic\.com$/i.test(host);
      } catch {
        return true;
      }
    }

    const items = [];
    const seen = new Set();
    const blocks = Array.from(document.querySelectorAll("div.g, div.MjjYud, div[data-sokoban-container], [data-header-feature]"));

    for (const block of blocks) {
      const link = Array.from(block.querySelectorAll("a[href]"))
        .map((anchor) => anchor.href)
        .find((href) => /^https?:\/\//i.test(href) && !isGoogleUrl(href));
      if (!link) continue;
      const normalized = normalize(link);
      if (seen.has(normalized)) continue;

      const h3 = block.querySelector("h3");
      const title = cleanText(h3 ? h3.textContent : block.textContent).slice(0, 240);
      if (!title) continue;

      seen.add(normalized);
      items.push({
        rank: items.length + 1,
        title,
        link: normalized
      });
      if (items.length >= 100) break;
    }

    if (items.length) return items;

    for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
      const href = anchor.href;
      if (!/^https?:\/\//i.test(href) || isGoogleUrl(href)) continue;
      const normalized = normalize(href);
      if (seen.has(normalized)) continue;
      const title = cleanText(anchor.textContent).slice(0, 240);
      if (!title) continue;
      seen.add(normalized);
      items.push({ rank: items.length + 1, title, link: normalized });
      if (items.length >= 100) break;
    }

    return items;
  });
}

async function main() {
  const { chromium } = require("playwright");
  const siteHost = cleanHost(argValue("--site-host", DEFAULT_SITE_HOST));
  const queries = splitList(argValue("--queries", ""), DEFAULT_QUERIES);
  const outDir = argValue("--out-dir", DEFAULT_OUT_DIR);
  const outName = argValue("--out", `google-playwright-rank-pilot-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`);
  const outBase = path.join(outDir, outName.replace(/\.(json|csv)$/i, ""));
  const headless = argValue("--headless", "true") !== "false";
  const dohUrl = argValue("--doh-url", "https://cloudflare-dns.com/dns-query");
  const rows = [];

  await mkdir(outDir, { recursive: true });

  const chromeExecutable = argValue(
    "--chrome-executable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  );
  const browser = await chromium.launch({
    headless,
    executablePath: chromeExecutable,
    args: dohUrl ? [
      "--dns-over-https-mode=secure",
      `--dns-over-https-servers=${dohUrl}`
    ] : []
  });
  const context = await browser.newContext({
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    geolocation: { latitude: 41.0082, longitude: 28.9784 },
    permissions: ["geolocation"],
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
  });
  const page = await context.newPage();

  try {
    for (const query of queries) {
      const url = new URL("https://www.google.com/search");
      url.searchParams.set("q", query);
      url.searchParams.set("num", argValue("--depth", "100"));
      url.searchParams.set("hl", argValue("--hl", "tr"));
      url.searchParams.set("gl", argValue("--gl", "tr"));
      url.searchParams.set("pws", "0");
      url.searchParams.set("safe", "off");

      try {
        await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 45000 });
        await acceptConsent(page);
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1500);

        const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
        const blocked = /unusual traffic|captcha|olağan dışı trafik|robot olmadığınızı/i.test(bodyText);
        const organic = blocked ? [] : await extractOrganic(page);
        const match = organic.find((item) => isTargetUrl(item.link, siteHost));

        rows.push({
          checked_at: new Date().toISOString(),
          provider: "google-playwright",
          query,
          status: blocked ? "blocked" : (match ? "found" : "not_found"),
          rank: match?.rank || "",
          serp_page: resultPage(match?.rank),
          page_position: pagePosition(match?.rank),
          matched_url: match?.link || "",
          matched_title: match?.title || "",
          organic_count: organic.length,
          error: ""
        });
        console.log(`${query} | ${match ? `FOUND #${match.rank}` : blocked ? "blocked" : "not_found"} | organic=${organic.length}`);
      } catch (error) {
        rows.push({
          checked_at: new Date().toISOString(),
          provider: "google-playwright",
          query,
          status: "error",
          rank: "",
          serp_page: "",
          page_position: "",
          matched_url: "",
          matched_title: "",
          organic_count: "",
          error: error.message || String(error)
        });
        console.log(`${query} | ERROR ${error.message || error}`);
      }
    }
  } finally {
    await browser.close();
  }

  const payload = {
    meta: {
      checked_at: new Date().toISOString(),
      provider: "google-playwright",
      site_host: siteHost,
      query_count: queries.length,
      doh_url: dohUrl,
      note: "Headless Google render pilotudur. Resmi haftalik takip icin Serper, SerpApi veya DataForSEO kullanilmalidir."
    },
    rows
  };
  const jsonPath = `${outBase}.json`;
  const csvPath = `${outBase}.csv`;
  const header = [
    "checked_at",
    "provider",
    "query",
    "status",
    "rank",
    "serp_page",
    "page_position",
    "matched_url",
    "matched_title",
    "organic_count",
    "error"
  ];
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(csvPath, `${[
    header.join(","),
    ...rows.map((row) => header.map((field) => csvEscape(row[field])).join(","))
  ].join("\n")}\n`);
  console.log(`json=${jsonPath}`);
  console.log(`csv=${csvPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
