import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PATCHES_DIR = path.resolve(ROOT_DIR, "..", "patches");

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function walkFiles(root, maxDepth = 3, depth = 0) {
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (depth < maxDepth) {
        files.push(...await walkFiles(entryPath, maxDepth, depth + 1));
      }
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function newestTarball(root) {
  const files = await walkFiles(root);
  const candidates = [];

  for (const file of files) {
    if (!/vip-gece.*\.tar\.gz$/i.test(path.basename(file))) continue;
    if (!(await exists(`${file}.sha256`))) continue;
    const stats = await stat(file);
    candidates.push({ file, mtimeMs: stats.mtimeMs });
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.file || "";
}

async function bestManifest(packagePath, shaFileValue) {
  const dir = path.dirname(packagePath);
  const files = (await walkFiles(dir, 1)).filter((file) => /manifest\.md$/i.test(path.basename(file)));
  const packageName = path.basename(packagePath);
  const packagePathNeedle = packagePath;

  for (const file of files) {
    const text = await readText(file);
    if (text.includes(packagePathNeedle) || text.includes(packageName) || (shaFileValue && text.includes(shaFileValue))) {
      return file;
    }
  }

  return "";
}

export async function resolvePackageArtifact(options = {}) {
  const patchesDir = options.patchesDir || process.env.VIP_GECE_PATCHES_DIR || DEFAULT_PATCHES_DIR;
  const packageCandidate =
    process.env.VIP_GECE_PACKAGE_PATH ||
    options.packagePath ||
    await newestTarball(patchesDir);
  const packagePath = packageCandidate ? path.resolve(packageCandidate) : "";
  const shaCandidate = process.env.VIP_GECE_PACKAGE_SHA_FILE || options.shaPath || (packagePath ? `${packagePath}.sha256` : "");
  const shaPath = shaCandidate ? path.resolve(shaCandidate) : "";
  const shaText = await readText(shaPath);
  const shaFileValue = shaText.trim().split(/\s+/)[0] || "";
  const manifestCandidate =
    process.env.VIP_GECE_PACKAGE_MANIFEST ||
    options.manifestPath ||
    (packagePath ? await bestManifest(packagePath, shaFileValue) : "");
  const manifestPath = manifestCandidate ? path.resolve(manifestCandidate) : "";
  const manifestText = await readText(manifestPath);
  const manifestSha = manifestText.match(/SHA256: `([^`]+)`/)?.[1] || "";

  return {
    packagePath,
    manifestPath,
    shaPath,
    manifestSha,
    shaFileValue,
    packageExists: Boolean(packagePath) && await exists(packagePath),
    manifestExists: Boolean(manifestPath) && await exists(manifestPath),
    shaFileExists: Boolean(shaPath) && await exists(shaPath)
  };
}

export function packageSha(artifact) {
  return artifact.manifestSha || artifact.shaFileValue || "";
}
