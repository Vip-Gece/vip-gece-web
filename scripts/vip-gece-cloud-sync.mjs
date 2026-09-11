import { spawnSync } from "node:child_process";
import { mkdirSync, openSync, closeSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const LOCK_PATH = path.join(ROOT_DIR, ".git", "vip-gece-cloud-sync.lock");
const LOG_DIR = path.join(process.env.HOME || ROOT_DIR, "Library", "Logs", "vip-gece-cloud-sync");

const args = new Set(process.argv.slice(2));
const statusOnly = args.has("--status");
const noPush = args.has("--no-push");

function nowLabel() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function log(message) {
  console.log(`[vip-gece-cloud-sync ${nowLabel()}] ${message}`);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    stdio: options.quiet ? "pipe" : "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    const stderr = result.stderr ? `\n${result.stderr.trim()}` : "";
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit ${result.status}${stderr}`);
  }

  return result;
}

function output(command, commandArgs, options = {}) {
  const result = run(command, commandArgs, { ...options, quiet: true });
  return (result.stdout || "").trim();
}

function ensureGitRepo() {
  const repoRoot = output("git", ["rev-parse", "--show-toplevel"]);
  if (path.resolve(repoRoot) !== ROOT_DIR) {
    throw new Error(`unexpected git root: ${repoRoot}`);
  }
}

function acquireLock() {
  try {
    const fd = openSync(LOCK_PATH, "wx");
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  if (existsSync(LOCK_PATH)) {
    unlinkSync(LOCK_PATH);
  }
}

function hasWorkingTreeChanges() {
  return output("git", ["status", "--porcelain"]).length > 0;
}

function hasStagedChanges() {
  const result = run("git", ["diff", "--cached", "--quiet"], { allowFailure: true, quiet: true });
  return result.status === 1;
}

function currentBranch() {
  const branch = output("git", ["branch", "--show-current"]);
  if (!branch) {
    throw new Error("detached HEAD is not supported for automatic cloud sync");
  }
  return branch;
}

function remoteUrl() {
  return output("git", ["remote", "get-url", "origin"]);
}

function statusReport() {
  ensureGitRepo();
  const branch = currentBranch();
  const remote = remoteUrl();
  const status = output("git", ["status", "--short"]);
  log(`repo: ${ROOT_DIR}`);
  log(`branch: ${branch}`);
  log(`remote: ${remote}`);
  log(status ? `pending changes:\n${status}` : "pending changes: none");
}

function sync() {
  mkdirSync(LOG_DIR, { recursive: true });
  ensureGitRepo();

  if (!acquireLock()) {
    log("another sync is already running; skipping");
    return;
  }

  try {
    const branch = currentBranch();
    const remote = remoteUrl();
    log(`repo: ${ROOT_DIR}`);
    log(`branch: ${branch}`);
    log(`remote: ${remote}`);

    if (!hasWorkingTreeChanges()) {
      log("no local changes to sync");
      return;
    }

    log("running secret scan");
    run("npm", ["run", "secret-scan"]);

    log("running syntax check");
    run("npm", ["run", "check"]);

    log("staging changes");
    run("git", ["add", "-A"]);

    if (!hasStagedChanges()) {
      log("nothing staged after git add; done");
      return;
    }

    const changedFiles = output("git", ["diff", "--cached", "--name-only"]);
    log(`staged files:\n${changedFiles}`);

    const message = `vip-gece cloud sync: ${nowLabel()}`;
    log(`creating commit: ${message}`);
    run("git", ["commit", "-m", message]);

    if (noPush) {
      log("created local sync commit; push skipped by --no-push");
      return;
    }

    log(`rebasing onto origin/${branch}`);
    run("git", ["pull", "--rebase", "origin", branch]);

    log(`pushing HEAD to origin/${branch}`);
    run("git", ["push", "origin", `HEAD:${branch}`]);
    log("cloud sync complete");
  } finally {
    releaseLock();
  }
}

try {
  if (statusOnly) {
    statusReport();
  } else {
    sync();
  }
} catch (error) {
  console.error(`[vip-gece-cloud-sync ${nowLabel()}] failed: ${error.message}`);
  process.exitCode = 1;
}
