const MODE = process.env.ENV_CONTRACT_MODE || "local";
const PROD_HOSTS = new Set(["vip-gece.site", "www.vip-gece.site"]);

const findings = [];

function value(name) {
  return String(process.env[name] || "").trim();
}

function fail(message) {
  findings.push(message);
}

function ok(message) {
  console.log(`ok ${message}`);
}

function parseList(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function validatePort() {
  const raw = value("PORT") || "3105";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail("PORT must be an integer between 1 and 65535");
    return;
  }
  ok("PORT shape");
}

function validateSiteUrl() {
  const raw = value("SITE_URL") || "http://127.0.0.1:3105";

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail("SITE_URL must be a valid URL");
    return;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    fail("SITE_URL must use http or https");
  }

  if (MODE === "staging" && PROD_HOSTS.has(parsed.hostname.toLowerCase())) {
    fail("SITE_URL must not point at production host in staging mode");
  }

  ok("SITE_URL shape");
}

function validateSupabase() {
  const url = value("SUPABASE_URL");
  const anon = value("SUPABASE_ANON_KEY");
  const serviceRole = value("SUPABASE_SERVICE_ROLE_KEY");
  const databaseUrl = value("DATABASE_URL");

  if (MODE === "local" && !url && !anon) {
    ok("Supabase env absent for local demo fallback");
    return;
  }

  if (!url || !anon) {
    fail("SUPABASE_URL and SUPABASE_ANON_KEY must be set together");
    return;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail("SUPABASE_URL must be a valid URL");
    return;
  }

  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co")) {
    fail("SUPABASE_URL must be an https supabase.co URL");
  }

  if (anon.length < 16) {
    fail("SUPABASE_ANON_KEY must not be empty or placeholder-short");
  }

  if (MODE === "staging" && serviceRole.length < 16 && !databaseUrl) {
    fail("SUPABASE_SERVICE_ROLE_KEY or DATABASE_URL must be set server-side for private customer data");
  }

  ok("Supabase env shape");
}

function validateAdminAuth() {
  const hasPublicSupabase = Boolean(value("SUPABASE_URL") || value("SUPABASE_ANON_KEY"));
  const adminEmails = parseList(value("ADMIN_EMAILS"));

  if (MODE === "local" && !hasPublicSupabase && !adminEmails.length) {
    ok("Admin auth absent for local demo fallback");
    return;
  }

  if ((MODE === "staging" || hasPublicSupabase) && !adminEmails.length) {
    fail("ADMIN_EMAILS must include at least one admin email when Supabase auth is enabled");
    return;
  }

  const invalidEmail = adminEmails.find((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (invalidEmail) {
    fail("ADMIN_EMAILS entries must be email addresses");
    return;
  }

  ok("Admin auth allowlist shape");
}

function validatePrivatePanels() {
  if (MODE === "local") {
    ok("Private panel edge gate optional for local mode");
    return;
  }

  if (value("VIP_GECE_PRIVATE_PANELS_ENABLED").toLowerCase() !== "true") {
    fail("VIP_GECE_PRIVATE_PANELS_ENABLED must be true outside local mode");
    return;
  }

  const hosts = parseList(value("VIP_GECE_PRIVATE_PANEL_HOSTS"))
    .map((host) => host.toLowerCase());
  const publicHosts = new Set([
    "vip-gece.site",
    "www.vip-gece.site",
    "vip-gece.online",
    "www.vip-gece.online",
    "vip-gece.com",
    "www.vip-gece.com"
  ]);

  if (!hosts.includes("127.0.0.1")) {
    fail("VIP_GECE_PRIVATE_PANEL_HOSTS must include 127.0.0.1 for the SSH-loopback listener");
    return;
  }

  if (hosts.some((host) => publicHosts.has(host))) {
    fail("VIP_GECE_PRIVATE_PANEL_HOSTS must not include a public VIP GECE hostname");
    return;
  }

  if (value("VIP_GECE_PRIVATE_PANEL_MODE").toLowerCase() !== "loopback-secret") {
    fail("VIP_GECE_PRIVATE_PANEL_MODE must be loopback-secret outside local mode");
    return;
  }

  const secret = value("VIP_GECE_PRIVATE_PANEL_SECRET");
  if (secret.length < 32) {
    fail("VIP_GECE_PRIVATE_PANEL_SECRET must contain at least 32 characters outside local mode");
    return;
  }

  if (
    secret === value("CUSTOMER_ACCESS_SESSION_SECRET") ||
    secret === value("ANALYTICS_EVENT_PROOF_SECRET")
  ) {
    fail("VIP_GECE_PRIVATE_PANEL_SECRET must be independent from session and analytics secrets");
    return;
  }

  ok("Private panel SSH-loopback gate");
}

function validateCustomerSessionSecret() {
  const secret = value("CUSTOMER_ACCESS_SESSION_SECRET");

  if (MODE === "local" && !secret) {
    ok("Customer session secret uses local ephemeral fallback");
    return;
  }

  if (secret.length < 32) {
    fail("CUSTOMER_ACCESS_SESSION_SECRET must contain at least 32 characters outside local mode");
    return;
  }

  ok("Customer session secret shape");
}

function validateAnalyticsEventProofSecret() {
  const secret = value("ANALYTICS_EVENT_PROOF_SECRET");
  const customerSecret = value("CUSTOMER_ACCESS_SESSION_SECRET");

  if (MODE === "local" && !secret) {
    ok("Analytics event proof secret uses local ephemeral fallback");
    return;
  }

  if (secret.length < 32) {
    fail("ANALYTICS_EVENT_PROOF_SECRET must contain at least 32 characters outside local mode");
    return;
  }

  if (customerSecret && secret === customerSecret) {
    fail("ANALYTICS_EVENT_PROOF_SECRET must be independent from CUSTOMER_ACCESS_SESSION_SECRET");
    return;
  }

  ok("Analytics event proof secret shape");
}

function validateGoogleSearchConsole() {
  const enabled = ["GOOGLE_SEARCH_CONSOLE_ENABLED", "GSC_ENABLED"]
    .some((name) => ["1", "true", "yes", "on"].includes(value(name).toLowerCase()));

  if (!enabled) {
    ok("Google Search Console optional");
    return;
  }

  const siteUrl = value("GOOGLE_SEARCH_CONSOLE_SITE_URL") || value("GSC_SITE_URL") || "";
  if (siteUrl) {
    if (!/^sc-domain:[a-z0-9.-]+$/i.test(siteUrl)) {
      try {
        const parsed = new URL(siteUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          fail("Google Search Console site URL must use http, https, or sc-domain");
          return;
        }
      } catch {
        fail("Google Search Console site URL must be a valid URL or sc-domain property");
        return;
      }
    }
  }

  const hasJson = Boolean(
    value("GOOGLE_SEARCH_CONSOLE_CREDENTIAL_JSON") ||
    value("GSC_CREDENTIAL_JSON") ||
    value("GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON") ||
    value("GSC_SERVICE_ACCOUNT_JSON")
  );
  const hasJsonPath = Boolean(
    value("GOOGLE_SEARCH_CONSOLE_CREDENTIAL_JSON_PATH") ||
    value("GSC_CREDENTIAL_JSON_PATH") ||
    value("GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON_PATH") ||
    value("GSC_SERVICE_ACCOUNT_JSON_PATH") ||
    value("GOOGLE_APPLICATION_CREDENTIALS")
  );
  const hasPair = Boolean((value("GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL") || value("GSC_CLIENT_EMAIL")) &&
    (value("GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY") || value("GSC_PRIVATE_KEY") || value("GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY_PATH") || value("GSC_PRIVATE_KEY_PATH")));

  if (!hasJson && !hasJsonPath && !hasPair) {
    fail("Google Search Console enabled requires credential JSON, JSON path, or client email/private key env");
    return;
  }

  ok("Google Search Console env shape");
}

function validateIndexNow() {
  const enabled = ["1", "true", "yes", "on"].includes(value("INDEXNOW_ENABLED").toLowerCase());
  const key = value("INDEXNOW_KEY");

  if (!enabled) {
    ok("IndexNow optional");
    return;
  }

  if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) {
    fail("INDEXNOW_ENABLED requires an 8-128 character alphanumeric/dash INDEXNOW_KEY");
    return;
  }

  ok("IndexNow env shape");
}

validatePort();
validateSiteUrl();
validateSupabase();
validateAdminAuth();
validatePrivatePanels();
validateCustomerSessionSecret();
validateAnalyticsEventProofSecret();
validateGoogleSearchConsole();
validateIndexNow();

if (!["local", "staging"].includes(MODE)) {
  fail("ENV_CONTRACT_MODE must be local or staging");
}

if (findings.length) {
  for (const finding of findings) {
    console.log(`fail ${finding}`);
  }
  process.exitCode = 1;
} else {
  ok(`${MODE} env contract`);
}
