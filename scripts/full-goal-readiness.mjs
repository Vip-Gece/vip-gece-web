"use strict";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { packageSha, resolvePackageArtifact } from "./package-artifact.mjs";

const require = createRequire(import.meta.url);

try {
  require("dotenv").config();
} catch {
  // dotenv is optional for CI/package checks.
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const PACKAGE_ARTIFACT = await resolvePackageArtifact();

const args = new Set(process.argv.slice(2));
const markdown = args.has("--markdown");
const strict = args.has("--strict");

function envTrue(name) {
  return /^(1|true|yes|ok|ready|done)$/i.test(process.env[name] || "");
}

function envPresent(name) {
  return Boolean(process.env[name] && String(process.env[name]).trim());
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

function repoPath(relativePath) {
  return path.join(ROOT_DIR, relativePath);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

const proofRules = {
  productionDeploy: {
    minChars: 260,
    requiredFields: ["Date", "Production URL", "Deployed package SHA", "Traffic switch method", "Live SEO command", "Live SEO result", "Owner confirmation"]
  },
  semrush: {
    minChars: 220,
    requiredFields: ["Date", "Account/workspace", "Project/domain", "Report/export reference", "Audit scope", "Main findings", "Owner confirmation"]
  },
  externalSeoAudit: {
    minChars: 240,
    requiredFields: ["Date", "Tool/source", "Account/workspace", "Project/domain", "Report/export reference", "Audit scope", "Main findings", "Owner confirmation"]
  },
  brand24: {
    minChars: 220,
    requiredFields: ["Date", "Account/workspace", "Project name", "Keyword/mention set", "Alert/stream reference", "Main findings", "Owner confirmation"]
  },
  similarweb: {
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
  decision: {
    minChars: 160,
    requiredFields: ["Date", "Decision", "Reason", "Owner confirmation"]
  },
  leadCrm: {
    minChars: 180,
    requiredFields: ["Date", "Selected option", "Reason", "Lead flow scope", "Owner confirmation"]
  }
};

function proofFieldValue(text, field) {
  const match = text.match(new RegExp(`^\\s*-\\s*${escapeRegex(field)}\\s*:\\s*(.+?)\\s*$`, "mi"));
  return match?.[1]?.trim() || "";
}

function proofFields(text, fields) {
  return Object.fromEntries(fields.map((field) => [field, proofFieldValue(text, field)]));
}

function secretLikeLine(text) {
  return String(text || "")
    .split(/\r?\n/)
    .find((line) => proofSecretPatterns.some((pattern) => pattern.test(line)))
    || "";
}

function normalizeSha(value) {
  return String(value || "").match(/\b[a-f0-9]{64}\b/i)?.[0]?.toLowerCase() || "";
}

function normalizeUrl(value) {
  try {
    return new URL(String(value || "").trim()).toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function liveSeoResultOk(value) {
  const text = String(value || "");
  return /\bok\s*=\s*true\b/i.test(text) || /"ok"\s*:\s*true\b/i.test(text);
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

  const placeholderFields = rule.requiredFields.filter((field) => {
    const value = proofFieldValue(text, field);
    return templateChoiceMarkers.some((marker) => value.includes(marker)) || /^<[^>]+>$/.test(value);
  });
  if (placeholderFields.length) {
    return { ok: false, reason: `placeholder fields: ${placeholderFields.join(", ")}` };
  }

  return { ok: true, reason: "valid proof file", fields: proofFields(text, rule.requiredFields) };
}

async function validateProofFile(proofPath, rule) {
  if (proofPath.includes(`${path.sep}_templates${path.sep}`) || proofPath.includes(`${path.sep}_drafts${path.sep}`)) {
    return { ok: false, reason: "template/draft path is not accepted as proof" };
  }

  const text = await readText(proofPath);
  if (!text) {
    return { ok: false, reason: "proof file is empty or unreadable" };
  }

  return validateProofText(text, rule);
}

async function proofReady(flagName, defaultRelativePath, overridePathEnv, ruleName) {
  const proofPath = process.env[overridePathEnv] || repoPath(defaultRelativePath);
  const fileExists = await exists(proofPath);
  const rule = proofRules[ruleName];
  const fileValidation = fileExists && rule ? await validateProofFile(proofPath, rule) : { ok: fileExists, reason: fileExists ? "file exists" : "proof file missing" };
  const flagOk = envTrue(flagName);

  return {
    ok: fileValidation.ok,
    flag: flagName,
    flag_ok: flagOk,
    proof_path: proofPath,
    proof_file_exists: fileExists,
    proof_file_valid: fileValidation.ok,
    proof_file_reason: fileValidation.reason,
    proof_file_fields: fileValidation.fields || {}
  };
}

function proofLabel(proof) {
  const invalidReason = proof.proof_file_exists && !proof.proof_file_valid ? ` (file present but invalid: ${proof.proof_file_reason})` : "";
  const flagNote = proof.flag_ok ? `; ${proof.flag}=true is noted but proof file is still required` : "";
  return `${proof.proof_path}${invalidReason}${flagNote}`;
}

function currentPackageSha() {
  return {
    manifest_sha: packageSha(PACKAGE_ARTIFACT),
    sha_file_value: PACKAGE_ARTIFACT.shaFileValue,
    manifest_exists: PACKAGE_ARTIFACT.manifestExists,
    sha_file_exists: PACKAGE_ARTIFACT.shaFileExists,
    package_path: PACKAGE_ARTIFACT.packagePath,
    manifest_path: PACKAGE_ARTIFACT.manifestPath,
    sha_path: PACKAGE_ARTIFACT.shaPath
  };
}

function check(id, title, ok, proof, nextStep = "") {
  return { id, title, ok: Boolean(ok), proof, next_step: nextStep };
}

async function buildReport() {
  const packageSha = currentPackageSha();
  const deployedSha = process.env.VIP_GECE_DEPLOYED_PACKAGE_SHA || "";
  const productionUrl = process.env.VIP_GECE_PRODUCTION_URL || "https://vip-gece.site";

  const productionProof = await proofReady("VIP_GECE_PRODUCTION_PROOF_READY", "docs/external/production-deploy-vip-gece.md", "VIP_GECE_PRODUCTION_PROOF", "productionDeploy");
  const semrush = await proofReady("VIP_GECE_SEMRUSH_READY", "docs/external/semrush-vip-gece.md", "VIP_GECE_SEMRUSH_PROOF", "semrush");
  const externalSeoAudit = await proofReady("VIP_GECE_SEO_AUDIT_READY", "docs/external/seo-audit-vip-gece.md", "VIP_GECE_SEO_AUDIT_PROOF", "externalSeoAudit");
  const brand24 = await proofReady("VIP_GECE_BRAND24_READY", "docs/external/brand24-vip-gece.md", "VIP_GECE_BRAND24_PROOF", "brand24");
  const similarweb = await proofReady("VIP_GECE_SIMILARWEB_READY", "docs/external/similarweb-vip-gece.md", "VIP_GECE_SIMILARWEB_PROOF", "similarweb");
  const conductor = await proofReady("VIP_GECE_CONDUCTOR_DECISION_READY", "docs/external/conductor-vip-gece.md", "VIP_GECE_CONDUCTOR_PROOF", "decision");
  const channel99 = await proofReady("VIP_GECE_CHANNEL99_DECISION_READY", "docs/external/channel99-vip-gece.md", "VIP_GECE_CHANNEL99_PROOF", "decision");
  const leadCrm = await proofReady("VIP_GECE_LEAD_CRM_DECISION_READY", "docs/external/lead-crm-vip-gece.md", "VIP_GECE_LEAD_CRM_PROOF", "leadCrm");
  const productionProofSha = normalizeSha(productionProof.proof_file_fields["Deployed package SHA"]);
  const productionProofUrl = normalizeUrl(productionProof.proof_file_fields["Production URL"]);
  const productionProofSeo = productionProof.proof_file_fields["Live SEO result"] || "";
  const productionProofUrlOk = productionProofUrl === normalizeUrl(productionUrl);
  const productionProofShaOk = Boolean(
    productionProof.ok &&
    productionProofSha &&
    packageSha.manifest_sha &&
    productionProofSha === packageSha.manifest_sha
  );
  const productionProofSeoOk = Boolean(productionProof.ok && liveSeoResultOk(productionProofSeo));

  const productionChecks = [
    check("package_sha", "Current staging package SHA is known", packageSha.manifest_sha && packageSha.manifest_sha === packageSha.sha_file_value, `manifest=${packageSha.manifest_path}`),
    check("deploy_proof", "Production deploy/traffic switch proof file is valid", productionProof.ok, proofLabel(productionProof), "Create validated production deploy proof after the switch."),
    check("production_url", "Production proof targets the expected URL", productionProof.ok && productionProofUrlOk, `Production URL field must be ${productionUrl}`, "Set the proof Production URL to the checked production URL."),
    check("deployed_sha_matches", "Production deployed package SHA matches current package", productionProofShaOk, "Deployed package SHA field", "Set the proof Deployed package SHA to the manifest SHA after deploy."),
    check("post_switch_seo", "Post-switch live SEO audit is confirmed clean", productionProofSeoOk, "Live SEO result field", "Run npm run live-seo-audit -- --strict after traffic switch and record ok=true.")
  ];

  const marketingChecks = [
    check("external_seo_audit", "Semrush or equivalent external SEO audit proof exists", semrush.ok || externalSeoAudit.ok, semrush.ok ? proofLabel(semrush) : proofLabel(externalSeoAudit), "Create Semrush proof or equivalent external SEO audit proof."),
    check("brand24", "Brand24 monitoring proof exists", brand24.ok, proofLabel(brand24), "Create Brand24 monitoring proof."),
    check("similarweb", "Similarweb benchmark proof exists", similarweb.ok, proofLabel(similarweb), "Create Similarweb benchmark proof or explicit decision note."),
    check("conductor", "Conductor decision/proof exists", conductor.ok, proofLabel(conductor), "Add Conductor decision/proof note."),
    check("channel99", "Channel99 decision/proof exists", channel99.ok, proofLabel(channel99), "Add Channel99 decision/proof note."),
    check("lead_crm", "HighLevel/HubSpot lead CRM decision proof exists", leadCrm.ok, proofLabel(leadCrm), "Add HighLevel/HubSpot decision/proof note.")
  ];

  function gate(id, title, checks) {
    const ok = checks.every((item) => item.ok);
    return {
      id,
      title,
      ok,
      status: ok ? "ready" : "waiting_external",
      checks
    };
  }

  const gates = [
    gate("production", "Production deploy / traffic switch", productionChecks),
    gate("marketing", "Marketing SEO / mention / visibility stack", marketingChecks)
  ];

  const fullGoalReady = gates.every((item) => item.ok);

  return {
    generated_at: new Date().toISOString(),
    repo: ROOT_DIR,
    production_url: productionUrl,
    package: {
      path: packageSha.package_path,
      manifest: packageSha.manifest_path,
      sha_file: packageSha.sha_path,
      current_sha: packageSha.manifest_sha,
      deployed_sha_matches: deployedSha && deployedSha === packageSha.manifest_sha
    },
    summary: {
      ok: !strict || fullGoalReady,
      full_goal_ready: fullGoalReady,
      ready_gates: gates.filter((item) => item.ok).length,
      waiting_gates: gates.filter((item) => !item.ok).length,
      total_gates: gates.length,
      waiting_checks: gates.flatMap((gateItem) => gateItem.checks.filter((item) => !item.ok).map((item) => `${gateItem.id}.${item.id}`))
    },
    gates,
    notes: [
      "No secret values are printed.",
      "Boolean flags accept true/1/yes/ok/ready/done.",
      "Production completion requires a validated production-deploy proof file; production boolean flags alone do not close it.",
      "Marketing external checks require validated proof files; boolean flags alone do not close them.",
      "Proof files must pass required-field validation; templates and placeholder choices are rejected."
    ]
  };
}

function printMarkdown(report) {
  console.log("# VIP GECE Full Goal Readiness\n");
  console.log(`Generated: ${report.generated_at}\n`);
  console.log(`Summary: full_goal_ready=${report.summary.full_goal_ready}, ready_gates=${report.summary.ready_gates}/${report.summary.total_gates}, waiting_checks=${report.summary.waiting_checks.length}\n`);
  console.log(`Current package SHA: \`${report.package.current_sha || "unknown"}\`\n`);
  for (const gateItem of report.gates) {
    console.log(`## ${gateItem.title}\n`);
    console.log(`Status: \`${gateItem.status}\`\n`);
    console.log("| Check | OK | Proof | Next step |");
    console.log("| --- | --- | --- | --- |");
    for (const item of gateItem.checks) {
      console.log(`| ${item.title} | ${item.ok ? "yes" : "no"} | \`${item.proof}\` | ${item.next_step || ""} |`);
    }
    console.log("");
  }
}

const report = await buildReport();

if (markdown) {
  printMarkdown(report);
} else {
  console.log(JSON.stringify(report, null, 2));
}

if (!report.summary.ok) {
  process.exitCode = 1;
}
