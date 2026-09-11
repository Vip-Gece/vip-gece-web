import "dotenv/config";

const ZONE_NAME = "vip-gece.site";
const API_BASE = "https://api.cloudflare.com/client/v4";
const PURGE_URLS = [
  `https://${ZONE_NAME}/robots.txt`,
  `https://www.${ZONE_NAME}/robots.txt`
];
const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || "";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || "";

if (!token) throw new Error("Cloudflare token unavailable");

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json"
};

async function cloudflare(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success !== true) {
    throw new Error(`Cloudflare request failed: ${response.status}`);
  }
  return body;
}

const verifyPath = token.startsWith("cfat_")
  ? `/accounts/${encodeURIComponent(accountId)}/tokens/verify`
  : "/user/tokens/verify";
if (token.startsWith("cfat_") && !accountId) {
  throw new Error("Cloudflare account identity unavailable");
}

await cloudflare(verifyPath);
const zones = await cloudflare(
  `/zones?name=${encodeURIComponent(ZONE_NAME)}&status=active&per_page=10`
);
const exactZones = (zones.result || []).filter(
  (zone) => zone.name === ZONE_NAME && zone.status === "active" && zone.paused !== true
);
if (exactZones.length !== 1) {
  throw new Error("Exact active vip-gece.site zone not found");
}

await cloudflare(`/zones/${exactZones[0].id}/purge_cache`, {
  method: "POST",
  body: JSON.stringify({ files: PURGE_URLS })
});

console.log(JSON.stringify({
  zone: exactZones[0].name,
  status: exactZones[0].status,
  paused: exactZones[0].paused === true,
  cache_purge_mode: "files",
  purged_urls: PURGE_URLS,
  dns_changed: false
}));
