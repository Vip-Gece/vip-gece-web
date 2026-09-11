#!/usr/bin/env node

const EXPECTED_ZONE = 'vip-gece.site';
const CLOUDFLARE_MANAGED_RULESET_ID = 'efb7b8c949ac4650a09736fc376e9aee';
const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;

if (!token) throw new Error('CLOUDFLARE_API_TOKEN is required');
if (token.startsWith('cfat_') && !accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is required for account tokens');

const apiBase = 'https://api.cloudflare.com/client/v4';

async function cf(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const errors = (body.errors || []).map((item) => item.message || item.code).join('; ');
    throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status} ${errors}`);
  }
  return body;
}

async function cfOptional(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function verifyToken() {
  const path = token.startsWith('cfat_')
    ? `/accounts/${encodeURIComponent(accountId)}/tokens/verify`
    : '/user/tokens/verify';
  const body = await cf(path);
  if (body.result?.status !== 'active') throw new Error(`Token is not active: ${body.result?.status || 'unknown'}`);
}

async function findZone() {
  const body = await cf(`/zones?name=${encodeURIComponent(EXPECTED_ZONE)}&per_page=10`);
  const zone = (body.result || []).find((item) => item.name === EXPECTED_ZONE);
  if (!zone) throw new Error(`Zone not found: ${EXPECTED_ZONE}`);
  return zone;
}

async function setSetting(zoneId, id, value) {
  const body = await cf(`/zones/${zoneId}/settings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ value }),
  });
  if (body.result?.value !== value) throw new Error(`${id} verification failed`);
  console.log(`[verified] ${id}=${value}`);
}

async function ensureManagedWaf(zoneId) {
  const path = `/zones/${zoneId}/rulesets/phases/http_request_firewall_managed/entrypoint`;
  const { response, body } = await cfOptional(path);
  let rules = [];

  if (response.ok && body.success !== false) {
    rules = body.result?.rules || [];
    const existing = rules.find((rule) =>
      rule.action === 'execute' && rule.action_parameters?.id === CLOUDFLARE_MANAGED_RULESET_ID
    );
    if (existing?.enabled) {
      console.log('[verified] Cloudflare Managed Ruleset is enabled');
      return;
    }

    const nextRules = existing
      ? rules.map((rule) => rule.id === existing.id ? { ...rule, enabled: true } : rule)
      : [...rules, {
          action: 'execute',
          action_parameters: { id: CLOUDFLARE_MANAGED_RULESET_ID },
          expression: 'true',
          description: 'Execute Cloudflare Managed Ruleset',
          enabled: true,
        }];

    await cf(`/zones/${zoneId}/rulesets/${body.result.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: body.result.name,
        description: body.result.description || 'VIP GECE managed WAF entrypoint',
        kind: body.result.kind,
        phase: body.result.phase,
        rules: nextRules,
      }),
    });
  } else if (response.status === 404 || (body.errors || []).some((item) => item.code === 10003)) {
    await cf(`/zones/${zoneId}/rulesets`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'VIP GECE Pro managed WAF',
        description: 'Cloudflare Managed Ruleset with vendor defaults',
        kind: 'zone',
        phase: 'http_request_firewall_managed',
        rules: [{
          action: 'execute',
          action_parameters: { id: CLOUDFLARE_MANAGED_RULESET_ID },
          expression: 'true',
          description: 'Execute Cloudflare Managed Ruleset',
          enabled: true,
        }],
      }),
    });
  } else {
    const errors = (body.errors || []).map((item) => item.message || item.code).join('; ');
    throw new Error(`GET ${path}: HTTP ${response.status} ${errors}`);
  }

  const verification = await cf(path);
  const enabled = (verification.result?.rules || []).some((rule) =>
    rule.enabled && rule.action === 'execute' && rule.action_parameters?.id === CLOUDFLARE_MANAGED_RULESET_ID
  );
  if (!enabled) throw new Error('Cloudflare Managed Ruleset verification failed');
  console.log('[verified] Cloudflare Managed Ruleset is enabled');
}

async function configureBotManagement(zoneId) {
  const current = await cf(`/zones/${zoneId}/bot_management`);
  const value = current.result || {};
  const desired = {
    ...value,
    enable_js: true,
    sbfm_definitely_automated: 'allow',
    sbfm_verified_bots: 'allow',
    sbfm_static_resource_protection: false,
    ai_bots_protection: 'disabled',
    content_bots_protection: 'disabled',
    crawler_protection: 'disabled',
    is_robots_txt_managed: false,
  };

  for (const key of ['using_latest_model', 'cf_robots_variant']) delete desired[key];

  await cf(`/zones/${zoneId}/bot_management`, {
    method: 'PUT',
    body: JSON.stringify(desired),
  });
  const verification = await cf(`/zones/${zoneId}/bot_management`);
  const actual = verification.result || {};
  const expected = {
    enable_js: true,
    sbfm_definitely_automated: 'allow',
    sbfm_verified_bots: 'allow',
    sbfm_static_resource_protection: false,
    ai_bots_protection: 'disabled',
    content_bots_protection: 'disabled',
    crawler_protection: 'disabled',
    is_robots_txt_managed: false,
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (actual[key] !== expectedValue) throw new Error(`bot_management.${key} verification failed`);
  }
  console.log('[verified] bot management allows public and verified/search crawlers; WAF remains active');
}

await verifyToken();
const zone = await findZone();
await setSetting(zone.id, 'ssl', 'strict');
await setSetting(zone.id, 'always_use_https', 'on');
await setSetting(zone.id, 'automatic_https_rewrites', 'on');
await setSetting(zone.id, 'min_tls_version', '1.2');
await setSetting(zone.id, 'tls_1_3', 'on');
await setSetting(zone.id, '0rtt', 'off');
await setSetting(zone.id, 'brotli', 'on');
await setSetting(zone.id, 'http3', 'on');
await setSetting(zone.id, 'ipv6', 'on');
await setSetting(zone.id, 'browser_check', 'on');
await setSetting(zone.id, 'security_level', 'medium');
await setSetting(zone.id, 'websockets', 'on');
await setSetting(zone.id, 'early_hints', 'on');
await setSetting(zone.id, 'speed_brain', 'on');
await setSetting(zone.id, 'polish', 'lossless');
await setSetting(zone.id, 'webp', 'on');
await setSetting(zone.id, 'rocket_loader', 'off');
await setSetting(zone.id, 'mirage', 'off');
await ensureManagedWaf(zone.id);
await configureBotManagement(zone.id);
console.log('[done] VIP GECE Cloudflare Pro hardening is active');
