"use strict";

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageSha as artifactSha, resolvePackageArtifact } from "./package-artifact.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const PACKAGE_ARTIFACT = await resolvePackageArtifact();
const PROOF_DIR = path.join(ROOT_DIR, "docs/external");
const DRAFT_DIR = path.join(PROOF_DIR, "_drafts");
const args = process.argv.slice(2);
const argSet = new Set(args);

const templateChoiceMarkers = [
  "use / defer / skip",
  "HighLevel / HubSpot / defer / skip"
];

const proofSecretPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i,
  /\b(?:api[_-]?key|token|password|passwd|secret|cookie|session)[\s:=]+[A-Za-z0-9._~+/-]{8,}/i,
  /\b(?:sk|ghp|glpat|xox[baprs])[-_][A-Za-z0-9_-]{12,}/i,
  /[?&](?:token|key|session|cookie|secret)=/i
];

const proofDefs = [
  {
    id: "production",
    title: "Production Deploy",
    target: "production-deploy-vip-gece.md",
    rule: {
      minChars: 260,
      requiredFields: ["Date", "Production URL", "Deployed package SHA", "Traffic switch method", "Live SEO command", "Live SEO result", "Owner confirmation"]
    },
    draft({ date, sha }) {
      return `# VIP GECE Production Deploy Proof

- Date: ${date}
- Production URL: https://vip-gece.site
- Deployed package SHA: <paste deployed package sha; expected current package ${sha || "unknown"}>
- Traffic switch method: <describe VPS/deploy/traffic switch method>
- Live SEO command: npm run live-seo-audit -- --strict
- Live SEO result: <paste post-switch strict audit line containing ok=true>
- Owner confirmation: <owner name/time or approval note>

No secrets included.
`;
    }
  },
  {
    id: "semrush",
    title: "Semrush",
    target: "semrush-vip-gece.md",
    rule: {
      minChars: 220,
      requiredFields: ["Date", "Account/workspace", "Project/domain", "Report/export reference", "Audit scope", "Main findings", "Owner confirmation"]
    },
    draft({ date }) {
      return `# VIP GECE Semrush Proof

- Date: ${date}
- Account/workspace: <workspace label only>
- Project/domain: vip-gece.site
- Report/export reference: <report id, file path, or dashboard link label>
- Audit scope: <crawl/audit scope>
- Main findings: <short result summary>
- Next actions: <follow-up actions>
- Owner confirmation: <owner name/time or approval note>

No secrets included.
`;
    }
  },
  {
    id: "seo-audit",
    title: "External SEO Audit",
    target: "seo-audit-vip-gece.md",
    rule: {
      minChars: 240,
      requiredFields: ["Date", "Tool/source", "Account/workspace", "Project/domain", "Report/export reference", "Audit scope", "Main findings", "Owner confirmation"]
    },
    draft({ date }) {
      return `# VIP GECE External SEO Audit Proof

- Date: ${date}
- Tool/source: <Semrush alternative such as Google Search Console, Ahrefs Webmaster Tools, Sitechecker, SE Ranking, Screaming Frog, or another external audit source>
- Account/workspace: <workspace label only>
- Project/domain: vip-gece.site
- Report/export reference: <report id, file path, or dashboard link label>
- Audit scope: <crawl/audit scope>
- Main findings: <short result summary>
- Next actions: <follow-up actions>
- Owner confirmation: <owner name/time or approval note>

No secrets included.
`;
    }
  },
  {
    id: "brand24",
    title: "Brand24",
    target: "brand24-vip-gece.md",
    rule: {
      minChars: 220,
      requiredFields: ["Date", "Account/workspace", "Project name", "Keyword/mention set", "Alert/stream reference", "Main findings", "Owner confirmation"]
    },
    draft({ date }) {
      return `# VIP GECE Brand24 Proof

- Date: ${date}
- Account/workspace: <workspace label only>
- Project name: <project name>
- Keyword/mention set: <tracked keywords>
- Alert/stream reference: <alert or stream reference>
- Main findings: <short result summary>
- Next actions: <follow-up actions>
- Owner confirmation: <owner name/time or approval note>

No secrets included.
`;
    }
  },
  {
    id: "similarweb",
    title: "Similarweb",
    target: "similarweb-vip-gece.md",
    rule: {
      alternatives: [
        {
          minChars: 220,
          requiredFields: ["Date", "Account/workspace", "Domain set", "Competitor set", "Report/export reference", "Main findings", "Owner confirmation"]
        },
        {
          minChars: 160,
          requiredFields: ["Date", "Decision", "Reason", "Owner confirmation"]
        }
      ]
    },
    draft({ date }) {
      return `# VIP GECE Similarweb Proof

- Date: ${date}
- Account/workspace: <workspace label only>
- Domain set: vip-gece.site
- Competitor set: <competitor domains reviewed>
- Report/export reference: <report id, file path, or dashboard link label>
- Main findings: <short result summary>
- Next actions: <follow-up actions>
- Owner confirmation: <owner name/time or approval note>

No secrets included.
`;
    }
  },
  {
    id: "conductor",
    title: "Conductor Decision / Proof",
    target: "conductor-vip-gece.md",
    rule: {
      minChars: 160,
      requiredFields: ["Date", "Decision", "Reason", "Owner confirmation"]
    },
    draft({ date }) {
      return `# VIP GECE Conductor Decision / Proof

- Date: ${date}
- Decision: <use, defer, or skip>
- Reason: <why this decision is acceptable for the current release>
- Account/project reference if used: <reference or none>
- Next review date: <date or none>
- Owner confirmation: <owner name/time or approval note>

No secrets included.
`;
    }
  },
  {
    id: "channel99",
    title: "Channel99 Decision / Proof",
    target: "channel99-vip-gece.md",
    rule: {
      minChars: 160,
      requiredFields: ["Date", "Decision", "Reason", "Owner confirmation"]
    },
    draft({ date }) {
      return `# VIP GECE Channel99 Decision / Proof

- Date: ${date}
- Decision: <use, defer, or skip>
- Reason: <why this decision is acceptable for the current release>
- Account/project reference if used: <reference or none>
- Paid attribution scope: <scope or none>
- Next review date: <date or none>
- Owner confirmation: <owner name/time or approval note>

No secrets included.
`;
    }
  },
  {
    id: "lead-crm",
    title: "HighLevel / HubSpot",
    target: "lead-crm-vip-gece.md",
    rule: {
      minChars: 180,
      requiredFields: ["Date", "Selected option", "Reason", "Lead flow scope", "Owner confirmation"]
    },
    draft({ date }) {
      return `# VIP GECE Lead CRM Decision / Proof

- Date: ${date}
- Selected option: <HighLevel, HubSpot, defer, or skip>
- Reason: <why this decision is acceptable for the current release>
- Account/project reference if used: <reference or none>
- Lead flow scope: <lead capture and handoff scope>
- Next actions: <follow-up actions>
- Owner confirmation: <owner name/time or approval note>

No secrets included.
`;
    }
  }
];

function usage() {
  return `Usage:
  npm run external-proof-intake -- --markdown
  npm run external-proof-intake -- --write-drafts
  npm run external-proof-intake -- --promote=<proof-id>

Proof ids: ${proofDefs.map((item) => item.id).join(", ")}
`;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function proofFieldValue(text, field) {
  const match = text.match(new RegExp(`^\\s*-\\s*${escapeRegex(field)}\\s*:\\s*(.+?)\\s*$`, "mi"));
  return match?.[1]?.trim() || "";
}

function hasPlaceholder(value) {
  const text = String(value || "").trim();
  return !text
    || /^<[^>]+>$/.test(text)
    || /<[^>]+>/.test(text)
    || templateChoiceMarkers.some((marker) => text.includes(marker));
}

function secretLikeLine(text) {
  return String(text || "")
    .split(/\r?\n/)
    .find((line) => proofSecretPatterns.some((pattern) => pattern.test(line)))
    || "";
}

function validateProofText(text, rule) {
  if (Array.isArray(rule.alternatives)) {
    const results = rule.alternatives.map((alternative) => validateProofText(text, alternative));
    const valid = results.find((result) => result.ok);
    if (valid) return valid;
    return { ok: false, reason: results.map((result) => result.reason).join("; ") };
  }

  const trimmed = text.trim();
  if (trimmed.length < rule.minChars) {
    return { ok: false, reason: `too short (${trimmed.length}/${rule.minChars} chars)` };
  }

  const secretLine = secretLikeLine(trimmed);
  if (secretLine) {
    return { ok: false, reason: `secret-like value present near: ${secretLine.slice(0, 80)}` };
  }

  const missing = rule.requiredFields.filter((field) => !proofFieldValue(text, field));
  if (missing.length) {
    return { ok: false, reason: `missing fields: ${missing.join(", ")}` };
  }

  const placeholderFields = rule.requiredFields.filter((field) => hasPlaceholder(proofFieldValue(text, field)));
  if (placeholderFields.length) {
    return { ok: false, reason: `placeholder fields: ${placeholderFields.join(", ")}` };
  }

  return { ok: true, reason: "valid proof draft" };
}

async function packageSha() {
  return artifactSha(PACKAGE_ARTIFACT);
}

function dateStamp() {
  return process.env.PROOF_DATE || new Date().toISOString().slice(0, 10);
}

function proofPaths(def) {
  return {
    target: path.join(PROOF_DIR, def.target),
    draft: path.join(DRAFT_DIR, def.target)
  };
}

async function statusRows() {
  const rows = [];
  for (const def of proofDefs) {
    const paths = proofPaths(def);
    const targetText = await readText(paths.target);
    const draftText = await readText(paths.draft);
    const targetExists = Boolean(targetText);
    const draftExists = Boolean(draftText);
    const targetValidation = targetExists ? validateProofText(targetText, def.rule) : null;
    const state = targetValidation?.ok
      ? "ready"
      : targetExists
        ? `invalid: ${targetValidation.reason}`
        : draftExists
          ? "draft"
          : "missing";
    const next = targetValidation?.ok
      ? "none"
      : draftExists
        ? `fill ${path.relative(ROOT_DIR, paths.draft)} then promote`
        : "run --write-drafts";

    rows.push({
      id: def.id,
      title: def.title,
      target: path.relative(ROOT_DIR, paths.target),
      draft: path.relative(ROOT_DIR, paths.draft),
      state,
      next
    });
  }
  return rows;
}

async function writeDrafts() {
  await mkdir(DRAFT_DIR, { recursive: true });
  const sha = await packageSha();
  const date = dateStamp();
  const force = argSet.has("--force");
  const written = [];

  for (const def of proofDefs) {
    const { draft } = proofPaths(def);
    if (!force && await exists(draft)) {
      continue;
    }
    await writeFile(draft, def.draft({ date, sha }));
    written.push(path.relative(ROOT_DIR, draft));
  }

  return written;
}

async function promote(id) {
  const def = proofDefs.find((item) => item.id === id);
  if (!def) {
    throw new Error(`unknown proof id: ${id}`);
  }

  const paths = proofPaths(def);
  const draft = await readText(paths.draft);
  if (!draft) {
    throw new Error(`draft missing: ${path.relative(ROOT_DIR, paths.draft)}`);
  }

  const validation = validateProofText(draft, def.rule);
  if (!validation.ok) {
    throw new Error(`draft is not valid proof yet: ${validation.reason}`);
  }

  await writeFile(paths.target, draft);
  return path.relative(ROOT_DIR, paths.target);
}

function promoteArg() {
  const direct = args.find((arg) => arg.startsWith("--promote="));
  if (direct) return direct.split("=", 2)[1];
  const index = args.indexOf("--promote");
  return index >= 0 ? args[index + 1] : "";
}

function printMarkdown(rows) {
  console.log("# VIP GECE External Proof Intake");
  console.log("");
  console.log(`Current package SHA: \`${rows.packageSha || ""}\``);
  console.log("");
  console.log("| Proof | Target | State | Next |");
  console.log("| --- | --- | --- | --- |");
  for (const row of rows) {
    console.log(`| ${row.title} | \`${row.target}\` | \`${row.state}\` | ${row.next} |`);
  }
}

async function main() {
  if (argSet.has("--help") || argSet.has("-h")) {
    console.log(usage());
    return;
  }

  if (argSet.has("--write-drafts")) {
    const written = await writeDrafts();
    console.log(`drafts_written=${written.length}`);
    for (const item of written) console.log(item);
  }

  const id = promoteArg();
  if (id) {
    const target = await promote(id);
    console.log(`promoted=${target}`);
  }

  const rows = await statusRows();
  rows.packageSha = await packageSha();
  if (argSet.has("--markdown") || argSet.has("--write-drafts") || id) {
    printMarkdown(rows);
  } else {
    console.log(JSON.stringify({
      package_sha: rows.packageSha,
      proof_dir: PROOF_DIR,
      draft_dir: DRAFT_DIR,
      rows
    }, null, 2));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
