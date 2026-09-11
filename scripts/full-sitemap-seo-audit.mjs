"use strict";

const DEFAULT_SITE_URL = "https://vip-gece.site";
const DEFAULT_SITEMAP = "/sitemap.xml";
const STRICT_STATIC_URL_COUNT = 5;
const STRICT_SITEMAP_URL_COUNT = optionalExpectedCount("VIP_GECE_EXPECTED_SITEMAP_URL_COUNT");
const STRICT_PROFILE_URL_COUNT = optionalExpectedCount("VIP_GECE_EXPECTED_INDEXABLE_PROFILE_COUNT");
const STRICT_ESCORT_LANDING_COUNT = optionalExpectedCount("VIP_GECE_EXPECTED_ESCORT_LANDING_COUNT", 235);
const REQUIRED_PROFILE_SLUGS = Object.freeze([
  "irem-istanbul",
  "istanbul-kardelen",
  "istanbul-lara",
  "istanbul-sofia",
  "istanbul-umay"
]);
const DEFAULT_FETCH_ATTEMPTS = 2;
const AUDIT_USER_AGENT = process.env.LIVE_AUDIT_USER_AGENT || "VIP-Gece-Full-Sitemap-Audit/2026-06-27";
const EXPECTED_GA4_ID = String(process.env.GOOGLE_ANALYTICS_MEASUREMENT_ID || "G-MGGWKPN1KH").trim().toUpperCase();

function optionalExpectedCount(name, fallback = null) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

const args = process.argv.slice(2);
const argSet = new Set(args);
const strict = argSet.has("--strict");
const jsonOnly = argSet.has("--json");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const direct = args.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length).trim();
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : fallback;
}

function normalizeSiteUrl(raw) {
  const value = String(raw || DEFAULT_SITE_URL).trim().replace(/\/+$/, "");
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("site url must use http or https");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function absoluteUrl(siteUrl, value) {
  const raw = String(value || "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${siteUrl}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function normalizeComparableUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.search = "";
    const pathname = parsed.pathname === "/" ? "/" : parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return String(value || "").trim();
  }
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(source, pattern) {
  const match = String(source || "").match(pattern);
  return match ? String(match[1] || "").trim() : "";
}

function allMatches(source, pattern) {
  return Array.from(String(source || "").matchAll(pattern)).map((match) => String(match[1] || "").trim());
}

function attributeValue(tag, name) {
  const match = String(tag || "").match(new RegExp(`${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? String(match[2] || "").trim() : "";
}

function metaContent(html, attributeName, targetValue) {
  const tags = String(html || "").match(/<meta\b[^>]*>/gi) || [];
  const target = String(targetValue || "").toLowerCase();
  for (const tag of tags) {
    if (attributeValue(tag, attributeName).toLowerCase() === target) {
      return attributeValue(tag, "content");
    }
  }
  return "";
}

async function fetchText(url, timeoutMs = 20000, attempts = DEFAULT_FETCH_ATTEMPTS) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8",
          "User-Agent": AUDIT_USER_AGENT
        }
      });
      const text = await response.text();
      const result = {
        ok: response.ok,
        status: response.status,
        final_url: response.url,
        content_type: response.headers.get("content-type") || "",
        x_robots_tag: response.headers.get("x-robots-tag") || "",
        text
      };
      if (result.ok || ![429, 502, 503, 504].includes(result.status) || attempt === attempts) {
        return result;
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("fetch failed");
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

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return output;
}

function parseSitemap(xml, siteUrl) {
  const urlBlocks = Array.from(String(xml || "").matchAll(/<url\b[\s\S]*?<\/url>/gi)).map((match) => match[0]);
  return urlBlocks.map((block) => {
    const loc = decodeXml(firstMatch(block, /<loc>([\s\S]*?)<\/loc>/i));
    return {
      loc: absoluteUrl(siteUrl, loc),
      lastmod: decodeXml(firstMatch(block, /<lastmod>([\s\S]*?)<\/lastmod>/i)),
      changefreq: decodeXml(firstMatch(block, /<changefreq>([\s\S]*?)<\/changefreq>/i)),
      priority: decodeXml(firstMatch(block, /<priority>([\s\S]*?)<\/priority>/i))
    };
  }).filter((entry) => entry.loc);
}

function extractJsonLd(html) {
  return allMatches(html, /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
    .map((raw, index) => {
      const text = raw.trim();
      try {
        const parsed = JSON.parse(text);
        const roots = Array.isArray(parsed) ? parsed : [parsed];
        const nodes = roots.flatMap((node) => {
          if (!node || typeof node !== "object") return [];
          return Array.isArray(node["@graph"]) ? node["@graph"] : [node];
        });
        return {
          index,
          ok: true,
          nodes,
          types: nodes
            .map((node) => node?.["@type"])
            .flat()
            .filter(Boolean)
        };
      } catch (error) {
        return { index, ok: false, error: error.message || "JSON parse failed", types: [] };
      }
    });
}

function hasJsonLdType(node, type) {
  const value = node?.["@type"];
  return Array.isArray(value) ? value.includes(type) : value === type;
}

function findJsonLdNode(nodes, type) {
  return nodes.find((node) => hasJsonLdType(node, type));
}

function jsonLdReferenceId(value) {
  if (typeof value === "string") return value;
  return value && typeof value === "object" ? String(value["@id"] || "") : "";
}

function isNonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSameOriginUrl(value, origin) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.origin === origin;
  } catch {
    return false;
  }
}

function isValidIsoDate(value) {
  return (
    isNonEmptyText(value) &&
    /^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function visiblePageText(html) {
  return stripTags(html)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("tr");
}

function structuredDataFindings({ html, pathName, canonical, siteOrigin, jsonLd }) {
  const findings = [];
  const nodes = jsonLd.flatMap((item) => item.ok && Array.isArray(item.nodes) ? item.nodes : []);
  const canonicalComparable = normalizeComparableUrl(canonical);
  const homeUrl = `${siteOrigin}/`;
  const organizationId = `${siteOrigin}/#organization`;
  const websiteId = `${siteOrigin}/#website`;
  const collection = findJsonLdNode(nodes, "CollectionPage");
  const webPage = findJsonLdNode(nodes, "WebPage");
  const profilePage = findJsonLdNode(nodes, "ProfilePage");
  const person = findJsonLdNode(nodes, "Person");
  const imageObject = findJsonLdNode(nodes, "ImageObject");
  const breadcrumb = findJsonLdNode(nodes, "BreadcrumbList");
  const faq = findJsonLdNode(nodes, "FAQPage");
  const organization = findJsonLdNode(nodes, "Organization");
  const website = findJsonLdNode(nodes, "WebSite");
  const isProfile = pathName.startsWith("/profil/");
  const isHome = pathName === "/";
  const isPolicy = pathName === "/guven-ve-politikalar";
  const isContact = pathName === "/iletisim";
  const isCollection = isHome || pathName === "/ilanlar" || pathName === "/kategoriler" || pathName.endsWith("-escort");
  const needsFaq = isContact || (!isHome && isCollection);
  const needsSiteIdentity = isCollection || isContact;

  if (findJsonLdNode(nodes, "ItemList")) {
    findings.push("unsupported ItemList structured data");
  }

  if (isCollection) {
    if (!collection) {
      findings.push("missing CollectionPage JSON-LD");
    } else {
      if (normalizeComparableUrl(collection.url) !== canonicalComparable) {
        findings.push("CollectionPage URL does not match canonical");
      }
      if (!isNonEmptyText(collection.name) || !isNonEmptyText(collection.description)) {
        findings.push("CollectionPage name/description missing");
      }
      if (collection.inLanguage !== "tr-TR") {
        findings.push("CollectionPage language mismatch");
      }
      if (jsonLdReferenceId(collection.isPartOf) !== websiteId) {
        findings.push("CollectionPage WebSite reference mismatch");
      }
      if (!isSameOriginUrl(collection.primaryImageOfPage?.url, siteOrigin)) {
        findings.push("CollectionPage image is not same-origin");
      }
      if ("keywords" in collection || "about" in collection) {
        findings.push("keyword-stuffed CollectionPage JSON-LD");
      }
    }
  }

  if (isContact || isPolicy) {
    if (!webPage) {
      findings.push("missing WebPage JSON-LD");
    } else {
      if (normalizeComparableUrl(webPage.url) !== canonicalComparable) {
        findings.push("WebPage URL does not match canonical");
      }
      if (!isNonEmptyText(webPage.name) || !isNonEmptyText(webPage.description)) {
        findings.push("WebPage name/description missing");
      }
      if (webPage.inLanguage !== "tr-TR") {
        findings.push("WebPage language mismatch");
      }
    }
  }

  if (needsSiteIdentity) {
    if (
      !organization ||
      organization["@id"] !== organizationId ||
      normalizeComparableUrl(organization.url) !== normalizeComparableUrl(homeUrl) ||
      !isNonEmptyText(organization.name) ||
      !isSameOriginUrl(organization.logo?.url, siteOrigin)
    ) {
      findings.push("Organization identity JSON-LD mismatch");
    }
    if (
      !website ||
      website["@id"] !== websiteId ||
      normalizeComparableUrl(website.url) !== normalizeComparableUrl(homeUrl) ||
      !isNonEmptyText(website.name) ||
      jsonLdReferenceId(website.publisher) !== organizationId
    ) {
      findings.push("WebSite identity JSON-LD mismatch");
    }
  }

  if (isProfile) {
    if (!profilePage) {
      findings.push("missing ProfilePage JSON-LD");
    } else {
      if (normalizeComparableUrl(profilePage.url) !== canonicalComparable) {
        findings.push("ProfilePage URL does not match canonical");
      }
      if (!isNonEmptyText(profilePage.name) || !isNonEmptyText(profilePage.description)) {
        findings.push("ProfilePage name/description missing");
      }
      if (!jsonLdReferenceId(profilePage.mainEntity)) {
        findings.push("ProfilePage mainEntity missing");
      }
      if (profilePage.dateCreated !== undefined && !isValidIsoDate(profilePage.dateCreated)) {
        findings.push("ProfilePage dateCreated invalid");
      }
      if (profilePage.dateModified !== undefined && !isValidIsoDate(profilePage.dateModified)) {
        findings.push("ProfilePage dateModified invalid");
      }
    }

    const personId = jsonLdReferenceId(profilePage?.mainEntity);
    if (
      !person ||
      !personId ||
      person["@id"] !== personId ||
      !isNonEmptyText(person.name) ||
      !isNonEmptyText(person.description) ||
      normalizeComparableUrl(person.url) !== canonicalComparable ||
      !isSameOriginUrl(person.image, siteOrigin)
    ) {
      findings.push("ProfilePage Person entity mismatch");
    }
    if (
      !imageObject ||
      !isSameOriginUrl(imageObject.url, siteOrigin) ||
      !isSameOriginUrl(imageObject.contentUrl, siteOrigin)
    ) {
      findings.push("ProfilePage ImageObject mismatch");
    }
  }

  if (!isHome) {
    const items = Array.isArray(breadcrumb?.itemListElement) ? breadcrumb.itemListElement : [];
    const breadcrumbValid = (
      items.length >= 2 &&
      items.every((item, index) => (
        hasJsonLdType(item, "ListItem") &&
        item.position === index + 1 &&
        isNonEmptyText(item.name) &&
        isSameOriginUrl(typeof item.item === "string" ? item.item : item.item?.["@id"], siteOrigin)
      )) &&
      normalizeComparableUrl(typeof items.at(-1)?.item === "string" ? items.at(-1).item : items.at(-1)?.item?.["@id"]) === canonicalComparable
    );
    if (!breadcrumbValid) {
      findings.push("BreadcrumbList is not canonical and sequential");
    }
  }

  if (needsFaq) {
    const entities = Array.isArray(faq?.mainEntity) ? faq.mainEntity : [];
    const pageText = visiblePageText(html);
    const faqValid = entities.length > 0 && entities.every((item) => (
      hasJsonLdType(item, "Question") &&
      isNonEmptyText(item.name) &&
      hasJsonLdType(item.acceptedAnswer, "Answer") &&
      isNonEmptyText(item.acceptedAnswer?.text) &&
      pageText.includes(item.name.trim().toLocaleLowerCase("tr")) &&
      pageText.includes(item.acceptedAnswer.text.trim().toLocaleLowerCase("tr"))
    ));
    if (!faqValid) {
      findings.push("FAQPage does not match visible question/answer content");
    }
  } else if (faq) {
    findings.push("unexpected FAQPage JSON-LD");
  }

  return findings;
}

function auditHtml(entry, result) {
  const html = result.text || "";
  const requested = normalizeComparableUrl(entry.loc);
  const finalUrl = normalizeComparableUrl(result.final_url);
  const title = stripTags(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = metaContent(html, "name", "description");
  const canonical = firstMatch(html, /<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i);
  const canonicalComparable = normalizeComparableUrl(canonical);
  const robots = metaContent(html, "name", "robots");
  const h1 = allMatches(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi).map(stripTags).filter(Boolean);
  const jsonLd = extractJsonLd(html);
  const ogTitle = metaContent(html, "property", "og:title");
  const ogDescription = metaContent(html, "property", "og:description");
  const twitterTitle = metaContent(html, "name", "twitter:title");
  const analyticsTags = allMatches(
    html,
    /<script\b[^>]*src=["']\/public\/js\/google-analytics\.js[^"']*["'][^>]*data-ga-measurement-id=["']([^"']+)["'][^>]*><\/script>/gi
  );
  const findings = [];

  if (!result.ok) findings.push(`HTTP ${result.status}`);
  if (!/^text\/html\b/i.test(result.content_type)) findings.push(`content-type ${result.content_type || "missing"}`);
  if (requested !== finalUrl) findings.push(`sitemap URL redirects to ${result.final_url}`);
  if (!title) findings.push("missing title");
  if (title && (title.length < 20 || title.length > 75)) findings.push(`title length ${title.length}`);
  if (!description) findings.push("missing description");
  if (description && (description.length < 80 || description.length > 180)) findings.push(`description length ${description.length}`);
  if (!canonical) findings.push("missing canonical");
  if (canonical && canonicalComparable !== requested) findings.push(`canonical mismatch ${canonical}`);
  if (/noindex/i.test(robots)) findings.push("noindex present");
  if (/noindex/i.test(result.x_robots_tag || "")) findings.push("X-Robots-Tag noindex present");
  if (h1.length !== 1) findings.push(`h1 count ${h1.length}`);
  if (!ogTitle || !ogDescription) findings.push("missing Open Graph title/description");
  if (!twitterTitle) findings.push("missing Twitter title");
  if (analyticsTags.length !== 1) findings.push(`GA4 tag count ${analyticsTags.length}`);
  if (analyticsTags.length === 1 && analyticsTags[0].toUpperCase() !== EXPECTED_GA4_ID) {
    findings.push(`GA4 measurement mismatch ${analyticsTags[0]}`);
  }
  if (!jsonLd.length) findings.push("missing JSON-LD");
  for (const item of jsonLd) {
    if (!item.ok) findings.push(`invalid JSON-LD ${item.index + 1}: ${item.error}`);
  }

  const pathName = new URL(entry.loc).pathname;
  findings.push(...structuredDataFindings({
    html,
    pathName,
    canonical,
    siteOrigin: new URL(entry.loc).origin,
    jsonLd
  }));
  if (pathName.endsWith("-escort")) {
    const keywordSurface = `${title} ${description} ${h1.join(" ")}`.toLocaleLowerCase("tr");
    if (!keywordSurface.includes("escort")) findings.push("landing keyword missing escort");
  }

  return {
    url: entry.loc,
    ok: findings.length === 0,
    status: result.status,
    final_url: result.final_url,
    content_type: result.content_type,
    title,
    title_length: title.length,
    description_length: description.length,
    canonical,
    h1,
    json_ld_types: jsonLd.flatMap((item) => item.types),
    findings
  };
}

function addDuplicateFindings(pages) {
  const duplicateFields = [
    ["title", "duplicate title"],
    ["description", "duplicate description"]
  ];

  for (const [field, label] of duplicateFields) {
    const groups = new Map();
    for (const page of pages) {
      const value = field === "description"
        ? String(page.description_text || "")
        : String(page.title || "");
      const key = value.trim().toLocaleLowerCase("tr");
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(page);
    }

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const page of group) {
        page.findings.push(`${label} (${group.length} URLs)`);
        page.ok = false;
      }
    }
  }
}

function sitemapShapeFindings(entries, siteUrl) {
  const findings = [];
  const locs = entries.map((entry) => normalizeComparableUrl(entry.loc));
  const unique = new Set(locs);
  const expectedHome = normalizeComparableUrl(`${siteUrl}/`);
  const expectedIstanbul = normalizeComparableUrl(`${siteUrl}/istanbul-escort`);
  const profileSlugs = entries
    .map((entry) => {
      const pathname = new URL(entry.loc).pathname;
      if (!pathname.startsWith("/profil/")) return "";
      const slug = decodeURIComponent(pathname.slice("/profil/".length)).trim();
      return slug && !slug.includes("/") ? slug : "";
    })
    .filter(Boolean);
  if (!entries.length) findings.push("empty sitemap");
  if (unique.size !== entries.length) findings.push(`duplicate sitemap URLs ${entries.length - unique.size}`);
  if (!locs.includes(expectedHome)) findings.push("missing home URL");
  if (!locs.includes(expectedIstanbul)) findings.push("missing istanbul-escort URL");
  const districtCount = locs.filter((url) => /\/[a-z0-9-]+-escort$/i.test(new URL(url).pathname)).length;
  if (strict && STRICT_ESCORT_LANDING_COUNT !== null && districtCount !== STRICT_ESCORT_LANDING_COUNT) {
    findings.push(`escort landing count ${districtCount}, expected ${STRICT_ESCORT_LANDING_COUNT}`);
  }
  if (strict && STRICT_SITEMAP_URL_COUNT !== null && entries.length !== STRICT_SITEMAP_URL_COUNT) {
    findings.push(`sitemap URL count ${entries.length}, expected ${STRICT_SITEMAP_URL_COUNT}`);
  }
  if (strict && STRICT_PROFILE_URL_COUNT !== null && profileSlugs.length !== STRICT_PROFILE_URL_COUNT) {
    findings.push(`profile URL count ${profileSlugs.length}, expected ${STRICT_PROFILE_URL_COUNT}`);
  }
  if (strict && entries.length !== districtCount + profileSlugs.length + STRICT_STATIC_URL_COUNT) {
    findings.push(
      `sitemap shape ${entries.length}, expected ${districtCount} landings + ${profileSlugs.length} profiles + ${STRICT_STATIC_URL_COUNT} static URLs`
    );
  }
  if (strict) {
    const missingRequiredProfiles = REQUIRED_PROFILE_SLUGS.filter((slug) => !profileSlugs.includes(slug));
    if (missingRequiredProfiles.length) {
      findings.push(`missing required profile URLs: ${missingRequiredProfiles.join(", ")}`);
    }
  }
  return findings;
}

async function main() {
  const siteUrl = normalizeSiteUrl(argValue("--site", process.env.LIVE_SITE_URL || DEFAULT_SITE_URL));
  const fetchOrigin = normalizeSiteUrl(argValue("--fetch-origin", siteUrl));
  const sitemapPath = argValue("--sitemap", DEFAULT_SITEMAP);
  const sitemapUrl = absoluteUrl(siteUrl, sitemapPath);
  const sitemapFetchUrl = absoluteUrl(fetchOrigin, sitemapPath);
  const concurrency = Number(argValue("--concurrency", "6")) || 6;
  const max = Number(argValue("--max", "0")) || 0;
  if (strict && max > 0) {
    throw new Error("strict audit must inspect the complete sitemap; remove --max");
  }

  const sitemapResponse = await fetchText(sitemapFetchUrl);
  const sitemapEntries = parseSitemap(sitemapResponse.text, siteUrl);
  const selectedEntries = max > 0 ? sitemapEntries.slice(0, max) : sitemapEntries;
  const sitemapFindings = sitemapShapeFindings(sitemapEntries, siteUrl);

  const pages = await mapLimit(selectedEntries, concurrency, async (entry) => {
    try {
      const entryUrl = new URL(entry.loc);
      const fetchUrl = `${fetchOrigin}${entryUrl.pathname}${entryUrl.search}`;
      const fetched = await fetchText(fetchUrl);
      const fetchedFinalUrl = new URL(fetched.final_url);
      const result = {
        ...fetched,
        final_url: `${siteUrl}${fetchedFinalUrl.pathname}${fetchedFinalUrl.search}`
      };
      const report = auditHtml(entry, result);
      report.description_text = metaContent(result.text || "", "name", "description");
      return report;
    } catch (error) {
      return {
        url: entry.loc,
        ok: false,
        status: 0,
        final_url: entry.loc,
        title: "",
        title_length: 0,
        description_length: 0,
        canonical: "",
        h1: [],
        json_ld_types: [],
        findings: [error.message || "fetch failed"]
      };
    }
  });

  addDuplicateFindings(pages);
  for (const page of pages) delete page.description_text;

  const failing = pages.filter((page) => !page.ok);
  const report = {
    ok: sitemapResponse.ok && sitemapFindings.length === 0 && failing.length === 0,
    strict,
    site_url: siteUrl,
    fetch_origin: fetchOrigin,
    sitemap_url: sitemapUrl,
    checked_at: new Date().toISOString(),
    sitemap: {
      ok: sitemapResponse.ok && sitemapFindings.length === 0,
      status: sitemapResponse.status,
      url_count: sitemapEntries.length,
      checked_url_count: selectedEntries.length,
      findings: sitemapFindings
    },
    failing_count: failing.length,
    failing: failing.map((page) => ({
      url: page.url,
      status: page.status,
      findings: page.findings
    })),
    pages
  };

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`site=${report.site_url}`);
    console.log(`fetch_origin=${report.fetch_origin}`);
    console.log(`ok=${report.ok}`);
    console.log(`sitemap_status=${report.sitemap.status}`);
    console.log(`sitemap_urls=${report.sitemap.url_count}`);
    console.log(`checked_urls=${report.sitemap.checked_url_count}`);
    console.log(`failing_count=${report.failing_count}`);
    if (report.sitemap.findings.length) {
      console.log(`sitemap_findings=${report.sitemap.findings.join("; ")}`);
    }
    for (const page of failing.slice(0, 40)) {
      console.log(`warn ${page.url} status=${page.status} findings=${page.findings.join("; ")}`);
    }
    if (failing.length > 40) {
      console.log(`warn showing 40/${failing.length} failing URLs`);
    }
  }

  if (strict && !report.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
