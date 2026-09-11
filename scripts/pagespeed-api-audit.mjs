"use strict";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const DEFAULT_SITE_URL = "https://vip-gece.site";
const DEFAULT_ENDPOINT = "https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed";
const DEFAULT_STRATEGIES = ["mobile", "desktop"];
const DEFAULT_CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];
const DEFAULT_LOCALE = "tr";
const DEFAULT_OUT = "output/external-audits/vip-gece-pagespeed-api-latest.json";
const DEFAULT_RAW_DIR = "output/external-audits";
const DEFAULT_LIGHTHOUSE_VERSION = "13.4.0";
const METRIC_IDS = [
  "first-contentful-paint",
  "largest-contentful-paint",
  "total-blocking-time",
  "cumulative-layout-shift",
  "speed-index",
  "interactive"
];
const OPPORTUNITY_IDS = [
  "render-blocking-resources",
  "unused-css-rules",
  "unused-javascript",
  "uses-optimized-images",
  "uses-webp-images",
  "uses-responsive-images",
  "server-response-time",
  "total-byte-weight",
  "dom-size",
  "third-party-summary",
  "mainthread-work-breakdown",
  "bootup-time",
  "unminified-css",
  "unminified-javascript"
];
const SCORE_KEYS = {
  performance: "performance",
  accessibility: "accessibility",
  "best-practices": "best_practices",
  seo: "seo"
};

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const jsonOnly = args.includes("--json");
const siteArg = argValue("--site") || argValue("--url");
const locale = argValue("--locale") || DEFAULT_LOCALE;
const outPath = argValue("--out") || DEFAULT_OUT;
const rawDir = argValue("--raw-dir") || DEFAULT_RAW_DIR;
const keyEnv = argValue("--key-env") || "PAGESPEED_API_KEY";
const fallback = argValue("--fallback") || (args.includes("--no-fallback") ? "none" : "lighthouse");
const lighthouseVersion = argValue("--lighthouse-version") || DEFAULT_LIGHTHOUSE_VERSION;
const strategies = listArgs("--strategy", DEFAULT_STRATEGIES);
const categories = listArgs("--category", DEFAULT_CATEGORIES);
const thresholds = {
  performance: numericArg("--min-performance", 70),
  accessibility: numericArg("--min-accessibility", 90),
  best_practices: numericArg("--min-best-practices", 90),
  seo: numericArg("--min-seo", 90)
};

function argValue(name) {
  const prefix = `${name}=`;
  const found = args.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : "";
}

function listArgs(name, fallback) {
  const prefix = `${name}=`;
  const values = args
    .filter((item) => item.startsWith(prefix))
    .flatMap((item) => item.slice(prefix.length).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? [...new Set(values)] : fallback;
}

function numericArg(name, fallback) {
  const raw = argValue(name);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeSiteUrl(raw) {
  const parsed = new URL(String(raw || DEFAULT_SITE_URL).trim());
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("site url must use http or https");
  }
  return parsed.toString();
}

function score(value) {
  return typeof value === "number" ? Math.round(value * 100) : null;
}

function shortError(error) {
  const info = Array.isArray(error?.details)
    ? error.details.find((item) => item?.["@type"] === "type.googleapis.com/google.rpc.ErrorInfo")
    : null;
  return {
    code: error?.code || 0,
    status: error?.status || "",
    reason: info?.reason || error?.errors?.[0]?.reason || "",
    message: error?.message || "PageSpeed API request failed",
    quota_metric: info?.metadata?.quota_metric || "",
    quota_limit_value: info?.metadata?.quota_limit_value || ""
  };
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    const child = spawn(command, commandArgs, {
      shell: false,
      ...options
    });

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code === 0) {
        resolve({ stdout: out, stderr: err });
      } else {
        reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code}\n${err || out}`));
      }
    });
  });
}

function auditSummary(audits, id) {
  const audit = audits?.[id];
  if (!audit) return null;
  return {
    id,
    title: audit.title || id,
    score: audit.score,
    display_value: audit.displayValue || "",
    numeric_value: typeof audit.numericValue === "number" ? Math.round(audit.numericValue) : null,
    numeric_unit: audit.numericUnit || "",
    savings_ms: audit.details?.overallSavingsMs ? Math.round(audit.details.overallSavingsMs) : 0,
    savings_bytes: audit.details?.overallSavingsBytes ? Math.round(audit.details.overallSavingsBytes) : 0
  };
}

function slugForRaw(siteUrl, strategy) {
  const parsed = new URL(siteUrl);
  const host = parsed.hostname.replace(/[^a-z0-9.-]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${host || "site"}-pagespeed-${strategy}-raw.json`;
}

function buildApiUrl(siteUrl, strategy, apiKey) {
  const params = new URLSearchParams({
    url: siteUrl,
    strategy,
    locale
  });
  for (const category of categories) params.append("category", category);
  if (apiKey) params.set("key", apiKey);
  return `${DEFAULT_ENDPOINT}?${params.toString()}`;
}

function summarizeLhr(lhr, base) {
  const audits = lhr.audits || {};
  const categoriesOut = Object.fromEntries(
    Object.entries(lhr.categories || {}).map(([id, category]) => [SCORE_KEYS[id] || id, score(category.score)])
  );
  const metrics = Object.fromEntries(
    METRIC_IDS
      .map((id) => [id, auditSummary(audits, id)])
      .filter(([, value]) => value)
  );
  const opportunities = OPPORTUNITY_IDS
    .map((id) => auditSummary(audits, id))
    .filter(Boolean)
    .filter((item) => item.score !== 1 || item.savings_ms || item.savings_bytes)
    .sort((a, b) => (b.savings_ms - a.savings_ms) || (b.savings_bytes - a.savings_bytes))
    .slice(0, 8);
  const findings = [];

  for (const [key, minimum] of Object.entries(thresholds)) {
    const actual = categoriesOut[key];
    if (actual !== null && actual !== undefined && actual < minimum) {
      findings.push(`${key} score ${actual} below ${minimum}`);
    }
  }

  return {
    ...base,
    ok: findings.length === 0,
    final_url: lhr.finalUrl || lhr.requestedUrl || "",
    fetch_time: lhr.fetchTime || "",
    lighthouse_version: lhr.lighthouseVersion || "",
    categories: categoriesOut,
    metrics,
    opportunities,
    run_warnings: lhr.runWarnings || [],
    findings
  };
}

async function runLighthouseFallback(siteUrl, strategy, apiFailure) {
  const rawPath = path.join(rawDir, slugForRaw(siteUrl, `lighthouse-${strategy}`));
  await mkdir(rawDir, { recursive: true });
  const onlyCategories = categories.join(",");
  const args = [
    "--yes",
    `lighthouse@${lighthouseVersion}`,
    siteUrl,
    "--quiet",
    "--output=json",
    `--output-path=${rawPath}`,
    `--only-categories=${onlyCategories}`,
    "--chrome-flags=--headless=new --no-sandbox --disable-gpu"
  ];

  if (strategy === "desktop") args.push("--preset=desktop");

  try {
    await run("npx", args, { cwd: process.cwd(), env: process.env });
    const body = JSON.parse(await readFile(rawPath, "utf8"));
    return summarizeLhr(body, {
      source: "lighthouse-fallback",
      status: 200,
      raw_path: rawPath,
      api: apiFailure
    });
  } catch (error) {
    return {
      ok: false,
      source: "lighthouse-fallback",
      status: 0,
      raw_path: rawPath,
      api: apiFailure,
      error: {
        message: error.message || "Lighthouse fallback failed"
      }
    };
  }
}

async function runStrategy(siteUrl, strategy, apiKey) {
  await mkdir(rawDir, { recursive: true });
  const rawPath = path.join(rawDir, slugForRaw(siteUrl, strategy));
  let response;
  try {
    response = await fetch(buildApiUrl(siteUrl, strategy, apiKey), {
      headers: {
        Accept: "application/json",
        "User-Agent": "VIP-Gece-PageSpeed-API-Audit/2026-06-28"
      }
    });
  } catch (error) {
    const body = {
      error: {
        code: 0,
        status: "FETCH_FAILED",
        message: error.message || "fetch failed"
      }
    };
    await writeFile(rawPath, JSON.stringify(body, null, 2));
    const apiFailure = {
      ok: false,
      status: 0,
      raw_path: rawPath,
      error: shortError(body.error)
    };
    if (fallback === "lighthouse") {
      return runLighthouseFallback(siteUrl, strategy, apiFailure);
    }
    return {
      source: "pagespeed-api",
      ...apiFailure
    };
  }
  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = { raw: bodyText };
  }

  await writeFile(rawPath, JSON.stringify(body, null, 2));

  if (!response.ok) {
    const apiFailure = {
      ok: false,
      status: response.status,
      raw_path: rawPath,
      error: shortError(body.error || body)
    };
    if (fallback === "lighthouse") {
      return runLighthouseFallback(siteUrl, strategy, apiFailure);
    }
    return {
      source: "pagespeed-api",
      ...apiFailure
    };
  }

  return summarizeLhr(body.lighthouseResult || {}, {
    source: "pagespeed-api",
    status: response.status,
    raw_path: rawPath
  });
}

function printReport(report) {
  console.log(`site=${report.site_url}`);
  console.log(`endpoint=${DEFAULT_ENDPOINT}`);
  console.log(`key_used=${report.key_used}`);
  console.log(`fallback=${report.fallback}`);
  console.log(`out=${report.out_path}`);
  console.log(`ok=${report.ok}`);
  for (const [strategy, result] of Object.entries(report.strategies)) {
    if (!result.ok && result.error) {
      console.log(`${strategy}: source=${result.source || "unknown"} status=${result.status} error=${result.error.status || result.error.reason || ""} message=${result.error.message}`);
      if (result.error.quota_metric) {
        console.log(`  quota=${result.error.quota_metric} limit=${result.error.quota_limit_value || "unknown"}`);
      }
      if (result.api?.error?.message) {
        console.log(`  api_status=${result.api.status} api_error=${result.api.error.status || result.api.error.reason} api_message=${result.api.error.message}`);
      }
      console.log(`  raw=${result.raw_path}`);
      continue;
    }
    const cats = result.categories || {};
    console.log(`${strategy}: source=${result.source || "unknown"} perf=${cats.performance ?? "n/a"} accessibility=${cats.accessibility ?? "n/a"} best_practices=${cats.best_practices ?? "n/a"} seo=${cats.seo ?? "n/a"}`);
    if (result.api?.error?.message) {
      console.log(`  api_status=${result.api.status} api_error=${result.api.error.status || result.api.error.reason} fallback_used=true`);
    }
    for (const [id, metric] of Object.entries(result.metrics || {})) {
      console.log(`  metric ${id}: ${metric.display_value || metric.numeric_value || "n/a"}`);
    }
    for (const item of result.opportunities || []) {
      const savings = item.savings_ms ? `${item.savings_ms}ms` : item.savings_bytes ? `${item.savings_bytes}B` : "review";
      console.log(`  opportunity ${item.id}: score=${item.score} savings=${savings} ${item.title}`);
    }
    for (const finding of result.findings || []) console.log(`  finding ${finding}`);
    console.log(`  raw=${result.raw_path}`);
  }
}

async function main() {
  const siteUrl = normalizeSiteUrl(siteArg || process.env.LIVE_SITE_URL);
  const apiKey = process.env[keyEnv] || "";
  const report = {
    ok: false,
    strict,
    site_url: siteUrl,
    checked_at: new Date().toISOString(),
    endpoint: DEFAULT_ENDPOINT,
    strategies_requested: strategies,
    categories_requested: categories,
    locale,
    key_env: keyEnv,
    key_used: Boolean(apiKey),
    fallback,
    lighthouse_version: fallback === "lighthouse" ? lighthouseVersion : null,
    thresholds,
    out_path: outPath,
    strategies: {}
  };

  for (const strategy of strategies) {
    report.strategies[strategy] = await runStrategy(siteUrl, strategy, apiKey);
  }

  report.ok = Object.values(report.strategies).every((item) => item.ok);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(report, null, 2));

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  if (strict && !report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
