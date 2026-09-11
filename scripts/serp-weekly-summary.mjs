"use strict";

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_DIR = "output/external-audits";

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

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function numericRank(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function rowKey(row) {
  return [row.device || "", row.slug || "", row.query || ""].join("|");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function latestSerpFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/serp.*\.json$/i.test(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    try {
      const payload = await readJson(fullPath);
      files.push({
        file: fullPath,
        checkedAt: payload?.meta?.checked_at || payload?.meta?.finished_at || "",
        provider: payload?.meta?.provider || "",
        rows: Array.isArray(payload?.rows) ? payload.rows.length : 0
      });
    } catch {
      // Ignore partial or non-report JSON files.
    }
  }
  return files
    .filter((file) => file.checkedAt)
    .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));
}

async function resolveCurrentFile(dir) {
  const explicit = argValue("--current", "");
  if (explicit) return explicit;
  const provider = argValue("--provider", "");
  const files = (await latestSerpFiles(dir)).filter((file) => !provider || file.provider === provider);
  const latest = files.at(-1);
  if (!latest) throw new Error(`No SERP JSON reports found in ${dir}`);
  return latest.file;
}

async function resolvePreviousFile(dir, currentFile, currentPayload) {
  const explicit = argValue("--previous", "");
  if (explicit) return explicit;
  const currentAt = currentPayload?.meta?.checked_at || currentPayload?.meta?.finished_at || "";
  const provider = currentPayload?.meta?.provider || "";
  const files = (await latestSerpFiles(dir)).filter((file) => file.file !== currentFile);
  const candidates = files.filter((file) => {
    if (provider && file.provider !== provider) return false;
    return !currentAt || file.checkedAt < currentAt;
  });
  return candidates.at(-1)?.file || "";
}

function compareRows(currentRows, previousRows) {
  const previousByKey = new Map(previousRows.map((row) => [rowKey(row), row]));
  return currentRows.map((row) => {
    const previous = previousByKey.get(rowKey(row)) || {};
    const rank = numericRank(row.rank);
    const previousRank = numericRank(previous.rank);
    let movement = "";
    let change = "";

    if (rank && previousRank) {
      change = previousRank - rank;
      movement = change > 0 ? "up" : change < 0 ? "down" : "same";
    } else if (rank && !previousRank) {
      movement = "new_found";
    } else if (!rank && previousRank) {
      movement = "lost";
    } else if (row.status === "error") {
      movement = "error";
    } else {
      movement = "not_found";
    }

    return {
      device: row.device || "",
      group: row.group || "",
      name: row.name || "",
      slug: row.slug || "",
      side: row.side || "",
      parent_district: row.parent_district || "",
      query: row.query || "",
      status: row.status || "",
      rank: rank || "",
      previous_rank: previousRank || "",
      change,
      movement,
      serp_page: row.serp_page || "",
      matched_url: row.matched_url || "",
      error: row.error || ""
    };
  });
}

function summarize(rows) {
  const foundRows = rows.filter((row) => numericRank(row.rank));
  return {
    total: rows.length,
    found: foundRows.length,
    not_found: rows.filter((row) => row.movement === "not_found").length,
    errors: rows.filter((row) => row.movement === "error").length,
    top_10: foundRows.filter((row) => Number(row.rank) <= 10).length,
    top_20: foundRows.filter((row) => Number(row.rank) <= 20).length,
    top_50: foundRows.filter((row) => Number(row.rank) <= 50).length,
    improved: rows.filter((row) => row.movement === "up").length,
    declined: rows.filter((row) => row.movement === "down").length,
    same: rows.filter((row) => row.movement === "same").length,
    new_found: rows.filter((row) => row.movement === "new_found").length,
    lost: rows.filter((row) => row.movement === "lost").length
  };
}

function markdownTable(rows) {
  const selected = rows
    .filter((row) => ["up", "down", "new_found", "lost"].includes(row.movement))
    .sort((a, b) => {
      const rankA = numericRank(a.rank) || 9999;
      const rankB = numericRank(b.rank) || 9999;
      return rankA - rankB || String(a.query).localeCompare(String(b.query), "tr");
    })
    .slice(0, 40);

  if (!selected.length) return "_Bu hafta belirgin sira degisimi yok._\n";

  const lines = [
    "| Query | Device | Onceki | Simdi | Degisim | URL |",
    "| --- | --- | ---: | ---: | --- | --- |"
  ];
  for (const row of selected) {
    const change = row.movement === "up" ? `+${row.change}` : row.movement === "down" ? String(row.change) : row.movement;
    lines.push(`| ${row.query} | ${row.device} | ${row.previous_rank || "-"} | ${row.rank || "-"} | ${change} | ${row.matched_url || "-"} |`);
  }
  return `${lines.join("\n")}\n`;
}

async function writeSummary(outBase, payload) {
  const jsonPath = `${outBase}.json`;
  const csvPath = `${outBase}.csv`;
  const mdPath = `${outBase}.md`;
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);

  const header = [
    "device",
    "group",
    "name",
    "slug",
    "side",
    "parent_district",
    "query",
    "status",
    "rank",
    "previous_rank",
    "change",
    "movement",
    "serp_page",
    "matched_url",
    "error"
  ];
  const lines = [header.join(",")];
  for (const row of payload.rows) {
    lines.push(header.map((field) => csvEscape(row[field])).join(","));
  }
  await writeFile(csvPath, `${lines.join("\n")}\n`);

  const summary = payload.summary;
  const markdown = `# VIP GECE Haftalik SERP Ozeti

- Current: \`${payload.meta.current_file}\`
- Previous: ${payload.meta.previous_file ? `\`${payload.meta.previous_file}\`` : "_yok_"}
- Checked at: ${payload.meta.checked_at}
- Provider: ${payload.meta.provider || "-"}
- Total: ${summary.total}
- Found: ${summary.found}
- Top 10 / 20 / 50: ${summary.top_10} / ${summary.top_20} / ${summary.top_50}
- Improved / Declined / Same: ${summary.improved} / ${summary.declined} / ${summary.same}
- New found / Lost / Errors: ${summary.new_found} / ${summary.lost} / ${summary.errors}

## Degisenler

${markdownTable(payload.rows)}
`;
  await writeFile(mdPath, markdown);
  return { jsonPath, csvPath, mdPath };
}

async function main() {
  const dir = argValue("--dir", DEFAULT_DIR);
  const currentFile = await resolveCurrentFile(dir);
  const currentPayload = await readJson(currentFile);
  const previousFile = await resolvePreviousFile(dir, currentFile, currentPayload);
  const previousPayload = previousFile ? await readJson(previousFile) : { rows: [] };
  const rows = compareRows(currentPayload.rows || [], previousPayload.rows || []);
  const summary = summarize(rows);
  const outDir = argValue("--out-dir", dir);
  const outName =
    argValue("--out", "") ||
    `serp-weekly-summary-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`;
  const outBase = path.join(outDir, outName.replace(/\.(json|csv|md)$/i, ""));
  await mkdir(outDir, { recursive: true });
  const payload = {
    meta: {
      generated_at: new Date().toISOString(),
      checked_at: currentPayload?.meta?.checked_at || currentPayload?.meta?.finished_at || "",
      provider: currentPayload?.meta?.provider || "",
      current_file: currentFile,
      previous_file: previousFile
    },
    summary,
    rows
  };
  const outputs = await writeSummary(outBase, payload);
  if (hasArg("--json")) {
    console.log(JSON.stringify({ ...payload.meta, ...summary, ...outputs }, null, 2));
    return;
  }
  console.log(`ok weekly-summary total=${summary.total} found=${summary.found} improved=${summary.improved} declined=${summary.declined}`);
  console.log(`markdown=${outputs.mdPath}`);
  console.log(`json=${outputs.jsonPath}`);
  console.log(`csv=${outputs.csvPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
