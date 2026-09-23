#!/usr/bin/env node
"use strict";

// Müşteri APK'sını Firebase App Distribution'a yükler ve test kullanıcılarını yönetir.
//
// Kullanım:
//   node scripts/distribute-customer-apk-firebase.mjs \
//     --apk=<path.apk> --app-id=1:134821364830:android:0e0cb17dfbc84e3d7760cf \
//     --project=vip-gece-android-20260914 --testers=bkaytanci00@gmail.com \
//     --notes="2.1.2: iyileştirmeler"
//
// Akış: binary upload -> çıkan release'e notları yaz (PATCH) -> proje test kullanıcılarını ekle (batchAdd).
// Kimlik: GOOGLE_OAUTH_TOKEN ya da yerel `gcloud auth print-access-token`; token yazılmaz.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const API = "https://firebaseappdistribution.googleapis.com/v1";

function arg(name, fallback = "") {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1).trim();
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : fallback;
}

function fail(message) {
  console.error(`hata: ${message}`);
  process.exit(1);
}

function accessToken() {
  if (process.env.GOOGLE_OAUTH_TOKEN) return process.env.GOOGLE_OAUTH_TOKEN.trim();
  try {
    return execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
  } catch {
    fail("Google erişim token'ı alınamadı (GOOGLE_OAUTH_TOKEN veya gcloud gerekli).");
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "x-goog-user-project": project,
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    fail(`${options.method || "GET"} ${url.replace(API, "")} -> HTTP ${response.status} ${JSON.stringify(body).slice(0, 240)}`);
  }
  return body;
}

const apkPath = path.resolve(arg("--apk"));
const appId = arg("--app-id");
const project = arg("--project");
const testers = arg("--testers").split(",").map((value) => value.trim()).filter(Boolean);
const notes = arg("--notes") || "VIP Gece müşteri uygulaması güncellemesi.";

if (!fs.existsSync(apkPath)) fail(`APK bulunamadı: ${apkPath}`);
if (!appId || !project) fail("--app-id ve --project gerekli.");

const projectNumber = arg("--project-number") || (appId.split(":")[1] || "");
if (!/^[0-9]+$/.test(projectNumber)) fail("proje numarasi cozulemedi (--project-number gerekli).");
const appBase = `${API}/projects/${projectNumber}/apps/${encodeURIComponent(appId)}`;
const uploadBase = "https://firebaseappdistribution.googleapis.com/upload/v1";
const form = new FormData();
form.set("release", new Blob([JSON.stringify({})], { type: "application/json" }), "release.json");
form.set("binary", new Blob([fs.readFileSync(apkPath)], { type: "application/octet-stream" }), path.basename(apkPath));
const operation = await api(`${uploadBase}/projects/${projectNumber}/apps/${encodeURIComponent(appId)}/releases:upload`, { method: "POST", body: form });

// 2) En güncel release kaydını bul ve notları yaz.
const list = await api(`${appBase}/releases`);
const release = (list.releases || []).slice().sort((a, b) => String(b.createTime || "").localeCompare(String(a.createTime || "")))[0];
if (!release?.name) fail("Yükleme sonrası release kaydı bulunamadı.");
if (notes) {
  await api(`${API.replace("/v1", "")}/v1/${release.name}?updateMask=releaseNotes`, {
    method: "PATCH",
    body: JSON.stringify({ releaseNotes: { text: notes.slice(0, 500) } })
  });
}

// 3) Test kullanıcılarını proje seviyesinde ekle.
let addedTesters = [];
if (testers.length) {
  const result = await api(`${API}/projects/${projectNumber}/testers:batchAdd`, {
    method: "POST",
    body: JSON.stringify({ emails: testers })
  });
  addedTesters = (result.testers || []).map((item) => item.name);
}

console.log(JSON.stringify({
  ok: true,
  operation: operation?.name || "",
  release: release.name,
  display_version: release.displayVersion || "",
  notes,
  testers: addedTesters
}, null, 2));
