import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import CleanCSS from "clean-css";
import { minify as minifyJs } from "terser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const { verifyManifestSignature } = require("../src/services/mobileReleaseManifest");
const DATE_LABEL = process.env.PACKAGE_DATE_LABEL || "20260810";
const DEFAULT_PACKAGE_PATH = path.resolve(
  ROOT_DIR,
  "..",
  "patches",
  `vip-gece-runtime-${DATE_LABEL}-seo-index-automation.tar.gz`
);
const PACKAGE_PATH = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_PACKAGE_PATH;
const SHA_PATH = process.argv[3] ? path.resolve(process.argv[3]) : `${PACKAGE_PATH}.sha256`;
const DOC_HASH_SYNC_TARGETS = [
  {
    path: path.join(ROOT_DIR, "WORKLIST.md"),
    label: "WORKLIST current package SHA note"
  },
  {
    path: path.join(ROOT_DIR, "docs/vip-gece-completion-audit-20260626.md"),
    label: "completion audit package SHA note"
  },
  {
    path: path.join(ROOT_DIR, "docs/vip-gece-external-proof-runbook-20260626.md"),
    label: "external proof runbook package SHA note"
  }
];

function literalRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function retiredEntryPattern(...parts) {
  return new RegExp(`/${literalRegExp(path.posix.join(...parts))}$`);
}

function retiredEntryPrefix(...parts) {
  return new RegExp(`/${literalRegExp(path.posix.join(...parts))}/`);
}

const retiredGenerationEntryPatterns = [
  retiredEntryPattern("scripts", ["a", "i-contract.mjs"].join("")),
  retiredEntryPattern("scripts", ["a", "i-runtime-contract.mjs"].join("")),
  retiredEntryPattern("scripts", ["image", "-runtime-proof.mjs"].join("")),
  retiredEntryPattern("scripts", ["image", "-runtime-readiness.mjs"].join("")),
  retiredEntryPrefix("ops", "yavru-" + ["image", "-runtime"].join("")),
  retiredEntryPrefix("server", ["a", "i"].join("")),
  retiredEntryPattern("src", "routes", ["a", "iRoutes.js"].join("")),
  retiredEntryPattern("src", "routes", ["image", "RuntimeRoutes.js"].join("")),
  retiredEntryPattern("src", "services", ["legacy", "AiContentService.js"].join("")),
  retiredEntryPattern("src", "services", ["image", "BriefInterpreterService.js"].join("")),
  retiredEntryPrefix("src", "services", ["image", "Runtime"].join("")),
  retiredEntryPattern("public", "js", "admin", ["a", "i.js"].join("")),
  retiredEntryPattern("public", "js", "admin", ["image", "-studio.js"].join("")),
  retiredEntryPattern("public", "css", ["image", "-studio.css"].join("")),
  retiredEntryPattern(["admin", "-gorsel.html"].join(""))
];

const REQUIRED_ENTRIES = [
  "runtime/.well-known/security.txt",
  "runtime/404.html",
  "runtime/ads.txt",
  "runtime/app-ads.txt",
  "runtime/llms.txt",
  "runtime/mobile-admin/android/app/src/main/res/raw/vip_gece_update_public_key.pem",
  "runtime/package.json",
  "runtime/package-lock.json",
  "runtime/sitemap.txt",
  "runtime/admin.css",
  "runtime/admin.js",
  "runtime/admin-sw.js",
  "runtime/admin.webmanifest",
  "runtime/customer-panel.css",
  "runtime/customer-panel.html",
  "runtime/ops/nginx/vip-gece-cloudflare-only.conf",
  "runtime/ops/nginx/vip-gece-private-loopback.conf",
  "runtime/ops/postgres/001-analytics-events.sql",
  "runtime/ops/postgres/002-supabase-security-hardening.sql",
  "runtime/ops/systemd/vip-gece-seo-sync.service",
  "runtime/ops/systemd/vip-gece-seo-sync.timer",
  "runtime/ops/systemd/vip-gece-indexnow.service",
  "runtime/ops/systemd/vip-gece-indexnow.timer",
  "runtime/server.modular.js",
  "runtime/config.js",
  "runtime/scripts/staging-env-contract.mjs",
  "runtime/scripts/private-panels-contract.mjs",
  "runtime/scripts/district-seo-contract.mjs",
  "runtime/scripts/structured-data-eligibility-contract.mjs",
  "runtime/scripts/supabase-integration-contract.mjs",
  "runtime/scripts/supabase-security-contract.mjs",
  "runtime/scripts/migrate-supabase-profile-images.mjs",
  "runtime/scripts/review-url.mjs",
  "runtime/scripts/secret-scan.mjs",
  "runtime/scripts/demo-contract.mjs",
  "runtime/scripts/external-proof-contract.mjs",
  "runtime/scripts/external-proof-intake.mjs",
  "runtime/scripts/live-domain-seo-audit.mjs",
  "runtime/scripts/full-sitemap-seo-audit.mjs",
  "runtime/scripts/gsc-index-monitor.mjs",
  "runtime/scripts/indexnow-submit.mjs",
  "runtime/scripts/indexnow-contract.mjs",
  "runtime/scripts/gsc-index-selection-contract.mjs",
  "runtime/scripts/google-search-console-retry-contract.mjs",
  "runtime/scripts/internal-link-graph-audit.mjs",
  "runtime/scripts/seo-policy-contract.mjs",
  "runtime/scripts/pagespeed-api-audit.mjs",
  "runtime/scripts/full-goal-readiness.mjs",
  "runtime/scripts/vip-gece-list-completion-audit.mjs",
  "runtime/scripts/local-review.mjs",
  "runtime/scripts/release-candidate-audit.mjs",
  "runtime/scripts/contracts.mjs",
  "runtime/src/app.js",
  "runtime/src/middleware/auth.js",
  "runtime/src/middleware/privatePanels.js",
  "runtime/src/middleware/security.js",
  "runtime/src/utils/input.js",
  "runtime/src/data/publicMetadata.js",
  "runtime/src/routes/adminRoutes.js",
  "runtime/src/routes/adminMobileRoutes.js",
  "runtime/src/routes/adminOpsRoutes.js",
  "runtime/src/routes/customerAccessRoutes.js",
  "runtime/src/routes/customerMobileRoutes.js",
  "runtime/src/routes/analyticsRoutes.js",
  "runtime/src/routes/publicApiRoutes.js",
  "runtime/src/routes/publicRoutes.js",
  "runtime/src/routes/systemRoutes.js",
  "runtime/src/services/sitemapService.js",
  "runtime/src/services/googleSearchConsoleService.js",
  "runtime/src/services/gscIndexSelectionService.js",
  "runtime/src/services/indexNowService.js",
  "runtime/src/services/profileAnalyticsService.js",
  "runtime/src/services/siteSettingsService.js",
  "runtime/src/services/customerMobileAccountService.js",
  "runtime/src/services/customerProfileImageService.js",
  "runtime/src/services/adminPermissions.js",
  "runtime/public/css/icons.css",
  "runtime/public/assets/vip-gece-brand-banner-20260726-720.webp",
  "runtime/public/assets/vip-gece-brand-banner-20260726-720.avif",
  "runtime/public/assets/vip-gece-logo-336.avif",
  "runtime/public/assets/favicon-32.png",
  "runtime/public/js/admin/shared.js",
  "runtime/public/js/admin/settings.js",
  "runtime/public/js/admin/profiles.js",
  "runtime/public/js/admin/customers.js",
  "runtime/public/js/admin/analytics.js",
  "runtime/public/js/admin/ads.js",
  "runtime/public/js/admin/tools.js",
  "runtime/public/js/admin/auth.js",
  "runtime/public/js/admin/index.js",
  "runtime/public/js/admin/pwa.js",
  "runtime/public/js/customer-panel.js",
  "runtime/public/js/category-final.js",
  "runtime/public/js/detail-final.js",
];

const FORBIDDEN_ENTRY_PATTERNS = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\._[^/]+$/,
  /(^|\/)\.DS_Store$/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.env(\.|$)/,
  /banner-(top|middle|bottom)/,
  /empty-box-logo/,
  /vip-gece-customer-(2\.0\.1-5|2\.1\.0-7)\.apk$/,
  /\/scripts\/(seo-sprint-launch|seo-social-auto|build-readable-whatsapp-export|build-whatsapp-archive)\.mjs$/,
  ...retiredGenerationEntryPatterns,
  /\.(key|p8|p12|pfx|jks|keystore)$/i,
  /\/docs\/council\//,
  /\/docs\/audits\//
];

const ALLOWED_PUBLIC_PEM_ENTRIES = new Set([
  "runtime/public/downloads/vip-gece-customer-config-public.pem",
  "runtime/mobile-admin/android/app/src/main/res/raw/vip_gece_update_public_key.pem"
]);

const ROOT_PUBLIC_ASSETS = new Set([
  "admin.css",
  "admin.js",
  "admin-sw.js",
  "customer-panel.css",
  "style.css"
]);

function isRuntimePublicAsset(relativePath) {
  const ext = path.extname(relativePath);
  if (ext !== ".css" && ext !== ".js") return false;
  if (ROOT_PUBLIC_ASSETS.has(relativePath)) return true;
  return relativePath.startsWith("public/css/") || relativePath.startsWith("public/js/");
}

function isLikelyModule(code) {
  return /(^|\n)\s*(import|export)\s/m.test(code);
}

async function minifyPublicAssetSource(relativePath, source) {
  const ext = path.extname(relativePath);

  if (ext === ".css") {
    const output = new CleanCSS({ level: 0, returnPromise: false }).minify(source).styles;
    return output && output !== source ? `${output.trim()}\n` : source;
  }

  if (ext === ".js") {
    const result = await minifyJs(source, {
      module: isLikelyModule(source),
      compress: false,
      mangle: false,
      format: {
        comments: false,
        beautify: false
      }
    });
    const output = result.code || source;
    return output ? `${output.trim()}\n` : source;
  }

  return source;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { encoding, ...spawnOptions } = options;
    const stdout = [];
    const stderr = [];
    const child = spawn(command, args, {
      shell: false,
      ...spawnOptions
    });

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("exit", (code) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code === 0) {
        resolve(encoding === "buffer" ? Buffer.concat(stdout) : out);
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}\n${err}`));
      }
    });
  });
}

async function assertExists(filePath, label) {
  await stat(filePath);
  console.log(`ok ${label} exists`);
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

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  console.log(`ok ${message}`);
}

await assertExists(PACKAGE_PATH, "package tarball");
await assertExists(SHA_PATH, "package sha file");

const actualHash = await hashFile(PACKAGE_PATH);
const shaText = await readFile(SHA_PATH, "utf8");
assert(shaText.includes(actualHash), "package sha matches sha file");

for (const target of DOC_HASH_SYNC_TARGETS) {
  const text = await readFile(target.path, "utf8");
  assert(text.includes(actualHash), `${target.label} matches package sha`);
}

const entries = (await run("tar", ["-tzf", PACKAGE_PATH]))
  .split("\n")
  .map((entry) => entry.trim())
  .filter(Boolean);

for (const required of REQUIRED_ENTRIES) {
  assert(entries.includes(required), `package contains ${required}`);
}

const forbiddenEntries = entries.filter((entry) =>
  FORBIDDEN_ENTRY_PATTERNS.some((pattern) => pattern.test(entry))
);
assert(forbiddenEntries.length === 0, "package contains no forbidden runtime paths");

const config = await run("tar", ["-xOzf", PACKAGE_PATH, "runtime/config.js"]);
assert(config.includes('supabaseUrl: "",'), "static config has empty supabaseUrl");
assert(config.includes('supabaseAnonKey: "",'), "static config has empty supabaseAnonKey");

const releaseManifest = JSON.parse(await run("tar", [
  "-xOzf",
  PACKAGE_PATH,
  "runtime/public/downloads/vip-gece-admin-latest.json"
]));
const releasePublicKey = await run("tar", [
  "-xOzf",
  PACKAGE_PATH,
  "runtime/mobile-admin/android/app/src/main/res/raw/vip_gece_update_public_key.pem"
]);
assert(
  releasePublicKey.includes("-----BEGIN PUBLIC KEY-----") &&
    !releasePublicKey.includes("PRIVATE KEY"),
  "package contains only the mobile release public key"
);
assert(
  verifyManifestSignature(releaseManifest, releasePublicKey),
  "packaged mobile release manifest signature is valid"
);
assert(
  !verifyManifestSignature(
    { ...releaseManifest, version_code: Number(releaseManifest.version_code) + 1 },
    releasePublicKey
  ),
  "tampered mobile release manifest signature is rejected"
);

const packageFileEntries = entries.filter((entry) =>
  entry.startsWith("runtime/") && !entry.endsWith("/")
);

const packagePemEntries = packageFileEntries.filter((entry) => /\.pem$/i.test(entry));
assert(
  packagePemEntries.every((entry) => ALLOWED_PUBLIC_PEM_ENTRIES.has(entry)),
  "package contains only approved public PEM paths"
);

for (const entry of packagePemEntries) {
  const pem = await run("tar", ["-xOzf", PACKAGE_PATH, entry]);
  assert(
    pem.includes("-----BEGIN PUBLIC KEY-----") && !pem.includes("PRIVATE KEY"),
    `package PEM is public-only ${entry}`
  );
}

for (const entry of packageFileEntries) {
  const relativePath = entry.slice("runtime/".length);
  const sourcePath = path.join(ROOT_DIR, relativePath);
  const sourceInfo = await stat(sourcePath);
  assert(sourceInfo.isFile(), `package source exists as file ${relativePath}`);
  const sourceHash = isRuntimePublicAsset(relativePath)
    ? hashBuffer(Buffer.from(await minifyPublicAssetSource(relativePath, await readFile(sourcePath, "utf8"))))
    : await hashFile(sourcePath);
  const tarBytes = await run("tar", ["-xOzf", PACKAGE_PATH, entry], { encoding: "buffer" });
  const tarHash = hashBuffer(tarBytes);
  assert(tarHash === sourceHash, `package matches current source ${relativePath}`);
}

console.log(`ok package sha256 ${actualHash}`);
