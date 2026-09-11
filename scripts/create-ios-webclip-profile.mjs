"use strict";

import { readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconPath = path.join(rootDir, "public/assets/vip-gece-woman-icon-512.png");
const outPath = path.join(rootDir, "vip-gece-yonetim.mobileconfig");

function deterministicUuid(value) {
  const bytes = crypto.createHash("sha256").update(String(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapBase64(value) {
  return value.match(/.{1,76}/g)?.join("\n") || value;
}

async function main() {
  const icon = await readFile(iconPath);
  const webClipUuid = deterministicUuid("com.vipgece.admin.webclip");
  const profileUuid = deterministicUuid("com.vipgece.admin.profile");
  const profile = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>FullScreen</key>
      <true/>
      <key>Icon</key>
      <data>
${wrapBase64(icon.toString("base64"))}
      </data>
      <key>IsRemovable</key>
      <true/>
      <key>Label</key>
      <string>${xmlEscape("VIP Yönetim")}</string>
      <key>PayloadDescription</key>
      <string>${xmlEscape("VIP GECE yönetim panelini iPhone ana ekranına ekler.")}</string>
      <key>PayloadDisplayName</key>
      <string>${xmlEscape("VIP GECE Yönetim")}</string>
      <key>PayloadIdentifier</key>
      <string>com.vipgece.admin.webclip</string>
      <key>PayloadOrganization</key>
      <string>${xmlEscape("VIP GECE")}</string>
      <key>PayloadType</key>
      <string>com.apple.webClip.managed</string>
      <key>PayloadUUID</key>
      <string>${webClipUuid}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>Precomposed</key>
      <false/>
      <key>URL</key>
      <string>http://127.0.0.1:8443/vg-panel-91x</string>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>${xmlEscape("VIP GECE yönetim paneli için iOS ana ekran kısayolu.")}</string>
  <key>PayloadDisplayName</key>
  <string>${xmlEscape("VIP GECE Yönetim")}</string>
  <key>PayloadIdentifier</key>
  <string>com.vipgece.admin.profile</string>
  <key>PayloadOrganization</key>
  <string>${xmlEscape("VIP GECE")}</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${profileUuid}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;
  await writeFile(outPath, profile);
  console.log(outPath);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
