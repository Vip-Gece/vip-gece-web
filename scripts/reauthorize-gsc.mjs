import crypto from "node:crypto";
import http from "node:http";
import { chmod, copyFile, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const WEBMASTERS_SCOPE = "https://www.googleapis.com/auth/webmasters";
const DEFAULT_CREDENTIAL = "/var/lib/vip-gece/google-search-console-credential.json";
const DEFAULT_SITE_URL = "sc-domain:vip-gece.site";

const args = new Map(
  process.argv.slice(2).map((value) => {
    const [key, ...rest] = value.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  })
);

const credentialPath = path.resolve(args.get("credential") || DEFAULT_CREDENTIAL);
const siteUrl = args.get("site") || DEFAULT_SITE_URL;
const requestedQuotaProject = args.get("quota-project") ||
  process.env.GOOGLE_SEARCH_CONSOLE_QUOTA_PROJECT ||
  "";
const port = Math.max(1024, Math.min(65535, Number(args.get("port") || 53682)));
const timeoutMs = Math.max(60_000, Math.min(15 * 60_000, Number(args.get("timeout-ms") || 600_000)));
const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

if (
  requestedQuotaProject &&
  !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(requestedQuotaProject)
) {
  throw new Error("Google Cloud quota project ID geçersiz.");
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function html(message) {
  return `<!doctype html><meta charset="utf-8"><title>VIP Gece Google Yetkisi</title><body><h1>${message}</h1><p>Bu sekmeyi kapatabilirsiniz.</p></body>`;
}

async function googleJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};

  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  if (!response.ok) {
    const message = body?.error_description || body?.error?.message || body?.error || `HTTP ${response.status}`;
    throw new Error(`Google OAuth başarısız: ${message}`);
  }

  return body;
}

async function writeCredentialAtomically(current, refreshToken, quotaProjectId) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T").replace("Z", "Z");
  const backupPath = `${credentialPath}.backup-${stamp}`;
  const tempPath = `${credentialPath}.tmp-${process.pid}`;
  const next = {
    type: "authorized_user",
    client_id: current.client_id,
    client_secret: current.client_secret,
    refresh_token: refreshToken,
    ...(quotaProjectId ? { quota_project_id: quotaProjectId } : {})
  };

  await copyFile(credentialPath, backupPath);
  await chmod(backupPath, 0o600);
  await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await chmod(tempPath, 0o600);
  await rename(tempPath, credentialPath);
  await chmod(credentialPath, 0o600);
  return backupPath;
}

const current = JSON.parse(await readFile(credentialPath, "utf8"));
if (!current.client_id || !current.client_secret || !current.refresh_token) {
  throw new Error("Mevcut credential authorized_user biçiminde değil.");
}
const quotaProjectId = requestedQuotaProject || current.quota_project_id || "";

const state = base64Url(crypto.randomBytes(32));
const codeVerifier = base64Url(crypto.randomBytes(64));
const codeChallenge = base64Url(crypto.createHash("sha256").update(codeVerifier).digest());
const authorizationUrl = new URL(AUTH_URL);
authorizationUrl.search = new URLSearchParams({
  client_id: current.client_id,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: WEBMASTERS_SCOPE,
  access_type: "offline",
  prompt: "consent",
  include_granted_scopes: "true",
  state,
  code_challenge: codeChallenge,
  code_challenge_method: "S256"
}).toString();

let settle;
const finished = new Promise((resolve, reject) => {
  settle = { resolve, reject };
});

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", redirectUri);

  if (requestUrl.pathname === "/done") {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(html("Google Search Console yetkisi yenilendi"));
    return;
  }

  if (requestUrl.pathname !== "/oauth2callback") {
    response.writeHead(404, { "Cache-Control": "no-store" });
    response.end();
    return;
  }

  try {
    if (requestUrl.searchParams.get("state") !== state) {
      throw new Error("OAuth state doğrulaması başarısız.");
    }

    const oauthError = requestUrl.searchParams.get("error");
    if (oauthError) {
      throw new Error(`Google yetkilendirmesi reddedildi: ${oauthError}`);
    }

    const code = requestUrl.searchParams.get("code");
    if (!code) throw new Error("Google authorization code eksik.");

    const token = await googleJson(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: current.client_id,
        client_secret: current.client_secret,
        code,
        code_verifier: codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri
      })
    });

    if (!token.refresh_token) {
      throw new Error("Google yeni refresh_token döndürmedi; yeniden izin verilmesi gerekiyor.");
    }

    // Preserve the new offline grant immediately. A valid refresh token must not
    // be discarded merely because the subsequent property/quota validation is
    // temporarily unavailable.
    const backupPath = await writeCredentialAtomically(
      current,
      token.refresh_token,
      quotaProjectId
    );
    let propertyAccess = false;
    let validationError = "";
    try {
      const sites = await googleJson("https://www.googleapis.com/webmasters/v3/sites", {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token.access_token}`,
          ...(quotaProjectId ? { "x-goog-user-project": quotaProjectId } : {})
        }
      });
      propertyAccess = Array.isArray(sites.siteEntry) &&
        sites.siteEntry.some((entry) => entry.siteUrl === siteUrl);
    } catch (error) {
      validationError = error.message;
    }

    response.writeHead(303, {
      "Cache-Control": "no-store",
      Location: "/done",
      "Referrer-Policy": "no-referrer"
    });
    response.end();
    settle.resolve({ backupPath, propertyAccess, validationError });
  } catch (error) {
    response.writeHead(400, {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(html("Google Search Console yetkisi yenilenemedi"));
    settle.reject(error);
  }
});

server.listen(port, "127.0.0.1");
await new Promise((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});

console.log(`authorization_url=${authorizationUrl}`);
console.log(`redirect_uri=${redirectUri}`);
console.log(`timeout_seconds=${Math.round(timeoutMs / 1000)}`);

const timer = setTimeout(() => {
  settle.reject(new Error("Google OAuth kullanıcı onayı zaman aşımına uğradı."));
}, timeoutMs);

try {
  const result = await finished;
  console.log("ok=true");
  console.log(`property_access=${result.propertyAccess}`);
  console.log(`api_validation=${result.validationError ? "failed" : "passed"}`);
  if (result.validationError) {
    console.log(`validation_error=${result.validationError.replace(/[\r\n]+/g, " ")}`);
  }
  console.log(`backup_path=${result.backupPath}`);
} finally {
  clearTimeout(timer);
  server.close();
}
