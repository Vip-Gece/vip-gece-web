const BASE_URL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3105";
const PUBLIC_ADMIN_HOSTS = new Set([
  "vip-gece.site",
  "www.vip-gece.site",
  "vip-gece.online",
  "www.vip-gece.online",
  "vip-gece.com",
  "www.vip-gece.com"
]);
const publicAdminSurfaceHidden = PUBLIC_ADMIN_HOSTS.has(new URL(BASE_URL).hostname.toLowerCase());
const adminGuardStatus = publicAdminSurfaceHidden ? 404 : 401;
const adminAssetStatus = publicAdminSurfaceHidden ? 404 : 200;

async function resolvePublicProfileSlug() {
  try {
    const response = await fetch(`${BASE_URL}/api/v1/public/profiles`);
    if (!response.ok) return "ada-vip";
    const payload = await response.json();
    const profiles = Array.isArray(payload) ? payload : (payload.profiles || payload.data || []);
    const first = profiles.find((profile) => profile?.slug) || profiles[0];
    return first?.slug || "ada-vip";
  } catch {
    return "ada-vip";
  }
}

const profileSlug = await resolvePublicProfileSlug();

const cases = [
  ["GET", "/health", 200],
  ["GET", "/api/health", 200],
  ["GET", "/", 200],
  ["GET", "/vip-escort", 200],
  ["GET", "/sisli-escort", 200],
  ["GET", `/profil/${profileSlug}`, 200],
  ["GET", "/iletisim", 200],
  ["GET", "/api/v1/public/profiles", 200],
  ["GET", "/api/admin/mobile/audit", adminGuardStatus],
  ["GET", "/api/admin/mobile/google/status", adminGuardStatus],
  ["GET", "/api/admin/mobile/taxonomy", adminGuardStatus],
  ["GET", "/api/admin/mobile/ads", adminGuardStatus],
  ["GET", "/api/admin/google/sitemaps", adminGuardStatus],
  ["GET", "/api/admin/google/status", adminGuardStatus],
  ["GET", "/api/admin/analytics/overview", adminGuardStatus],
  ["POST", "/api/analytics/event", 202],
  ["GET", `/api/public/profile/${profileSlug}`, 200],
  ["GET", "/api/public/profiles", 200],
  ["GET", "/api/system/languages", 200],
  ["GET", "/api/system/districts", 200],
  ["GET", "/api/mobile/admin/update", publicAdminSurfaceHidden ? 404 : 200],
  ["DELETE", "/api/admin/mobile/ads/demo-ad", adminGuardStatus],
  ["PATCH", "/api/admin/mobile/ads/demo-ad", adminGuardStatus],
  ["POST", "/api/admin/mobile/ads", adminGuardStatus],
  ["PATCH", "/api/admin/mobile/settings", adminGuardStatus],
  ["DELETE", "/api/admin/mobile/profiles/demo-ada", adminGuardStatus],
  ["PATCH", "/api/admin/mobile/profiles/demo-ada", adminGuardStatus],
  ["GET", "/vg-panel-91x", 404],
  ["GET", "/admin.js", adminAssetStatus],
  ["GET", "/musteri", 404],
  ["GET", "/anasayfa", 200],
  ["GET", "/api/v1/admin/status", adminGuardStatus],
  ["GET", "/api/admin/mobile/health", adminGuardStatus],
  ["GET", "/api/admin/mobile/bootstrap", adminGuardStatus],
  ["GET", "/api/admin/mobile/profiles", adminGuardStatus],
  ["GET", "/api/v1/customer/profile", 404],
  ["POST", "/api/customer/request", 404],
  ["POST", "/api/customer/login", 404],
  ["GET", "/kaldirma.html", 404],
  ["GET", "/sorumluluk.html", 404],
  ["GET", "/detay.js", 404],
  ["GET", "/kategori.js", 404],
  ["GET", "/src/app.js", 404]
];

function requestInit(method) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.SMOKE_REQUEST_TIMEOUT_MS || 12000));
  const base = {
    method,
    signal: controller.signal,
    done: () => clearTimeout(timeout)
  };

  if (method !== "POST") return base;
  return {
    ...base,
    headers: { "Content-Type": "application/json" },
    body: "{}"
  };
}

let failed = 0;

for (const [method, path, expected] of cases) {
  const init = requestInit(method);
  let response;

  try {
    response = await fetch(`${BASE_URL}${path}`, init);
  } catch (error) {
    init.done?.();
    failed += 1;
    console.log(`fail ${method} ${path} -> ${error.name || "request_error"}`);
    continue;
  }

  init.done?.();
  const ok = response.status === expected;
  console.log(`${ok ? "ok" : "fail"} ${method} ${path} -> ${response.status}`);
  await response.arrayBuffer().catch(() => null);

  if (!ok) {
    failed += 1;
  }
}

if (failed) {
  process.exitCode = 1;
}
