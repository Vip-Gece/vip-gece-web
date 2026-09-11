import { spawn } from "node:child_process";

const PROD_HOSTS = new Set(["vip-gece.site", "www.vip-gece.site"]);
const rawBaseUrl = process.env.REVIEW_BASE_URL || process.env.SMOKE_BASE_URL || "";

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

function normalizeBaseUrl(input) {
  if (!input) {
    throw new Error("REVIEW_BASE_URL is required.");
  }

  const parsed = new URL(input);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("REVIEW_BASE_URL must use http or https.");
  }

  if (PROD_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("REVIEW_BASE_URL points at production host; refusing to run write-capable review against live.");
  }

  return parsed.toString().replace(/\/$/, "");
}

const baseUrl = normalizeBaseUrl(rawBaseUrl);
const expectedSiteUrl = (process.env.EXPECTED_SITE_URL || baseUrl).replace(/\/$/, "");
const env = {
  ...process.env,
  SITE_URL: expectedSiteUrl,
  SMOKE_BASE_URL: baseUrl,
  EXPECTED_SITE_URL: expectedSiteUrl
};

await run("npm", ["run", "smoke"], { env });
await run("npm", ["run", "contracts"], { env });
console.log(`ok review URL gate ${baseUrl}`);
