"use strict";

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = process.env.PORT || "3115";
const BASE_URL = process.env.RELEASE_CANDIDATE_BASE_URL || `http://${HOST}:${PORT}`;
const HEALTH_TIMEOUT_MS = Number(process.env.RELEASE_CANDIDATE_HEALTH_TIMEOUT_MS || 90000);

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

async function waitForHealth(timeoutMs = HEALTH_TIMEOUT_MS) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.status === 200) return;
    } catch {
      // Server is still booting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${BASE_URL}/health`);
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);

  return new Promise((resolve) => {
    function onExit() {
      clearTimeout(timer);
      resolve(true);
    }

    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);

    child.once("exit", onExit);
  });
}

async function stopServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;

  server.kill("SIGINT");
  if (await waitForProcessExit(server, 5000)) return;

  server.kill("SIGTERM");
  if (await waitForProcessExit(server, 5000)) return;

  server.kill("SIGKILL");
  if (!(await waitForProcessExit(server, 2000))) {
    throw new Error(`Release candidate server did not stop on ${HOST}:${PORT}`);
  }
}

async function runPreServerGates() {
  await run("npm", ["run", "check"]);
  await run("npm", ["run", "secret-scan"]);
  await run("npm", ["run", "supabase-integration:contract"]);
  await run("npm", ["run", "supabase-security:contract"]);
  await run("npm", ["run", "private-panels:contract"]);
  await run("npm", ["run", "district-seo:contract"]);
  await run("npm", ["run", "structured-data:contract"]);
  await run("npm", ["run", "analytics-event-proof-contract"]);
  await run("npm", ["run", "gsc-runtime:contract"]);
  await run("npm", ["run", "profile-publication-contract"]);
  await run("npm", ["run", "env-contract"], {
    env: { ...process.env, SITE_URL: process.env.SITE_URL || BASE_URL }
  });
  await run("npm", ["run", "demo-contract"]);
}

async function runLocalRuntimeGates() {
  await run("npm", ["run", "review-url"], {
    env: {
      ...process.env,
      REVIEW_BASE_URL: BASE_URL,
      EXPECTED_SITE_URL: BASE_URL,
      VIP_GECE_EXPECTED_PUBLIC_PROFILE_COUNT: "3",
      VIP_GECE_EXPECTED_INDEXABLE_PROFILE_COUNT: "3",
      VIP_GECE_EXPECTED_SITEMAP_URL_COUNT: "32"
    }
  });
  await run("npm", [
    "run",
    "live-seo-audit",
    "--",
    `--site=${BASE_URL}`,
    "--routes=/,/anasayfa,/ilanlar,/kategoriler,/istanbul-escort,/sisli-escort,/vip-escort,/esmer-escort,/iletisim,/profil/ada-vip",
    "--strict"
  ], {
    env: {
      ...process.env,
      VIP_GECE_EXPECTED_PUBLIC_PROFILE_COUNT: "3",
      VIP_GECE_EXPECTED_INDEXABLE_PROFILE_COUNT: "3",
      VIP_GECE_EXPECTED_SITEMAP_URL_COUNT: "32"
    }
  });
  await run("npm", [
    "run",
    "internal-link-graph-audit",
    "--",
    `--site=${BASE_URL}`,
    "--strict",
    "--expected-count=32"
  ]);
  await run("npm", ["run", "full-sitemap-seo-audit", "--", `--site=${BASE_URL}`], {
    env: {
      ...process.env,
      VIP_GECE_EXPECTED_SITEMAP_URL_COUNT: "32"
    }
  });
}

async function runPackageGates() {
  await run("npm", ["run", "package-staging"]);
  await run("npm", ["run", "verify-package"]);
  await run("npm", ["run", "external-proof-contract"]);
  await run("npm", ["run", "list-completion-audit"]);
  await run("npm", ["run", "full-goal-readiness"]);
}

async function main() {
  const auditTempDir = await mkdtemp(path.join(os.tmpdir(), "vip-gece-release-audit-"));
  try {
    await runPreServerGates();

    const server = spawn("node", ["server.modular.js"], {
      stdio: "inherit",
      env: {
        ...process.env,
        HOST,
        PORT,
        SITE_URL: process.env.SITE_URL || BASE_URL,
        NODE_ENV: "development",
        ENABLE_DEMO_PROFILES: "true"
      }
    });

    try {
      await waitForHealth();
      await runLocalRuntimeGates();
    } finally {
      await stopServer(server);
    }

    await runPackageGates();

    console.log(`ok release candidate audit ${BASE_URL}`);
  } finally {
    await rm(auditTempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
