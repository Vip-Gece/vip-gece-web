import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import CleanCSS from "clean-css";
import { minify as minifyJs } from "terser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DATE_LABEL = process.env.PACKAGE_DATE_LABEL || "20260810";
const ARTIFACT_DIR = process.env.PACKAGE_ARTIFACT_DIR
  ? path.resolve(process.env.PACKAGE_ARTIFACT_DIR)
  : path.resolve(ROOT_DIR, "..", "patches");
const BUILD_DIR = path.join(ARTIFACT_DIR, "runtime");
const PACKAGE_NAME = process.env.PACKAGE_NAME || `vip-gece-runtime-${DATE_LABEL}-seo-index-automation.tar.gz`;
const PACKAGE_PATH = path.join(ARTIFACT_DIR, PACKAGE_NAME);
const MANIFEST_PATH = path.join(
  ARTIFACT_DIR,
  `${PACKAGE_NAME.replace(/\.tar\.gz$/i, "")}-manifest.md`
);
const SHA_PATH = path.join(ARTIFACT_DIR, `${PACKAGE_NAME}.sha256`);
const DOC_HASH_SYNC_TARGETS = [
  {
    path: path.join(ROOT_DIR, "WORKLIST.md"),
    replacements: [
      [/Guncel paket SHA:? `[a-f0-9]{64}`/g, `Guncel paket SHA: \`${hashPlaceholder()}\``]
    ]
  },
  {
    path: path.join(ROOT_DIR, "docs/vip-gece-completion-audit-20260626.md"),
    replacements: [
      [/- SHA256: `[a-f0-9]{64}`/g, `- SHA256: \`${hashPlaceholder()}\``],
      [/Güncel temiz paket SHA: `[a-f0-9]{64}`/g, `Güncel temiz paket SHA: \`${hashPlaceholder()}\``]
    ]
  },
  {
    path: path.join(ROOT_DIR, "docs/vip-gece-external-proof-runbook-20260626.md"),
    replacements: [
      [/- SHA256: `[a-f0-9]{64}`/g, `- SHA256: \`${hashPlaceholder()}\``],
      [/Güncel temiz paket SHA: `[a-f0-9]{64}`/g, `Güncel temiz paket SHA: \`${hashPlaceholder()}\``],
      [/VIP_GECE_DEPLOYED_PACKAGE_SHA=[a-f0-9]{64}/g, `VIP_GECE_DEPLOYED_PACKAGE_SHA=${hashPlaceholder()}`]
    ]
  }
];

const INCLUDE_PATHS = [
  ".well-known",
  "404.html",
  "CNAME",
  "admin.css",
  "admin.js",
  "admin-sw.js",
  "admin.webmanifest",
  "ads.txt",
  "app-ads.txt",
  "bolge.html",
  "config.js",
  "customer-panel.css",
  "customer-panel.html",
  "detay.html",
  "favicon.ico",
  "favicon.png",
  "favicon.png.webp",
  "guven-ve-politikalar.html",
  "ilanlar.html",
  "iletisim.html",
  "index.html",
  "istanbul.html",
  "kategori.html",
  "kategori-landing.html",
  "llms.txt",
  "logo.png",
  "logo.png.webp",
  "mobile-admin/android/app/src/main/res/raw/vip_gece_update_public_key.pem",
  "ops",
  "package-lock.json",
  "package.json",
  "public",
  "robots.txt",
  "sitemap.txt",
  "scripts",
  "server",
  "server.modular.js",
  "src",
  "style.css",
  "vg-panel-91x.html",
  "whatsapp-logo.png"
];
const OPTIONAL_ROOT_VERIFICATION_PATTERNS = [
  /^google[A-Za-z0-9_-]{8,128}\.html$/,
  /^BingSiteAuth\.xml$/,
  /^yandex[_-]?[A-Za-z0-9_-]{8,128}\.html$/i,
  /^[A-Za-z0-9-]{8,128}\.txt$/
];

const FORBIDDEN_NAMES = [
  ".git",
  "node_modules",
  "banner-top.jpg",
  "banner-top.jpg.webp",
  "banner-middle.jpg",
  "banner-middle.jpg.webp",
  "banner-bottom.jpg",
  "banner-bottom.jpg.webp",
  "empty-box-logo.jpg",
  "empty-box-logo.jpg.webp",
  "vip-gece-customer-2.0.1-5.apk",
  "vip-gece-customer-2.1.0-7.apk",
  "build-readable-whatsapp-export.mjs",
  "build-whatsapp-archive.mjs"
];

const PUBLIC_ASSET_EXTENSIONS = new Set([".css", ".js"]);
const ROOT_PUBLIC_ASSETS = new Set([
  "admin.css",
  "admin.js",
  "admin-sw.js",
  "customer-panel.css",
  "style.css"
]);
const PUBLIC_ASSET_DIRS = [
  "public/css",
  "public/js"
];
const SIGNING_KEY_EXTENSIONS = new Set([".pem", ".key", ".p8", ".p12", ".pfx", ".jks", ".keystore"]);
const ALLOWED_PUBLIC_KEY_PATHS = new Set([
  path.join(ROOT_DIR, "public", "downloads", "vip-gece-customer-config-public.pem"),
  path.join(
    ROOT_DIR,
    "mobile-admin",
    "android",
    "app",
    "src",
    "main",
    "res",
    "raw",
    "vip_gece_update_public_key.pem"
  )
]);

function legacyName(...parts) {
  return parts.join("");
}

const RETIRED_SOURCE_PREFIXES = [
  path.join(ROOT_DIR, "ops", `yavru-${legacyName("image", "-runtime")}`),
  path.join(ROOT_DIR, "server", legacyName("a", "i")),
  path.join(ROOT_DIR, "src", "services", legacyName("image", "Runtime"))
];

function isRetiredSourcePath(sourcePath) {
  const resolved = path.resolve(sourcePath);
  return RETIRED_SOURCE_PREFIXES.some((prefix) => (
    resolved === prefix || resolved.startsWith(`${prefix}${path.sep}`)
  ));
}

function isForbiddenName(name) {
  return FORBIDDEN_NAMES.includes(name) || name === ".env" || name.startsWith(".env.");
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function hashPlaceholder() {
  return "__VIP_GECE_PACKAGE_SHA__";
}

async function copyRuntime() {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await Promise.all([
    rm(BUILD_DIR, { recursive: true, force: true }),
    rm(PACKAGE_PATH, { force: true }),
    rm(MANIFEST_PATH, { force: true }),
    rm(SHA_PATH, { force: true })
  ]);
  await mkdir(BUILD_DIR, { recursive: true });

  const includePaths = [
    ...INCLUDE_PATHS,
    ...await discoverOptionalRootVerificationFiles()
  ];

  for (const relativePath of includePaths) {
    const source = path.join(ROOT_DIR, relativePath);
    if (!(await exists(source))) continue;

    await cp(source, path.join(BUILD_DIR, relativePath), {
      recursive: true,
      force: true,
      filter(sourcePath) {
        if (isRetiredSourcePath(sourcePath)) {
          return false;
        }
        const name = path.basename(sourcePath);
        const extension = path.extname(name).toLowerCase();
        if (SIGNING_KEY_EXTENSIONS.has(extension) && !ALLOWED_PUBLIC_KEY_PATHS.has(path.resolve(sourcePath))) {
          return false;
        }
        return !isForbiddenName(name) && !name.startsWith("._") && name !== ".DS_Store";
      }
    });
  }
}

async function discoverOptionalRootVerificationFiles() {
  const entries = await readdir(ROOT_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => OPTIONAL_ROOT_VERIFICATION_PATTERNS.some((pattern) => pattern.test(name)))
    .filter((name) => !INCLUDE_PATHS.includes(name));
}

async function walkFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function isLikelyModule(code) {
  return /(^|\n)\s*(import|export)\s/m.test(code);
}

async function minifyPublicAsset(filePath) {
  const ext = path.extname(filePath);
  const source = await readFile(filePath, "utf8");
  let output = source;

  if (ext === ".css") {
    output = new CleanCSS({ level: 0, returnPromise: false }).minify(source).styles;
  } else if (ext === ".js") {
    const result = await minifyJs(source, {
      module: isLikelyModule(source),
      compress: false,
      mangle: false,
      format: {
        comments: false,
        beautify: false
      }
    });
    output = result.code || source;
  }

  if (output && output !== source) {
    await writeFile(filePath, `${output.trim()}\n`);
  }
}

async function minifyRuntimePublicAssets() {
  const candidates = [];

  for (const relativePath of ROOT_PUBLIC_ASSETS) {
    const assetPath = path.join(BUILD_DIR, relativePath);
    if (await exists(assetPath)) candidates.push(assetPath);
  }

  for (const relativeDir of PUBLIC_ASSET_DIRS) {
    const dirPath = path.join(BUILD_DIR, relativeDir);
    if (!(await exists(dirPath))) continue;
    const files = await walkFiles(dirPath);
    candidates.push(...files.filter((filePath) => PUBLIC_ASSET_EXTENSIONS.has(path.extname(filePath))));
  }

  for (const assetPath of candidates) {
    await minifyPublicAsset(assetPath);
  }
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

async function writeManifest(hash) {
  const manifest = `# VIP-GECE VPS Staging Package - ${DATE_LABEL}

Status: LOCAL ARTIFACT ONLY.

No production deploy, Cloudflare edit, production Supabase write, VPS write, process restart, or secret handling was performed.

## Artifact

- Tarball: \`${PACKAGE_PATH}\`
- SHA256: \`${hash}\`
- Runtime root inside package: \`runtime/\`
- Source root: \`${ROOT_DIR}\`

## Package Policy

- \`node_modules\` excluded; run \`npm ci --omit=dev\` on staging host.
- \`.env\` and secret-like env files excluded.
- Git metadata excluded.
- Local council/audit docs excluded from runtime tarball.
- Old banner and empty-box ad image assets excluded from runtime tarball.
- Static source \`config.js\` keeps Supabase browser fields empty; runtime \`/config.js\` injects only \`SUPABASE_URL\` and \`SUPABASE_ANON_KEY\` from server env.
- \`SUPABASE_SERVICE_ROLE_KEY\` is server-only and must never appear in \`/config.js\`, package docs, or browser assets.
- Admin login requires Supabase Auth plus \`ADMIN_EMAILS\` allowlist entries on the staging/production server.
- Public profile analytics requires a dedicated \`ANALYTICS_EVENT_PROOF_SECRET\` of at least 32 characters; it must not reuse the customer session secret.

## Suggested VPS Staging Commands

\`\`\`sh
mkdir -p /var/www/vip-gece-staging
tar -xzf ${PACKAGE_NAME} -C /var/www/vip-gece-staging --strip-components=1
cd /var/www/vip-gece-staging
npm ci --omit=dev
ENV_CONTRACT_MODE=staging PORT=<staging-port> SITE_URL=<staging-url> SUPABASE_URL=<public-supabase-url> SUPABASE_ANON_KEY=<public-anon-key> SUPABASE_SERVICE_ROLE_KEY=<server-service-role> CUSTOMER_ACCESS_SESSION_SECRET=<minimum-32-character-secret> ANALYTICS_EVENT_PROOF_SECRET=<independent-minimum-32-character-secret> ADMIN_EMAILS=<admin-email-list> VIP_GECE_PRIVATE_PANELS_ENABLED=true VIP_GECE_PRIVATE_PANEL_HOSTS=127.0.0.1,localhost VIP_GECE_PRIVATE_PANEL_MODE=loopback-secret VIP_GECE_PRIVATE_PANEL_SECRET=<independent-minimum-32-character-secret> npm run env-contract
NODE_ENV=production PORT=<staging-port> SITE_URL=<staging-url> SUPABASE_URL=<public-supabase-url> SUPABASE_ANON_KEY=<public-anon-key> SUPABASE_SERVICE_ROLE_KEY=<server-service-role> CUSTOMER_ACCESS_SESSION_SECRET=<minimum-32-character-secret> ANALYTICS_EVENT_PROOF_SECRET=<independent-minimum-32-character-secret> ADMIN_EMAILS=<admin-email-list> VIP_GECE_PRIVATE_PANELS_ENABLED=true VIP_GECE_PRIVATE_PANEL_HOSTS=127.0.0.1,localhost VIP_GECE_PRIVATE_PANEL_MODE=loopback-secret VIP_GECE_PRIVATE_PANEL_SECRET=<independent-minimum-32-character-secret> npm start
\`\`\`

## Promotion Gates

Local release-candidate gate before staging transfer:

\`\`\`sh
npm run verify-release-candidate
\`\`\`

Local/source recovered old-list completion snapshot before staging transfer:

\`\`\`sh
npm run list-completion-audit -- --markdown
npm run full-goal-readiness -- --markdown
npm run external-proof-contract
npm run external-proof-intake -- --markdown
\`\`\`

Before switching public traffic, run the checks below from the staging host or
from a trusted machine that can reach the staging URL:

\`\`\`sh
npm run live-seo-audit -- --site=<staging-url> --strict
npm run full-sitemap-seo-audit -- --site=<staging-url> --strict
npm run pagespeed-api-audit -- --site=<staging-url> --strategy=mobile --strategy=desktop
\`\`\`

After public traffic is switched, verify the live domain:

\`\`\`sh
npm run live-seo-audit -- --strict
npm run full-sitemap-seo-audit -- --strict
npm run pagespeed-api-audit -- --strict
npm run full-goal-readiness -- --strict
\`\`\`

Expected current state:

- \`live-seo-audit -- --site=<staging-url> --strict\` should pass.
- \`full-sitemap-seo-audit -- --site=<staging-url> --strict\` should pass for
  canonical, redirect, meta and JSON-LD checks across sitemap URLs.
- \`pagespeed-api-audit\` tries Google PageSpeed REST first. If no
  \`PAGESPEED_API_KEY\` or quota is available, it falls back to local
  Lighthouse and writes raw proof under \`output/external-audits/\`.

Use separate staging env values. Do not reuse or print production secrets.
`;

  await writeFile(MANIFEST_PATH, manifest);
  await writeFile(SHA_PATH, `${hash}  ${PACKAGE_NAME}\n`);
}

async function syncPackageShaDocs(hash) {
  for (const target of DOC_HASH_SYNC_TARGETS) {
    if (!(await exists(target.path))) continue;

    let text = await readFile(target.path, "utf8");
    const before = text;

    for (const [pattern, replacement] of target.replacements) {
      text = text.replace(pattern, replacement.replaceAll(hashPlaceholder(), hash));
    }

    if (text !== before) {
      await writeFile(target.path, text);
    }
  }
}

async function main() {
  await run(process.execPath, [path.join(ROOT_DIR, "scripts/build-home-render-css.mjs")], { cwd: ROOT_DIR });
  await copyRuntime();
  await minifyRuntimePublicAssets();
  await run("tar", ["--no-xattrs", "-czf", PACKAGE_PATH, "runtime"], {
    cwd: ARTIFACT_DIR,
    env: { ...process.env, COPYFILE_DISABLE: "1" }
  });
  await rm(BUILD_DIR, { recursive: true, force: true });
  const hash = await hashFile(PACKAGE_PATH);
  await writeManifest(hash);
  await syncPackageShaDocs(hash);
  console.log(`package=${PACKAGE_PATH}`);
  console.log(`sha256=${hash}`);
  console.log(`manifest=${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
