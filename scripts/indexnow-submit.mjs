"use strict";

import { createRequire } from "node:module";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || ".env" });

const require = createRequire(import.meta.url);
const { parseSitemapEntries } = require("../src/services/gscIndexSelectionService");
const {
  MAX_INDEXNOW_URLS,
  indexNowRuntimeConfig,
  normalizeSiteOrigin,
  selectIndexNowUrls,
  submitIndexNowBatch,
  verifyIndexNowKey
} = require("../src/services/indexNowService");

const args = process.argv.slice(2);
const DEFAULT_SITE = "https://vip-gece.site";
const DEFAULT_STATE = process.env.VIP_GECE_INDEXNOW_STATE_PATH ||
  "output/external-audits/indexnow-state.json";
const DEFAULT_REPORT = process.env.VIP_GECE_INDEXNOW_REPORT_PATH ||
  "output/external-audits/indexnow-latest.json";

function argValue(name, fallback = "") {
  const direct = args.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).trim();
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : fallback;
}

function hasArg(name) {
  return args.includes(name);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "VIP-Gece-IndexNow/1.0" },
    signal: AbortSignal.timeout(30_000), redirect: "error"
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  if (!/xml/i.test(response.headers.get("content-type") || "")) throw new Error("IndexNow requires an XML sitemap response");
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 8 * 1024 * 1024) throw new Error("Sitemap exceeds the configured size limit");
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!/<urlset\b/.test(body) || !/<\/urlset>\s*$/.test(body)) throw new Error("Sitemap is incomplete or unsupported; no URLs submitted");
  return body;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error("IndexNow state is unreadable; refusing to resubmit the entire site");
  }
}

async function writeJsonAtomic(file, payload) {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

function batches(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function main() {
  const config = indexNowRuntimeConfig();
  if (!config.enabled) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "INDEXNOW_ENABLED is not true" }, null, 2));
    return;
  }

  const site = normalizeSiteOrigin(argValue("--site", process.env.SITE_URL || DEFAULT_SITE));
  const sitemapUrl = `${site}/sitemap.xml`;
  const statePath = argValue("--state", DEFAULT_STATE);
  const reportPath = argValue("--report", DEFAULT_REPORT);
  const dryRun = hasArg("--dry-run");
  const forceAll = hasArg("--all");
  const sitemapXml = await fetchText(sitemapUrl);
  const entries = parseSitemapEntries(sitemapXml, site);
  const previousState = await readJson(statePath);
  const selection = selectIndexNowUrls({ entries, previousState, site, forceAll });
  const checkedAt = new Date().toISOString();
  const plan = {
    site,
    sitemap_url: sitemapUrl,
    sitemap_url_count: Object.keys(selection.currentMap).length,
    selected_url_count: selection.urls.length,
    changed_url_count: selection.changedUrls.length,
    removed_url_count: selection.removedUrls.length,
    force_all: forceAll,
    policy: "IndexNow only; Google Indexing API is not used"
  };

  if (dryRun) {
    console.log(JSON.stringify({ ok: true, dry_run: true, ...plan, urls: selection.urls }, null, 2));
    return;
  }

  if (!selection.urls.length) {
    const report = {
      ok: true,
      checked_at: checkedAt,
      submission_status: "no_changes",
      ...plan,
      response_statuses: []
    };
    await writeJsonAtomic(reportPath, report);
    console.log(JSON.stringify({ ...report, report: path.resolve(reportPath) }, null, 2));
    return;
  }

  const reportBase = {
    checked_at: checkedAt,
    submission_status: "pending",
    ...plan
  };

  try {
    await verifyIndexNowKey({ site, key: config.key });
    const responseStatuses = [];
    for (const urlBatch of batches(selection.urls, MAX_INDEXNOW_URLS)) {
      const result = await submitIndexNowBatch({ site, key: config.key, urls: urlBatch });
      responseStatuses.push(result.status);
    }

    const report = {
      ok: true,
      ...reportBase,
      submission_status: "accepted",
      indexed_status: "not_verified",
      key_verified: true,
      response_statuses: responseStatuses
    };
    await writeJsonAtomic(reportPath, report);
    await writeJsonAtomic(statePath, {
      version: 1,
      updated_at: checkedAt,
      last_successful_run: checkedAt,
      sitemap_url_count: plan.sitemap_url_count,
      sitemap_lastmods: selection.currentMap,
      last_submitted_url_count: selection.urls.length,
      last_response_statuses: responseStatuses,
      last_report: path.resolve(reportPath)
    });
    console.log(JSON.stringify({ ...report, state: path.resolve(statePath), report: path.resolve(reportPath) }, null, 2));
  } catch (error) {
    const report = {
      ok: false,
      ...reportBase,
      submission_status: "failed",
      key_verified: false,
      response_statuses: [],
      error: error.message || String(error)
    };
    await writeJsonAtomic(reportPath, report);
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
