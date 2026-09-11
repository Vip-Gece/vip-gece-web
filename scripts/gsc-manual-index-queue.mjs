"use strict";

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { categoryRows, districtRows } = require("../src/data/publicMetadata");

const args = process.argv.slice(2);
const DEFAULT_SITE = "https://vip-gece.site";

function argValue(name, fallback = "") {
  const direct = args.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).trim();
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : fallback;
}

function normalizeSite(value) {
  const parsed = new URL(String(value || DEFAULT_SITE));
  if (parsed.protocol !== "https:") throw new Error("site must use https");
  return parsed.origin;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function xmlValue(block, tag) {
  return decodeXml(block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "").trim();
}

function parseSitemap(xml, site) {
  const seen = new Set();
  const rows = [];
  for (const match of String(xml || "").matchAll(/<url\b[\s\S]*?<\/url>/gi)) {
    const block = match[0];
    const loc = xmlValue(block, "loc");
    let parsed;
    try {
      parsed = new URL(loc);
    } catch {
      continue;
    }
    if (parsed.origin !== site || seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    rows.push({
      url: parsed.href,
      path: parsed.pathname,
      sitemap_priority: Number(xmlValue(block, "priority") || 0),
      lastmod: xmlValue(block, "lastmod")
    });
  }
  return rows;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function readReport(source) {
  const raw = source === "-" ? await readStdin() : await readFile(source, "utf8");
  const report = JSON.parse(raw);
  if (!Array.isArray(report.inspections) || !Array.isArray(report.search_analytics?.rows)) {
    throw new Error("report must contain inspections and search_analytics.rows");
  }
  return report;
}

function aggregateDemand(rows) {
  const pages = new Map();
  for (const row of rows) {
    const page = String(row?.keys?.[1] || "").trim();
    if (!page) continue;
    const current = pages.get(page) || { clicks: 0, impressions: 0, weighted_position: 0 };
    const impressions = Number(row.impressions || 0);
    current.clicks += Number(row.clicks || 0);
    current.impressions += impressions;
    current.weighted_position += Number(row.position || 0) * impressions;
    pages.set(page, current);
  }
  for (const current of pages.values()) {
    current.position = current.impressions > 0
      ? current.weighted_position / current.impressions
      : null;
    delete current.weighted_position;
  }
  return pages;
}

const districtPaths = new Set(districtRows().map((row) => `/${row.slug}`));
const categoryPaths = new Set(categoryRows().map((row) => `/${row.slug}`));

function pageType(path) {
  if (path === "/") return "home";
  if (path === "/istanbul-escort") return "city";
  if (["/ilanlar", "/kategoriler"].includes(path)) return "hub";
  if (path.startsWith("/profil/")) return "profile";
  if (districtPaths.has(path)) return "district";
  if (categoryPaths.has(path)) return "category";
  if (["/iletisim", "/guven-ve-politikalar"].includes(path)) return "static";
  return "neighborhood";
}

function coverageBoost(coverage) {
  const value = String(coverage || "").toLocaleLowerCase("tr-TR");
  if (/google.*bilinmiyor|unknown/.test(value)) return 800;
  if (/keşfedildi|discovered/.test(value)) return 650;
  if (/tarandı|crawled/.test(value)) return 500;
  return 300;
}

function baseScore(type, path) {
  if (path === "/istanbul-escort") return 50000;
  if (path === "/ilanlar") return 49000;
  if (path === "/kategoriler") return 48000;
  return {
    district: 5600,
    category: 5000,
    profile: 4400,
    neighborhood: 4000,
    static: 1800,
    city: 12000,
    hub: 10000,
    home: 0
  }[type] || 0;
}

function scoreRow(row) {
  if (row.inspection_verdict === "PASS") return -100000;
  const demand = row.search_demand;
  const demandScore = demand.impressions > 0
    ? 7000 + (demand.impressions * 80) + (demand.clicks * 120) +
      (demand.position !== null && demand.position > 5 ? 350 : 0)
    : 0;
  return baseScore(row.type, row.path) + demandScore + coverageBoost(row.coverage_state) +
    Math.round(row.sitemap_priority * 100);
}

function priorityBand(rank, row) {
  if (row.inspection_verdict === "PASS") return "Zaten dizinde";
  if (rank <= 10) return "P0 - şimdi";
  if (rank <= 40) return "P1 - sonra";
  if (rank <= 100) return "P2 - takip";
  return "P3 - sitemap rotasyonu";
}

function markdownEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

async function main() {
  const site = normalizeSite(argValue("--site", process.env.SITE_URL || DEFAULT_SITE));
  const reportSource = argValue("--report", "-");
  const format = argValue("--format", "json");
  const [report, sitemapResponse] = await Promise.all([
    readReport(reportSource),
    fetch(`${site}/sitemap.xml`, {
      headers: { "User-Agent": "VIP-Gece-GSC-Manual-Queue/1.0" },
      signal: AbortSignal.timeout(30000)
    })
  ]);
  if (!sitemapResponse.ok) throw new Error(`sitemap returned HTTP ${sitemapResponse.status}`);
  const sitemapRows = parseSitemap(await sitemapResponse.text(), site);
  if (!sitemapRows.length) throw new Error("sitemap has no same-origin URL rows");

  const inspections = new Map(report.inspections.map((row) => [row.inspection_url, row]));
  const demand = aggregateDemand(report.search_analytics.rows);
  const queue = sitemapRows.map((entry) => {
    const inspection = inspections.get(entry.url) || {};
    const row = {
      ...entry,
      type: pageType(entry.path),
      inspection_verdict: inspection.verdict || "UNKNOWN",
      coverage_state: inspection.coverage_state || "",
      last_crawl_time: inspection.last_crawl_time || "",
      search_demand: demand.get(entry.url) || { clicks: 0, impressions: 0, position: null }
    };
    return { ...row, score: scoreRow(row) };
  }).sort((left, right) =>
    right.score - left.score ||
    right.search_demand.impressions - left.search_demand.impressions ||
    right.sitemap_priority - left.sitemap_priority ||
    left.url.localeCompare(right.url, "tr")
  ).map((row, index) => ({
    rank: index + 1,
    band: priorityBand(index + 1, row),
    ...row
  }));

  const output = {
    generated_at: new Date().toISOString(),
    site,
    source_report_checked_at: report.checked_at || "",
    sitemap_url_count: sitemapRows.length,
    inspection_summary: report.inspection_summary,
    policy: "All URLs stay submitted through sitemaps. P0 is the bounded manual Search Console Request indexing queue; URL Inspection API itself cannot request indexing.",
    queue
  };

  if (format === "markdown") {
    console.log("# VIP GECE Google dizin öncelik kuyruğu\n");
    console.log(`- Üretim: ${site}`);
    console.log(`- Üretildi: ${output.generated_at}`);
    console.log(`- Sitemap URL: ${output.sitemap_url_count}`);
    console.log(`- Son URL Inspection: ${output.source_report_checked_at || "bilinmiyor"}`);
    console.log(`- Durum: ${report.inspection_summary?.pass || 0} dizinde, ${report.inspection_summary?.neutral || 0} bekliyor, ${report.inspection_summary?.fail || 0} hata`);
    console.log("- Kural: Tüm URL'ler sitemap ile gönderilir; yalnız P0 satırları günlük Search Console manuel `Dizine eklenmesini iste` kotasına girer. URL Inspection API istek göndermez, yalnız durum okur.\n");
    console.log("| # | Sıra | Tür | URL | GSC | Kapsam | Tıklama | Gösterim | Ort. konum |");
    console.log("|---:|---|---|---|---|---|---:|---:|---:|");
    for (const row of queue) {
      const position = row.search_demand.position === null ? "-" : row.search_demand.position.toFixed(2);
      console.log(`| ${row.rank} | ${row.band} | ${row.type} | ${row.url} | ${row.inspection_verdict} | ${markdownEscape(row.coverage_state)} | ${row.search_demand.clicks} | ${row.search_demand.impressions} | ${position} |`);
    }
    return;
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
