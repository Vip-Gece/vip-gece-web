#!/usr/bin/env node
"use strict";

// FCM HTTP v1 ile müşteri cihazlarına güncelleme duyurusu gönderir (anlık push).
// Kimlik: servis hesabı JWT (scope firebase.messaging) veya GOOGLE_OAUTH_TOKEN / gcloud.
// Cihaz token'ları varsayılan olarak sunucudan SSH ile okunur; --tokens-file ile yerel dosya.
//
// Kullanım:
//   node scripts/send-customer-update-push.mjs --title "..." --body "..." --version 2.1.5
//   node scripts/send-customer-update-push.mjs --dry-run

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "vip-gece-android-20260914";
const SA_PATH = process.env.GOOGLE_SERVICE_ACCOUNT ||
  path.join(os.homedir(), ".config/vip-gece/gsc-reader-20260923.json");
const REMOTE_TOKENS_PATH = "/var/lib/vip-gece/customer-device-tokens.json";
const FCM_ENDPOINT = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;

const args = new Map();
for (const part of process.argv.slice(2)) {
  if (!part.startsWith("--")) continue;
  const eq = part.indexOf("=");
  if (eq === -1) args.set(part, true);
  else args.set(part.slice(0, eq), part.slice(eq + 1));
}

const TITLE = String(args.get("--title") || "VIP Gece güncellemesi");
const VERSION = String(args.get("--version") || "").trim();
const BODY = String(args.get("--body") || (VERSION ? `Sürüm ${VERSION} yayında. Kurmak için dokunun.` : "Yeni sürüm yayında. Kurmak için dokunun."));
const SERVER = String(args.get("--server") || "vip-gece-hetzner");
const TOKENS_FILE = args.get("--tokens-file") ? path.resolve(String(args.get("--tokens-file"))) : "";
const DRY = args.get("--dry-run") === true;
const CONCURRENCY = Math.max(1, Math.min(Number(args.get("--concurrency") || 8), 32));

function serviceAccountAccessToken() {
  const sa = JSON.parse(fs.readFileSync(SA_PATH, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  })).toString("base64url");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), sa.private_key).toString("base64url");
  return fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`
    })
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      throw new Error(`servis hesabı token alınamadı: ${response.status}`);
    }
    return payload.access_token;
  });
}

async function accessToken() {
  if (process.env.GOOGLE_OAUTH_TOKEN) return process.env.GOOGLE_OAUTH_TOKEN.trim();
  try {
    return await serviceAccountAccessToken();
  } catch (error) {
    const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
    if (!token) throw error;
    return token;
  }
}

function readLocalTokens() {
  const raw = fs.readFileSync(TOKENS_FILE, "utf8");
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.tokens) ? parsed.tokens : []);
  return rows.map((row) => (typeof row === "string" ? row : row?.token)).filter(Boolean);
}

function readRemoteTokens() {
  const raw = execFileSync("ssh", ["-o", "BatchMode=yes", SERVER, `cat ${REMOTE_TOKENS_PATH}`], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed.tokens) ? parsed.tokens : [];
  return rows.map((row) => row?.token).filter(Boolean);
}

async function sendToToken(token, authToken) {
  const response = await fetch(FCM_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      message: {
        token,
        data: { type: "update", title: TITLE, body: BODY, version: VERSION },
        android: { priority: "high" }
      }
    })
  });
  if (response.ok) return { ok: true };
  const payload = await response.json().catch(() => ({}));
  const status = payload?.error?.status || String(response.status);
  const message = payload?.error?.message || "";
  const unregistered = status === "UNREGISTERED" || status === "NOT_FOUND" || /not registered|not found/i.test(message);
  return { ok: false, unregistered, status, message: message.slice(0, 120) };
}

(async () => {
  const tokens = TOKENS_FILE ? readLocalTokens() : readRemoteTokens();
  const unique = [...new Set(tokens)];
  console.log(JSON.stringify({
    kaynak: TOKENS_FILE ? TOKENS_FILE : `${SERVER}:${REMOTE_TOKENS_PATH}`,
    cihaz_token: unique.length,
    baslik: TITLE,
    surum: VERSION,
    dry_run: DRY
  }));
  if (DRY || unique.length === 0) process.exit(0);

  const authToken = await accessToken();
  const results = { ok: 0, unregistered: 0, failed: 0 };
  const failures = [];
  let index = 0;

  async function worker() {
    while (index < unique.length) {
      const token = unique[index++];
      try {
        const outcome = await sendToToken(token, authToken);
        if (outcome.ok) results.ok += 1;
        else if (outcome.unregistered) results.unregistered += 1;
        else {
          results.failed += 1;
          if (failures.length < 5) failures.push(`${outcome.status}: ${outcome.message}`);
        }
      } catch (error) {
        results.failed += 1;
        if (failures.length < 5) failures.push(String(error.message).slice(0, 120));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));
  console.log(JSON.stringify({ sonuc: results, ornek_hatalar: failures }));
  if (results.failed > 0) process.exit(1);
})().catch((error) => {
  console.error("hata: " + (error?.message || error));
  process.exit(1);
});
