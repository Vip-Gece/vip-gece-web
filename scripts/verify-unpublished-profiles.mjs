#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const baseline = args.find((arg) => arg.startsWith("--baseline="))?.slice("--baseline=".length) || "work/profile-image-binding-report-20260914.json";
const output = args.find((arg) => arg.startsWith("--output="))?.slice("--output=".length) || "work/profile-unpublication-verification-20260914.json";
const before = JSON.parse(await readFile(baseline, "utf8"));
const selected = before.profiles.filter((profile) => profile.fallback);
if (selected.length !== 12) throw new Error("Expected the twelve audited missing-image profiles");
const base = "https://vip-gece.site";

async function request(path) {
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(new URL(path, base), {
        redirect: "manual", signal: AbortSignal.timeout(25_000),
        headers: { "User-Agent": "VIP-Gece-Unpublication-Verification/1.0" }
      });
      return {
        path, status: response.status, body: await response.text(),
        cache_status: response.headers.get("cf-cache-status"),
        location: response.headers.get("location"),
        age: response.headers.get("age"), attempts: attempt
      };
    } catch (error) {
      lastError = error.cause?.code || error.message;
    }
  }
  return { path, status: 0, body: "", error: lastError, attempts: 2 };
}

const catalog = await request("/api/v1/public/profiles");
const active = catalog.status === 200 ? JSON.parse(catalog.body).profiles : [];
const home = await request("/");
const sitemap = await request("/sitemap.xml");
const checks = [];
for (const profile of selected) {
  const pathname = `/profil/${encodeURIComponent(profile.slug)}`;
  const detail = await request(pathname);
  const api = await request(`/api/v1/public/profiles/${encodeURIComponent(profile.slug)}`);
  const resolved = api.status === 200 ? JSON.parse(api.body).profile : null;
  const differentActiveProfile = resolved && !selected.some((row) => String(row.id) === String(resolved.id)) &&
    active.some((row) => row.slug === resolved.slug);
  const canonicalRedirect = differentActiveProfile && [301, 302, 307, 308].includes(detail.status) && detail.location &&
    new URL(detail.location, base).href === new URL(`/profil/${encodeURIComponent(resolved.slug)}`, base).href;
  const check = {
    id: profile.id, name: profile.name, slug: profile.slug,
    absent_from_catalog: !active.some((row) => row.slug === profile.slug),
    absent_from_home: !home.body.includes(pathname),
    absent_from_sitemap: !sitemap.body.includes(pathname),
    detail_status: detail.status, api_status: api.status,
    resolved_profile_id: resolved?.id || null,
    redirect_location: detail.location,
    redirects_to_different_active_profile: Boolean(canonicalRedirect),
    detail_cache_status: detail.cache_status, detail_age: detail.age
  };
  check.ok = check.absent_from_catalog && check.absent_from_home && check.absent_from_sitemap &&
    detail.status === 404 && api.status === 404 && !canonicalRedirect;
  checks.push(check);
}
const report = {
  checked_at: new Date().toISOString(), public_profiles: active.length,
  catalog_status: catalog.status, home_status: home.status, sitemap_status: sitemap.status,
  checks,
  ok: active.length === 15 && [catalog, home, sitemap].every((result) => result.status === 200) &&
    checks.every((check) => check.ok)
};
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
