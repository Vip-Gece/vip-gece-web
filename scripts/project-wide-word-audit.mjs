#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { cp, lstat, mkdir, opendir, readlink, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE = path.resolve(__dirname, "..");
const started = new Date();
const stamp = started.toISOString().replace(/[:.]/g, "-");

const WORD_PATTERN = /[\p{L}\p{N}_][\p{L}\p{N}_.'@:/+-]{1,255}/gu;
const ASCII_STRING_PATTERN = /[\x20-\x7e]{4,}/g;
const MAX_SAMPLE_FILES_PER_WORD = 20;
const MAX_RAW_FORMS_PER_WORD = 30;
const MAX_BINARY_CARRY = 512;

function parseArgs(argv) {
  const options = {
    source: DEFAULT_SOURCE,
    out: "",
    copyToTemp: true,
    cleanupSourceCopy: true
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      index++;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };

    if (arg === "--source") options.source = path.resolve(next());
    else if (arg === "--out") options.out = path.resolve(next());
    else if (arg === "--no-copy") options.copyToTemp = false;
    else if (arg === "--keep-source-copy") options.cleanupSourceCopy = false;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  options.source = path.resolve(options.source);
  options.out ||= path.join(os.tmpdir(), `vip-gece-word-audit-${stamp}`);
  return options;
}

function printHelp() {
  console.log(`Project-wide word audit

Usage:
  node scripts/project-wide-word-audit.mjs [options]

Options:
  --source <dir>          Project directory to audit. Defaults to this repo root.
  --out <dir>             Output directory. Defaults to OS temp.
  --no-copy               Scan the source directory directly instead of copying it.
  --keep-source-copy      Keep the temporary source copy after the audit.
  -h, --help              Show this help.

Default server-safe mode:
  The script copies the whole project tree to a temporary directory first, scans
  the temporary copy, removes the copied source tree, and leaves the reports in
  the same temporary audit directory.

Reports:
  summary.md              Human-readable overview.
  file-manifest.jsonl     One line per scanned filesystem entry.
  word-occurrences.jsonl  One line per observed word occurrence.
  all-words.txt           Plain file:line:column word list.
  word-index.jsonl        One line per unique normalized word.
  word-index.csv          Spreadsheet-friendly unique word index.
`);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function toRepoPath(root, filePath) {
  const relative = path.relative(root, filePath).replace(/\\/g, "/");
  return relative || ".";
}

function normalizeWord(word) {
  return word.normalize("NFKC").toLocaleLowerCase("tr");
}

function csv(value) {
  return `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
}

function markdownEscape(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function classesForWord(word) {
  const classes = new Set();
  const normalized = normalizeWord(word);

  if (/^\d+$/.test(word)) classes.add("number");
  if (/^https?:\/\//i.test(word)) classes.add("url");
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(word)) classes.add("email");
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(word)) classes.add("ipv4");
  if (/^[a-f0-9:]{3,}$/i.test(word) && word.includes(":")) classes.add("colon-token");
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(word)) classes.add("domain-like");
  if (/[\\/]/.test(word)) classes.add("path-like");
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(word)) classes.add("env-like");
  if (word.length >= 40) classes.add("long");
  if (word.length >= 120) classes.add("very-long");
  if (/[^\x00-\x7f]/.test(word)) classes.add("non-ascii");
  if (/[._'@:/+-]/.test(word)) classes.add("symbolic");
  if (/[a-z]/.test(word) && /[A-Z]/.test(word)) classes.add("mixed-case");
  if (/[a-zA-Z]/.test(word) && /\d/.test(word)) classes.add("alpha-number");

  const hasLatin = /\p{Script=Latin}/u.test(word);
  const hasGreek = /\p{Script=Greek}/u.test(word);
  const hasCyrillic = /\p{Script=Cyrillic}/u.test(word);
  const hasArabic = /\p{Script=Arabic}/u.test(word);
  if ([hasLatin, hasGreek, hasCyrillic, hasArabic].filter(Boolean).length > 1) {
    classes.add("mixed-script");
  }

  if (/^(sk|pk|ghp|glpat|xox[baprs])[-_]/i.test(word) || /^[A-Za-z0-9+/_=-]{64,}$/.test(word)) {
    classes.add("secret-shaped");
  }

  if (classes.size === 0 && normalized.length > 0) classes.add("plain");
  return [...classes].sort();
}

function isProbablyText(buffer) {
  if (buffer.length === 0) return true;
  if (buffer.includes(0)) return false;

  let printable = 0;
  for (const byte of buffer) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 128) {
      printable++;
    }
  }

  return printable / buffer.length >= 0.9;
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

async function firstChunk(filePath) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    const stream = createReadStream(filePath, { start: 0, end: 8191 });
    stream.on("data", (chunk) => {
      chunks.push(chunk);
      length += chunk.length;
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks, length)));
  });
}

async function* walk(root, current = root) {
  const handle = await opendir(current);
  for await (const entry of handle) {
    const fullPath = path.join(current, entry.name);
    yield fullPath;

    if (entry.isDirectory()) {
      yield* walk(root, fullPath);
    }
  }
}

function openOutput(filePath) {
  return createWriteStream(filePath, { flags: "w", encoding: "utf8" });
}

function writeLine(stream, value) {
  stream.write(`${value}\n`);
}

function updateWordIndex(wordStats, occurrence) {
  const normalized = occurrence.normalized;
  let item = wordStats.get(normalized);

  if (!item) {
    item = {
      normalized,
      count: 0,
      rawForms: new Map(),
      sampleFiles: [],
      fileSet: new Set(),
      classes: new Set(),
      first: {
        file: occurrence.file,
        line: occurrence.line,
        column: occurrence.column,
        word: occurrence.word
      },
      last: null
    };
    wordStats.set(normalized, item);
  }

  item.count++;
  item.rawForms.set(occurrence.word, (item.rawForms.get(occurrence.word) || 0) + 1);
  if (item.rawForms.size > MAX_RAW_FORMS_PER_WORD) {
    const leastUsed = [...item.rawForms.entries()].sort((a, b) => a[1] - b[1])[0]?.[0];
    if (leastUsed) item.rawForms.delete(leastUsed);
  }

  if (!item.fileSet.has(occurrence.file)) {
    item.fileSet.add(occurrence.file);
    if (item.sampleFiles.length < MAX_SAMPLE_FILES_PER_WORD) item.sampleFiles.push(occurrence.file);
  }

  for (const wordClass of occurrence.classes) item.classes.add(wordClass);
  item.last = {
    file: occurrence.file,
    line: occurrence.line,
    column: occurrence.column,
    word: occurrence.word
  };
}

function emitWord(word, location, outputs, wordStats, counters) {
  const normalized = normalizeWord(word);
  if (!normalized) return;

  const occurrence = {
    word,
    normalized,
    classes: classesForWord(word),
    ...location
  };

  counters.words++;
  for (const wordClass of occurrence.classes) {
    counters.wordClasses.set(wordClass, (counters.wordClasses.get(wordClass) || 0) + 1);
  }

  writeLine(outputs.occurrences, JSON.stringify(occurrence));
  writeLine(outputs.allWords, `${occurrence.file}:${occurrence.line}:${occurrence.column}\t${occurrence.word}`);
  updateWordIndex(wordStats, occurrence);
}

async function scanTextFile(filePath, relativePath, outputs, wordStats, counters) {
  const input = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });

  let lineNumber = 0;
  let fileWords = 0;

  for await (const line of reader) {
    lineNumber++;
    WORD_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(WORD_PATTERN)) {
      fileWords++;
      emitWord(match[0], {
        file: relativePath,
        line: lineNumber,
        column: match.index + 1,
        source: "text"
      }, outputs, wordStats, counters);
    }
  }

  return { lines: lineNumber, words: fileWords };
}

async function scanBinaryStrings(filePath, relativePath, outputs, wordStats, counters) {
  let byteOffset = 0;
  let carry = "";
  let strings = 0;
  let words = 0;

  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      const text = carry + chunk.toString("latin1");
      const carryBaseOffset = byteOffset - Buffer.byteLength(carry, "latin1");
      ASCII_STRING_PATTERN.lastIndex = 0;

      for (const match of text.matchAll(ASCII_STRING_PATTERN)) {
        const value = match[0];
        const matchEnd = match.index + value.length;
        if (matchEnd === text.length) continue;

        strings++;
        WORD_PATTERN.lastIndex = 0;
        for (const wordMatch of value.matchAll(WORD_PATTERN)) {
          words++;
          emitWord(wordMatch[0], {
            file: relativePath,
            line: 0,
            column: carryBaseOffset + match.index + wordMatch.index + 1,
            source: "binary-string"
          }, outputs, wordStats, counters);
        }
      }

      const tail = text.match(/[\x20-\x7e]{0,512}$/)?.[0] || "";
      carry = tail.slice(-MAX_BINARY_CARRY);
      byteOffset += chunk.length;
    });
    stream.on("error", reject);
    stream.on("end", () => {
      if (carry) {
        WORD_PATTERN.lastIndex = 0;
        for (const wordMatch of carry.matchAll(WORD_PATTERN)) {
          words++;
          emitWord(wordMatch[0], {
            file: relativePath,
            line: 0,
            column: Math.max(1, byteOffset - Buffer.byteLength(carry, "latin1") + wordMatch.index + 1),
            source: "binary-string"
          }, outputs, wordStats, counters);
        }
      }
      resolve();
    });
  });

  return { strings, words };
}

async function prepareSource(options) {
  await mkdir(options.out, { recursive: true });

  if (!options.copyToTemp) {
    return {
      scanRoot: options.source,
      displayRoot: options.source,
      copied: false,
      sourceCopy: ""
    };
  }

  const sourceCopy = path.join(options.out, "source-copy");
  await rm(sourceCopy, { recursive: true, force: true });
  await cp(options.source, sourceCopy, {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
    filter(sourcePath) {
      const resolvedSourcePath = path.resolve(sourcePath);
      const resolvedOut = path.resolve(options.out);
      return resolvedSourcePath !== resolvedOut && !isInside(resolvedOut, resolvedSourcePath);
    }
  });

  return {
    scanRoot: sourceCopy,
    displayRoot: options.source,
    copied: true,
    sourceCopy
  };
}

async function writeWordIndexes(outDir, wordStats) {
  const jsonlPath = path.join(outDir, "word-index.jsonl");
  const csvPath = path.join(outDir, "word-index.csv");
  const jsonl = openOutput(jsonlPath);
  const csvOut = openOutput(csvPath);

  writeLine(csvOut, [
    "normalized",
    "count",
    "file_count",
    "classes",
    "raw_forms",
    "sample_files",
    "first_location",
    "last_location"
  ].map(csv).join(","));

  const sorted = [...wordStats.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.normalized.localeCompare(b.normalized, "tr");
  });

  for (const item of sorted) {
    const rawForms = [...item.rawForms.entries()].sort((a, b) => b[1] - a[1])
      .map(([form, count]) => `${form}:${count}`);
    const record = {
      normalized: item.normalized,
      count: item.count,
      file_count: item.fileSet.size,
      classes: [...item.classes].sort(),
      raw_forms: rawForms,
      sample_files: item.sampleFiles,
      first: item.first,
      last: item.last
    };
    writeLine(jsonl, JSON.stringify(record));
    writeLine(csvOut, [
      item.normalized,
      item.count,
      item.fileSet.size,
      [...item.classes].sort().join(";"),
      rawForms.join(";"),
      item.sampleFiles.join(";"),
      `${item.first.file}:${item.first.line}:${item.first.column}`,
      `${item.last.file}:${item.last.line}:${item.last.column}`
    ].map(csv).join(","));
  }

  await Promise.all([
    new Promise((resolve) => jsonl.end(resolve)),
    new Promise((resolve) => csvOut.end(resolve))
  ]);
}

async function writeSummary(outDir, options, prepared, counters, wordStats) {
  const summaryPath = path.join(outDir, "summary.md");
  const topWords = [...wordStats.values()].sort((a, b) => b.count - a.count).slice(0, 200);
  const classCounts = [...counters.wordClasses.entries()].sort((a, b) => b[1] - a[1]);
  const topDirs = [...counters.topDirs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80);
  const lines = [
    "# Project-Wide Word Audit",
    "",
    `- Started: ${started.toISOString()}`,
    `- Finished: ${new Date().toISOString()}`,
    `- Source root: ${options.source}`,
    `- Scan root: ${prepared.scanRoot}`,
    `- Output directory: ${outDir}`,
    `- Temporary copy used: ${prepared.copied ? "yes" : "no"}`,
    `- Temporary source copy removed: ${prepared.copied && options.cleanupSourceCopy ? "yes" : "no"}`,
    `- Filesystem entries seen: ${counters.entries}`,
    `- Files scanned: ${counters.files}`,
    `- Directories seen: ${counters.directories}`,
    `- Symlinks seen: ${counters.symlinks}`,
    `- Text files: ${counters.textFiles}`,
    `- Binary/string-scanned files: ${counters.binaryFiles}`,
    `- Bytes scanned: ${counters.bytes}`,
    `- Text lines read: ${counters.lines}`,
    `- Word occurrences: ${counters.words}`,
    `- Unique normalized words: ${wordStats.size}`,
    "",
    "## Reports",
    "",
    "- `file-manifest.jsonl`: every scanned entry with size/hash/type.",
    "- `word-occurrences.jsonl`: every observed word occurrence with file, line, column and source.",
    "- `all-words.txt`: plain file:line:column word list.",
    "- `word-index.jsonl`: unique normalized word index.",
    "- `word-index.csv`: spreadsheet-friendly unique word index.",
    "",
    "## Word Classes",
    "",
    ...classCounts.map(([wordClass, count]) => `- ${wordClass}: ${count}`),
    "",
    "## Top Directories",
    "",
    ...topDirs.map(([dir, count]) => `- ${markdownEscape(dir)}: ${count}`),
    "",
    "## Top 200 Words",
    "",
    "| Word | Count | File count | Classes | First location |",
    "| --- | ---: | ---: | --- | --- |",
    ...topWords.map((item) => [
      markdownEscape(item.normalized),
      item.count,
      item.fileSet.size,
      markdownEscape([...item.classes].sort().join(", ")),
      markdownEscape(`${item.first.file}:${item.first.line}:${item.first.column}`)
    ]).map((row) => `| ${row.join(" | ")} |`),
    ""
  ];

  await new Promise((resolve, reject) => {
    const output = openOutput(summaryPath);
    output.on("error", reject);
    output.end(lines.join("\n"), resolve);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const prepared = await prepareSource(options);
  const outputs = {
    manifest: openOutput(path.join(options.out, "file-manifest.jsonl")),
    occurrences: openOutput(path.join(options.out, "word-occurrences.jsonl")),
    allWords: openOutput(path.join(options.out, "all-words.txt"))
  };
  const counters = {
    entries: 0,
    files: 0,
    directories: 0,
    symlinks: 0,
    textFiles: 0,
    binaryFiles: 0,
    bytes: 0,
    lines: 0,
    words: 0,
    topDirs: new Map(),
    wordClasses: new Map()
  };
  const wordStats = new Map();

  try {
    for await (const entryPath of walk(prepared.scanRoot)) {
      counters.entries++;
      const relativePath = toRepoPath(prepared.scanRoot, entryPath);
      const topDir = relativePath.split("/")[0] || ".";
      counters.topDirs.set(topDir, (counters.topDirs.get(topDir) || 0) + 1);

      const entryStat = await lstat(entryPath);
      if (entryStat.isDirectory()) {
        counters.directories++;
        writeLine(outputs.manifest, JSON.stringify({ path: relativePath, kind: "directory" }));
        continue;
      }

      if (entryStat.isSymbolicLink()) {
        counters.symlinks++;
        writeLine(outputs.manifest, JSON.stringify({
          path: relativePath,
          kind: "symlink",
          target: await readlink(entryPath).catch(() => "")
        }));
        continue;
      }

      if (!entryStat.isFile()) {
        writeLine(outputs.manifest, JSON.stringify({ path: relativePath, kind: "other" }));
        continue;
      }

      counters.files++;
      counters.bytes += entryStat.size;

      const [sample, sha256, fileStat] = await Promise.all([
        firstChunk(entryPath),
        hashFile(entryPath),
        stat(entryPath)
      ]);
      const text = isProbablyText(sample);
      const record = {
        path: relativePath,
        kind: text ? "text" : "binary",
        size: fileStat.size,
        sha256
      };

      if (text) {
        counters.textFiles++;
        const result = await scanTextFile(entryPath, relativePath, outputs, wordStats, counters);
        counters.lines += result.lines;
        record.lines = result.lines;
        record.words = result.words;
      } else {
        counters.binaryFiles++;
        const result = await scanBinaryStrings(entryPath, relativePath, outputs, wordStats, counters);
        record.extracted_strings = result.strings;
        record.words = result.words;
      }

      writeLine(outputs.manifest, JSON.stringify(record));
      if (counters.files % 1000 === 0) {
        console.error(`scanned_files=${counters.files} words=${counters.words}`);
      }
    }
  } finally {
    await Promise.all([
      new Promise((resolve) => outputs.manifest.end(resolve)),
      new Promise((resolve) => outputs.occurrences.end(resolve)),
      new Promise((resolve) => outputs.allWords.end(resolve))
    ]);
  }

  await writeWordIndexes(options.out, wordStats);

  if (prepared.copied && options.cleanupSourceCopy) {
    await rm(prepared.sourceCopy, { recursive: true, force: true });
  }

  await writeSummary(options.out, options, prepared, counters, wordStats);

  console.log(JSON.stringify({
    ok: true,
    source: options.source,
    output: options.out,
    temporary_copy_used: prepared.copied,
    temporary_source_copy_removed: prepared.copied && options.cleanupSourceCopy,
    files_scanned: counters.files,
    text_files: counters.textFiles,
    binary_files: counters.binaryFiles,
    words: counters.words,
    unique_words: wordStats.size,
    summary: path.join(options.out, "summary.md"),
    manifest: path.join(options.out, "file-manifest.jsonl"),
    occurrences: path.join(options.out, "word-occurrences.jsonl"),
    word_index_jsonl: path.join(options.out, "word-index.jsonl"),
    word_index_csv: path.join(options.out, "word-index.csv")
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
