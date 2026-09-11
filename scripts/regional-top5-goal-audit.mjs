"use strict";

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_INPUT_DIR = "output/external-audits";
const DEFAULT_TARGET_POSITION = 5;
const DEFAULT_MINIMUM_IMPRESSIONS = 10;
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

function numberArg(name, fallback, min, max) {
  const raw = argValue(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href.replace(/\/$/, url.pathname === "/" ? "/" : "");
  } catch {
    return "";
  }
}

function expectedUrlFor(row, siteUrl) {
  try {
    return normalizeUrl(new URL(`/${String(row.slug || "").replace(/^\/+/, "")}`, siteUrl).href);
  } catch {
    return "";
  }
}

export function evaluateRegionalRows(rows, options = {}) {
  const siteUrl = options.siteUrl || "https://vip-gece.site";
  const targetPosition = Number(options.targetPosition || DEFAULT_TARGET_POSITION);
  const minimumImpressions = Number(options.minimumImpressions || DEFAULT_MINIMUM_IMPRESSIONS);

  const evaluated = (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.group === "district" || row?.group === "istanbul")
    .map((row) => {
      const impressions = Number(row.impressions || 0);
      const position = Number(row.avg_position || 0);
      const expectedUrl = expectedUrlFor(row, siteUrl);
      const topPage = normalizeUrl(row.top_page);
      const hasData = row.status === "has_gsc_data" && impressions > 0 && position > 0;
      const correctPage = hasData && expectedUrl === topPage;
      let goalStatus = "no_data";

      if (hasData && !correctPage) goalStatus = "cannibalized";
      else if (hasData && position > targetPosition) goalStatus = "outside_top5";
      else if (hasData && impressions < minimumImpressions) goalStatus = "top5_low_sample";
      else if (hasData) goalStatus = "top5_validated";

      return {
        ...row,
        expected_page: expectedUrl,
        correct_target_page: correctPage,
        goal_status: goalStatus
      };
    });

  function summarize(scopeRows) {
    const count = (status) => scopeRows.filter((row) => row.goal_status === status).length;
    return {
      total: scopeRows.length,
      with_data: scopeRows.filter((row) => row.goal_status !== "no_data").length,
      correct_target_page: scopeRows.filter((row) => row.correct_target_page).length,
      top5_validated: count("top5_validated"),
      top5_low_sample: count("top5_low_sample"),
      outside_top5: count("outside_top5"),
      cannibalized: count("cannibalized"),
      no_data: count("no_data")
    };
  }

  const districts = evaluated.filter((row) => row.group === "district");
  const city = evaluated.filter((row) => row.group === "istanbul");
  return {
    target: {
      position_at_most: targetPosition,
      minimum_impressions: minimumImpressions,
      requires_intended_canonical_page: true,
      measurement: "rolling Google Search Console average position"
    },
    summary: {
      districts: summarize(districts),
      istanbul_hub: summarize(city),
      combined: summarize(evaluated)
    },
    rows: evaluated
  };
}

async function latestInputFile(inputDir) {
  const names = (await readdir(inputDir))
    .filter((name) => /^gsc-daily-.*\.json$/i.test(name));
  const candidates = await Promise.all(names.map(async (name) => {
    const file = path.join(inputDir, name);
    return { file, modified: (await stat(file)).mtimeMs };
  }));
  candidates.sort((a, b) => b.modified - a.modified);
  if (!candidates[0]) throw new Error(`GSC input bulunamadı: ${inputDir}`);
  return candidates[0].file;
}

async function main() {
  const input = argValue("--input") || await latestInputFile(argValue("--input-dir", DEFAULT_INPUT_DIR));
  const payload = JSON.parse(await readFile(input, "utf8"));
  const report = evaluateRegionalRows(payload.rows, {
    siteUrl: argValue("--site", process.env.SITE_URL || "https://vip-gece.site"),
    targetPosition: numberArg("--target-position", DEFAULT_TARGET_POSITION, 1, 100),
    minimumImpressions: numberArg("--minimum-impressions", DEFAULT_MINIMUM_IMPRESSIONS, 1, 1000000)
  });
  report.meta = {
    generated_at: new Date().toISOString(),
    input,
    source_checked_at: payload.meta?.checked_at || "",
    start_date: payload.meta?.start_date || "",
    end_date: payload.meta?.end_date || "",
    note: "GSC average position is not a location-neutral live SERP guarantee. Strict success requires the intended page, top 5 average position and the minimum impression sample."
  };

  const output = argValue("--output");
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));

  if (hasArg("--strict") && report.summary.districts.top5_validated !== report.summary.districts.total) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
