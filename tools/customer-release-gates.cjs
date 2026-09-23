"use strict";

// Exercise the existing site gates with a loopback-only fixture server and no production environment.
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output", `customer-release-gates-${stamp}`);

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const env = {};
  for (const key of ["PATH", "Path", "SystemRoot", "ComSpec", "PATHEXT", "HOME", "USERPROFILE", "TEMP", "TMP"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, {
    NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port),
    SITE_URL: origin, EXPECTED_SITE_URL: origin, SMOKE_BASE_URL: origin,
    ENABLE_DEMO_PROFILES: "true", ENABLE_PROFILE_EXPIRY: "false",
    DOTENV_CONFIG_PATH: path.join(output, "absent.env"),
    CUSTOMER_MOBILE_ACCOUNT_STORE_PATH: path.join(output, "fixture-accounts.json"),
    CUSTOMER_SUPPORT_STORE_PATH: path.join(output, "fixture-support.json")
  });
  const server = spawn(process.execPath, ["server.modular.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let serverLog = "", serverExit = false;
  server.stdout.on("data", chunk => { serverLog += chunk; });
  server.stderr.on("data", chunk => { serverLog += chunk; });
  const serverClosed = new Promise(resolve => server.once("close", () => { serverExit = true; resolve(); }));
  const proof = { origin, production_environment_loaded: false, checks: [] };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80 && !serverExit; attempt++) {
      try { ready = (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error("Fixture server did not become ready");
    for (const script of ["smoke", "contracts", "admin-role-contract", "private-panels-contract", "secret-scan"]) {
      const result = await new Promise(resolve => {
        const child = spawn(process.execPath, [`scripts/${script}.mjs`], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
        let log = "", timedOut = false;
        child.stdout.on("data", chunk => { log += chunk; });
        child.stderr.on("data", chunk => { log += chunk; });
        const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 180000);
        child.once("error", () => { log += "\nChild process could not start\n"; });
        child.once("close", code => { clearTimeout(timer); resolve({ script, exit_code: code, timed_out: timedOut, log }); });
      });
      await fs.writeFile(path.join(output, `${script}.log`), result.log);
      const failures = result.log.split(/\r?\n/).filter(line => /^(fail|not ok)\b/.test(line));
      proof.checks.push({ script, exit_code: result.exit_code, timed_out: result.timed_out, failures });
      console.log(JSON.stringify(proof.checks.at(-1)));
    }
  } finally {
    if (!serverExit) server.kill("SIGTERM");
    await serverClosed;
    await fs.writeFile(path.join(output, "server.log"), serverLog);
    await fs.writeFile(path.join(output, "proof.json"), JSON.stringify(proof, null, 2));
    console.log(JSON.stringify({ evidence: output, server_stopped: true }));
  }
  if (proof.checks.some(check => check.exit_code !== 0)) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
