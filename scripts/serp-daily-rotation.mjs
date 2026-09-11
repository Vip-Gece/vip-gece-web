"use strict";

import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  categoryRows,
  districtRows,
  districtSide,
  landingAliasRows
} = require("../src/data/publicMetadata");

const DEFAULT_OUT_DIR = "output/external-audits";
const DEFAULT_STATE_FILE = path.join(DEFAULT_OUT_DIR, "serp-daily-rotation-state.json");
const DEFAULT_BATCH_SIZE = 40;
const DEFAULT_PROVIDER = "serper";
const DEFAULT_DEVICE = "desktop";

const args = process.argv.slice(2);

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const direct = args.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length).trim();
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : fallback;
}

function hasArg(name) {
  return args.includes(name);
}

function numberArg(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const raw = argValue(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function safeSlug(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(file, payload) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function rowMatchesSide(row, side, includeCity) {
  if (!side || side === "all") return true;
  if (row.group === "istanbul") return includeCity;
  return row.side === side;
}

function allQueryRows({ side, includeCity, includeCategories, primaryOnly }) {
  const rows = [
    { group: "istanbul", name: "İstanbul", slug: "istanbul-escort", query: "istanbul escort" },
    ...districtRows().map((row) => ({
      group: "district",
      name: row.name,
      slug: row.slug,
      side: row.side || districtSide(row.name),
      query: `${String(row.name).toLocaleLowerCase("tr-TR")} escort`
    }))
  ];

  if (!primaryOnly) {
    rows.push(...landingAliasRows().map((row) => ({
      group: "semt",
      name: row.name,
      slug: row.slug,
      parent_district: row.parent_district,
      side: row.side || districtSide(row.parent_district),
      query: `${String(row.name).toLocaleLowerCase("tr-TR")} escort`
    })));
  }

  const filtered = rows.filter((row) => rowMatchesSide(row, side, includeCity));

  if (includeCategories) {
    filtered.push(...categoryRows().map((row) => ({
      group: "category",
      name: row.name,
      slug: row.slug,
      query: `${String(row.name).toLocaleLowerCase("tr-TR")}`
    })));
  }

  return filtered;
}

function providerEnv(provider) {
  if (provider === "serpapi") return ["SERPAPI_KEY"];
  if (provider === "serper") return ["SERPER_API_KEY"];
  if (provider === "dataforseo") return ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"];
  return [];
}

function missingProviderEnv(provider) {
  return providerEnv(provider).filter((name) => !String(process.env[name] || "").trim());
}

function stateFingerprint(input) {
  return [
    input.provider,
    input.device,
    input.side,
    input.includeCity ? "city" : "no-city",
    input.includeCategories ? "categories" : "no-categories",
    input.primaryOnly ? "primary" : "all-local",
    String(input.batchSize)
  ].join("|");
}

function runCommand(command, commandArgs) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (error) => {
      console.error(error.message || error);
      resolve(1);
    });
  });
}

async function main() {
  const provider = argValue("--provider", DEFAULT_PROVIDER).toLowerCase();
  if (!["serpapi", "dataforseo", "serper"].includes(provider)) {
    throw new Error("--provider must be serpapi, dataforseo or serper");
  }

  const device = argValue("--device", DEFAULT_DEVICE);
  const side = argValue("--side", "all").toLowerCase();
  const includeCity = hasArg("--include-city") || side === "all";
  const includeCategories = hasArg("--include-categories");
  const primaryOnly = hasArg("--primary-only");
  const batchSize = numberArg("--batch-size", DEFAULT_BATCH_SIZE, 1, 1000);
  const depth = numberArg("--depth", 100, 10, 100);
  const delayMs = numberArg("--delay-ms", 700, 0, 60000);
  const outDir = argValue("--out-dir", DEFAULT_OUT_DIR);
  const stateFile = argValue("--state-file", DEFAULT_STATE_FILE);
  const date = argValue("--date", todayIsoDate());
  const force = hasArg("--force");
  const dryRun = hasArg("--dry-run");
  const resume = !hasArg("--no-resume");
  const explicitOffset = argValue("--offset", "");

  const scope = { provider, device, side, includeCity, includeCategories, primaryOnly, batchSize };
  const fingerprint = stateFingerprint(scope);
  const queries = allQueryRows(scope);
  const totalQueries = queries.length;
  const totalBatches = Math.max(1, Math.ceil(totalQueries / batchSize));
  const existingState = await readJsonIfExists(stateFile);
  const sameScope = existingState?.fingerprint === fingerprint;
  const alreadyRanToday = sameScope && existingState?.last_run?.date === date && existingState?.last_run?.status === "success";

  if (alreadyRanToday && !force) {
    console.log(`already_ran_today date=${date} next_offset=${existingState.next_offset}`);
    console.log(`state=${stateFile}`);
    console.log("Use --force to spend another daily batch intentionally.");
    return;
  }

  let offset = explicitOffset ? numberArg("--offset", 0, 0) : (sameScope ? numberArgFromState(existingState?.next_offset, 0) : 0);
  if (offset >= totalQueries) offset = 0;
  const limit = Math.min(batchSize, Math.max(0, totalQueries - offset));
  const selectedQueries = queries.slice(offset, offset + limit);
  const batchIndex = Math.floor(offset / batchSize) + 1;
  const outName = [
    "serp-daily",
    date,
    `batch-${String(batchIndex).padStart(2, "0")}-of-${String(totalBatches).padStart(2, "0")}`,
    safeSlug(side || "all"),
    safeSlug(device)
  ].join("-");

  const commandArgs = [
    "run",
    "serp-rank-check",
    "--",
    `--provider=${provider}`,
    `--device=${device}`,
    `--depth=${depth}`,
    `--delay-ms=${delayMs}`,
    `--limit=${limit}`,
    `--offset=${offset}`,
    `--out-dir=${outDir}`,
    `--out=${outName}`
  ];
  if (resume) commandArgs.push("--resume");
  if (side && side !== "all") commandArgs.push(`--side=${side}`);
  if (includeCity) commandArgs.push("--include-city");
  if (includeCategories) commandArgs.push("--include-categories");
  if (primaryOnly) commandArgs.push("--primary-only");

  const plan = {
    date,
    provider,
    device,
    side,
    include_city: includeCity,
    include_categories: includeCategories,
    primary_only: primaryOnly,
    total_queries: totalQueries,
    batch_size: batchSize,
    batch_index: batchIndex,
    total_batches: totalBatches,
    offset,
    limit,
    next_offset_on_success: offset + limit >= totalQueries ? 0 : offset + limit,
    output_json: path.join(outDir, `${outName}.json`),
    output_csv: path.join(outDir, `${outName}.csv`),
    first_query: selectedQueries[0]?.query || "",
    last_query: selectedQueries.at(-1)?.query || "",
    command: `npm ${commandArgs.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ")}`
  };

  console.log(JSON.stringify(plan, null, 2));

  if (dryRun) return;

  const missing = missingProviderEnv(provider);
  if (missing.length) {
    await writeJson(stateFile, {
      version: 1,
      updated_at: new Date().toISOString(),
      fingerprint,
      next_offset: offset,
      last_run: {
        ...plan,
        status: "blocked_missing_key",
        missing_env: missing
      }
    });
    throw new Error(`Missing provider env: ${missing.join(", ")}`);
  }

  const code = await runCommand("npm", commandArgs);
  const success = code === 0;
  await writeJson(stateFile, {
    version: 1,
    updated_at: new Date().toISOString(),
    fingerprint,
    next_offset: success ? plan.next_offset_on_success : offset,
    last_run: {
      ...plan,
      status: success ? "success" : "failed",
      exit_code: code
    }
  });

  if (!success) process.exitCode = code;
}

function numberArgFromState(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? Math.floor(numberValue) : fallback;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
