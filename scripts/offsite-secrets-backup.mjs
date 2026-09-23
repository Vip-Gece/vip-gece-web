#!/usr/bin/env node
"use strict";

// Şifreli offsite yedek (age): sunucudaki günlük `secrets-*.tar.gz` dosyasını
// çeker, age ile şifreler ve iCloud Drive hedefine (ya da --target) yazar.
// Kimlik dosyası: yerelde ~/.codex/.secrets içinde (600) + sunucuda root-only kopya.
// Gizli değerler hiçbir zaman stdout'a yazılmaz; yalnızca dosya adı/hash özeti basılır.
//
// Kullanım:
//   node scripts/offsite-secrets-backup.mjs [--refresh] [--keep=8] [--dry-run]
//                                          [--target=DIR] [--server=ALIAS] [--identity=FILE]

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = new Map();
for (const part of process.argv.slice(2)) {
  if (!part.startsWith("--")) continue;
  const eq = part.indexOf("=");
  if (eq === -1) args.set(part, true);
  else args.set(part.slice(0, eq), part.slice(eq + 1));
}

const SERVER = args.get("--server") || "vip-gece-hetzner";
const REMOTE_DIR = "/var/backups/vip-gece";
const REMOTE_IDENTITY = "/var/lib/vip-gece/signing/offsite-age-identity.txt";
const IDENTITY =
  args.get("--identity") ||
  path.join(os.homedir(), ".codex/.secrets/vip-gece-offsite-age-identity.txt");
const TARGET =
  args.get("--target") ||
  path.join(os.homedir(), "Library/Mobile Documents/com~apple~CloudDocs/VIP-Gece-Backups");
const KEEP = Math.max(1, Number(args.get("--keep") || 8));
const REFRESH = args.get("--refresh") === true;
const DRY = args.get("--dry-run") === true;

const AGE =
  ["/opt/homebrew/bin/age", "/usr/local/bin/age", "/usr/bin/age"].find((p) => fs.existsSync(p)) ||
  "age";
const AGE_KEYGEN = AGE === "age" ? "age-keygen" : AGE.replace(/age$/, "age-keygen");

function ssh(command, options = {}) {
  return execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", SERVER, command], {
    encoding: options.binary || options.input ? undefined : "utf8",
    input: options.input,
    maxBuffer: 256 * 1024 * 1024
  });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  console.error(`offsite-backup: ${message}`);
  process.exit(1);
}

if (REFRESH) {
  ssh("systemctl start vip-gece-backup.service");
}

const remotePath = String(ssh(`ls -t ${REMOTE_DIR}/secrets-*.tar.gz 2>/dev/null | head -1`)).trim();
if (!remotePath) fail("sunucuda secrets-*.tar.gz bulunamadı");

const remoteName = path.basename(remotePath);
const sums = String(ssh(`cat ${REMOTE_DIR}/SHA256SUMS 2>/dev/null || true`));
const plainSha = (sums.split("\n").find((line) => line.trim().endsWith(`./${remoteName}`)) || "").split(/\s+/)[0];
if (!/^[0-9a-f]{64}$/.test(plainSha)) fail(`${remoteName} için SHA256SUMS kaydı bulunamadı`);

const payload = ssh(`cat ${remotePath}`, { binary: true });
if (sha256(payload) !== plainSha) fail("indirilen arşivin sha256 değeri sunucu kaydıyla eşleşmiyor");

if (!fs.existsSync(IDENTITY)) {
  fs.mkdirSync(path.dirname(IDENTITY), { recursive: true, mode: 0o700 });
  execFileSync(AGE_KEYGEN, ["-o", IDENTITY], { stdio: "ignore" });
  fs.chmodSync(IDENTITY, 0o600);
}
const recipient = String(execFileSync(AGE_KEYGEN, ["-y", IDENTITY], { encoding: "utf8" })).trim();
if (!recipient.startsWith("age1")) fail("age alıcı anahtarı okunamadı");

const remoteHasIdentity = String(ssh(`test -f ${REMOTE_IDENTITY} && echo var || echo yok`)).trim() === "var";
if (!remoteHasIdentity) {
  ssh(`cat > ${REMOTE_IDENTITY} && chmod 600 ${REMOTE_IDENTITY}`, { input: fs.readFileSync(IDENTITY) });
}

const stamp = (remoteName.match(/(\d{8}T\d{6}Z)/) || [])[1] || new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
const outName = `vip-gece-secrets-${stamp}.tar.gz.age`;
const outPath = path.join(TARGET, outName);

fs.mkdirSync(TARGET, { recursive: true, mode: 0o700 });
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vip-offsite-"));
const tmpTar = path.join(tmpDir, remoteName);

try {
  fs.writeFileSync(tmpTar, payload, { mode: 0o600 });
  if (DRY) {
    console.log(JSON.stringify({ dry_run: true, source: remoteName, plain_sha256: plainSha, would_write: outPath }));
    process.exit(0);
  }
  execFileSync(AGE, ["-e", "-r", recipient, "-o", outPath, tmpTar], { stdio: "ignore" });
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const cipherSha = sha256(fs.readFileSync(outPath));
fs.writeFileSync(
  `${outPath}.sha256`,
  [
    `${cipherSha}  ${outName}`,
    `${plainSha}  ${remoteName}`,
    `source=${SERVER}:${remotePath}`,
    `recipient=${recipient}`,
    `created=${new Date().toISOString()}`
  ].join("\n") + "\n",
  { mode: 0o644 }
);

const pruned = [];
const copies = fs
  .readdirSync(TARGET)
  .filter((name) => /^vip-gece-secrets-.*\.tar\.gz\.age$/.test(name))
  .sort((a, b) => b.localeCompare(a));
for (const stale of copies.slice(KEEP)) {
  fs.rmSync(path.join(TARGET, stale), { force: true });
  fs.rmSync(path.join(TARGET, `${stale}.sha256`), { force: true });
  pruned.push(stale);
}

console.log(
  JSON.stringify({
    source: remoteName,
    plain_sha256: plainSha,
    cipher_file: outName,
    cipher_sha256: cipherSha,
    target: TARGET,
    kept: Math.min(copies.length, KEEP),
    pruned,
    recipient
  })
);
