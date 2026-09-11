"use strict";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractOrganicLinks(html) {
  const links = [];
  const seen = new Set();
  const anchorPattern = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const rawHref = decodeHtml(match[1]);
    let target = "";

    if (rawHref.startsWith("/url?") || rawHref.startsWith("https://www.google.com/url?")) {
      const parsed = new URL(rawHref, "https://www.google.com");
      target = parsed.searchParams.get("q") || parsed.searchParams.get("url") || "";
    } else if (/^https?:\/\//i.test(rawHref) && !rawHref.includes("google.")) {
      target = rawHref;
    }

    if (!target || target.includes("/search?") || target.includes("/preferences?")) continue;
    const normalized = normalizeUrl(target);
    const host = resultHost(normalized);
    if (!host || host.includes("google.")) continue;
    if (seen.has(normalized)) continue;

    const title = decodeHtml(match[2]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    seen.add(normalized);
    links.push({ rank: links.length + 1, title, link: normalized });
  }

  return links.slice(0, 100);
}

async function fetchGoogle(query) {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("num", argValue("--depth", "100"));
  url.searchParams.set("hl", argValue("--hl", "tr"));
  url.searchParams.set("gl", argValue("--gl", "tr"));
  url.searchParams.set("pws", "0");
  url.searchParams.set("safe", "off");

  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.7",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    }
  });
  const html = await response.text();
  const blocked = /unusual traffic|sorry\/index|captcha/i.test(html);
  return {
    status: response.status,
    final_url: response.url,
    blocked,
    html
  };
}

async function main() {
  const siteHost = argValue("--site-host", DEFAULT_SITE_HOST).replace(/^www\./i, "");
  const queries = splitList(argValue("--queries", ""), DEFAULT_QUERIES);
  const outDir = argValue("--out-dir", DEFAULT_OUT_DIR);
  const outName = argValue("--out", `google-direct-rank-pilot-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`);
  const outBase = path.join(outDir, outName.replace(/\.(json|csv)$/i, ""));
  const rows = [];

  await mkdir(outDir, { recursive: true });

  for (const query of queries) {
    try {
      const result = await fetchGoogle(query);
      const organic = result.blocked ? [] : extractOrganicLinks(result.html);
      const match = organic.find((item) => isTargetUrl(item.link, siteHost));
      rows.push({
        checked_at: new Date().toISOString(),
        provider: "google-direct-html",
        query,
        status: result.blocked ? "blocked" : (match ? "found" : "not_found"),
        rank: match?.rank || "",
        serp_page: match?.rank ? Math.floor((match.rank - 1) / 10) + 1 : "",
        page_position: match?.rank ? ((match.rank - 1) % 10) + 1 : "",
        matched_url: match?.link || "",
        matched_title: match?.title || "",
        organic_count: organic.length,
        http_status: result.status,
        error: ""
      });
      console.log(`${query} | ${match ? `FOUND #${match.rank}` : result.blocked ? "blocked" : "not_found"} | organic=${organic.length}`);
    } catch (error) {
      rows.push({
        checked_at: new Date().toISOString(),
        provider: "google-direct-html",
        query,
        status: "error",
        rank: "",
        serp_page: "",
        page_position: "",
        matched_url: "",
        matched_title: "",
        organic_count: "",
        http_status: "",
        error: error.message || String(error)
      });
      console.log(`${query} | ERROR ${error.message || error}`);
    }
  }

  const payload = {
    meta: {
      checked_at: new Date().toISOString(),
      provider: "google-direct-html",
      site_host: siteHost,
      query_count: queries.length,
      note: "API anahtari olmadan Google HTML pilotudur; resmi rank tracking icin Serper, SerpApi veya DataForSEO kullanilmalidir."
    },
    rows
  };
  const jsonPath = `${outBase}.json`;
  const csvPath = `${outBase}.csv`;
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
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
    "http_status",
    "error"
  ];
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
