"use strict";

import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { resolveLandingTarget } = require("../src/services/landingContextService");

const args = process.argv.slice(2);
const DEFAULT_SITE = "https://vip-gece.site";
const DEFAULT_OUT_DIR = "output/external-audits";

const TERM_ROWS = Object.freeze([
  { term: "escort", class: "core", publicUse: "eligible" },
  { term: "eskort", class: "core_variant", publicUse: "eligible" },
  { term: "vip escort", class: "quality_variant", publicUse: "eligible" },
  { term: "elit escort", class: "quality_variant", publicUse: "eligible" },
  { term: "premium escort", class: "quality_variant", publicUse: "eligible" },
  { term: "bağımsız escort", class: "service_variant", publicUse: "eligible_if_true" },
  { term: "bireysel escort", class: "service_variant", publicUse: "eligible_if_true" },
  { term: "refakatçi", class: "semantic_variant", publicUse: "review_only" },
  { term: "kadın refakatçi", class: "semantic_variant", publicUse: "review_only" },
  { term: "özel refakatçi", class: "semantic_variant", publicUse: "review_only" },
  { term: "ücretli arkadaşlık", class: "semantic_variant", publicUse: "review_only" },
  { term: "özel arkadaşlık", class: "semantic_variant", publicUse: "review_only" },
  { term: "yetişkin arkadaşlık", class: "semantic_variant", publicUse: "review_only" },
  { term: "gecelik arkadaşlık", class: "semantic_variant", publicUse: "review_only" },
  { term: "bayan arkadaş", class: "semantic_variant", publicUse: "review_only" },
  { term: "kadın arkadaş", class: "semantic_variant", publicUse: "review_only" },
  { term: "özel partner", class: "semantic_variant", publicUse: "review_only" },
  { term: "gece partneri", class: "semantic_variant", publicUse: "review_only" },
  { term: "refakat hizmeti", class: "semantic_variant", publicUse: "review_only" },
  { term: "özel refakat", class: "semantic_variant", publicUse: "review_only" },
  { term: "call girl", class: "english_variant", publicUse: "tracking_only" },
  { term: "callgirl", class: "english_variant", publicUse: "tracking_only" },
  { term: "companion", class: "english_variant", publicUse: "tracking_only" },
  { term: "female companion", class: "english_variant", publicUse: "tracking_only" },
  { term: "independent escort", class: "english_variant", publicUse: "tracking_only" },
  { term: "vip companion", class: "english_variant", publicUse: "tracking_only" },
  { term: "escort bayan", class: "word_order_variant", publicUse: "tracking_only" },
  { term: "eskort bayan", class: "word_order_variant", publicUse: "tracking_only" },
  { term: "escort kadın", class: "word_order_variant", publicUse: "tracking_only" },
  { term: "eskort kadın", class: "word_order_variant", publicUse: "tracking_only" },
  { term: "fahişe", class: "rough_language", publicUse: "tracking_only" },
  { term: "orospu", class: "rough_language", publicUse: "tracking_only" },
  { term: "hayat kadını", class: "rough_language", publicUse: "tracking_only" },
  { term: "telekız", class: "rough_language", publicUse: "tracking_only" },
  { term: "çağrı kızı", class: "rough_language", publicUse: "tracking_only" },
  { term: "seks işçisi", class: "rough_language", publicUse: "tracking_only" },
  { term: "ücretli kadın", class: "rough_language", publicUse: "tracking_only" },
  { term: "paralı kadın", class: "rough_language", publicUse: "tracking_only" },
  { term: "konsomatris", class: "rough_language", publicUse: "tracking_only" },
  { term: "randevu evi", class: "rough_language", publicUse: "tracking_only" },
  { term: "genelev kadını", class: "rough_language", publicUse: "tracking_only" },
  { term: "seks partneri", class: "rough_language", publicUse: "tracking_only" },
  { term: "para karşılığı arkadaşlık", class: "rough_language", publicUse: "tracking_only" },
  { term: "ücret karşılığı arkadaşlık", class: "rough_language", publicUse: "tracking_only" },
  { term: "paralı arkadaş", class: "rough_language", publicUse: "tracking_only" },
  { term: "ücretli bayan", class: "rough_language", publicUse: "tracking_only" },
  { term: "gecelik kadın", class: "rough_language", publicUse: "tracking_only" },
  { term: "gecelik bayan", class: "rough_language", publicUse: "tracking_only" },
  { term: "fahise", class: "ascii_variant", publicUse: "tracking_only" },
  { term: "hayat kadini", class: "ascii_variant", publicUse: "tracking_only" },
  { term: "tele kiz", class: "ascii_variant", publicUse: "tracking_only" },
  { term: "cagri kizi", class: "ascii_variant", publicUse: "tracking_only" },
  { term: "seks iscisi", class: "ascii_variant", publicUse: "tracking_only" },
  { term: "ucretli kadin", class: "ascii_variant", publicUse: "tracking_only" },
  { term: "parali kadin", class: "ascii_variant", publicUse: "tracking_only" },
  { term: "escört", class: "misspelling", publicUse: "tracking_only" },
  { term: "eskord", class: "misspelling", publicUse: "tracking_only" },
  { term: "escord", class: "misspelling", publicUse: "tracking_only" },
  { term: "escot", class: "misspelling", publicUse: "tracking_only" },
  { term: "escor", class: "misspelling", publicUse: "tracking_only" },
  { term: "escortt", class: "misspelling", publicUse: "tracking_only" },
  { term: "eskorrt", class: "misspelling", publicUse: "tracking_only" },
  { term: "eskot", class: "misspelling", publicUse: "tracking_only" },
  { term: "eskört", class: "misspelling", publicUse: "tracking_only" },
  { term: "orosbu", class: "misspelling", publicUse: "tracking_only" },
  { term: "orospo", class: "misspelling", publicUse: "tracking_only" }
]);

const LOCATION_PATTERNS = Object.freeze([
  { key: "exact", render: (location, term) => `${location} ${term}` },
  { key: "reverse", render: (location, term) => `${term} ${location}` },
  { key: "listings", render: (location, term) => `${location} ${term} ilanları` },
  { key: "singular_listing", render: (location, term) => `${location} ${term} ilanı` },
  { key: "number", render: (location, term) => `${location} ${term} numarası` },
  { key: "phone", render: (location, term) => `${location} ${term} telefon` },
  { key: "whatsapp", render: (location, term) => `${location} ${term} whatsapp` },
  { key: "contact", render: (location, term) => `${location} ${term} iletişim` },
  { key: "current", render: (location, term) => `${location} güncel ${term}` },
  { key: "active", render: (location, term) => `${location} aktif ${term}` },
  { key: "near", render: (location, term) => `${location} yakın ${term}` },
  { key: "night", render: (location, term) => `${location} gece ${term}` },
  { key: "appointment", render: (location, term) => `${location} ${term} randevu` },
  { key: "find", render: (location, term) => `${location} ${term} bul` }
]);

function argValue(name, fallback = "") {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).trim();
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : fallback;
}

function hasArg(name) {
  return args.includes(name);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeQuery(value) {
  return normalizeText(value).toLocaleLowerCase("tr-TR");
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "VIP-Gece-Query-Universe/2026-08-06" } });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.json();
}

async function fetchSitemap(url) {
  const response = await fetch(url, { headers: { Accept: "application/xml", "User-Agent": "VIP-Gece-Query-Universe/2026-08-06" } });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
    .map((match) => normalizeUrl(normalizeText(match[1]).replace(/&amp;/g, "&")))
    .filter(Boolean);
}

function addRow(map, row) {
  const query = normalizeQuery(row.query);
  if (!query) return;
  const key = `${row.url}|${query}`;
  const existing = map.get(key);
  if (existing && existing.source === "gsc_observed") return;
  map.set(key, { ...row, query });
}

function locationRows(url, target, map) {
  const location = normalizeText(
    target?.district?.name ||
    target?.category?.name ||
    new URL(url).pathname.slice(1).replace(/-escort$/i, "").replace(/-/g, " ")
  );
  for (const term of TERM_ROWS) {
    for (const pattern of LOCATION_PATTERNS) {
      addRow(map, {
        url,
        page_type: target?.type === "city" ? "city" : (target?.district?.is_alias ? "semt" : (target?.type === "category" ? "category" : "district")),
        location,
        query: pattern.render(location, term.term),
        term: term.term,
        term_class: term.class,
        intent: pattern.key,
        public_use: term.publicUse,
        source: "planned_language_matrix"
      });
    }
  }
}

function profileRows(url, profile, map) {
  const name = normalizeText(profile?.name || new URL(url).pathname.split("/").pop().replace(/-/g, " "));
  const location = normalizeText(profile?.district || profile?.city || "İstanbul");
  for (const term of TERM_ROWS) {
    const variants = [
      { intent: "profile_name", query: `${name} ${term.term}` },
      { intent: "profile_name_brand", query: `${name} ${term.term} vip gece` },
      { intent: "profile_location", query: `${location} ${name} ${term.term}` }
    ];
    for (const variant of variants) {
      addRow(map, {
        url,
        page_type: "profile",
        location,
        query: variant.query,
        term: term.term,
        term_class: term.class,
        intent: variant.intent,
        public_use: term.publicUse,
        source: "planned_language_matrix"
      });
    }
  }
}

function staticRows(url, map) {
  const pathname = new URL(url).pathname;
  const queries = pathname === "/"
    ? ["vip gece", "vip gece istanbul", "vip gece escort", "vip gece ilanları"]
    : pathname === "/ilanlar"
      ? ["istanbul escort ilanları", "güncel escort ilanları", "vip gece ilanları"]
      : pathname === "/kategoriler"
        ? ["istanbul escort kategorileri", "vip gece kategorileri"]
        : pathname === "/iletisim"
          ? ["vip gece iletişim", "vip gece whatsapp"]
          : ["vip gece güven", "vip gece politikalar"];
  for (const query of queries) addRow(map, {
    url,
    page_type: pathname === "/" ? "home" : "static",
    location: "İstanbul",
    query,
    term: "brand",
    term_class: "brand",
    intent: "brand_navigation",
    public_use: "eligible",
    source: "planned_brand_matrix"
  });
}

async function main() {
  const site = argValue("--site", process.env.SITE_URL || DEFAULT_SITE).replace(/\/+$/, "");
  const outDir = argValue("--out-dir", DEFAULT_OUT_DIR);
  const date = new Date().toISOString().slice(0, 10);
  const outBase = path.join(outDir, argValue("--out", `seo-query-universe-${date}`));
  const urls = await fetchSitemap(`${site}/sitemap.xml`);
  const profilePayload = await fetchJson(`${site}/api/v1/public/profiles`);
  const profiles = Array.isArray(profilePayload.profiles) ? profilePayload.profiles : [];
  const profilesByPath = new Map(profiles.map((profile) => [`/profil/${profile.slug}`, profile]));
  const rowsByKey = new Map();

  for (const url of urls) {
    const pathname = new URL(url).pathname.replace(/\/+$/, "") || "/";
    if (pathname.startsWith("/profil/")) {
      profileRows(url, profilesByPath.get(pathname), rowsByKey);
    } else if (pathname.endsWith("-escort")) {
      locationRows(url, resolveLandingTarget(pathname.slice(1)), rowsByKey);
    } else {
      staticRows(url, rowsByKey);
    }
  }

  if (hasArg("--with-gsc")) {
    const { querySearchAnalytics, searchConsoleStatus } = require("../src/services/googleSearchConsoleService");
    const status = searchConsoleStatus();
    if (!status.configured || !status.enabled) throw new Error("Google Search Console aktif degil");
    const analytics = await querySearchAnalytics({
      startDate: argValue("--start-date", "2026-07-04"),
      endDate: argValue("--end-date", "2026-08-03"),
      dimensions: ["query", "page"],
      rowLimit: 25000,
      searchType: "web"
    });
    const sitemapSet = new Set(urls);
    for (const row of analytics.rows || []) {
      const url = normalizeUrl(row.keys?.[1]);
      if (!sitemapSet.has(url)) continue;
      addRow(rowsByKey, {
        url,
        page_type: "gsc_observed",
        location: "",
        query: row.keys?.[0],
        term: "observed",
        term_class: "observed",
        intent: "observed_search_demand",
        public_use: "review_before_use",
        source: "gsc_observed",
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
        position: Number(row.position || 0)
      });
    }
  }

  const rows = [...rowsByKey.values()].sort((a, b) => a.url.localeCompare(b.url) || a.query.localeCompare(b.query, "tr"));
  const summary = {
    url_count: urls.length,
    profile_count: profiles.length,
    query_count: rows.length,
    term_count: TERM_ROWS.length,
    pattern_count: LOCATION_PATTERNS.length,
    tracking_only_count: rows.filter((row) => row.public_use === "tracking_only").length,
    observed_gsc_count: rows.filter((row) => row.source === "gsc_observed").length,
    term_class_counts: Object.fromEntries([...new Set(TERM_ROWS.map((row) => row.class))].map((termClass) => [
      termClass,
      TERM_ROWS.filter((row) => row.class === termClass).length
    ]))
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(`${outBase}.json`, `${JSON.stringify({
    meta: {
      generated_at: new Date().toISOString(),
      site,
      ...summary,
      terms: TERM_ROWS,
      location_patterns: LOCATION_PATTERNS.map((pattern) => pattern.key)
    },
    rows
  }, null, 2)}\n`);
  const fields = ["url", "page_type", "location", "query", "term", "term_class", "intent", "public_use", "source", "clicks", "impressions", "position"];
  const lines = [fields.join(","), ...rows.map((row) => fields.map((field) => csvEscape(row[field])).join(","))];
  await writeFile(`${outBase}.csv`, `${lines.join("\n")}\n`);
  const termLines = TERM_ROWS.map((row) => `- ${row.term} | ${row.class} | ${row.publicUse}`).join("\n");
  const classLines = Object.entries(summary.term_class_counts).map(([name, count]) => `- ${name}: ${count}`).join("\n");
  await writeFile(`${outBase}.md`, `# VIP GECE SEO Query Universe\n\n- URL: ${summary.url_count}\n- Query: ${summary.query_count}\n- Terim: ${summary.term_count}\n- Lokasyon kalibi: ${summary.pattern_count}\n- Yalniz takip edilecek argo/yazim varyanti satiri: ${summary.tracking_only_count}\n- GSC'de gercekten gozlenen satir: ${summary.observed_gsc_count}\n\n## Terim sinifi sayilari\n\n${classLines}\n\n## Terim envanteri\n\n${termLines}\n\nBu envanter arastirma ve rank tracking icindir. \`tracking_only\` sorgular canli gorunur metne, gizli metne, title'a veya otomatik backlink anchor'ina eklenmez. Arama hacmi kanitlanmayan planned satirlar talep varmis gibi raporlanmaz. Resit olmayanlari ima eden terimler, yasa disi hizmetler ve ilgisiz kimlik/kategori sorgulari bilerek uretilmez.\n`);
  console.log(JSON.stringify({ ...summary, json: `${outBase}.json`, csv: `${outBase}.csv`, markdown: `${outBase}.md` }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
