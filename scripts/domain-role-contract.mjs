import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const FORMER_ORIGIN = ["178.104", "161.198"].join(".");
const REMOVED_ORIGIN = ["51.222", "156.225"].join(".");
const REMOVED_ORIGIN_IPV6 = ["2607:5300:205:200", "2cc1"].join("::");
const CROSS_APP_HOST = ["unsscore", "com"].join(".");

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const packageJson = JSON.parse(await source("package.json"));
assert.equal(packageJson.scripts["cloudflare-vip-gece-cutover"], undefined);
assert.equal(packageJson.scripts["cloudflare-vip-gece-hardening"], undefined);
assert.equal(packageJson.scripts["cloudflare-post-deploy"], "node scripts/cloudflare-vip-gece-post-deploy.mjs");

const cloudflarePostDeploy = await source("scripts/cloudflare-vip-gece-post-deploy.mjs");
assert.match(cloudflarePostDeploy, /zoneName\s*=\s*process\.env\.CLOUDFLARE_ZONE_NAME\s*\|\|\s*"vip-gece\.site"/);
assert.equal(cloudflarePostDeploy.includes(FORMER_ORIGIN), false);
assert.equal(cloudflarePostDeploy.includes(REMOVED_ORIGIN), false);
assert.equal(cloudflarePostDeploy.includes(REMOVED_ORIGIN_IPV6), false);
assert.equal(cloudflarePostDeploy.includes(CROSS_APP_HOST), false);
assert.equal(cloudflarePostDeploy.includes("vip-gece.com"), false);

const liveAudit = await source("scripts/live-domain-role-audit.mjs");
for (const required of ["https://vip-gece.site", "vip-gece.com", "vip-gece.online"]) {
  assert.equal(liveAudit.includes(required), true, `${required} missing from role audit`);
}
assert.match(liveAudit, /EXPECTED_PROFILE_COUNT\s*=\s*27/);
assert.match(liveAudit, /EXPECTED_SITEMAP_COUNT\s*=\s*267/);
assert.match(liveAudit, /response\.status === 404/);
assert.match(liveAudit, /CANCELLED_MIGRATION\s*=\s*"vip-gece\.com"/);
assert.match(liveAudit, /FUTURE_SEPARATE_SITE\s*=\s*"vip-gece\.online"/);
assert.equal(liveAudit.includes("old-domain path/query redirect matrix"), false);
assert.equal(liveAudit.includes("response.status === 301 && response.location === entry.expected"), false);

const comRedirectTemplate = await source("ops/nginx/vip-gece.com-redirect.conf");
assert.equal(comRedirectTemplate.includes("return 301 https://vip-gece.site"), false);
assert.match(comRedirectTemplate, /return 410;/);

const fullRedirectAudit = await source("scripts/full-redirect-cutover-audit.mjs");
assert.match(fullRedirectAudit, /OLD_DOMAIN\s*=\s*process\.env\.OLD_DOMAIN\s*\|\|\s*""/);
assert.match(fullRedirectAudit, /ALLOW_CANCELLED_COM_MIGRATION/);
assert.match(fullRedirectAudit, /taşıması iptal edildi/);

console.log("VIP-GECE domain role contract passed");
