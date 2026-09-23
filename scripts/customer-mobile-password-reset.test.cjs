"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const svc = require("../src/services/customerMobileAccountService");

let directory;
let storePath;
let saved;

beforeEach(async () => {
  saved = { ...process.env };
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "customer-password-reset-"));
  storePath = path.join(directory, "accounts.json");
  process.env.NODE_ENV = "test";
  process.env.CUSTOMER_ACCOUNT_STORE_BACKEND = "json";
  process.env.CUSTOMER_MOBILE_ACCOUNT_STORE_PATH = storePath;
  process.env.CUSTOMER_MOBILE_SESSION_SECRET = crypto.randomBytes(48).toString("hex");
  process.env.SITE_URL = "https://vip-gece.site";
  delete process.env.CUSTOMER_GATEWAY_URL;
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

async function createAccount(extra = {}) {
  const password = crypto.randomBytes(24).toString("base64url");
  const created = await svc.upsertCustomerMobileAccount("", {
    label: "Test Ajans",
    email: `${crypto.randomUUID()}@example.invalid`,
    password,
    ...extra
  });
  return { created, password };
}

async function readStoredAccount(id) {
  const store = JSON.parse(await fs.readFile(storePath, "utf8"));
  return store.accounts.find((account) => account.id === id);
}

test("reset link üretir: 43 karakter token, hash'li saklama, TTL ve tek kullanım bilgisi", async () => {
  const { created } = await createAccount();
  const link = await svc.issueCustomerMobilePasswordResetLink(created.id, { ttlMinutes: 30 });

  assert.match(link.reset_url, /^https:\/\/vip-gece\.site\/sifre-yenile#[A-Za-z0-9_-]{43}$/);
  assert.equal(link.ttl_minutes, 30);
  assert.ok(Date.parse(link.expires_at) > Date.now());
  assert.equal(link.account.has_password_reset, true);

  const token = link.reset_url.split("#")[1];
  const stored = await readStoredAccount(created.id);
  assert.match(stored.password_reset_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.password_reset_hash, token);
  assert.ok(!JSON.stringify(stored).includes(token));
});

test("start doğrulaması etiket ve maskeli e-posta döner; düz e-posta sızmaz", async () => {
  const { created } = await createAccount();
  const link = await svc.issueCustomerMobilePasswordResetLink(created.id, { ttlMinutes: 15 });
  const token = link.reset_url.split("#")[1];

  const info = await svc.validateCustomerMobilePasswordReset(token);
  assert.equal(info.account.label, "Test Ajans");
  assert.match(info.account.email_masked, /^[^@]\*\*\*@example\.invalid$/);
  assert.ok(!info.account.email_masked.includes(created.email.slice(0, 5)));
});

test("geçersiz ve süresi dolmuş token reddedilir", async () => {
  const { created } = await createAccount();
  const link = await svc.issueCustomerMobilePasswordResetLink(created.id);
  const token = link.reset_url.split("#")[1];

  assert.equal(await svc.validateCustomerMobilePasswordReset("kisa"), null);
  assert.equal(await svc.validateCustomerMobilePasswordReset("A".repeat(43)), null);

  const stored = await readStoredAccount(created.id);
  stored.password_reset_expires_at = new Date(Date.now() - 1000).toISOString();
  await fs.writeFile(storePath, JSON.stringify({ version: 1, accounts: [stored] }, null, 2));
  assert.equal(await svc.validateCustomerMobilePasswordReset(token), null);
});

test("zayıf şifre reddedilir, link tüketilmez", async () => {
  const { created } = await createAccount();
  const link = await svc.issueCustomerMobilePasswordResetLink(created.id);
  const token = link.reset_url.split("#")[1];

  await assert.rejects(
    () => svc.consumeCustomerMobilePasswordReset(token, "kisa"),
    (error) => error.status === 400 && error.code === "WEAK_PASSWORD"
  );
  const stored = await readStoredAccount(created.id);
  assert.ok(stored.password_reset_hash);
});

test("başarılı tüketim: yeni şifre çalışır, eski şifre çalışmaz, link tekrar kullanılamaz", async () => {
  const { created, password } = await createAccount();
  const link = await svc.issueCustomerMobilePasswordResetLink(created.id);
  const token = link.reset_url.split("#")[1];
  const newPassword = crypto.randomBytes(24).toString("base64url");

  await svc.consumeCustomerMobilePasswordReset(token, newPassword);

  const login = await svc.authenticateCustomerMobile(created.email, newPassword);
  assert.ok(login?.session?.token);
  assert.equal(login.account.must_change_password, false);

  assert.equal(await svc.authenticateCustomerMobile(created.email, password), null);
  assert.equal(await svc.validateCustomerMobilePasswordReset(token), null);
  await assert.rejects(
    () => svc.consumeCustomerMobilePasswordReset(token, newPassword),
    (error) => error.status === 400 && error.code === "RESET_LINK_INVALID"
  );

  const stored = await readStoredAccount(created.id);
  assert.equal(stored.password_reset_hash, undefined);
  assert.equal(stored.password_reset_expires_at, undefined);
  assert.equal(typeof stored.password_hash, "string");
  assert.ok(stored.password_updated_at);
});

test("tüketim eski müşteri oturumlarını kapatır (session_version artar)", async () => {
  const { created, password } = await createAccount();
  const login = await svc.authenticateCustomerMobile(created.email, password);
  const oldToken = `Bearer ${login.session.token}`;
  assert.ok(await svc.requireCustomerMobileSession(oldToken));

  const link = await svc.issueCustomerMobilePasswordResetLink(created.id);
  const token = link.reset_url.split("#")[1];
  const newPassword = crypto.randomBytes(24).toString("base64url");
  await svc.consumeCustomerMobilePasswordReset(token, newPassword);

  assert.equal(await svc.requireCustomerMobileSession(oldToken), null);
});

test("bağlantı kaynağı yapılandırılmamışsa 503 döner ve store değişmez", async () => {
  const { created } = await createAccount();
  delete process.env.SITE_URL;
  delete process.env.CUSTOMER_GATEWAY_URL;

  await assert.rejects(
    () => svc.issueCustomerMobilePasswordResetLink(created.id),
    (error) => error.status === 503
  );
  const stored = await readStoredAccount(created.id);
  assert.equal(stored.password_reset_hash, undefined);
});

test("TTL sınırlanır (5-1440 dk)", async () => {
  const { created } = await createAccount();
  const short = await svc.issueCustomerMobilePasswordResetLink(created.id, { ttlMinutes: 1 });
  assert.equal(short.ttl_minutes, 5);
  const long = await svc.issueCustomerMobilePasswordResetLink(created.id, { ttlMinutes: 99999 });
  assert.equal(long.ttl_minutes, 1440);
});
