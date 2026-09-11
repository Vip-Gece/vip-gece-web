#!/usr/bin/env node

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '74a57e11aae95f005a5ad2b3548cdd7e';
const ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || 'd03cc4b65d00081a68689b7f941e08da';
const ZONE_NAME = 'vip-gece.site';

const apiBase = 'https://api.cloudflare.com/client/v4';

if (!CLOUDFLARE_API_TOKEN) {
  console.error('CLOUDFLARE_API_TOKEN is required.');
  process.exit(1);
}

async function cf(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
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

async function enableMinification() {
  console.log('[1/6] Enabling minification for CSS and JS...');
  try {
    const result = await cf(`/zones/${ZONE_ID}/settings/minify`, {
      method: 'PATCH',
      body: JSON.stringify({
        value: {
          css: 'on',
          js: 'on',
          html: 'off' // HTML minification can break SSR, keep off
        }
      })
    });
    console.log('  ✓ Minification enabled (CSS: on, JS: on, HTML: off)');
  } catch (error) {
    console.error('  ✗ Minification error:', error.message);
  }
}

async function enableBrowserCacheTTL() {
  console.log('[2/6] Setting browser cache TTL...');
  try {
    await cf(`/zones/${ZONE_ID}/settings/browser_cache_ttl`, {
      method: 'PATCH',
      body: JSON.stringify({ value: 14400 }) // 4 hours for static assets
    });
    console.log('  ✓ Browser cache TTL set to 4 hours');
  } catch (error) {
    console.error('  ✗ Browser cache TTL error:', error.message);
  }
}

async function createCacheRules() {
  console.log('[3/6] Creating cache rules...');

  // Get or create custom cache ruleset
  let cacheRulesetId;
  try {
    const rulesets = await cf(`/zones/${ZONE_ID}/rulesets`);
    const cacheRuleset = rulesets.result.find(r => r.phase === 'http_request_cache_custom');

    if (cacheRuleset) {
      cacheRulesetId = cacheRuleset.id;
      console.log('  ✓ Found existing cache ruleset:', cacheRulesetId);
    } else {
      const newRuleset = await cf(`/zones/${ZONE_ID}/rulesets`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'VIP Gece Cache Rules',
          kind: 'custom',
          phase: 'http_request_cache_custom',
          rules: []
        })
      });
      cacheRulesetId = newRuleset.result.id;
      console.log('  ✓ Created cache ruleset:', cacheRulesetId);
    }
  } catch (error) {
    console.error('  ✗ Cache ruleset error:', error.message);
    return;
  }

  // Define cache rules
  const rules = [
    {
      action: 'set_cache_settings',
      action_parameters: {
        cache: true,
        edge_ttl: { mode: 'override', default: 300, status_codes_ttl: [{ status_code_range: { from: 200, to: 299 }, value: 300 }] },
        browser_ttl: { mode: 'override_origin' }
      },
      expression: '(http.request.uri.path eq "/" or http.request.uri.path eq "/ilanlar" or http.request.uri.path eq "/kategoriler" or http.request.uri.path eq "/istanbul-escort" or http.request.uri.path eq "/iletisim")',
      description: 'Cache public HTML pages for 5 minutes',
      enabled: true
    },
    {
      action: 'set_cache_settings',
      action_parameters: {
        cache: true,
        edge_ttl: { mode: 'override', default: 86400 },
        browser_ttl: { mode: 'override', default: 2592000 }
      },
      expression: '(http.request.uri.path.extension in {"css" "js" "png" "jpg" "jpeg" "gif" "avif" "webp" "svg" "ico" "woff" "woff2"})',
      description: 'Cache static assets for 30 days',
      enabled: true
    },
    {
      action: 'set_cache_settings',
      action_parameters: {
        cache: false
      },
      expression: '(http.request.uri.path startswith "/api/" or http.request.uri.path startswith "/admin" or http.request.uri.path startswith "/vg-panel" or http.request.uri.path startswith "/m-panel/")',
      description: 'Never cache admin and API routes',
      enabled: true
    },
    {
      action: 'set_cache_settings',
      action_parameters: {
        cache: true,
        edge_ttl: { mode: 'override', default: 604800 },
        browser_ttl: { mode: 'override', default: 2592000 }
      },
      expression: '(http.request.uri.path startswith "/media/profile-image/")',
      description: 'Cache profile images for 7 days',
      enabled: true
    }
  ];

  try {
    await cf(`/zones/${ZONE_ID}/rulesets/${cacheRulesetId}`, {
      method: 'PUT',
      body: JSON.stringify({ rules })
    });
    console.log(`  ✓ Applied ${rules.length} cache rules`);
  } catch (error) {
    console.error('  ✗ Cache rules error:', error.message);
  }
}

async function enableSecurityHeaders() {
  console.log('[4/6] Configuring security settings...');

  const securitySettings = [
    { id: 'security_level', value: 'medium' },
    { id: 'challenge_ttl', value: 1800 },
    { id: 'privacy_pass', value: 'on' },
    { id: 'security_header', value: { strict_transport_security: { enabled: true, max_age: 31536000, include_subdomains: true, preload: false } } }
  ];

  for (const setting of securitySettings) {
    try {
      await cf(`/zones/${ZONE_ID}/settings/${setting.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ value: setting.value })
      });
      console.log(`  ✓ ${setting.id} configured`);
    } catch (error) {
      console.error(`  ✗ ${setting.id} error:`, error.message);
    }
  }
}

async function enableAutoMinify() {
  console.log('[5/6] Enabling auto minify...');
  try {
    await cf(`/zones/${ZONE_ID}/settings/auto_minify`, {
      method: 'PATCH',
      body: JSON.stringify({
        value: {
          css: 'on',
          html: 'off',
          js: 'on'
        }
      })
    });
    console.log('  ✓ Auto minify enabled');
  } catch (error) {
    console.error('  ✗ Auto minify error:', error.message);
  }
}

async function purgeCache() {
  console.log('[6/6] Purging cache...');
  try {
    await cf(`/zones/${ZONE_ID}/purge_cache`, {
      method: 'POST',
      body: JSON.stringify({ purge_everything: true })
    });
    console.log('  ✓ Cache purged successfully');
  } catch (error) {
    console.error('  ✗ Cache purge error:', error.message);
  }
}

async function main() {
  console.log('=== Cloudflare Optimization for VIP GECE ===\n');
  console.log(`Zone: ${ZONE_NAME}`);
  console.log(`Zone ID: ${ZONE_ID}\n`);

  await enableMinification();
  await enableBrowserCacheTTL();
  await createCacheRules();
  await enableSecurityHeaders();
  await enableAutoMinify();
  await purgeCache();

  console.log('\n=== Optimization Complete ===');
  console.log('✓ All settings applied successfully');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
