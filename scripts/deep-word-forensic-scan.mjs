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
const OUT_DIR = path.join(ROOT, "work", "server-deep-word-scan");
const jsonlPath = path.join(OUT_DIR, `deep-scan-${stamp}.jsonl`);
const summaryPath = path.join(OUT_DIR, `deep-summary-${stamp}.md`);
const wordPath = path.join(OUT_DIR, `word-index-${stamp}.json`);

const SKIP_DIR_NAMES = new Set([".git"]);
const SKIP_RELATIVE_DIRS = new Set([
  "work/server-deep-word-scan",
  "work/forensic-full-tree",
  "work/server-scan-results"
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

const OLD_MARKERS = [
  ["51", "222", "156", "225"].join("."),
  ["2607", "5300", "205", "200", "", "2cc1"].join(":"),
  ["un", "svps"].join(""),
  ["mrs", "site"].join("-"),
  ["baris", "admin"].join(""),
  ["Auss", "chwitz"].join(""),
  ["Vip", "Gece", "Web", "Gelistirme"].join("-")
];
const CHROME_DEBUG_MARKERS = [
  ["9", "222"].join(""),
  ["remote", "debugging"].join("-"),
  ["Dev", "Tools"].join("")
];
const HIDDEN_COMMAND_MARKERS = [
  ["Encoded", "Command"].join(""),
  ["From", "Base64", "String"].join(""),
  [["cert", "util"].join(""), "decode"].join("\\s+-"),
  ["bits", "admin"].join(""),
  ["reg", "svr", "32"].join(""),
  ["run", "dll", "32"].join(""),
  ["sch", "tasks"].join("")
];

const RULES = [
  ["old_infrastructure_trace", new RegExp(OLD_MARKERS.map(escapeRegExp).join("|"), "i"), "HIGH"],
  ["chrome_remote_control", new RegExp(CHROME_DEBUG_MARKERS.map(escapeRegExp).map((value) => value === CHROME_DEBUG_MARKERS[0] ? `\\b${value}\\b` : value).join("|"), "i"), "HIGH"],
  ["download_pipe_execute", /\b(curl|wget|Invoke-WebRequest|iwr|irm|Invoke-RestMethod)\b[^\n|;&]{0,180}(\||;|&&)\s*(sudo\s+)?\b(bash|sh|powershell|pwsh|cmd|node|python)\b/i, "HIGH"],
  ["encoded_or_hidden_command", new RegExp(`\\b(${HIDDEN_COMMAND_MARKERS.join("|")})\\b`, "i"), "HIGH"],
  ["secret_assignment", /\b(api[_-]?key|secret|token|password|passwd|private[_-]?key|service_role)\b\s*[:=]\s*['"]?[^'"\s]{8,}/i, "MEDIUM"],
  ["process_spawn", /\b(child_process|execSync|spawnSync|execFile|spawn\(|Start-Process|subprocess|os\.system)\b/i, "MEDIUM"],
  ["persistence", /\b(systemd|launchd|crontab|pm2|timer|service|autorun|RunOnce|Startup)\b/i, "MEDIUM"],
  ["network_listener", /\b(listen\s*\(|createServer\s*\(|express\(|FastAPI\(|uvicorn|0\.0\.0\.0)\b/i, "MEDIUM"],
  ["external_url", /https?:\/\/[^\s"'<>]+/i, "LOW"],
  ["ip_literal", /\b(?:\d{1,3}\.){3}\d{1,3}\b/i, "LOW"],
  ["long_token", /\b[A-Za-z0-9+/=_-]{80,}\b/i, "LOW"]
];

const WORD_RE = /[\p{L}\p{N}_./:@+-]{2,}/gu;
const TOP_WORD_LIMIT = 2000;
const MAX_SAMPLES_PER_RULE = 8;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

function addWordCounts(text, wordCounts) {
  for (const match of text.matchAll(WORD_RE)) {
    const word = match[0].toLowerCase();
    wordCounts.total++;
    wordCounts.unique.set(word, (wordCounts.unique.get(word) || 0) + 1);
  }
}

function inspectLines(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (const [id, pattern, severity] of RULES) {
    const samples = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!pattern.test(line)) continue;
      samples.push({
        line: index + 1,
        text: line.length > 260 ? `${line.slice(0, 260)}...` : line
      });
      pattern.lastIndex = 0;
      if (samples.length >= MAX_SAMPLES_PER_RULE) break;
    }
    if (samples.length) findings.push({ id, severity, samples });
  }
  return findings;
}

function summarizeSeverity(findings) {
  const high = findings.filter((finding) => finding.severity === "HIGH").map((finding) => finding.id);
  const medium = findings.filter((finding) => finding.severity === "MEDIUM").map((finding) => finding.id);
  const low = findings.filter((finding) => finding.severity === "LOW").map((finding) => finding.id);
  return { high, medium, low };
}

await mkdir(OUT_DIR, { recursive: true });

const records = [];
const wordCounts = { total: 0, unique: new Map() };
const counters = {
  total: 0,
  text: 0,
  binary: 0,
  bytes: 0,
  lines: 0,
  highFiles: 0,
  mediumFiles: 0
};
const findingCounts = new Map();
const topDirs = new Map();

for await (const filePath of walk(ROOT)) {
  counters.total++;
  const relative = rel(filePath);
  const top = relative.split("/")[0] || relative;
  topDirs.set(top, (topDirs.get(top) || 0) + 1);
  const fileStat = await stat(filePath);
  counters.bytes += fileStat.size;
  const firstChunk = await readFile(filePath).then((buffer) => buffer.subarray(0, Math.min(buffer.length, 8192))).catch(() => Buffer.alloc(0));
  const sha256 = await hashFile(filePath);
  const record = { path: relative, size: fileStat.size, sha256 };
  if (isProbablyText(filePath, firstChunk)) {
    counters.text++;
    const text = await readFile(filePath, "utf8").catch(() => "");
    const lines = text.length ? text.split(/\r?\n/).length : 0;
    counters.lines += lines;
    addWordCounts(text, wordCounts);
    const findings = inspectLines(text);
    const severity = summarizeSeverity(findings);
    for (const finding of findings) findingCounts.set(finding.id, (findingCounts.get(finding.id) || 0) + 1);
    if (severity.high.length) counters.highFiles++;
    else if (severity.medium.length) counters.mediumFiles++;
    Object.assign(record, {
      kind: "text",
      lines,
      words: (text.match(WORD_RE) || []).length,
      findings,
      high: severity.high,
      medium: severity.medium,
      low: severity.low
    });
  } else {
    counters.binary++;
    record.kind = "binary";
  }
  records.push(record);
  if (counters.total % 500 === 0) console.error(`deep_scanned=${counters.total}`);
}

const topWords = [...wordCounts.unique.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, TOP_WORD_LIMIT)
  .map(([word, count]) => ({ word, count }));

const jsonl = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
await writeFile(jsonlPath, jsonl);
await writeFile(wordPath, JSON.stringify({
  totalWords: wordCounts.total,
  uniqueWords: wordCounts.unique.size,
  topWords
}, null, 2));

const highRecords = records.filter((record) => record.high?.length);
const mediumRecords = records.filter((record) => !record.high?.length && record.medium?.length);
const summary = [
  "# Deep Word Forensic Scan",
  "",
  `- Started: ${started.toISOString()}`,
  `- Finished: ${new Date().toISOString()}`,
  `- Root: ${ROOT}`,
  `- Files scanned: ${counters.total}`,
  `- Text files: ${counters.text}`,
  `- Binary files: ${counters.binary}`,
  `- Lines read: ${counters.lines}`,
  `- Words read: ${wordCounts.total}`,
  `- Unique words: ${wordCounts.unique.size}`,
  `- Total bytes: ${counters.bytes}`,
  `- High severity files: ${counters.highFiles}`,
  `- Medium-only files: ${counters.mediumFiles}`,
  "",
  "## Top Directories",
  "",
  ...[...topDirs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([dir, count]) => `- ${dir}: ${count}`),
  "",
  "## Finding Counts",
  "",
  ...[...findingCounts.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => `- ${id}: ${count}`),
  "",
  "## High Severity Files",
  "",
  ...highRecords.map((record) => `- ${record.path} (${record.high.join(", ")})`),
  "",
  "## Medium Severity Sample",
  "",
  ...mediumRecords.slice(0, 120).map((record) => `- ${record.path} (${record.medium.join(", ")})`),
  ""
].join("\n");
await writeFile(summaryPath, summary);

console.log(JSON.stringify({
  ok: true,
  ...counters,
  totalWords: wordCounts.total,
  uniqueWords: wordCounts.unique.size,
  jsonl: jsonlPath,
  summary: summaryPath,
  wordIndex: wordPath
}, null, 2));
