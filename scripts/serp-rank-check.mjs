"use strict";

import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { categoryRows, districtRows, landingAliasRows } = require("../src/data/publicMetadata");

const DEFAULT_SITE_HOST = "vip-gece.site";
const DEFAULT_OUT_DIR = "output/external-audits";
const DEFAULT_DEVICES = ["desktop", "mobile"];
const DEFAULT_DEPTH = 100;
const DEFAULT_LOCATION = "Istanbul, Istanbul, Turkey";
const DEFAULT_LANGUAGE = "tr";
const DEFAULT_COUNTRY = "tr";
const EUROPEAN_DISTRICTS = new Set([
  "Arnavutköy",
  "Avcılar",
  "Bağcılar",
  "Bahçelievler",
  "Bakırköy",
  "Başakşehir",
  "Bayrampaşa",
  "Beşiktaş",
  "Beylikdüzü",
  "Beyoğlu",
  "Büyükçekmece",
  "Çatalca",
  "Esenler",
  "Esenyurt",
  "Eyüpsultan",
  "Fatih",
  "Gaziosmanpaşa",
  "Güngören",
  "Kağıthane",
  "Küçükçekmece",
  "Sarıyer",
  "Silivri",
  "Sultangazi",
  "Şişli",
  "Zeytinburnu"
]);
const ASIAN_DISTRICTS = new Set([
  "Adalar",
  "Ataşehir",
  "Beykoz",
  "Çekmeköy",
  "Kadıköy",
  "Kartal",
  "Maltepe",
  "Pendik",
  "Sancaktepe",
  "Sultanbeyli",
  "Şile",
  "Tuzla",
  "Ümraniye",
  "Üsküdar"
]);

const args = process.argv.slice(2);

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const direct = args.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length).trim();
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : fallback;
}

function hasArg(name) {
  return args.includes(name);
}

function splitList(value, fallback = []) {
  const list = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? [...new Set(list)] : fallback;
}

function numberArg(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const raw = argValue(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function cleanHost(value) {
  return String(value || DEFAULT_SITE_HOST).trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeSlugText(slug) {
  return String(slug || "")
    .replace(/-escort$/i, "")
    .replace(/-/g, " ")
    .trim();
}

function districtSide(name) {
  if (EUROPEAN_DISTRICTS.has(name)) return "europe";
  if (ASIAN_DISTRICTS.has(name)) return "asia";
  return "";
}

function rowMatchesSide(row, side) {
  if (!side || side === "all") return true;
  if (row.group === "istanbul") return hasArg("--include-city");
  const districtName = row.parent_district || row.name;
  return districtSide(districtName) === side;
}

function queryRows() {
  const side = argValue("--side", "all").toLowerCase();
  const rows = [
    { group: "istanbul", name: "İstanbul", slug: "istanbul-escort", query: "istanbul escort" },
    ...districtRows().map((row) => ({
      group: "district",
      name: row.name,
      slug: row.slug,
      side: districtSide(row.name),
      query: `${String(row.name || safeSlugText(row.slug)).toLocaleLowerCase("tr-TR")} escort`
    }))
  ].filter((row) => rowMatchesSide(row, side));

  if (!hasArg("--primary-only")) {
    rows.push(...landingAliasRows().map((row) => ({
      group: "semt",
      name: row.name || safeSlugText(row.slug),
      slug: row.slug,
      parent_district: row.parent_district,
      side: districtSide(row.parent_district),
      query: `${String(row.name || safeSlugText(row.slug)).toLocaleLowerCase("tr-TR")} escort`
    })).filter((row) => rowMatchesSide(row, side)));
  }

  if (hasArg("--include-categories")) {
    rows.push(...categoryRows().map((row) => ({
      group: "category",
      name: row.name,
      slug: row.slug,
      query: `${String(row.name || safeSlugText(row.slug)).toLocaleLowerCase("tr-TR")}`
    })));
  }

  return rows;
}

function resultPage(rank) {
  return rank ? Math.floor((rank - 1) / 10) + 1 : "";
}

function pagePosition(rank) {
  return rank ? ((rank - 1) % 10) + 1 : "";
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

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeOutputs(outBase, payload) {
  const jsonPath = `${outBase}.json`;
  const csvPath = `${outBase}.csv`;
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);

  const header = [
    "checked_at",
    "provider",
    "device",
    "group",
    "name",
    "slug",
    "side",
    "parent_district",
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
  const rows = payload.rows || [];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((field) => csvEscape(row[field])).join(","));
  }
  await writeFile(csvPath, `${lines.join("\n")}\n`);
}

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function serpApiUrl(input) {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", input.query);
  url.searchParams.set("api_key", requireEnv(argValue("--serpapi-key-env", "SERPAPI_KEY")));
  url.searchParams.set("hl", argValue("--hl", DEFAULT_LANGUAGE));
  url.searchParams.set("gl", argValue("--gl", DEFAULT_COUNTRY));
  url.searchParams.set("google_domain", argValue("--google-domain", "google.com.tr"));
  url.searchParams.set("location", argValue("--location", DEFAULT_LOCATION));
  url.searchParams.set("device", input.device);
  url.searchParams.set("num", String(input.depth));
  url.searchParams.set("safe", argValue("--safe", "off"));
  url.searchParams.set("no_cache", hasArg("--no-cache") ? "true" : "false");
  return url;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    throw new Error(body?.error || body?.message || `HTTP ${response.status}`);
  }
  return body;
}

async function checkSerpApi(input) {
  const body = await fetchJson(serpApiUrl(input));
  if (body.error) throw new Error(body.error);
  const organic = Array.isArray(body.organic_results) ? body.organic_results : [];
  const normalized = organic.map((item, index) => ({
    rank: Number(item.position || index + 1),
    title: String(item.title || ""),
    link: normalizeUrl(item.link || item.redirect_link || ""),
    displayed_link: String(item.displayed_link || ""),
    snippet: String(item.snippet || "")
  }));
  const match = normalized.find((item) => isTargetUrl(item.link, input.siteHost));
  return { organic: normalized, match, raw_metadata: body.search_metadata || {} };
}

function dataForSeoAuthHeader() {
  const login = requireEnv(argValue("--dataforseo-login-env", "DATAFORSEO_LOGIN"));
  const password = requireEnv(argValue("--dataforseo-password-env", "DATAFORSEO_PASSWORD"));
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

async function checkDataForSeo(input) {
  const task = {
    keyword: input.query,
    location_name: argValue("--location", "Istanbul,Turkey"),
    language_code: argValue("--language-code", DEFAULT_LANGUAGE),
    device: input.device,
    os: input.device === "mobile" ? argValue("--mobile-os", "ios") : argValue("--desktop-os", "macos"),
    depth: input.depth,
    tag: `${input.device}:${input.slug}`
  };
  const body = await fetchJson("https://api.dataforseo.com/v3/serp/google/organic/live/regular", {
    method: "POST",
    headers: {
      authorization: dataForSeoAuthHeader(),
      "content-type": "application/json"
    },
    body: JSON.stringify([task])
  });
  const items = body?.tasks?.[0]?.result?.[0]?.items || [];
  const organic = items
    .filter((item) => item.type === "organic")
    .map((item) => ({
      rank: Number(item.rank_absolute || item.rank_group || ""),
      title: String(item.title || ""),
      link: normalizeUrl(item.url || ""),
      displayed_link: String(item.breadcrumb || ""),
      snippet: String(item.description || "")
    }))
    .filter((item) => item.rank && item.link);
  const match = organic.find((item) => isTargetUrl(item.link, input.siteHost));
  return { organic, match, raw_metadata: { task_id: body?.tasks?.[0]?.id || "" } };
}

function serperPayload(input) {
  const payload = {
    q: input.query,
    gl: argValue("--gl", DEFAULT_COUNTRY),
    hl: argValue("--hl", DEFAULT_LANGUAGE),
    location: argValue("--location", DEFAULT_LOCATION),
    num: input.depth,
    autocorrect: !hasArg("--no-autocorrect")
  };
  const page = numberArg("--page", 0, 1, 100);
  const tbs = argValue("--tbs", "");
  if (page) payload.page = page;
  if (tbs) payload.tbs = tbs;
  return payload;
}

function serperAuthHeader() {
  return requireEnv(argValue("--serper-key-env", "SERPER_API_KEY"));
}

async function checkSerper(input) {
  const body = await fetchJson("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": serperAuthHeader(),
      "content-type": "application/json"
    },
    body: JSON.stringify(serperPayload(input))
  });
  const organic = Array.isArray(body.organic) ? body.organic : [];
  const normalized = organic
    .map((item, index) => ({
      rank: Number(item.position || index + 1),
      title: String(item.title || ""),
      link: normalizeUrl(item.link || ""),
      displayed_link: String(item.displayedUrl || item.displayed_link || ""),
      snippet: String(item.snippet || "")
    }))
    .filter((item) => item.rank && item.link);
  const match = normalized.find((item) => isTargetUrl(item.link, input.siteHost));
  return { organic: normalized, match, raw_metadata: body.searchParameters || {} };
}

async function checkRank(input) {
  if (input.provider === "dataforseo") return checkDataForSeo(input);
  if (input.provider === "serper") return checkSerper(input);
  return checkSerpApi(input);
}

function existingKey(row) {
  return `${row.provider}|${row.device}|${row.slug}|${row.query}`;
}

async function main() {
  const provider = argValue("--provider", "serpapi").toLowerCase();
  if (!["serpapi", "dataforseo", "serper"].includes(provider)) {
    throw new Error("--provider must be serpapi, dataforseo or serper");
  }

  const siteHost = cleanHost(argValue("--site-host", DEFAULT_SITE_HOST));
  const defaultDevices = provider === "serper" ? ["desktop"] : DEFAULT_DEVICES;
  const devices = splitList(argValue("--device", ""), defaultDevices).filter((device) => DEFAULT_DEVICES.includes(device));
  const depth = numberArg("--depth", DEFAULT_DEPTH, 10, 100);
  const limit = numberArg("--limit", 0, 0);
  const offset = numberArg("--offset", 0, 0);
  const delayMs = numberArg("--delay-ms", 700, 0, 60000);
  const outDir = argValue("--out-dir", DEFAULT_OUT_DIR);
  const outName = argValue("--out", `serp-rank-${provider}-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`);
  const outBase = path.join(outDir, outName.replace(/\.(json|csv)$/i, ""));
  const resume = hasArg("--resume");

  await mkdir(outDir, { recursive: true });

  const selectedQueries = queryRows().slice(offset, limit ? offset + limit : undefined);
  const existing = resume ? await readJsonIfExists(`${outBase}.json`) : null;
  const rows = Array.isArray(existing?.rows) ? existing.rows : [];
  const completed = new Set(rows.map(existingKey));

  const payload = {
    meta: {
      checked_at: new Date().toISOString(),
      provider,
      site_host: siteHost,
      devices,
      depth,
      query_count: selectedQueries.length,
      total_checks_planned: selectedQueries.length * devices.length,
      location: argValue("--location", provider === "dataforseo" ? "Istanbul,Turkey" : DEFAULT_LOCATION),
      device_note:
        provider === "serper"
          ? "Serper free pilot uses a lightweight Google SERP endpoint; use SerpApi or DataForSEO when strict mobile/desktop parity is required."
          : "",
      output_json: `${outBase}.json`,
      output_csv: `${outBase}.csv`
    },
    rows
  };

  for (const query of selectedQueries) {
    for (const device of devices) {
      const baseRow = {
        checked_at: new Date().toISOString(),
        provider,
        device,
        group: query.group,
        name: query.name,
        slug: query.slug,
        side: query.side || "",
        parent_district: query.parent_district || "",
        query: query.query
      };

      if (resume && completed.has(existingKey(baseRow))) continue;

      try {
        const result = await checkRank({ ...query, provider, device, depth, siteHost });
        const match = result.match;
        payload.rows.push({
          ...baseRow,
          status: match ? "found" : "not_found",
          rank: match?.rank || "",
          serp_page: resultPage(match?.rank),
          page_position: pagePosition(match?.rank),
          matched_url: match?.link || "",
          matched_title: match?.title || "",
          organic_count: result.organic.length,
          error: ""
        });
        console.log(`${device} | ${query.query} | ${match ? `FOUND #${match.rank}` : "not_found"} | organic=${result.organic.length}`);
      } catch (error) {
        payload.rows.push({
          ...baseRow,
          status: "error",
          rank: "",
          serp_page: "",
          page_position: "",
          matched_url: "",
          matched_title: "",
          organic_count: "",
          error: error.message || String(error)
        });
        console.log(`${device} | ${query.query} | ERROR ${error.message || error}`);
        if (hasArg("--stop-on-error")) {
          await writeOutputs(outBase, payload);
          throw error;
        }
      }

      await writeOutputs(outBase, payload);
      if (delayMs) await sleep(delayMs);
    }
  }

  const found = payload.rows.filter((row) => row.status === "found").length;
  const errors = payload.rows.filter((row) => row.status === "error").length;
  payload.meta.finished_at = new Date().toISOString();
  payload.meta.completed_checks = payload.rows.length;
  payload.meta.found = found;
  payload.meta.errors = errors;
  await writeOutputs(outBase, payload);

  if (!hasArg("--json")) {
    console.log(`ok provider=${provider} checks=${payload.rows.length} found=${found} errors=${errors}`);
    console.log(`json=${outBase}.json`);
    console.log(`csv=${outBase}.csv`);
  } else {
    console.log(JSON.stringify(payload.meta, null, 2));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
