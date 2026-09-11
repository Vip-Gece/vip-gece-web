"use strict";

const crypto = require("crypto");
const fs = require("fs");
const { SITE_URL } = require("../config/env");
const { buildSitemapXml } = require("./sitemapService");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const WEBMASTERS_BASE_URL = "https://www.googleapis.com/webmasters/v3";
const URL_INSPECTION_ENDPOINT = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const WEBMASTERS_SCOPE = "https://www.googleapis.com/auth/webmasters";
const READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const DEFAULT_GOOGLE_TIMEOUT_MS = 25000;
const DEFAULT_INSPECTION_ATTEMPTS = 3;
const DEFAULT_INSPECTION_RETRY_BASE_DELAY_MS = 750;

const DEFAULT_DISCOVERY_PATHS = [
  "/",
  "/istanbul-escort",
  "/kategoriler",
  "/ilanlar",
  "/sisli-escort",
  "/vip-escort",
  "/esmer-escort",
  "/sarisin-escort",
  "/kumral-escort",
  "/zayif-escort",
  "/balik-etli-escort",
  "/kapali-escort"
];

let tokenCache = {
  cacheKey: "",
  accessToken: "",
  expiresAt: 0
};

function clean(value) {
  return String(value || "").trim();
}

function envValue(...names) {
  for (const name of names) {
    const value = clean(process.env[name]);
    if (value) return value;
  }
  return "";
}

function envEnabled(...names) {
  return names.some((name) => ["1", "true", "yes", "on"].includes(clean(process.env[name]).toLowerCase()));
}

function boundedNumber(value, fallback, min, max) {
  const raw = clean(value);
  if (!raw) return fallback;
  const number = Number(raw);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function googleTimeoutMs() {
  return boundedNumber(
    envValue("GOOGLE_SEARCH_CONSOLE_TIMEOUT_MS", "GSC_TIMEOUT_MS"),
    DEFAULT_GOOGLE_TIMEOUT_MS,
    5000,
    60000
  );
}

function inspectionAttempts(options = {}) {
  return boundedNumber(
    options.inspectionAttempts ||
      options.inspection_attempts ||
      envValue("GOOGLE_SEARCH_CONSOLE_INSPECTION_ATTEMPTS", "GSC_INSPECTION_ATTEMPTS"),
    DEFAULT_INSPECTION_ATTEMPTS,
    1,
    4
  );
}

function inspectionRetryBaseDelayMs(options = {}) {
  return boundedNumber(
    options.inspectionRetryBaseDelayMs ||
      options.inspection_retry_base_delay_ms ||
      envValue(
        "GOOGLE_SEARCH_CONSOLE_INSPECTION_RETRY_BASE_DELAY_MS",
        "GSC_INSPECTION_RETRY_BASE_DELAY_MS"
      ),
    DEFAULT_INSPECTION_RETRY_BASE_DELAY_MS,
    0,
    5000
  );
}

function retryableGoogleError(error) {
  const status = Number(error?.googleStatus || error?.statusCode || 0);
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

async function wait(milliseconds) {
  if (milliseconds <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = googleTimeoutMs()) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Google API request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function siteOrigin() {
  try {
    return new URL(SITE_URL).origin;
  } catch {
    return "https://vip-gece.site";
  }
}

function defaultSearchConsoleSiteUrl() {
  try {
    const host = new URL(SITE_URL).hostname.replace(/^www\./i, "");
    return `sc-domain:${host}`;
  } catch {
    return "sc-domain:vip-gece.site";
  }
}

function normalizeSearchConsoleSiteUrl(value = "") {
  const raw = clean(value) || defaultSearchConsoleSiteUrl();
  if (/^sc-domain:[a-z0-9.-]+$/i.test(raw)) return raw.toLowerCase();

  const parsed = new URL(raw);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("GSC site URL must use http, https, or sc-domain");
  }
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
  return parsed.toString();
}

function normalizePrivateKey(value = "") {
  const raw = clean(value);
  if (!raw) return "";
  return raw.replace(/\\n/g, "\n");
}

function parseCredentialJson(raw = "") {
  if (!clean(raw)) return null;
  const parsed = JSON.parse(raw);

  if (parsed.type === "authorized_user" || parsed.refresh_token) {
    return {
      type: "authorized_user",
      client_id: clean(parsed.client_id),
      client_secret: clean(parsed.client_secret),
      refresh_token: clean(parsed.refresh_token),
      quota_project_id: clean(parsed.quota_project_id)
    };
  }

  return {
    type: "service_account",
    client_email: clean(parsed.client_email),
    private_key: normalizePrivateKey(parsed.private_key)
  };
}

function parseServiceAccountJson(raw = "") {
  const parsed = parseCredentialJson(raw);
  if (!parsed) return null;
  if (parsed.type !== "service_account") {
    throw new Error("GSC credential JSON is not a service account");
  }
  return parsed;
}

function readJsonFile(filePath = "") {
  const target = clean(filePath);
  if (!target) return null;
  return parseCredentialJson(fs.readFileSync(target, "utf8"));
}

function readPrivateKeyFile(filePath = "") {
  const target = clean(filePath);
  if (!target) return "";
  return normalizePrivateKey(fs.readFileSync(target, "utf8"));
}

function loadSearchConsoleCredentials() {
  const jsonEnv = envValue(
    "GOOGLE_SEARCH_CONSOLE_CREDENTIAL_JSON",
    "GSC_CREDENTIAL_JSON",
    "GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON",
    "GSC_SERVICE_ACCOUNT_JSON"
  );
  if (jsonEnv) {
    const parsed = parseCredentialJson(jsonEnv);
    return { ...parsed, source: `${parsed.type}_json_env` };
  }

  const jsonPath = envValue(
    "GOOGLE_SEARCH_CONSOLE_CREDENTIAL_JSON_PATH",
    "GSC_CREDENTIAL_JSON_PATH",
    "GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON_PATH",
    "GSC_SERVICE_ACCOUNT_JSON_PATH",
    "GOOGLE_APPLICATION_CREDENTIALS"
  );
  if (jsonPath) {
    const parsed = readJsonFile(jsonPath);
    return { ...parsed, source: `${parsed.type}_json_file` };
  }

  const clientEmail = envValue("GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL", "GSC_CLIENT_EMAIL");
  const privateKey = normalizePrivateKey(envValue("GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY", "GSC_PRIVATE_KEY")) ||
    readPrivateKeyFile(envValue("GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY_PATH", "GSC_PRIVATE_KEY_PATH"));

  if (clientEmail || privateKey) {
    return {
      type: "service_account",
      client_email: clientEmail,
      private_key: privateKey,
      source: privateKey ? "inline_service_account_pair" : "incomplete_service_account_pair"
    };
  }

  return { type: "missing", client_email: "", private_key: "", source: "missing" };
}

function credentialStatus(credentials = loadSearchConsoleCredentials()) {
  return {
    type: credentials.type || "missing",
    source: credentials.source || "missing",
    has_client_email: Boolean(credentials.client_email),
    has_private_key: Boolean(credentials.private_key),
    has_client_id: Boolean(credentials.client_id),
    has_client_secret: Boolean(credentials.client_secret),
    has_refresh_token: Boolean(credentials.refresh_token)
  };
}

function safeCredentialState() {
  try {
    return {
      credentials: loadSearchConsoleCredentials(),
      error: ""
    };
  } catch {
    return {
      credentials: { type: "invalid", client_email: "", private_key: "", source: "invalid" },
      error: "invalid_or_unreadable"
    };
  }
}

function isCredentialConfigured(credentials = loadSearchConsoleCredentials()) {
  if (credentials.type === "authorized_user") {
    return Boolean(credentials.client_id && credentials.client_secret && credentials.refresh_token);
  }

  return Boolean(credentials.client_email && credentials.private_key);
}

function isConfigured() {
  const { credentials, error } = safeCredentialState();
  return !error && isCredentialConfigured(credentials);
}

function searchConsoleStatus() {
  const enabled = envEnabled("GOOGLE_SEARCH_CONSOLE_ENABLED", "GSC_ENABLED");
  const { credentials, error: credentialError } = safeCredentialState();
  const configured = !credentialError && isCredentialConfigured(credentials);
  let siteUrl = defaultSearchConsoleSiteUrl();
  let siteUrlError = "";

  try {
    siteUrl = normalizeSearchConsoleSiteUrl(envValue("GOOGLE_SEARCH_CONSOLE_SITE_URL", "GSC_SITE_URL"));
  } catch {
    siteUrlError = "invalid_site_url";
  }

  return {
    ok: true,
    configured,
    enabled,
    provider: "google_search_console",
    mode: configured && enabled ? "configured" : "standby",
    site_url: siteUrl,
    credential: {
      ...credentialStatus(credentials),
      ...(credentialError ? { error: credentialError } : {})
    },
    ...(siteUrlError ? { site_url_error: siteUrlError } : {}),
    actions: {
      sitemap_submit: configured && enabled,
      url_inspection: configured && enabled,
      search_analytics: configured && enabled
    },
    next_action: configured
      ? (enabled
        ? "GSC credentials are configured; live access is proven only by a successful Google API action."
        : "Set GOOGLE_SEARCH_CONSOLE_ENABLED=true to allow sync/inspect actions.")
      : "Add a Search Console credential with vip-gece.site property access."
  };
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createJwt(credentials, scope = WEBMASTERS_SCOPE, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: credentials.client_email,
    scope,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(credentials.private_key);

  return `${unsigned}.${base64Url(signature)}`;
}

async function getAccessToken(scope = WEBMASTERS_SCOPE) {
  const credentials = loadSearchConsoleCredentials();
  if (!isCredentialConfigured(credentials)) {
    throw new Error("Google Search Console credentials are not configured.");
  }

  const cacheKey = `${credentials.type}:${credentials.client_email || credentials.client_id}:${scope}`;
  if (tokenCache.cacheKey === cacheKey && tokenCache.accessToken && tokenCache.expiresAt > Date.now() + 60000) {
    return tokenCache.accessToken;
  }

  let requestBody;
  if (credentials.type === "authorized_user") {
    requestBody = new URLSearchParams({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      refresh_token: credentials.refresh_token,
      grant_type: "refresh_token"
    });
  } else {
    const assertion = createJwt(credentials, scope);
    requestBody = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    });
  }

  const response = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: requestBody
  });

  const body = await parseGoogleResponse(response);
  if (!response.ok) {
    throw new Error(`Google OAuth token request failed: ${body.error || response.status}`);
  }

  tokenCache = {
    cacheKey,
    accessToken: body.access_token,
    expiresAt: Date.now() + Math.max(60, Number(body.expires_in || 3600) - 60) * 1000
  };

  return tokenCache.accessToken;
}

async function parseGoogleResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 600) };
  }
}

function ensureActive() {
  const status = searchConsoleStatus();
  if (!status.configured || !status.enabled) {
    const error = new Error(status.next_action);
    error.statusCode = 503;
    error.status = status;
    throw error;
  }
  return status;
}

async function googleRequest(url, options = {}) {
  const credentials = loadSearchConsoleCredentials();
  const token = await getAccessToken(options.scope || WEBMASTERS_SCOPE);
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    ...(options.headers || {})
  };

  if (credentials.type === "authorized_user" && credentials.quota_project_id && !headers["x-goog-user-project"]) {
    headers["x-goog-user-project"] = credentials.quota_project_id;
  }

  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetchWithTimeout(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await parseGoogleResponse(response);

  if (!response.ok) {
    const message = body?.error?.message || body?.error || `Google API request failed with ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status >= 500 ? 502 : response.status;
    error.googleStatus = response.status;
    error.googleError = body?.error || body;
    throw error;
  }

  return body;
}

function encodePathParam(value) {
  return encodeURIComponent(value);
}

function buildSitemapsListUrl(siteUrl = normalizeSearchConsoleSiteUrl()) {
  return `${WEBMASTERS_BASE_URL}/sites/${encodePathParam(siteUrl)}/sitemaps`;
}

function buildSitemapSubmitUrl(siteUrl, sitemapUrl) {
  return `${WEBMASTERS_BASE_URL}/sites/${encodePathParam(siteUrl)}/sitemaps/${encodePathParam(sitemapUrl)}`;
}

function absoluteSiteUrl(value = "") {
  const raw = clean(value);
  if (!raw) return siteOrigin();
  return new URL(raw, `${siteOrigin()}/`).toString();
}

function defaultSitemapUrls() {
  return [
    absoluteSiteUrl("/sitemap.xml"),
    absoluteSiteUrl("/image-sitemap.xml")
  ];
}

function normalizeStringList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return clean(value)
    .split(",")
    .map(clean)
    .filter(Boolean);
}

function normalizeUrlList(value, fallback = []) {
  const rows = normalizeStringList(value);
  const source = rows.length ? rows : fallback;
  const origin = siteOrigin();
  return [...new Set(source.map((item) => absoluteSiteUrl(item)).filter((url) => url.startsWith(origin)))];
}

function defaultInspectionUrls() {
  return DEFAULT_DISCOVERY_PATHS.map((item) => absoluteSiteUrl(item));
}

function decodeXmlText(value = "") {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractSitemapLocs(xml = "") {
  return [...String(xml || "").matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
    .map((match) => decodeXmlText(match[1]).trim())
    .filter(Boolean);
}

async function sitemapInspectionUrls() {
  const { getSeoProfiles } = require("../data/profilesRepo");
  const xml = buildSitemapXml(await getSeoProfiles());
  return normalizeUrlList(extractSitemapLocs(xml), []);
}

async function listSitemaps() {
  const status = ensureActive();
  const body = await googleRequest(buildSitemapsListUrl(status.site_url), { scope: READONLY_SCOPE });
  return {
    ok: true,
    site_url: status.site_url,
    sitemap: body.sitemap || [],
    google: searchConsoleStatus()
  };
}

async function submitSitemap(sitemapUrl) {
  const status = ensureActive();
  const target = absoluteSiteUrl(sitemapUrl || "/sitemap.xml");
  await googleRequest(buildSitemapSubmitUrl(status.site_url, target), {
    method: "PUT",
    body: null,
    scope: WEBMASTERS_SCOPE
  });

  return {
    ok: true,
    submitted: target,
    site_url: status.site_url
  };
}

async function submitSitemaps(sitemaps) {
  const targets = normalizeUrlList(sitemaps, defaultSitemapUrls());
  const submitted = [];

  for (const sitemapUrl of targets) {
    submitted.push(await submitSitemap(sitemapUrl));
  }

  return {
    ok: true,
    submitted: submitted.map((item) => item.submitted),
    count: submitted.length
  };
}

async function inspectUrl(inspectionUrl, options = {}) {
  const status = ensureActive();
  const target = absoluteSiteUrl(inspectionUrl);
  const attempts = inspectionAttempts(options);
  const retryBaseDelayMs = inspectionRetryBaseDelayMs(options);
  let body;
  let successfulAttempt = 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      body = await googleRequest(URL_INSPECTION_ENDPOINT, {
        method: "POST",
        scope: READONLY_SCOPE,
        body: {
          inspectionUrl: target,
          siteUrl: status.site_url,
          languageCode: clean(options.languageCode || options.language_code || "tr-TR")
        }
      });
      successfulAttempt = attempt;
      break;
    } catch (error) {
      error.inspectionAttempts = attempt;
      if (attempt >= attempts || !retryableGoogleError(error)) throw error;
      await wait(Math.min(5000, retryBaseDelayMs * (2 ** (attempt - 1))));
    }
  }

  const result = body.inspectionResult || {};
  const indexStatus = result.indexStatusResult || {};

  return {
    ok: true,
    inspection_url: target,
    inspection_attempts: successfulAttempt,
    site_url: status.site_url,
    verdict: indexStatus.verdict || "",
    coverage_state: indexStatus.coverageState || "",
    robots_txt_state: indexStatus.robotsTxtState || "",
    indexing_state: indexStatus.indexingState || "",
    last_crawl_time: indexStatus.lastCrawlTime || "",
    page_fetch_state: indexStatus.pageFetchState || "",
    google_canonical: indexStatus.googleCanonical || "",
    user_canonical: indexStatus.userCanonical || "",
    raw: result
  };
}

function isoDate(daysAgo) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function validDate(value, fallback) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function normalizeDimensions(value) {
  const allowed = new Set(["query", "page", "country", "device", "date", "searchAppearance"]);
  const rows = normalizeStringList(value);
  const selected = rows.filter((item) => allowed.has(item));
  return selected.length ? selected : ["query", "page"];
}

async function querySearchAnalytics(input = {}) {
  const status = ensureActive();
  const siteUrl = status.site_url;
  const endDate = validDate(input.endDate || input.end_date, isoDate(2));
  const startDate = validDate(input.startDate || input.start_date, isoDate(32));
  const rowLimit = Math.min(25000, Math.max(1, Number(input.rowLimit || input.row_limit || 100)));
  const dimensions = normalizeDimensions(input.dimensions);
  const requestBody = {
    startDate,
    endDate,
    dimensions,
    rowLimit,
    searchType: clean(input.searchType || input.search_type || "web")
  };

  if (input.dimensionFilterGroups && Array.isArray(input.dimensionFilterGroups)) {
    requestBody.dimensionFilterGroups = input.dimensionFilterGroups;
  }

  const body = await googleRequest(`${WEBMASTERS_BASE_URL}/sites/${encodePathParam(siteUrl)}/searchAnalytics/query`, {
    method: "POST",
    scope: READONLY_SCOPE,
    body: requestBody
  });

  return {
    ok: true,
    site_url: siteUrl,
    request: requestBody,
    rows: body.rows || []
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

async function runDiscoverySync(input = {}) {
  const sitemapResult = await submitSitemaps(input.sitemaps);
  const inspectAllSitemapUrls = input.inspectAllSitemapUrls === true ||
    input.inspect_all_sitemap_urls === true ||
    input.all === true;
  const allowExtendedInspectionLimit = input.allowExtendedInspectionLimit === true ||
    input.allow_extended_inspection_limit === true;
  const inspect = input.inspect === false
    ? []
    : (inspectAllSitemapUrls ? await sitemapInspectionUrls() : normalizeUrlList(input.urls, defaultInspectionUrls()));
  const defaultLimit = inspectAllSitemapUrls ? inspect.length : 20;
  const hardLimit = inspectAllSitemapUrls || allowExtendedInspectionLimit ? 300 : 50;
  const inspectLimit = Math.max(1, Math.min(hardLimit, Number(input.inspectLimit || input.inspect_limit || defaultLimit)));
  const inspectConcurrency = boundedNumber(
    input.inspectConcurrency || input.inspect_concurrency || envValue("GOOGLE_SEARCH_CONSOLE_INSPECT_CONCURRENCY", "GSC_INSPECT_CONCURRENCY"),
    inspectAllSitemapUrls ? 4 : 2,
    1,
    8
  );
  const inspectTargets = inspect.slice(0, inspectLimit);

  const inspections = await mapWithConcurrency(inspectTargets, inspectConcurrency, async (url) => {
    try {
      return await inspectUrl(url, input);
    } catch (err) {
      return {
        ok: false,
        inspection_url: url,
        inspection_attempts: err.inspectionAttempts || 1,
        error: err.message,
        google_status: err.googleStatus || 0
      };
    }
  });

  return {
    ok: inspections.every((item) => item.ok !== false),
    submitted_sitemaps: sitemapResult.submitted,
    inspection_source: inspectAllSitemapUrls
      ? "generated_sitemap"
      : (normalizeStringList(input.urls).length ? "explicit_urls" : "default_priority_urls"),
    inspection_requested_count: inspect.length,
    inspection_limit: inspectLimit,
    inspection_concurrency: inspectConcurrency,
    inspected_urls: inspections,
    google: searchConsoleStatus()
  };
}

function publicFastDiscoveryPlan() {
  return {
    allowed: [
      "Submit sitemap.xml and image-sitemap.xml through Search Console API",
      "Inspect changed canonical URLs after deploy",
      "Track query/page/date performance through Search Analytics",
      "Keep internal links, canonicals, robots, sitemap lastmod, and cache state clean"
    ],
    avoided: [
      "Cloaking",
      "doorway/spam pages",
      "link schemes",
      "Indexing API abuse for non-JobPosting/non-BroadcastEvent pages"
    ],
    default_inspection_urls: defaultInspectionUrls()
  };
}

module.exports = {
  WEBMASTERS_SCOPE,
  READONLY_SCOPE,
  buildSitemapSubmitUrl,
  buildSitemapsListUrl,
  createJwt,
  defaultInspectionUrls,
  defaultSitemapUrls,
  extractSitemapLocs,
  isConfigured,
  listSitemaps,
  normalizeSearchConsoleSiteUrl,
  publicFastDiscoveryPlan,
  querySearchAnalytics,
  runDiscoverySync,
  searchConsoleStatus,
  submitSitemap,
  submitSitemaps,
  inspectUrl
};
