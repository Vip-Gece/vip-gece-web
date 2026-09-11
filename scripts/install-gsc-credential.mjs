import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = new Map();
for (const raw of process.argv.slice(2)) {
  const [key, ...rest] = raw.replace(/^--/, "").split("=");
  args.set(key, rest.join("=") || "true");
}

const envPath = path.resolve(args.get("env") || "/var/www/vip-gece-site/.env");
const credentialPath = path.resolve(args.get("credential") || "/var/lib/vip-gece/google-search-console-credential.json");
const siteUrl = args.get("site") || "sc-domain:vip-gece.site";

function fail(message) {
  console.error(`fail ${message}`);
  process.exitCode = 1;
}

function setEnvLine(source, key, value) {
  const escaped = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(source)) return source.replace(pattern, escaped);
  return `${source.replace(/\s*$/, "")}\n${escaped}\n`;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

function validateCredential(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("stdin must be a valid Google credential JSON");
  }

  if (parsed.type === "service_account" && parsed.client_email && parsed.private_key) {
    return { type: "service_account", identity: parsed.client_email };
  }

  if (parsed.type === "authorized_user" && parsed.client_id && parsed.client_secret && parsed.refresh_token) {
    return { type: "authorized_user", identity: "oauth-user" };
  }

  throw new Error("credential JSON must be a service_account key or authorized_user credential");
}

async function main() {
  const raw = await readStdin();
  const credential = validateCredential(raw);

  await mkdir(path.dirname(credentialPath), { recursive: true, mode: 0o700 });
  await writeFile(credentialPath, `${raw}\n`, { mode: 0o600 });
  await chmod(credentialPath, 0o600);

  let env = "";
  try {
    env = await readFile(envPath, "utf8");
  } catch {
    env = "";
  }

  env = setEnvLine(env, "GOOGLE_SEARCH_CONSOLE_ENABLED", "true");
  env = setEnvLine(env, "GOOGLE_SEARCH_CONSOLE_SITE_URL", siteUrl);
  env = setEnvLine(env, "GOOGLE_SEARCH_CONSOLE_CREDENTIAL_JSON_PATH", credentialPath);

  await writeFile(envPath, env, { mode: 0o600 });
  await chmod(envPath, 0o600);

  console.log("ok Google Search Console credential installed");
  console.log(`credential_type=${credential.type}`);
  if (credential.type === "service_account") {
    console.log(`client_email=${credential.identity}`);
  }
  console.log(`credential_path=${credentialPath}`);
  console.log(`env_path=${envPath}`);
  console.log("next=Restart PM2 with --update-env. For service accounts, add the service account email to the Search Console property if it is not already added.");
}

main().catch((err) => fail(err.message || "install failed"));
