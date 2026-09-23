#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = process.argv[2] || "/var/www/vip-gece-site/current";
require(path.join(root, "node_modules/dotenv")).config({
  path: "/var/www/vip-gece-site/.env", quiet: true, override: true
});

async function main() {
  const ready = await fetch("http://127.0.0.1:3003/api/ready", { signal: AbortSignal.timeout(15_000) });
  assert.equal(ready.status, 200, "Origin must be ready before cache invalidation");
  const origin = await fetch("http://127.0.0.1:3003/api/v1/public/profiles", { signal: AbortSignal.timeout(15_000) });
  const profiles = (await origin.json()).profiles;
  assert.equal(profiles.length, 15);
  assert.equal(profiles.some((profile) => profile.images.some((image) => image === "/logo.png.webp")), false);

  const tokenFile = process.env.CLOUDFLARE_API_TOKEN_FILE || process.env.CF_API_TOKEN_FILE ||
    "/etc/vip-gece-domain-gateway/cloudflare.token";
  const token = String(process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN ||
    fs.readFileSync(tokenFile, "utf8")).trim();
  assert.ok(token, "Existing Cloudflare credential is required");
  async function cf(endpoint, options = {}) {
    const response = await fetch(`https://api.cloudflare.com/client/v4${endpoint}`, {
      ...options, signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    });
    const payload = await response.json();
    if (!response.ok || payload.success !== true) {
      throw new Error(`Cloudflare HTTP ${response.status}: ${(payload.errors || []).map((item) => item.code).join(",")}`);
    }
    return payload.result;
  }
  const zones = await cf("/zones?name=vip-gece.site&per_page=10");
  const matches = zones.filter((zone) => zone.name === "vip-gece.site");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].status, "active");
  const result = await cf(`/zones/${matches[0].id}/purge_cache`, {
    method: "POST", body: JSON.stringify({ purge_everything: true })
  });
  console.log(JSON.stringify({ checked_at: new Date().toISOString(), zone: "vip-gece.site",
    purge_success: true, purge_id: result.id, origin_ready: true, public_profiles: profiles.length,
    configuration_changed: false }, null, 2));
}
main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
