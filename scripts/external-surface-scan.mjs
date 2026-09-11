"use strict";

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const HOME_DIR = os.homedir();
const args = process.argv.slice(2);
const argSet = new Set(args);

const PREFIX_PATTERN = /^(SEMRUSH|BRAND24|VIP_GECE).*=/;
const ENV_PREFIXES = ["SEMRUSH", "BRAND24", "VIP_GECE"];
const PROOF_TARGETS = [
  {
    id: "semrush",
    label: "Semrush",
    proof: "docs/external/semrush-vip-gece.md",
    draft: "docs/external/_drafts/semrush-vip-gece.md"
  },
  {
    id: "brand24",
    label: "Brand24",
    proof: "docs/external/brand24-vip-gece.md",
    draft: "docs/external/_drafts/brand24-vip-gece.md"
  }
];

function argValue(name) {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).trim();
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : "";
}

function todayLabel() {
  return new Date().toISOString().slice(0, 10);
}

function compactDate(value) {
  return String(value || todayLabel()).replace(/-/g, "");
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function envNamesByPrefix() {
  return Object.keys(process.env)
    .filter((name) => ENV_PREFIXES.some((prefix) => name.startsWith(prefix)))
    .sort();
}

async function proofInfo(target) {
  const proofPath = path.join(ROOT_DIR, target.proof);
  const draftPath = path.join(ROOT_DIR, target.draft);
  return {
    ...target,
    proofExists: await exists(proofPath),
    draftExists: await exists(draftPath)
  };
}

async function boundedFilenameSearch() {
  const roots = [
    path.join(HOME_DIR, "Desktop"),
    path.join(HOME_DIR, "Downloads"),
    path.join(HOME_DIR, "Documents"),
    path.join(HOME_DIR, "Code")
  ];
  const skipNames = new Set([".git", "node_modules", "Library", "Applications"]);
  const pattern = /semrush|brand24/i;
  const results = [];
  let visited = 0;
  const maxVisited = 120000;
  const maxDepth = 5;

  async function walk(dir, depth) {
    if (visited >= maxVisited || depth > maxDepth || results.length >= 80) return;
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (visited >= maxVisited || results.length >= 80) return;
      if (skipNames.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      visited += 1;
      if (pattern.test(entry.name)) {
        results.push(fullPath);
      }
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      }
    }
  }

  for (const root of roots) {
    await walk(root, 0);
  }

  return { results: [...new Set(results)].sort(), visited, truncated: visited >= maxVisited || results.length >= 80 };
}

async function oldSessionPlanningEvidence() {
  const filePath = path.join(HOME_DIR, "Desktop/vip-gece-ilk-oturum-okunabilir.html");
  try {
    const text = await readFile(filePath, "utf8");
    return {
      path: filePath,
      exists: true,
      mentionsSemrush: /semrush/i.test(text),
      mentionsBrand24: /brand24/i.test(text)
    };
  } catch {
    return { path: filePath, exists: false, mentionsSemrush: false, mentionsBrand24: false };
  }
}

function runVpsCheck() {
  if (!argSet.has("--include-vps")) {
    return { status: "not_run", fileCount: null, processCount: null, raw: "" };
  }

  const remoteScript = [
    "APP_DIR=${VIP_GECE_APP_DIR:-/var/www/vip-gece-site/current}",
    "APP_PROCESS=${VIP_GECE_APP_PROCESS:-vip-gece-site}",
    "file_count=$(sudo -n sh -c \"grep -Ec '^(SEMRUSH|BRAND24|VIP_GECE).*=' \\\"$APP_DIR/.env\\\" 2>/dev/null || true\" 2>/dev/null || echo unreadable)",
    "pid=$(pgrep -f \"$APP_PROCESS|$APP_DIR/server.modular.js\" | head -n1)",
    "if [ -n \"$pid\" ]; then process_count=$(sudo -n sh -c \"tr '\\0' '\\n' < /proc/$pid/environ 2>/dev/null | grep -Ec '^(SEMRUSH|BRAND24|VIP_GECE).*=' || true\" 2>/dev/null || echo unreadable); else process_count=missing_pid; fi",
    "printf 'file_count=%s\\nprocess_count=%s\\n' \"$file_count\" \"$process_count\""
  ].join("; ");

  const sshHost = process.env.VIP_GECE_SSH_HOST || "vip-gece";
  const result = spawnSync("ssh", [sshHost, remoteScript], {
    encoding: "utf8",
    timeout: 15000
  });

  const raw = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.error || result.status !== 0) {
    return {
      status: "error",
      fileCount: null,
      processCount: null,
      raw: raw || result.error?.message || `ssh exited ${result.status}`
    };
  }

  const fileCount = raw.match(/^file_count=(.+)$/m)?.[1]?.trim() || "";
  const processCount = raw.match(/^process_count=(.+)$/m)?.[1]?.trim() || "";
  return {
    status: "checked",
    fileCount,
    processCount,
    raw
  };
}

async function buildReport() {
  const date = argValue("--date") || todayLabel();
  const envNames = envNamesByPrefix();
  const proofs = await Promise.all(PROOF_TARGETS.map(proofInfo));
  const fileSearch = await boundedFilenameSearch();
  const oldSession = await oldSessionPlanningEvidence();
  const vps = runVpsCheck();

  return {
    date,
    generatedAt: new Date().toISOString(),
    env: {
      prefixes: ENV_PREFIXES,
      presentNames: envNames,
      presentCount: envNames.length
    },
    vps,
    proofs,
    fileSearch,
    oldSession
  };
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function displayPath(filePath) {
  const relative = path.relative(ROOT_DIR, filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replace(/\\/g, "/");
  }
  return path.basename(filePath);
}

function markdown(report) {
  const semrushProof = report.proofs.find((item) => item.id === "semrush");
  const brand24Proof = report.proofs.find((item) => item.id === "brand24");
  const vpsText = report.vps.status === "checked"
    ? `file prefix count ${report.vps.fileCount}; process prefix count ${report.vps.processCount}`
    : report.vps.status;
  const candidates = report.fileSearch.results.length
    ? report.fileSearch.results.map((item) => `  - \`${displayPath(item)}\``).join("\n")
    : "  - none";

  return `# VIP GECE External Surface Scan - ${report.date}

Bu dosya proof degildir. Kalan Semrush ve Brand24 kapilarinda mevcut secretsiz
yuzeyi kaydetmek icin tutulur.

Generated: ${report.generatedAt}

## Sonuc

- Local shell env: watched prefixes ${report.env.prefixes.map((item) => `\`${item}\``).join(", ")}; present key count ${report.env.presentCount}.
- VPS production prefix check: ${vpsText}.
- Callable MCP exposure: not proven by this script; verify with tool_search in the active Codex session before claiming connector readiness.
- Semrush proof: target ${yesNo(semrushProof?.proofExists)}, draft ${yesNo(semrushProof?.draftExists)}.
- Brand24 proof: target ${yesNo(brand24Proof?.proofExists)}, draft ${yesNo(brand24Proof?.draftExists)}.
- Old readable session planning note: ${yesNo(report.oldSession.exists)}; Semrush mention ${yesNo(report.oldSession.mentionsSemrush)}; Brand24 mention ${yesNo(report.oldSession.mentionsBrand24)}.
- Bounded filename search visited ${report.fileSearch.visited} entries; truncated ${yesNo(report.fileSearch.truncated)}.

## Candidate Local Files

${candidates}

## Yorum

Reproduce this scan:

\`\`\`sh
node scripts/external-surface-scan.mjs --write --include-vps
\`\`\`

Bu tarama kalan gate'leri kapatmaz; sadece neden kapali kaldiklarini kanitlar.
Full hedefin kapanmasi icin hala sunlardan biri gerekir:

1. Semrush ve Brand24 connector/app yetkisi aktif hale gelir ve gercek rapor
   kaniti \`docs/external/semrush-vip-gece.md\` ile
   \`docs/external/brand24-vip-gece.md\` dosyalarina yazilir.
2. Hesap sahibinden gelen Semrush/Brand24 export veya dashboard referanslari
   \`_drafts\` taslaklarina islenir ve \`npm run external-proof-intake --
   --promote=<proof-id>\` ile promoted proof'a tasinir.
No secrets included.
`;
}

async function main() {
  const report = await buildReport();

  if (argSet.has("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const body = markdown(report);
  if (argSet.has("--write")) {
    const output = argValue("--output")
      || path.join(ROOT_DIR, "docs/external", `external-surface-scan-${compactDate(report.date)}.md`);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, body);
    console.log(`surface_scan_written=${path.relative(ROOT_DIR, output)}`);
    return;
  }

  console.log(body);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
