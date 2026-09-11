#!/usr/bin/env node
/**
 * Post-deploy Cloudflare apply for vip-gece.site (+ optional .com).
 *
 * Auth (first match wins):
 *   1) CLOUDFLARE_API_TOKEN / CF_API_TOKEN env
 *   2) CLOUDFLARE_API_TOKEN_FILE / CF_API_TOKEN_FILE path
 *   3) /etc/vip-gece-domain-gateway/cloudflare.token
 *
 * Optional:
 *   CLOUDFLARE_ACCOUNT_ID / CF_ACCOUNT_ID  (required for cfat_ account tokens)
 *   CLOUDFLARE_ZONE_NAME                   (default: vip-gece.site)
 *   --also-com                             also apply SEO-safe redirect check for vip-gece.com
 *   --dry-run                              print plan only
 */
import { readFileSync, existsSync } from "node:fs";

const apiBase = "https://api.cloudflare.com/client/v4";
const dryRun = process.argv.includes("--dry-run");
const alsoCom = process.argv.includes("--also-com");
const zoneName = process.env.CLOUDFLARE_ZONE_NAME || "vip-gece.site";

function loadToken() {
  const direct = (process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || "").trim();
  if (direct) return direct;
  const file =
    process.env.CLOUDFLARE_API_TOKEN_FILE ||
    process.env.CF_API_TOKEN_FILE ||
    "/etc/vip-gece-domain-gateway/cloudflare.token";
  if (existsSync(file)) {
    const value = readFileSync(file, "utf8").trim();
    if (value) return value;
  }
  throw new Error(
    "Cloudflare token missing. Set CLOUDFLARE_API_TOKEN or write a non-empty token to " +
      "/etc/vip-gece-domain-gateway/cloudflare.token"
  );
}

const token = loadToken();
const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || "").trim();

async function cf(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const errors = (body.errors || []).map((item) => item.message || item.code).join("; ");
    throw new Error(`${options.method || "GET"} ${path}: HTTP ${response.status} ${errors}`);
  }
  return body;
}

async function verifyToken() {
  const path = token.startsWith("cfat_")
    ? `/accounts/${encodeURIComponent(accountId)}/tokens/verify`
    : "/user/tokens/verify";
  if (token.startsWith("cfat_") && !accountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID required for account-owned tokens (cfat_)");
  }
  const body = await cf(path);
  if (body.result?.status && body.result.status !== "active") {
    throw new Error(`Token not active: ${body.result.status}`);
  }
  console.log("[ok] token active");
}

async function findZone(name) {
  const body = await cf(`/zones?name=${encodeURIComponent(name)}&per_page=10`);
  const zone = (body.result || []).find((item) => item.name === name);
  if (!zone) throw new Error(`Zone not found: ${name}`);
  return zone;
}

async function setSetting(zoneId, id, value) {
  if (dryRun) {
    console.log(`[dry-run] settings/${id}=${JSON.stringify(value)}`);
    return;
  }
  const body = await cf(`/zones/${zoneId}/settings/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ value }),
  });
  console.log(`[verified] ${id}=${JSON.stringify(body.result?.value)}`);
}

async function configureBotManagement(zoneId) {
  if (dryRun) {
    console.log("[dry-run] bot_management open-crawler policy; JavaScript Detections off");
    return;
  }
  let current;
  try {
    current = await cf(`/zones/${zoneId}/bot_management`);
  } catch (err) {
    console.log(`[skip] bot_management unavailable: ${err.message}`);
    return;
  }
  const desired = {
    fight_mode: false,
    enable_js: false,
    sbfm_definitely_automated: "allow",
    sbfm_verified_bots: "allow",
    sbfm_static_resource_protection: false,
    ai_bots_protection: "disabled",
    content_bots_protection: "disabled",
    crawler_protection: "disabled",
    is_robots_txt_managed: false,
  };
  await cf(`/zones/${zoneId}/bot_management`, {
    method: "PUT",
    body: JSON.stringify(desired),
  });
  const verified = await cf(`/zones/${zoneId}/bot_management`);
  if (verified.result?.fight_mode !== false || verified.result?.enable_js !== false) {
    throw new Error("Cloudflare bot injection remained active after update");
  }
  console.log("[verified] bot fight mode and JavaScript Detections are off");
}

const disableRumRule = {
  ref: "vip_gece_disable_rum",
  expression: "true",
  description: "Keep Cloudflare RUM off; Google Analytics remains the single browser analytics source",
  action: "set_config",
  action_parameters: {
    disable_rum: true,
  },
  enabled: true,
};

async function disableCloudflareRum(zoneId) {
  const list = await cf(`/zones/${zoneId}/rulesets`);
  let ruleset = (list.result || []).find(
    (item) => item.kind === "zone" && item.phase === "http_config_settings"
  );

  if (dryRun) {
    console.log(
      `[dry-run] ${ruleset ? "upsert" : "create"} configuration rule ${disableRumRule.ref}`
    );
    return;
  }

  if (!ruleset) {
    const created = await cf(`/zones/${zoneId}/rulesets`, {
      method: "POST",
      body: JSON.stringify({
        name: "VIP-GECE zone configuration",
        description: "Performance-safe configuration overrides managed with the deployment",
        kind: "zone",
        phase: "http_config_settings",
        rules: [disableRumRule],
      }),
    });
    ruleset = created.result;
  } else {
    const full = await cf(`/zones/${zoneId}/rulesets/${ruleset.id}`);
    const existing = (full.result?.rules || []).find(
      (rule) => rule.ref === disableRumRule.ref
    );
    const path = existing
      ? `/zones/${zoneId}/rulesets/${ruleset.id}/rules/${existing.id}`
      : `/zones/${zoneId}/rulesets/${ruleset.id}/rules`;
    await cf(path, {
      method: existing ? "PATCH" : "POST",
      body: JSON.stringify(disableRumRule),
    });
  }

  const verified = await cf(`/zones/${zoneId}/rulesets/${ruleset.id}`);
  const activeRule = (verified.result?.rules || []).find(
    (rule) => rule.ref === disableRumRule.ref
  );
  if (!activeRule?.enabled || activeRule.action_parameters?.disable_rum !== true) {
    throw new Error("Cloudflare RUM disable rule was not active after update");
  }
  console.log("[verified] Cloudflare Web Analytics/RUM injection is off");
}

async function purgeSite(zoneId, host) {
  if (dryRun) {
    console.log(`[dry-run] purge full zone cache for ${host}`);
    return;
  }
  await cf(`/zones/${zoneId}/purge_cache`, {
    method: "POST",
    body: JSON.stringify({ purge_everything: true }),
  });
  console.log(`[verified] purged full zone cache for ${host}`);
}

async function readSecurityLevel(zoneId) {
  try {
    const body = await cf(`/zones/${zoneId}/settings/security_level`);
    console.log(`[info] security_level=${body.result?.value}`);
  } catch (err) {
    console.log(`[skip] security_level read: ${err.message}`);
  }
}

await verifyToken();
const siteZone = await findZone(zoneName);
console.log(`[info] zone ${siteZone.name} id=${siteZone.id} plan=${siteZone.plan?.name || "unknown"}`);

// SEO / transport hygiene (matches project hardening script)
await setSetting(siteZone.id, "ssl", "strict");
await setSetting(siteZone.id, "always_use_https", "on");
await setSetting(siteZone.id, "automatic_https_rewrites", "on");
await setSetting(siteZone.id, "min_tls_version", "1.2");
await setSetting(siteZone.id, "tls_1_3", "on");
await setSetting(siteZone.id, "brotli", "on");
await setSetting(siteZone.id, "http3", "on");
await setSetting(siteZone.id, "ipv6", "on");
await setSetting(siteZone.id, "browser_check", "off");
await setSetting(siteZone.id, "security_level", "medium");
await setSetting(siteZone.id, "websockets", "on");
await setSetting(siteZone.id, "early_hints", "on");
await setSetting(siteZone.id, "rocket_loader", "off");
await setSetting(siteZone.id, "mirage", "off");
await readSecurityLevel(siteZone.id);
await configureBotManagement(siteZone.id);
await disableCloudflareRum(siteZone.id);
await purgeSite(siteZone.id, zoneName);

if (alsoCom) {
  try {
    const comZone = await findZone("vip-gece.com");
    console.log(`[info] also zone ${comZone.name} id=${comZone.id}`);
    await setSetting(comZone.id, "ssl", "strict");
    await setSetting(comZone.id, "always_use_https", "on");
    await setSetting(comZone.id, "security_level", "medium");
    await configureBotManagement(comZone.id);
  } catch (err) {
    console.log(`[skip] vip-gece.com: ${err.message}`);
  }
}

console.log("[done] cloudflare post-deploy apply finished");
