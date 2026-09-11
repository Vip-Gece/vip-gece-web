#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, opendir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const started = new Date();
const stamp = started.toISOString().replace(/[:.]/g, "-");
const OUT_DIR = path.join(ROOT, "work", "forensic-full-tree");
const jsonlPath = path.join(OUT_DIR, `scan-${stamp}.jsonl`);
const summaryPath = path.join(OUT_DIR, `summary-${stamp}.md`);

const SKIP_DIR_NAMES = new Set([".git"]);
const SKIP_RELATIVE_DIRS = new Set([
  "work/forensic-full-tree",
  "work/server-scan-results",
  "work/server-deep-word-scan"
]);
const TEXT_EXTENSIONS = new Set([
  ".cjs", ".conf", ".css", ".csv", ".env", ".example", ".html", ".ini",
  ".js", ".json", ".jsonl", ".jsx", ".local", ".lock", ".log", ".md",
  ".mjs", ".ps1", ".py", ".service", ".sh", ".sql", ".svg", ".timer",
  ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml"
]);
const BINARY_EXTENSIONS = new Set([
  ".7z", ".apk", ".avif", ".crt", ".db", ".dll", ".exe", ".gif", ".gz",
  ".ico", ".jar", ".jpg", ".jpeg", ".keystore", ".map", ".mp4", ".pdf",
  ".pem", ".png", ".pyd", ".so", ".tar", ".webp", ".zip"
]);

const REMOVED_OLD_ORIGIN_MARKERS = [
  ["51", "222", "156", "225"].join("."),
  ["2607", "5300", "205", "200", "", "2cc1"].join(":")
];
const CHROME_DEBUG_MARKERS = [
  ["9", "222"].join(""),
  ["remote", "debugging"].join("-"),
  ["Dev", "Tools"].join("")
];
const DOWNLOAD_COMMANDS = ["curl", "wget", "Invoke-WebRequest", "iwr", "irm", "Invoke-RestMethod"];
const EXECUTOR_COMMANDS = ["bash", "sh", "powershell", "pwsh", "cmd", "node", "python"];
const POWERSHELL_OR_CMD_MARKERS = [
  "powershell",
  "pwsh",
  ["cmd", "exe"].join("\\."),
  ["Start", "Process"].join("-"),
  ["Encoded", "Command"].join("")
];
const PERSISTENCE_MARKERS = [
  "systemd",
  "launchd",
  ["sch", "tasks"].join(""),
  "crontab",
  "pm2",
  "timer",
  "service"
];

const PATTERNS = [
  ["removed_old_origin_ip", new RegExp(REMOVED_OLD_ORIGIN_MARKERS
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"), "i"), "HIGH"],
  ["chrome_debug_port", new RegExp(CHROME_DEBUG_MARKERS
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .map((value) => value === CHROME_DEBUG_MARKERS[0] ? `\\b${value}\\b` : value)
    .join("|"), "i"), "HIGH"],
  ["shell_download_exec", new RegExp(
    `\\b(${DOWNLOAD_COMMANDS.join("|")})\\b[^\\n|;&]{0,160}(\\||;|&&)\\s*(sudo\\s+)?\\b(${EXECUTOR_COMMANDS.join("|")})\\b`,
    "i"
  ), "HIGH"],
  ["powershell_or_cmd", new RegExp(`\\b(${POWERSHELL_OR_CMD_MARKERS.join("|")})\\b`, "i"), "MEDIUM"],
  ["node_child_process", /\b(child_process|execSync|spawnSync|execFile|spawn\()/i, "MEDIUM"],
  ["dynamic_eval", /\b(eval\s*\(|new Function\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`])/i, "MEDIUM"],
  ["persistence_unit", new RegExp(`\\b(${PERSISTENCE_MARKERS.join("|")})\\b`, "i"), "MEDIUM"],
  ["network_listener", /\b(listen\s*\(|createServer\s*\(|FastAPI\(|uvicorn|express\()/i, "MEDIUM"],
  ["cloudflare_mutation", /\bcloudflare\b[\s\S]{0,160}\b(DNS|zone|purge|ruleset|firewall|cache)\b/i, "MEDIUM"],
  ["google_credential", /\b(GOOGLE_APPLICATION_CREDENTIALS|GSC_|GOOGLE_SEARCH_CONSOLE|private_key|client_email)\b/i, "MEDIUM"],
  ["secret_like", /\b(api[_-]?key|secret|token|password|passwd|private[_-]?key)\b\s*[:=]/i, "MEDIUM"],
  ["ip_literal", /\b(?:\d{1,3}\.){3}\d{1,3}\b/i, "LOW"],
  ["url_literal", /https?:\/\/[^\s"'<>]+/i, "LOW"],
  ["long_base64", /(?:[A-Za-z0-9+/]{80,}={0,2})/i, "LOW"]
];

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function isProbablyText(filePath, buffer) {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (BINARY_EXTENSIONS.has(ext)) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) return false;
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 128) printable++;
  }
  return sample.length === 0 || printable / sample.length > 0.92;
}

async function* walk(dir) {
  const relativeDir = rel(dir);
  if (SKIP_RELATIVE_DIRS.has(relativeDir)) return;
  const handle = await opendir(dir);
  for await (const entry of handle) {
    if (entry.isDirectory() && SKIP_DIR_NAMES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

function firstLine(text, pattern) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) return { line: i + 1, text: lines[i].slice(0, 240) };
  }
  return null;
}

function scanText(relativePath, text) {
  const findings = [];
  for (const [id, pattern, severity] of PATTERNS) {
    pattern.lastIndex = 0;
    if (!pattern.test(text)) continue;
    pattern.lastIndex = 0;
    findings.push({ id, severity, sample: firstLine(text, pattern) });
  }

  if (relativePath.endsWith("package.json")) {
    try {
      const parsed = JSON.parse(text);
      const scripts = parsed && typeof parsed === "object" && parsed.scripts && typeof parsed.scripts === "object"
        ? parsed.scripts
        : {};
      for (const name of ["preinstall", "install", "postinstall", "prepare"]) {
        if (scripts[name]) {
          findings.push({
            id: `npm_lifecycle_${name}`,
            severity: relativePath.includes("node_modules/") ? "LOW" : "MEDIUM",
            sample: { line: 1, text: `${name}: ${String(scripts[name]).slice(0, 220)}` }
          });
        }
      }
    } catch {
      findings.push({ id: "invalid_package_json", severity: "LOW", sample: null });
    }
  }

  return findings;
}

function severityRank(severity) {
  return severity === "HIGH" ? 3 : severity === "MEDIUM" ? 2 : severity === "LOW" ? 1 : 0;
}

await mkdir(OUT_DIR, { recursive: true });

let total = 0;
let textCount = 0;
let binaryCount = 0;
let totalBytes = 0;
const byFinding = new Map();
const byTopDir = new Map();
const highFiles = [];
const mediumFiles = [];
const out = [];

for await (const filePath of walk(ROOT)) {
  total++;
  const relativePath = rel(filePath);
  const info = await stat(filePath);
  totalBytes += info.size;
  const top = relativePath.split("/")[0] || ".";
  byTopDir.set(top, (byTopDir.get(top) || 0) + 1);
  const sha256 = await hashFile(filePath);
  const buffer = await readFile(filePath);
  const isText = isProbablyText(filePath, buffer);
  const record = {
    path: relativePath,
    size: info.size,
    sha256,
    kind: isText ? "text" : "binary",
    findings: []
  };

  if (isText) {
    textCount++;
    const text = buffer.toString("utf8");
    record.lines = text.length ? text.split(/\r?\n/).length : 0;
    record.words = text.trim() ? text.trim().split(/\s+/).length : 0;
    record.findings = scanText(relativePath, text);
  } else {
    binaryCount++;
  }

  let maxRank = 0;
  for (const finding of record.findings) {
    byFinding.set(finding.id, (byFinding.get(finding.id) || 0) + 1);
    maxRank = Math.max(maxRank, severityRank(finding.severity));
  }
  if (maxRank >= 3) highFiles.push(record);
  else if (maxRank === 2) mediumFiles.push(record);
  out.push(JSON.stringify(record));

  if (total % 500 === 0) {
    console.error(`scanned=${total}`);
  }
}

await writeFile(jsonlPath, `${out.join("\n")}\n`, "utf8");

const topFindings = [...byFinding.entries()].sort((a, b) => b[1] - a[1]);
const topDirs = [...byTopDir.entries()].sort((a, b) => b[1] - a[1]);

const summary = [
  `# Full Tree Forensic Scan`,
  ``,
  `- Started: ${started.toISOString()}`,
  `- Finished: ${new Date().toISOString()}`,
  `- Root: ${ROOT}`,
  `- Files scanned: ${total}`,
  `- Text files content-scanned: ${textCount}`,
  `- Binary files hashed: ${binaryCount}`,
  `- Total bytes: ${totalBytes}`,
  `- High severity files: ${highFiles.length}`,
  `- Medium severity files: ${mediumFiles.length}`,
  ``,
  `## Top Directories`,
  ``,
  ...topDirs.slice(0, 30).map(([name, count]) => `- ${name}: ${count}`),
  ``,
  `## Finding Counts`,
  ``,
  ...topFindings.map(([name, count]) => `- ${name}: ${count}`),
  ``,
  `## High Severity Files`,
  ``,
  ...highFiles.slice(0, 200).map((file) => {
    const labels = file.findings.filter((finding) => finding.severity === "HIGH").map((finding) => finding.id).join(", ");
    return `- ${file.path} (${labels})`;
  }),
  ``,
  `## Medium Severity Sample`,
  ``,
  ...mediumFiles.slice(0, 200).map((file) => {
    const labels = file.findings.filter((finding) => finding.severity === "MEDIUM").map((finding) => finding.id).join(", ");
    return `- ${file.path} (${labels})`;
  }),
  ``
].join("\n");

await writeFile(summaryPath, summary, "utf8");

console.log(JSON.stringify({
  ok: true,
  total,
  text_files: textCount,
  binary_files: binaryCount,
  high_files: highFiles.length,
  medium_files: mediumFiles.length,
  jsonl: jsonlPath,
  summary: summaryPath
}, null, 2));
