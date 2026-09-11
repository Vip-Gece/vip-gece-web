"use strict";

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

function normalizeSite(value) {
  const parsed = new URL(String(value || "https://vip-gece.site"));
  if (parsed.protocol !== "https:") throw new Error("site must use https");
  return parsed.origin;
}

function decodeXml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

function addType(counts, type) {
  for (const value of Array.isArray(type) ? type : [type]) {
    if (typeof value === "string" && value) counts[value] = (counts[value] || 0) + 1;
  }
}

function walkSchema(value, counts) {
  if (!value || typeof value !== "object") return;
  addType(counts, value["@type"]);
  if (Array.isArray(value)) {
    for (const item of value) walkSchema(item, counts);
    return;
  }
  for (const child of Object.values(value)) walkSchema(child, counts);
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "VIP-Gece-Live-Structured-Data-Audit/1.0" },
    signal: AbortSignal.timeout(30000)
  });
  return { response, text: await response.text() };
}

async function main() {
  const site = normalizeSite(argValue("--site", process.env.SITE_URL || "https://vip-gece.site"));
  const concurrency = boundedInteger(argValue("--concurrency", "2"), 2, 1, 4);
  const { response: sitemapResponse, text: sitemapXml } = await fetchText(`${site}/sitemap.xml`);
  if (!sitemapResponse.ok) throw new Error(`sitemap status ${sitemapResponse.status}`);
  const urls = [...sitemapXml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)]
    .map((match) => decodeXml(match[1].trim()))
    .filter((url) => {
      try {
        return new URL(url).origin === site;
      } catch {
        return false;
      }
    });
  if (!urls.length) throw new Error("sitemap has no same-origin URLs");

  const findings = [];
  const typeCounts = {};
  let cursor = 0;

  async function inspect(url) {
    const { response, text: html } = await fetchText(url);
    const jsonLdBlocks = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    const canonical = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] || "";
    const description = html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] || "";
    const ogTitle = html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i)?.[1] || "";
    const twitterCard = html.match(/<meta\b[^>]*name=["']twitter:card["'][^>]*content=["']([^"']*)["']/i)?.[1] || "";
    const h1Count = (html.match(/<h1\b/gi) || []).length;
    const problems = [];

    if (response.status !== 200) problems.push(`status=${response.status}`);
    if (canonical !== url) problems.push(`canonical=${canonical || "missing"}`);
    if (!description) problems.push("description=missing");
    if (!ogTitle) problems.push("og:title=missing");
    if (!twitterCard) problems.push("twitter:card=missing");
    if (h1Count !== 1) problems.push(`h1_count=${h1Count}`);
    if (jsonLdBlocks.length === 0) problems.push("jsonld=missing");

    for (const [, raw] of jsonLdBlocks) {
      try {
        const schema = JSON.parse(raw);
        const contexts = Array.isArray(schema)
          ? schema.map((item) => item?.["@context"])
          : [schema?.["@context"]];
        if (contexts.some((context) => context && context !== "https://schema.org")) {
          problems.push("jsonld=context_invalid");
        }
        walkSchema(schema, typeCounts);
      } catch {
        problems.push("jsonld=parse_error");
      }
    }

    if (problems.length) findings.push({ url, problems: [...new Set(problems)] });
  }

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= urls.length) return;
      try {
        await inspect(urls[index]);
      } catch (error) {
        findings.push({ url: urls[index], problems: [`request_error=${error.message || error}`] });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const result = {
    ok: findings.length === 0,
    site,
    sitemap_urls: urls.length,
    checked_urls: urls.length,
    schema_type_occurrences: Object.fromEntries(
      Object.entries(typeCounts).sort(([left], [right]) => left.localeCompare(right))
    ),
    finding_count: findings.length,
    findings: findings.slice(0, 50)
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
