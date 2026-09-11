import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const SKIP_DIRS = new Set([
  ".git",
  ".gradle",
  ".idea",
  ".kotlin",
  ".next",
  ".playwright-cli",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "output",
  "patches"
]);

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".cjs",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".conf",
  ".pem",
  ".properties",
  ".sh",
  ".sql",
  ".txt",
  ".toml",
  ".ts",
  ".tsx",
  ".xml",
  ".yaml",
  ".yml"
]);

const SECRET_PATTERNS = [
  {
    name: "private key block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/
  },
  {
    name: "sk-prefixed key value",
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/
  },
  {
    name: "Cloudflare API token",
    pattern: /\bcfat_[A-Za-z0-9_-]{20,}\b/
  },
  {
    name: "JWT-looking token",
    pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/
  },
  {
    name: "raw bearer token",
    pattern: /Bearer\s+(?!\[token-redacted\]|\$\{|<)[A-Za-z0-9._-]{12,}/i
  },
  {
    name: "Postgres URL",
    pattern: /postgres(?:ql)?:\/\/[^"'\s]+/i
  },
  {
    name: "hardcoded secret assignment",
    pattern:
      /\b(?:api[_-]?key|api[_-]?token|auth[_-]?token|client[_-]?secret|password|private[_-]?key|secret)\b\s*[:=]\s*["'`][A-Za-z0-9_./+=-]{20,}["'`]/i
  }
];

const findings = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(ROOT_DIR, fullPath);

    const isEnvTemplate = entry.name.startsWith(".env") && entry.name.endsWith(".example");
    if (!isEnvTemplate && (entry.name === ".env" || entry.name.startsWith(".env."))) {
      // Local ignored env files are approved secret stores; Git/CI controls
      // are responsible for preventing them from being tracked or packaged.
      continue;
    }

    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }

    if (!entry.isFile() || !TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }

    const fileStat = await stat(fullPath);
    if (fileStat.size > 5 * 1024 * 1024) continue;

    const content = await readFile(fullPath, "utf8");
    let skipNextFixtureLine = false;
    const scannableContent = content
      .split(/\r?\n/)
      .filter((line) => {
        if (line.includes("secret-scan: allow-next-line test fixture")) {
          skipNextFixtureLine = true;
          return false;
        }
        if (skipNextFixtureLine) {
          skipNextFixtureLine = false;
          return false;
        }
        return true;
      })
      .join("\n");
    for (const rule of SECRET_PATTERNS) {
      if (rule.pattern.test(scannableContent)) {
        findings.push(`${relativePath}: ${rule.name}`);
      }
    }
  }
}

await walk(ROOT_DIR);

if (findings.length) {
  for (const finding of findings) {
    console.log(`fail ${finding}`);
  }
  process.exitCode = 1;
} else {
  console.log("ok no secret-like values found in runtime source");
}
