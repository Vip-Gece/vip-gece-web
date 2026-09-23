import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { handle } from '../services/customer-gateway/worker.mjs';

const require = createRequire(import.meta.url);
const middleware = require('../src/middleware/customerGateway');
const api = '/api/customer/mobile';
const env = { ENABLED: 'true', CUSTOMER_ORIGIN_URL: 'https://origin.example.invalid',
  CUSTOMER_GATEWAY_ORIGIN_SECRET: randomBytes(32).toString('hex') };
function request(path = '/bootstrap', options = {}) {
  return new Request('https://gateway.example.invalid' + api + path, {
    ...options, headers: { 'CF-Connecting-IP': '192.0.2.10', ...options.headers }
  });
}
const ok = value => Response.json({ ok: true, ...value });

test('gateway remains closed until explicitly enabled and rejects unknown routes', async () => {
  let calls = 0;
  const origin = async () => { calls++; return ok({}); };
  assert.equal((await handle(request(), { ...env, ENABLED: 'false' }, origin)).status, 404);
  for (const path of ['/bootstrap?debug=1', '/admin', '/profiles/a/images/12']) {
    assert.equal((await handle(request(path), env, origin)).status, 404);
  }
  assert.equal(calls, 0);
});

test('only edge client IP and allowlisted authentication headers reach the origin', async () => {
  const authorization = 'Bearer ' + randomBytes(24).toString('hex');
  const response = await handle(request('/bootstrap', { headers: {
    Authorization: authorization, 'X-Customer-Client-IP': '198.51.100.99',
    'X-Forwarded-For': '198.51.100.99', Cookie: 'unrelated=value'
  } }), env, async (url, init) => {
    assert.equal(url.origin, env.CUSTOMER_ORIGIN_URL);
    assert.equal(init.headers.get('X-Customer-Origin-Secret'), env.CUSTOMER_GATEWAY_ORIGIN_SECRET);
    assert.equal(init.headers.get('X-Customer-Client-IP'), '192.0.2.10');
    assert.equal(init.headers.get('X-Forwarded-For'), null);
    assert.equal(init.headers.get('Cookie'), null);
    assert.equal(init.headers.get('Authorization'), authorization);
    assert.equal(init.redirect, 'manual');
    return ok({});
  });
  assert.equal(response.status, 200);
});

test('Cloudflare pseudo IPv4 preserves the original IPv6 identity', async () => {
  const response = await handle(request('/bootstrap', { headers: {
    'CF-Connecting-IP': '240.0.0.1', 'CF-Connecting-IPv6': '2001:db8::7'
  } }), env, async (_, init) => {
    assert.equal(init.headers.get('X-Customer-Client-IP'), '2001:db8::7');
    return ok({});
  });
  assert.equal(response.status, 200);
});

test('absent, invalid or multi-valued edge identities never reach origin', async () => {
  for (const ip of ['', 'not-an-ip', '192.0.2.1, 192.0.2.2']) {
    let called = false;
    const response = await handle(request('/bootstrap', { headers: { 'CF-Connecting-IP': ip } }), env,
      async () => { called = true; return ok({}); });
    assert.equal(response.status, 403);
    assert.equal(called, false);
  }
});

test('an ordinary edge address cannot be replaced by a supplied IPv6 header', async () => {
  const response = await handle(request('/bootstrap', { headers: { 'CF-Connecting-IPv6': '2001:db8::99' } }), env,
    async (_, init) => {
      assert.equal(init.headers.get('X-Customer-Client-IP'), '192.0.2.10');
      return ok({});
    });
  assert.equal(response.status, 200);
});

test('gateway projects profile images to authenticated paths without origin metadata', async () => {
  const response = await handle(request(), env, async () => ok({
    account: { id: 'one', email: 'fixture@example.invalid', password_hash: 'private' },
    profiles: [{ id: 'p1', name: 'Fixture', owner_user_id: 'private',
      images: ['https://storage.example.invalid/original.jpg'] }],
    quota: { limit: null, unlimited: true, used: 1 }, private_value: 'private'
  }));
  const data = await response.json();
  assert.deepEqual(data.profiles[0].images, [api + '/profiles/p1/images/0']);
  assert.equal(data.account.password_hash, undefined);
  assert.equal(data.profiles[0].owner_user_id, undefined);
  assert.equal(data.private_value, undefined);
  assert.equal(data.quota.unlimited, true);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('upstream redirects, HTML errors and internal diagnostics are not exposed', async () => {
  for (const reply of [new Response(null, { status: 302, headers: { Location: env.CUSTOMER_ORIGIN_URL } }),
    new Response('private diagnostics'), Response.json({ ok: false, error: 'private diagnostics' }, { status: 500 })]) {
    const response = await handle(request(), env, async () => reply);
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /private|origin\.example/);
  }
});

test('mandatory password changes survive error projection', async () => {
  const response = await handle(request(), env, async () => Response.json({
    ok: false, code: 'PASSWORD_CHANGE_REQUIRED', error: 'not exposed'
  }, { status: 403 }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, code: 'PASSWORD_CHANGE_REQUIRED' });
});

test('request body caps and media types are enforced before contacting origin', async () => {
  let calls = 0;
  for (const [type, body, status] of [['text/plain', '{}', 415], ['application/json', 'x'.repeat(65537), 413]]) {
    const response = await handle(request('/login', { method: 'POST', headers: { 'Content-Type': type }, body }), env,
      async () => { calls++; return ok({}); });
    assert.equal(response.status, status);
  }
  assert.equal(calls, 0);
});

test('image upload requires retry identity and original preservation confirmation is explicit', async () => {
  const id = '74f00319-b49a-4a6a-815b-6a7887d894f6';
  const options = { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array([255, 216, 255]) };
  assert.equal((await handle(request('/profiles/p1/images', options), env, async () => ok({}))).status, 400);
  options.headers['X-Upload-Id'] = id;
  const response = await handle(request('/profiles/p1/images', options), env, async (_, init) => {
    assert.equal(init.headers.get('X-Upload-Id'), id);
    return ok({ upload_id: id, original_saved: true });
  });
  assert.deepEqual(await response.json(), { ok: true, upload_id: id, original_saved: true });
});

test('origin trusts client identity only after gateway proof and fails closed otherwise', () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: 'production', CUSTOMER_MOBILE_ENABLED: 'true',
      CUSTOMER_GATEWAY_ORIGIN_SECRET: env.CUSTOMER_GATEWAY_ORIGIN_SECRET });
    for (const [proof, ip, allowed] of [
      ['', '192.0.2.3', false], ['invalid', '192.0.2.3', false],
      [env.CUSTOMER_GATEWAY_ORIGIN_SECRET, '', false],
      [env.CUSTOMER_GATEWAY_ORIGIN_SECRET, '192.0.2.1, 192.0.2.2', false],
      [env.CUSTOMER_GATEWAY_ORIGIN_SECRET, '2001:db8::5', true]
    ]) {
      const req = { ip: '127.0.0.1', get: key => ({ 'x-customer-origin-secret': proof, 'x-customer-client-ip': ip })[key] };
      let next = false, status;
      const res = { set: () => res, setHeader: () => res, removeHeader: () => res,
        status: code => { status = code; return res; }, json: () => res };
      middleware.requireCustomerGateway(req, res, () => { next = true; });
      assert.equal(next, allowed);
      if (allowed) assert.equal(req.customerClientIp, ip);
      else { assert.equal(status, 404); assert.equal(req.customerClientIp, undefined); }
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test('rate limiter isolates clients and groups IPv6 addresses by subnet', () => {
  assert.notEqual(middleware.customerRateLimitKey({ customerClientIp: '192.0.2.1' }),
    middleware.customerRateLimitKey({ customerClientIp: '192.0.2.2' }));
  assert.equal(middleware.customerRateLimitKey({ customerClientIp: '2001:db8::1' }),
    middleware.customerRateLimitKey({ customerClientIp: '2001:db8::2' }));
  assert.equal(middleware.customerRateLimitKey({ ip: '127.0.0.1' }), '127.0.0.1');
});
