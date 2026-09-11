import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const PROOF_ENV_NAMES = [
  "VIP_GECE_PRODUCTION_DEPLOY_CONFIRMED",
  "VIP_GECE_DEPLOYED_PACKAGE_SHA",
  "VIP_GECE_POST_SWITCH_LIVE_SEO_OK",
  "VIP_GECE_PRODUCTION_PROOF_READY",
  "VIP_GECE_PRODUCTION_PROOF",
  "VIP_GECE_SEMRUSH_READY",
  "VIP_GECE_SEMRUSH_PROOF",
  "VIP_GECE_SEO_AUDIT_READY",
  "VIP_GECE_SEO_AUDIT_PROOF",
  "VIP_GECE_BRAND24_READY",
  "VIP_GECE_BRAND24_PROOF",
  "VIP_GECE_SIMILARWEB_READY",
  "VIP_GECE_SIMILARWEB_PROOF",
  "VIP_GECE_CONDUCTOR_DECISION_READY",
  "VIP_GECE_CONDUCTOR_PROOF",
  "VIP_GECE_CHANNEL99_DECISION_READY",
  "VIP_GECE_CHANNEL99_PROOF",
  "VIP_GECE_LEAD_CRM_DECISION_READY",
  "VIP_GECE_LEAD_CRM_PROOF",
  "VIP_GECE_PACKAGE_PATH",
  "VIP_GECE_PACKAGE_SHA_FILE",
  "VIP_GECE_PACKAGE_MANIFEST",
  "VIP_GECE_PATCHES_DIR"
];

function cleanEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const name of PROOF_ENV_NAMES) {
    if (!(name in overrides)) delete env[name];
  }
  return env;
}

function runNode(scriptName, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT_DIR, "scripts", scriptName)], {
      cwd: ROOT_DIR,
      env: cleanEnv(env),
      shell: false
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("exit", (code) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code === 0) {
        resolve(out);
      } else {
        reject(new Error(`${scriptName} exited with ${code}\n${err || out}`));
      }
    });
  });
}

async function fullGoal(env = {}) {
  return JSON.parse(await runNode("full-goal-readiness.mjs", env));
}

async function listAudit(env = {}) {
  return JSON.parse(await runNode("vip-gece-list-completion-audit.mjs", env));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`ok ${message}`);
}

function gate(report, id) {
  return report.gates.find((item) => item.id === id);
}

function check(report, gateId, checkId) {
  return gate(report, gateId)?.checks.find((item) => item.id === checkId);
}

function productionProof({ sha, result }) {
  return `# VIP GECE Production Deploy Proof

- Date: 2026-09-11
- Production URL: https://vip-gece.site
- Deployed package SHA: \`${sha}\`
- Traffic switch method: local proof fixture
- Live SEO command: npm run live-seo-audit -- --strict
- Live SEO result: ${result}
- Owner confirmation: external proof contract fixture

No secrets included.
`;
}

function seoAuditProof() {
  return `# VIP GECE External SEO Audit Proof

- Date: 2026-09-11
- Tool/source: external proof contract fixture crawler
- Account/workspace: external proof contract fixture
- Project/domain: vip-gece.site
- Report/export reference: fixture external SEO audit reference
- Audit scope: robots, sitemap, metadata, internal links and structured data
- Main findings: fixture audit is structurally complete and secret-free
- Owner confirmation: external proof contract fixture

No secrets included.
`;
}

function brand24Proof() {
  return `# VIP GECE Brand24 Proof

- Date: 2026-09-11
- Account/workspace: external proof contract fixture
- Project name: vip-gece.site
- Keyword/mention set: VIP GECE, vip-gece.site
- Alert/stream reference: fixture mention stream
- Main findings: fixture monitoring proof is structurally complete and secret-free
- Owner confirmation: external proof contract fixture

No secrets included.
`;
}

function decisionProof(title) {
  return `# VIP GECE ${title} Decision

- Date: 2026-09-11
- Decision: defer
- Reason: external proof contract fixture accepts explicit owner decision notes when no live account is available
- Owner confirmation: external proof contract fixture

No secrets included.
`;
}

function leadCrmProof() {
  return `# VIP GECE Lead CRM Decision / Proof

- Date: 2026-09-11
- Selected option: defer
- Reason: external proof contract fixture accepts a clear lead CRM decision without exposing accounts
- Lead flow scope: customer request capture and manual follow-up
- Owner confirmation: external proof contract fixture

No secrets included.
`;
}

function seoProofWithSecret() {
  return `# VIP GECE External SEO Audit Proof

- Date: 2026-09-11
- Tool/source: external proof contract fixture crawler
- Account/workspace: external proof contract fixture
- Project/domain: vip-gece.site
- Report/export reference: fixture external SEO audit reference
- Audit scope: robots, sitemap and metadata
- Main findings: reject this because api_key=abc123456789XYZ is present
- Owner confirmation: external proof contract fixture

No secrets included.
`;
}

async function main() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "vip-gece-proof-contract-"));
  try {
    const fixturePackage = path.join(tmp, "vip-gece-contract.tar.gz");
    const fixtureShaPath = `${fixturePackage}.sha256`;
    const fixtureManifest = path.join(tmp, "vip-gece-contract-manifest.md");
    const fixturePackageBody = Buffer.from("vip-gece external proof contract artifact\n", "utf8");
    const sha = createHash("sha256").update(fixturePackageBody).digest("hex");
    await writeFile(fixturePackage, fixturePackageBody);
    await writeFile(fixtureShaPath, `${sha}  ${path.basename(fixturePackage)}\n`);
    await writeFile(fixtureManifest, `# VIP GECE Contract Package\n\nPackage: \`${fixturePackage}\`\nSHA256: \`${sha}\`\n`);

    const fixturePackageEnv = {
      VIP_GECE_PACKAGE_PATH: fixturePackage,
      VIP_GECE_PACKAGE_SHA_FILE: fixtureShaPath,
      VIP_GECE_PACKAGE_MANIFEST: fixtureManifest
    };
    const missingProductionProof = path.join(tmp, "production-missing.md");
    const missingSeoProof = path.join(tmp, "seo-missing.md");
    const badProductionProof = path.join(tmp, "production-bad.md");
    const goodProductionProof = path.join(tmp, "production-good.md");
    const goodSeoProof = path.join(tmp, "seo-good.md");
    const goodBrand24Proof = path.join(tmp, "brand24-good.md");
    const similarwebDecision = path.join(tmp, "similarweb-decision.md");
    const conductorDecision = path.join(tmp, "conductor-decision.md");
    const channel99Decision = path.join(tmp, "channel99-decision.md");
    const leadCrmDecision = path.join(tmp, "lead-crm-decision.md");
    const draftSeoProof = path.join(tmp, "_drafts", "seo-audit-vip-gece.md");
    const secretSeoProof = path.join(tmp, "seo-secret.md");

    await writeFile(badProductionProof, productionProof({ sha, result: "not clean" }));
    await writeFile(goodProductionProof, productionProof({ sha, result: "ok=true" }));
    await writeFile(goodSeoProof, seoAuditProof());
    await writeFile(goodBrand24Proof, brand24Proof());
    await writeFile(similarwebDecision, decisionProof("Similarweb"));
    await writeFile(conductorDecision, decisionProof("Conductor"));
    await writeFile(channel99Decision, decisionProof("Channel99"));
    await writeFile(leadCrmDecision, leadCrmProof());
    await writeFile(secretSeoProof, seoProofWithSecret());
    await mkdir(path.dirname(draftSeoProof), { recursive: true });
    await writeFile(draftSeoProof, seoAuditProof());

    const testFullGoal = (env = {}) => fullGoal({ ...fixturePackageEnv, ...env });
    const testListAudit = (env = {}) => listAudit({ ...fixturePackageEnv, ...env });

    const fakeFlags = await testFullGoal({
      VIP_GECE_PRODUCTION_DEPLOY_CONFIRMED: "1",
      VIP_GECE_DEPLOYED_PACKAGE_SHA: sha,
      VIP_GECE_POST_SWITCH_LIVE_SEO_OK: "1",
      VIP_GECE_PRODUCTION_PROOF_READY: "1",
      VIP_GECE_PRODUCTION_PROOF: missingProductionProof,
      VIP_GECE_SEMRUSH_READY: "1",
      VIP_GECE_SEO_AUDIT_READY: "1",
      VIP_GECE_SEO_AUDIT_PROOF: missingSeoProof,
      VIP_GECE_BRAND24_READY: "1"
    });
    assert(!fakeFlags.summary.full_goal_ready, "boolean proof flags alone do not complete full goal");
    assert(!check(fakeFlags, "production", "deploy_proof").ok, "production flag alone does not satisfy deploy proof");
    assert(!check(fakeFlags, "marketing", "external_seo_audit").ok, "marketing ready flags alone do not satisfy external SEO audit proof");

    const templatePath = path.join(ROOT_DIR, "docs/external/_templates/README.md");
    const templateProof = await testFullGoal({ VIP_GECE_SEO_AUDIT_PROOF: templatePath });
    assert(!check(templateProof, "marketing", "external_seo_audit").ok, "template path is rejected as SEO proof");
    const draftPathProof = await testFullGoal({ VIP_GECE_SEO_AUDIT_PROOF: draftSeoProof });
    assert(!check(draftPathProof, "marketing", "external_seo_audit").ok, "draft path is rejected as SEO proof");
    const secretProof = await testFullGoal({ VIP_GECE_SEO_AUDIT_PROOF: secretSeoProof });
    assert(!check(secretProof, "marketing", "external_seo_audit").ok, "secret-like SEO proof is rejected");

    const badProduction = await testFullGoal({ VIP_GECE_PRODUCTION_PROOF: badProductionProof });
    assert(check(badProduction, "production", "deploy_proof").ok, "complete production proof fixture validates structurally");
    assert(check(badProduction, "production", "deployed_sha_matches").ok, "production proof SHA is normalized and matched");
    assert(!check(badProduction, "production", "post_switch_seo").ok, "production proof requires explicit ok=true SEO result");
    assert(!gate(badProduction, "production").ok, "production gate stays waiting when SEO result is not ok=true");

    const goodProduction = await testFullGoal({
      VIP_GECE_PRODUCTION_PROOF: goodProductionProof,
      VIP_GECE_SEO_AUDIT_PROOF: missingSeoProof,
      VIP_GECE_BRAND24_PROOF: missingSeoProof
    });
    assert(gate(goodProduction, "production").ok, "valid production proof closes production gate only");
    assert(!goodProduction.summary.full_goal_ready, "production proof alone does not complete full goal");

    const completeGoal = await testFullGoal({
      VIP_GECE_PRODUCTION_PROOF: goodProductionProof,
      VIP_GECE_SEO_AUDIT_PROOF: goodSeoProof,
      VIP_GECE_BRAND24_PROOF: goodBrand24Proof,
      VIP_GECE_SIMILARWEB_PROOF: similarwebDecision,
      VIP_GECE_CONDUCTOR_PROOF: conductorDecision,
      VIP_GECE_CHANNEL99_PROOF: channel99Decision,
      VIP_GECE_LEAD_CRM_PROOF: leadCrmDecision
    });
    assert(gate(completeGoal, "marketing").ok, "valid marketing proof set closes marketing gate");
    assert(check(completeGoal, "marketing", "external_seo_audit").ok, "equivalent external SEO audit proof can replace Semrush");
    assert(completeGoal.summary.full_goal_ready, "production and marketing proof set completes full goal");

    const audit = await testListAudit({
      VIP_GECE_PRODUCTION_PROOF: goodProductionProof,
      VIP_GECE_SEO_AUDIT_PROOF: goodSeoProof,
      VIP_GECE_BRAND24_PROOF: goodBrand24Proof,
      VIP_GECE_SIMILARWEB_PROOF: similarwebDecision,
      VIP_GECE_CONDUCTOR_PROOF: conductorDecision,
      VIP_GECE_CHANNEL99_PROOF: channel99Decision,
      VIP_GECE_LEAD_CRM_PROOF: leadCrmDecision
    });
    assert(audit.evidence.productionExternalReady, "list audit recognizes valid production proof");
    assert(audit.evidence.externalSeoAuditReady, "list audit recognizes valid SEO proof");
    assert(audit.evidence.brand24ExternalReady, "list audit recognizes valid Brand24 proof");
    assert(audit.evidence.marketingStackExternalReady, "list audit recognizes complete marketing proof set");

    const secretAudit = await testListAudit({ VIP_GECE_SEO_AUDIT_PROOF: secretSeoProof });
    assert(!secretAudit.evidence.externalSeoAuditReady, "list audit rejects secret-like SEO proof");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
