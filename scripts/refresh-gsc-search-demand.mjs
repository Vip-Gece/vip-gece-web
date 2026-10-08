import { createSign, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildGscDemandSnapshot } = require("../src/services/gscDemandSnapshotBuilder");

const CREDENTIAL_PATH = process.env.VIP_GECE_GSC_CREDENTIAL_PATH ||
  "/var/lib/vip-gece/google-search-console-credential.json";
const SNAPSHOT_PATH = process.env.VIP_GECE_SEARCH_DEMAND_PATH ||
  "/var/lib/vip-gece/gsc-search-demand.json";
const SITE_CANDIDATES = ["sc-domain:vip-gece.site", "https://vip-gece.site/"];
const WEBMASTERS_READONLY = "https://www.googleapis.com/auth/webmasters.readonly";

function encoded(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Google API HTTP ${response.status}`);
  return response.json();
}

async function serviceAccountToken(credential) {
  if (!credential?.client_email || !credential?.private_key) {
    throw new Error("Search Console service account credential is incomplete");
  }

  const now = Math.floor(Date.now() / 1000);
  const unsigned = [
    encoded({ alg: "RS256", typ: "JWT" }),
    encoded({
      iss: credential.client_email,
      scope: WEBMASTERS_READONLY,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    })
  ].join(".");
  const signature = createSign("RSA-SHA256").update(unsigned).sign(credential.private_key).toString("base64url");
  const tokenResponse = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`
    })
  });
  if (!tokenResponse.access_token) throw new Error("Google did not return an access token");
  return tokenResponse.access_token;
}

function dateWindow() {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 3);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 89);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10)
  };
}

async function searchAnalyticsRows(siteUrl, token, window) {
  const rows = [];
  const pageSize = 25_000;
  for (let startRow = 0; startRow < 50_000; startRow += pageSize) {
    const result = await fetchJson(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          ...window,
          dimensions: ["page", "query"],
          type: "web",
          dataState: "final",
          rowLimit: pageSize,
          startRow
        })
      }
    );
    const batch = Array.isArray(result.rows) ? result.rows : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function atomicWriteSnapshot(payload) {
  const temporaryPath = `${SNAPSHOT_PATH}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(payload)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporaryPath, SNAPSHOT_PATH);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function main() {
  const credential = JSON.parse(await readFile(CREDENTIAL_PATH, "utf8"));
  const token = await serviceAccountToken(credential);
  const sites = await fetchJson("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { authorization: `Bearer ${token}` }
  });
  const siteUrl = SITE_CANDIDATES.find((candidate) =>
    sites.siteEntry?.some((site) => site.siteUrl === candidate && site.permissionLevel !== "siteUnverifiedUser")
  );
  if (!siteUrl) throw new Error("Service account has no verified vip-gece.site Search Console property");

  const window = dateWindow();
  const rows = await searchAnalyticsRows(siteUrl, token, window);
  const snapshot = buildGscDemandSnapshot(rows, window);
  if (!process.argv.includes("--dry-run")) await atomicWriteSnapshot(snapshot);
  console.log(JSON.stringify({
    mode: process.argv.includes("--dry-run") ? "dry-run" : "written",
    property: siteUrl,
    start_date: snapshot.start_date,
    end_date: snapshot.end_date,
    raw_row_count: snapshot.raw_row_count,
    matched_row_count: snapshot.matched_row_count,
    landing_count: Object.keys(snapshot.landings).length
  }));
}

main().catch((error) => {
  console.error(`Search demand refresh failed: ${error.message}`);
  process.exitCode = 1;
});
