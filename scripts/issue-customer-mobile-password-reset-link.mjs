#!/usr/bin/env node
"use strict";

// Müşteri (mobile) hesabı için tek kullanımlık şifre yenileme bağlantısı üretir.
//
// Kullanım:
//   node scripts/issue-customer-mobile-password-reset-link.mjs --account=mrsajans@vipgece.com
//   node scripts/issue-customer-mobile-password-reset-link.mjs --account=<id> --ttl-minutes=120
//   node scripts/issue-customer-mobile-password-reset-link.mjs --account=... --out=~/.config/vip-gece/mrs-reset-link.txt
//
// Güvenlik notu: link tek kullanımlık ve sürelidir. --out verilmezse link terminale yazılır;
// paylaşılan/loglanan ortamlarda --out ile 600 izinli dosyaya yazıp dosyayı güvenli kanaldan iletin.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env", quiet: true });

const svc = require("../src/services/customerMobileAccountService");

function arg(name, fallback = "") {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1).trim();
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : fallback;
}

function fail(message) {
  console.error(`hata: ${message}`);
  process.exit(1);
}

async function main() {
  const target = arg("--account");
  if (!target) fail("--account=<id|email|label> gerekli.");

  const ttlRaw = Number.parseInt(arg("--ttl-minutes", ""), 10);
  const options = Number.isFinite(ttlRaw) ? { ttlMinutes: ttlRaw } : {};

  const accounts = await svc.listCustomerMobileAccounts();
  const needle = target.toLowerCase();
  const account = accounts.find((item) =>
    item.id === target ||
    String(item.email || "").toLowerCase() === needle ||
    String(item.username || "").toLowerCase() === needle ||
    String(item.label || "").toLowerCase() === needle
  );
  if (!account) fail(`Hesap bulunamadı: ${target}`);

  const result = await svc.issueCustomerMobilePasswordResetLink(account.id, options);

  const out = arg("--out");
  const summary = {
    account: result.account.label || result.account.email,
    account_id: result.account.id,
    email_masked: String(result.account.email || "").replace(/^(.).*(@.*)$/, "$1***$2"),
    expires_at: result.expires_at,
    ttl_minutes: result.ttl_minutes
  };
  console.log(JSON.stringify(summary, null, 2));

  if (out) {
    const filePath = path.resolve(out.replace(/^~(?=\/)/, os.homedir()));
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, `${result.reset_url}\n`, { mode: 0o600 });
    console.log(`link_dosyasi=${filePath} (600, tek kullanımlık, ${result.ttl_minutes} dk)`);
  } else {
    console.log(`reset_url=${result.reset_url}`);
  }
}

main().catch((error) => fail(error?.message || String(error)));
