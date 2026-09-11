#!/usr/bin/env node

const DEFAULT_ZONE_NAME = 'vip-gece.site';
const DEFAULT_IPV4 = '159.69.146.114';
const DEFAULT_IPV6 = '';

function argValue(name, fallback = '') {
  const prefixed = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefixed));
  if (inline) return inline.slice(prefixed.length);
  const index = process.argv.indexOf(name);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function requireValue(value, label) {
  if (!value) {
    console.error(`[cloudflare-cutover] Missing ${label}. Set env or pass ${label}.`);
    process.exit(2);
  }
  return value;
}

const token = requireValue(
  process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || argValue('--token'),
  'CLOUDFLARE_API_TOKEN'
);
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || argValue('--account-id');
const zoneName = argValue('--zone-name', process.env.CLOUDFLARE_ZONE_NAME || DEFAULT_ZONE_NAME);
const ipv4 = argValue('--ipv4', process.env.VIP_GECE_ORIGIN_IPV4 || DEFAULT_IPV4);
const ipv6 = argValue('--ipv6', process.env.VIP_GECE_ORIGIN_IPV6 || DEFAULT_IPV6);
const dryRun = hasFlag('--dry-run');
const purge = !hasFlag('--no-purge');
const includeIpv6 = !hasFlag('--no-ipv6');

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
    const errors = Array.isArray(body.errors) ? body.errors.map((e) => e.message || e.code).join('; ') : response.statusText;
    throw new Error(`${options.method || 'GET'} ${path} failed: HTTP ${response.status} ${errors}`);
  }
  return body;
}

async function verifyToken() {
  const isAccountToken = token.startsWith('cfat_');
  if (isAccountToken && !accountId) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID is required for an account-owned token');
  }
  const verifyPath = isAccountToken
    ? `/accounts/${encodeURIComponent(accountId)}/tokens/verify`
    : '/user/tokens/verify';
  const response = await fetch(`${apiBase}${verifyPath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success !== true) {
    const errors = Array.isArray(body.errors) ? body.errors.map((e) => `${e.code || 'unknown'} ${e.message || ''}`.trim()).join('; ') : response.statusText;
    throw new Error(`Cloudflare token verification failed: HTTP ${response.status} ${errors}`);
  }
  if (body.result?.status && body.result.status !== 'active') {
    throw new Error(`Cloudflare token is not active: ${body.result.status}`);
  }
}

async function findZone() {
  const body = await cf(`/zones?name=${encodeURIComponent(zoneName)}&per_page=10`);
  const zone = (body.result || []).find((item) => item.name === zoneName);
  if (!zone) throw new Error(`Zone not found: ${zoneName}`);
  return zone;
}

async function listRecords(zoneId) {
  const body = await cf(`/zones/${zoneId}/dns_records?per_page=100`);
  return body.result || [];
}

function targetRecords() {
  const records = [
    { type: 'A', name: zoneName, content: ipv4 },
    { type: 'A', name: `www.${zoneName}`, content: ipv4 },
  ];
  if (includeIpv6 && ipv6) {
    records.push({ type: 'AAAA', name: zoneName, content: ipv6 });
    records.push({ type: 'AAAA', name: `www.${zoneName}`, content: ipv6 });
  }
  return records;
}

async function upsertRecord(zoneId, existing, target) {
  const cname = existing.find((record) => record.type === 'CNAME' && record.name === target.name);
  if (cname && (target.type === 'A' || target.type === 'AAAA')) {
    console.log(`[preserved] CNAME ${target.name} -> ${cname.content} proxied=${cname.proxied}`);
    return;
  }
  const current = existing.find((record) => record.type === target.type && record.name === target.name);
  const proxied = current?.proxied ?? true;
  const ttl = proxied ? 1 : (current?.ttl || 1);
  const payload = {
    type: target.type,
    name: target.name,
    content: target.content,
    proxied,
    ttl,
  };
  if (dryRun) {
    console.log(`[dry-run] ${current ? 'PATCH' : 'POST'} ${target.type} ${target.name} -> ${target.content} proxied=${proxied}`);
    return;
  }
  if (current) {
    await cf(`/zones/${zoneId}/dns_records/${current.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    console.log(`[updated] ${target.type} ${target.name} -> ${target.content} proxied=${proxied}`);
  } else {
    await cf(`/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    console.log(`[created] ${target.type} ${target.name} -> ${target.content} proxied=${proxied}`);
  }
}

async function purgeCache(zoneId) {
  if (!purge) return;
  if (dryRun) {
    console.log('[dry-run] purge everything for vip-gece.site zone');
    return;
  }
  await cf(`/zones/${zoneId}/purge_cache`, {
    method: 'POST',
    body: JSON.stringify({ purge_everything: true }),
  });
  console.log('[purged] Cloudflare cache for vip-gece.site');
}

async function main() {
  if (zoneName !== DEFAULT_ZONE_NAME) {
    throw new Error(`Refusing to modify non-VIP zone: ${zoneName}`);
  }
  await verifyToken();
  const zone = await findZone();
  console.log(`[zone] ${zone.name} ${zone.id.slice(0, 8)}...${zone.id.slice(-4)} status=${zone.status}`);
  const records = await listRecords(zone.id);
  for (const target of targetRecords()) {
    await upsertRecord(zone.id, records, target);
  }
  await purgeCache(zone.id);
  console.log('[done] DNS cutover request completed. Verify public DNS/HTTPS after Cloudflare propagation.');
}

main().catch((error) => {
  console.error(`[cloudflare-cutover] ${error.message}`);
  process.exit(1);
});
