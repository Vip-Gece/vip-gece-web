import { spawn } from "node:child_process";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = process.env.PORT || "3105";
const BASE_URL = `http://${HOST}:${PORT}`;

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

async function waitForHealth(timeoutMs = 10000) {
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

async function main() {
  await run("npm", ["run", "secret-scan"]);
  await run("npm", ["run", "env-contract"], {
    env: { ...process.env, SITE_URL: process.env.SITE_URL || BASE_URL }
  });
  await run("npm", ["run", "demo-contract"]);

  const server = spawn("node", ["server.modular.js"], {
    stdio: "inherit",
    env: {
      ...process.env,
      HOST,
      PORT,
      SITE_URL: process.env.SITE_URL || BASE_URL,
      ENABLE_DEMO_PROFILES: process.env.ENABLE_DEMO_PROFILES || "true"
    }
  });

  try {
    await waitForHealth();
    await run("npm", ["run", "review-url"], {
      env: { ...process.env, REVIEW_BASE_URL: BASE_URL, EXPECTED_SITE_URL: BASE_URL }
    });
  } finally {
    server.kill("SIGINT");
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
