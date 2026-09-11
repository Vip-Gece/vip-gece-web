"use strict";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageSha, resolvePackageArtifact } from "./package-artifact.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || ROOT_DIR;
const COMPLETION_EVIDENCE_PATH = path.join(ROOT_DIR, "docs", "vip-gece-completion-audit-20260626.md");
const PACKAGE_ARTIFACT = await resolvePackageArtifact();
const PACKAGE_PATH = PACKAGE_ARTIFACT.packagePath;
const MANIFEST_PATH = PACKAGE_ARTIFACT.manifestPath;
const SHA_PATH = PACKAGE_ARTIFACT.shaPath;

const DESIGN_PLUGINS = [
  "website-design-studio",
  "landing-page-architect",
  "ui-polish-auditor"
];

const FULL_PLUGIN_SET = [
  ...DESIGN_PLUGINS,
  "figma-site-builder",
  "brand-system-forge",
  "seo-landing-optimizer"
];

const READY_DESIGN_TOOLS = [
  "Figma",
  "Canva",
  "Base44",
  "Lovable",
  "Product Design",
  "Vercel",
  "Netlify",
  "HyperFrames",
  "Shutterstock",
  "Fal",
  "Picsart"
];

const EXTRA_PLUGIN_IDEAS = [
  "figma-site-builder",
  "brand-system-forge",
  "saas-dashboard-designer",
  "ecommerce-storefront-designer",
  "seo-landing-optimizer",
  "motion-hero-director",
  "design-qa-mobile",
  "component-library-generator"
];

const SEO_CANDIDATES = [
  "Semrush",
  "Conductor",
  "Similarweb"
];

const MARKETING_STACK = [
  "Semrush",
  "Brand24",
  "Similarweb",
  "Conductor",
  "Channel99",
  "HighLevel",
  "HubSpot"
];

function envTrue(name) {
  return /^(1|true|yes|ok|ready|done)$/i.test(process.env[name] || "");
}

function envPresent(name) {
  return Boolean(process.env[name] && String(process.env[name]).trim());
}

const args = new Set(process.argv.slice(2));
const markdown = args.has("--markdown");
const strict = args.has("--strict");

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

async function readJson(filePath) {
  const text = await readText(filePath);
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
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

function secretLikeLine(text) {
  return String(text || "")
    .split(/\r?\n/)
    .find((line) => proofSecretPatterns.some((pattern) => pattern.test(line)))
    || "";
}

function validateProofText(text, rule) {
  if (Array.isArray(rule.alternatives)) {
    return rule.alternatives.some((alternative) => validateProofText(text, alternative));
  }

  const trimmed = text.trim();
  if (trimmed.length < rule.minChars) {
    return false;
  }

  if (secretLikeLine(trimmed)) {
    return false;
  }

  const hasRequiredFields = rule.requiredFields.every((field) => Boolean(proofFieldValue(text, field)));
  if (!hasRequiredFields) {
    return false;
  }

  return rule.requiredFields.every((field) => {
    const value = proofFieldValue(text, field);
    return !templateChoiceMarkers.some((marker) => value.includes(marker)) && !/^<[^>]+>$/.test(value);
  });
}

async function validateProofFile(proofPath, rule) {
  if (proofPath.includes(`${path.sep}_templates${path.sep}`) || proofPath.includes(`${path.sep}_drafts${path.sep}`)) {
    return false;
  }

  const text = await readText(proofPath);
  return Boolean(text && validateProofText(text, rule));
}

function pluginSourcePath(name, suffix = ".codex-plugin/plugin.json") {
  return path.join(HOME_DIR, "plugins", name, suffix);
}

function pluginCachePath(name, suffix = ".codex-plugin/plugin.json") {
  return path.join(HOME_DIR, ".codex/plugins/cache/personal", name, "0.1.0", suffix);
}

function status(ok, fallback = "missing") {
  return ok ? "complete" : fallback;
}

async function allExist(paths) {
  const results = await Promise.all(paths.map((filePath) => exists(filePath)));
  return results.every(Boolean);
}

async function anyTextIncludes(filePath, needles) {
  const text = await readText(filePath);
  return needles.every((needle) => text.includes(needle));
}

async function pluginRecord(name) {
  const sourceManifestPath = pluginSourcePath(name);
  const cacheManifestPath = pluginCachePath(name);
  const sourceSkillPath = pluginSourcePath(name, "skills/index/SKILL.md");
  const cacheSkillPath = pluginCachePath(name, "skills/index/SKILL.md");
  const sourceManifest = await readJson(sourceManifestPath);
  const cacheManifest = await readJson(cacheManifestPath);

  function validManifest(manifest) {
    return Boolean(
      manifest
      && manifest.name === name
      && manifest.version
      && manifest.description
      && manifest.skills === "./skills/"
      && manifest.interface?.displayName
      && Array.isArray(manifest.interface?.capabilities)
    );
  }

  return {
    name,
    sourceManifestPath,
    cacheManifestPath,
    sourceSkillPath,
    cacheSkillPath,
    sourceManifestValid: validManifest(sourceManifest),
    cacheManifestValid: validManifest(cacheManifest),
    sourceSkillReady: await exists(sourceSkillPath),
    cacheSkillReady: await exists(cacheSkillPath)
  };
}

async function proofReady(flagName, relativeProofPath, overridePathEnv, ruleName) {
  const proofPath = process.env[overridePathEnv] || repoPath(relativeProofPath);
  const rule = proofRules[ruleName];
  const fileReady = rule ? await validateProofFile(proofPath, rule) : await exists(proofPath);
  return fileReady;
}

async function proofField(relativeProofPath, overridePathEnv, field) {
  const proofPath = process.env[overridePathEnv] || repoPath(relativeProofPath);
  const text = await readText(proofPath);
  return proofFieldValue(text, field);
}

function pluginReady(record) {
  return Boolean(
    record?.sourceManifestValid
    && record?.cacheManifestValid
    && record?.sourceSkillReady
    && record?.cacheSkillReady
  );
}

async function buildEvidence() {
  const pluginRecords = await Promise.all(FULL_PLUGIN_SET.map((name) => pluginRecord(name)));
  const pluginByName = Object.fromEntries(pluginRecords.map((record) => [record.name, record]));
  const packageJson = await readJson(repoPath("package.json"));
  const packageManifest = await readText(MANIFEST_PATH);
  const latestPackageSha = packageSha(PACKAGE_ARTIFACT);
  const packageShaMatch = Boolean(latestPackageSha && PACKAGE_ARTIFACT.shaFileValue === latestPackageSha);
  const designToolStackDoc = repoPath("docs/vip-gece-design-tool-stack-20260626.md");
  const marketingPlanDoc = repoPath("docs/vip-gece-marketing-stack-command-plan-20260626.md");
  const deployedPackageSha = process.env.VIP_GECE_DEPLOYED_PACKAGE_SHA || "";
  const productionProofReady = await proofReady("VIP_GECE_PRODUCTION_PROOF_READY", "docs/external/production-deploy-vip-gece.md", "VIP_GECE_PRODUCTION_PROOF", "productionDeploy");
  const productionProofSha = normalizeSha(await proofField("docs/external/production-deploy-vip-gece.md", "VIP_GECE_PRODUCTION_PROOF", "Deployed package SHA"));
  const productionProofUrl = normalizeUrl(await proofField("docs/external/production-deploy-vip-gece.md", "VIP_GECE_PRODUCTION_PROOF", "Production URL"));
  const productionProofSeo = await proofField("docs/external/production-deploy-vip-gece.md", "VIP_GECE_PRODUCTION_PROOF", "Live SEO result");
  const semrushExternalReady = await proofReady("VIP_GECE_SEMRUSH_READY", "docs/external/semrush-vip-gece.md", "VIP_GECE_SEMRUSH_PROOF", "semrush");
  const externalSeoAuditReady = semrushExternalReady || await proofReady("VIP_GECE_SEO_AUDIT_READY", "docs/external/seo-audit-vip-gece.md", "VIP_GECE_SEO_AUDIT_PROOF", "externalSeoAudit");
  const brand24ExternalReady = await proofReady("VIP_GECE_BRAND24_READY", "docs/external/brand24-vip-gece.md", "VIP_GECE_BRAND24_PROOF", "brand24");
  const marketingStackExternalReady = [
    externalSeoAuditReady,
    brand24ExternalReady,
    await proofReady("VIP_GECE_SIMILARWEB_READY", "docs/external/similarweb-vip-gece.md", "VIP_GECE_SIMILARWEB_PROOF", "similarweb"),
    await proofReady("VIP_GECE_CONDUCTOR_DECISION_READY", "docs/external/conductor-vip-gece.md", "VIP_GECE_CONDUCTOR_PROOF", "decision"),
    await proofReady("VIP_GECE_CHANNEL99_DECISION_READY", "docs/external/channel99-vip-gece.md", "VIP_GECE_CHANNEL99_PROOF", "decision"),
    await proofReady("VIP_GECE_LEAD_CRM_DECISION_READY", "docs/external/lead-crm-vip-gece.md", "VIP_GECE_LEAD_CRM_PROOF", "leadCrm")
  ].every(Boolean);
  const productionExternalReady = Boolean(
    latestPackageSha
    && productionProofReady
    && productionProofUrl === "https://vip-gece.site"
    && productionProofSha === latestPackageSha
    && liveSeoResultOk(productionProofSeo)
  );
  return {
    completionEvidenceExists: await exists(COMPLETION_EVIDENCE_PATH),
    pluginRecords,
    designPluginsReady: DESIGN_PLUGINS.every((name) => pluginReady(pluginByName[name])),
    fullPluginSetReady: FULL_PLUGIN_SET.every((name) => pluginReady(pluginByName[name])),
    designToolStackReady: await anyTextIncludes(designToolStackDoc, [
      ...READY_DESIGN_TOOLS,
      ...EXTRA_PLUGIN_IDEAS,
      ...FULL_PLUGIN_SET
    ]),
    marketingPlanReady: await exists(marketingPlanDoc),
    seoCandidatesCompared: await anyTextIncludes(marketingPlanDoc, SEO_CANDIDATES),
    marketingStackPlanned: await anyTextIncludes(marketingPlanDoc, MARKETING_STACK),
    completionAuditReady: await exists(repoPath("docs/vip-gece-completion-audit-20260626.md")),
    liveSeoDocReady: await anyTextIncludes(repoPath("docs/vip-gece-live-seo-audit-20260626.md"), [
      "Local Current Kod Sonucu",
      "Sonuc: `ok=true`",
      "Canli Domain Sonucu",
      "Sonuc: `ok=false`"
    ]),
    homeCssTargetReady: await anyTextIncludes(repoPath("public/css/home-redesign.css"), [
      "selected target: kizil/sicak Neon Minimal Feed",
      "hero-brand-plate"
    ]),
    designSystemReady: await exists(repoPath("docs/home-design-system.md")),
    desktopScreenshotReady: await exists(repoPath("output/playwright/vip-gece-home-kizil/home-desktop-1440x1000.png")),
    mobileScreenshotReady: await exists(repoPath("output/playwright/vip-gece-home-kizil/home-mobile-390x844.png")),
    packageReady: await exists(PACKAGE_PATH),
    packageShaReady: await exists(SHA_PATH),
    packageManifestReady: Boolean(packageManifest),
    packageShaMatch,
    releaseGateReady: await anyTextIncludes(repoPath("package.json"), [
      "\"verify-release-candidate\": \"node scripts/release-candidate-audit.mjs\""
    ]),
    releaseGateScriptReady: await anyTextIncludes(repoPath("scripts/release-candidate-audit.mjs"), [
      "list-completion-audit",
      "full-goal-readiness"
    ]),
    verifyPackageRequiresGates: await anyTextIncludes(repoPath("scripts/verify-package-artifact.mjs"), [
      "runtime/scripts/release-candidate-audit.mjs",
      "runtime/scripts/live-domain-seo-audit.mjs",
      "runtime/scripts/vip-gece-list-completion-audit.mjs"
    ]),
    packagePromotionGatesReady: packageManifest.includes("Promotion Gates")
      && packageManifest.includes("npm run verify-release-candidate")
      && packageManifest.includes("npm run list-completion-audit -- --markdown")
      && packageManifest.includes("npm run full-goal-readiness -- --markdown")
      && packageManifest.includes("npm run live-seo-audit -- --site=<staging-url> --strict"),
    latestPackageSha,
    deployedPackageSha,
    semrushExternalReady,
    externalSeoAuditReady,
    brand24ExternalReady,
    marketingStackExternalReady,
    productionExternalReady,
    fullGoalReadinessReady: await anyTextIncludes(repoPath("package.json"), [
      "\"full-goal-readiness\": \"node scripts/full-goal-readiness.mjs\""
    ]) && await exists(repoPath("scripts/full-goal-readiness.mjs")),
    liveProductionDriftKnown: await anyTextIncludes(repoPath("docs/vip-gece-live-seo-audit-20260626.md"), [
      "/ilanlar` HTTP 404",
      "eski veya"
    ]),
    workspacePathReady: Boolean(
      packageJson?.name === "vip-gece-rebuild"
      && await exists(repoPath("server.modular.js"))
      && await exists(repoPath("src/services/render/homeRenderer.js"))
      && await exists(repoPath("ops/domain-gateway/targets.json"))
    ),
    brandSystemForgeReady: await anyTextIncludes(repoPath("docs/home-design-system.md"), [
      "Renk Tokenlari",
      "Tipografi Olcegi",
      "Spacing Sistemi",
      "Patternler"
    ]),
    figmaSiteBuilderReady: await anyTextIncludes(repoPath("docs/page-hierarchy-plan.md"), [
      "Sayfa Tipi Bazli Hiyerarsi",
      "Ana sayfa",
      "Kategori hub",
      "Profil detay"
    ]),
    threeDirectionsReady: await anyTextIncludes(repoPath("WORKLIST.md"), [
      "Midnight Editorial",
      "Premium Directory",
      "Neon Minimal Feed"
    ]),
    uiAuditReady: await anyTextIncludes(repoPath("docs/vip-gece-ui-audit-20260626.md"), [
      "Ana Sayfa Duzeni Analizi",
      "Kart / Liste / Grid Analizi",
      "Kategori ve Filtre UX Analizi",
      "Responsive Yapi Analizi",
      "Tipografi, Renk, Spacing ve Component Sistemi Analizi",
      "UI Audit Sonucu"
    ]),
    heroStructureReady: await anyTextIncludes(repoPath("public/css/home-redesign.css"), [
      ".hero-grid",
      ".hero-copy",
      ".hero-shortcuts",
      ".hero-cta-row"
    ]),
    cardStructureReady: await anyTextIncludes(repoPath("public/css/home-redesign.css"), [
      ".home-story-item",
      ".selected-card",
      ".directory-card",
      ".home-story-ring",
      ".selected-meta",
      "transition: transform"
    ]),
    mobileDensityReady: await anyTextIncludes(repoPath("public/css/home-redesign.css"), [
      "grid-auto-flow: column",
      "scroll-snap-type",
      "grid-template-columns: repeat(2, minmax(0, 1fr))"
    ]),
    technicalOpenSurfaceReady: await anyTextIncludes(repoPath("scripts/contracts.mjs"), [
      "performance polish",
      "runtime skip link target exists",
      "package verifier checks all runtime source hashes",
      "release package carries completion and full-goal readiness gates"
    ])
  };
}

function row(id, title, state, evidence, note = "") {
  return { id, title, state, evidence, note };
}

function requirement(id, title, state, evidence, note = "") {
  return { id, title, state, evidence, note };
}

function isIncompleteState(state) {
  return ["missing", "incomplete"].includes(state);
}

function isFullGoalCompleteState(state) {
  return ["complete", "complete_local", "complete_local_verified", "complete_local_validated", "complete_external_verified"].includes(state);
}

function remainingExternalConditions(evidence) {
  const remaining = [];
  if (!evidence.productionExternalReady) {
    remaining.push("Production deploy / traffic switch not performed or not proven with matching package SHA");
  }
  if (!evidence.marketingStackExternalReady) {
    remaining.push("External SEO audit / mention / visibility proof is not available");
  }
  return remaining;
}

async function main() {
  const evidence = await buildEvidence();
  const productionVerifiedNote = "Production deploy proof valid; matching SHA ve post-switch live SEO ok=true.";
  const productionWaitingNote = evidence.liveProductionDriftKnown
    ? "Live domain eski deploy/SEO drift gosteriyor; production deploy yapilmadi."
    : "";

  const items = [
    row("1-6", "Uc ana design plugin scaffold / metadata / skill / marketplace", status(evidence.designPluginsReady), [
      "HOME/plugins/{website-design-studio,landing-page-architect,ui-polish-auditor}",
      "HOME/.codex/plugins/cache/personal/..."
    ]),
    row("7-10,14", "Design suite ve opsiyonel seo-landing-optimizer lokal plugin seti", status(evidence.fullPluginSetReady), [
      "website-design-studio",
      "landing-page-architect",
      "ui-polish-auditor",
      "figma-site-builder",
      "brand-system-forge",
      "seo-landing-optimizer"
    ]),
    row("11-18", "SEO / reklam / mention stack arastirma ve komuta plani", evidence.marketingStackExternalReady ? "complete_external_verified" : evidence.marketingPlanReady ? "planned_external" : "missing", [
      "docs/vip-gece-marketing-stack-command-plan-20260626.md"
    ], "Semrush veya esdeger dis SEO audit kaniti; Brand24/Similarweb/Conductor/Channel99/HighLevel canli hesap veya callable connector gerektirir."),
    row("19-21", "Workspace, paket, domain ve live SEO drift kontrolu", evidence.productionExternalReady ? "complete_external_verified" : evidence.packageReady && evidence.liveSeoDocReady ? "complete_with_live_drift" : "incomplete", [
      PACKAGE_PATH,
      "docs/vip-gece-live-seo-audit-20260626.md",
      "npm run live-seo-audit"
    ], evidence.productionExternalReady ? productionVerifiedNote : productionWaitingNote),
    row("22-30", "Public site audit, uc yon ve Neon Minimal Feed secimi", evidence.homeCssTargetReady && evidence.desktopScreenshotReady && evidence.mobileScreenshotReady ? "complete_local" : "incomplete", [
      "public/css/home-redesign.css",
      "output/playwright/vip-gece-home-kizil/*.png"
    ]),
    row("31-33", "Brand system ve sayfa iskeleti", evidence.designSystemReady ? "complete_local" : "missing", [
      "docs/home-design-system.md",
      "docs/page-hierarchy-plan.md"
    ]),
    row("34-44", "Hero, hiyerarsi, kart anatomisi, responsive, teknik/performance/accesibility pass", evidence.releaseGateReady && evidence.releaseGateScriptReady && evidence.verifyPackageRequiresGates ? "complete_local_verified" : "incomplete", [
      "npm run verify-release-candidate",
      "scripts/release-candidate-audit.mjs",
      "scripts/verify-package-artifact.mjs"
    ]),
    row("package", "Staging package ve promotion gates", evidence.packageReady && evidence.packageShaReady && evidence.packageShaMatch && evidence.packagePromotionGatesReady ? "complete_local_verified" : "incomplete", [
      MANIFEST_PATH,
      SHA_PATH,
      `sha=${evidence.latestPackageSha}`
    ])
  ];

  const requirements = [
    requirement("1", "plugin-creator ile web tasarim plugin paketi olustur", evidence.designPluginsReady ? "complete_local_validated" : "incomplete", ["HOME/plugins/*", "HOME/.codex/plugins/cache/personal/*"], "plugin-creator callable kaniti yerine source/cache plugin paketi ve validator kaniti kullaniliyor."),
    requirement("2", "Uc ana plugin scaffold et", evidence.designPluginsReady ? "complete" : "missing", DESIGN_PLUGINS),
    requirement("3", "Her plugin icin gercek manifest metadata yaz", evidence.designPluginsReady ? "complete_local_validated" : "incomplete", DESIGN_PLUGINS.map((name) => pluginSourcePath(name))),
    requirement("4", "Her plugin icine calisir skills/.../SKILL.md ekle", evidence.designPluginsReady ? "complete_local_validated" : "incomplete", DESIGN_PLUGINS.map((name) => pluginSourcePath(name, "skills/index/SKILL.md"))),
    requirement("5", "Uc plugini validator'dan gecir", evidence.designPluginsReady ? "complete_local_validated" : "incomplete", ["manifest JSON parse", "interface metadata", "source/cache SKILL.md"]),
    requirement("6", "Pluginleri personal marketplace'e ekle", evidence.designPluginsReady ? "complete" : "missing", DESIGN_PLUGINS.map((name) => pluginCachePath(name))),
    requirement("7", "Hazir tasarim/tool tarafini incele", evidence.designToolStackReady ? "complete" : "missing", ["docs/vip-gece-design-tool-stack-20260626.md"]),
    requirement("8", "Ek ozel plugin fikirlerini listele", evidence.designToolStackReady ? "complete" : "missing", ["docs/vip-gece-design-tool-stack-20260626.md"]),
    requirement("9", "Profesyonel web design suite icin ana besliyi sec", evidence.designToolStackReady ? "complete" : "missing", ["docs/vip-gece-design-tool-stack-20260626.md"]),
    requirement("10", "Eksik iki yerel plugini kur", evidence.fullPluginSetReady ? "complete" : "missing", ["figma-site-builder", "brand-system-forge"]),
    requirement("11", "Google SEO tarafinda plugin arastirmasi yap", evidence.marketingPlanReady ? "complete" : "missing", ["docs/vip-gece-marketing-stack-command-plan-20260626.md"]),
    requirement("12", "SEO adaylarini karsilastir", evidence.seoCandidatesCompared ? "complete" : "missing", SEO_CANDIDATES),
    requirement("13", "Google SEO icin Semrush veya esdeger dis audit kaniti", evidence.externalSeoAuditReady ? "complete_external_verified" : evidence.marketingPlanReady ? "planned_external" : "missing", ["docs/vip-gece-marketing-stack-command-plan-20260626.md", "docs/external/seo-audit-vip-gece.md", "npm run full-goal-readiness"], "Semrush kotasi dolarsa esdeger dis SEO audit proof kabul edilir; bos template kabul edilmez."),
    requirement("14", "seo-landing-optimizer altinci plugini kur", evidence.fullPluginSetReady ? "complete" : "missing", ["seo-landing-optimizer"]),
    requirement("15", "Reklam / mention / gorunurluk tarafini arastir", evidence.marketingPlanReady ? "complete" : "missing", ["docs/vip-gece-marketing-stack-command-plan-20260626.md"]),
    requirement("16", "Brand24'u kur", evidence.brand24ExternalReady ? "complete_external_verified" : evidence.marketingPlanReady ? "planned_external" : "missing", ["Brand24", "npm run full-goal-readiness"], "Brand24 canli hesap/connector yok; secim ve komuta plani hazir."),
    requirement("17", "Reklam ve gorunurluk stack'ini tamamla", evidence.marketingStackExternalReady ? "complete_external_verified" : evidence.marketingStackPlanned ? "planned_external" : "missing", [...MARKETING_STACK, "npm run full-goal-readiness"], "Canli hesaplar ve connector yetkileri gelince uygulanacak."),
    requirement("18", "Reklam araclari icin hangi soruda hangi plugin kullanilacak komuta plani cikar", evidence.marketingStackPlanned ? "complete" : "missing", ["docs/vip-gece-marketing-stack-command-plan-20260626.md"]),
    requirement("19", "VPS erisim yolu, deploy yolu ve canli site durumunu kontrol et", evidence.productionExternalReady ? "complete_external_verified" : evidence.packageReady && evidence.liveSeoDocReady ? "complete_with_live_drift" : "incomplete", [PACKAGE_PATH, "docs/vip-gece-live-seo-audit-20260626.md", "npm run full-goal-readiness"], evidence.productionExternalReady ? productionVerifiedNote : "Production deploy/VPS write yapilmadi."),
    requirement("20", "Yerel VIP Gece repo kimligini dogrula", evidence.workspacePathReady ? "complete" : "missing", [ROOT_DIR, "package.json", "server.modular.js"]),
    requirement("21", "Canli domain'i disaridan dogrula", evidence.productionExternalReady ? "complete_external_verified" : evidence.liveSeoDocReady ? "complete_with_live_drift" : "missing", ["docs/vip-gece-live-seo-audit-20260626.md", "npm run full-goal-readiness"], evidence.productionExternalReady ? productionVerifiedNote : "Canli domain local current koddan geri/drift durumunda."),
    requirement("22", "Siteyi genel ilan/dizin UI olarak ele al", evidence.homeCssTargetReady ? "complete_local" : "incomplete", ["public/css/home-redesign.css"]),
    requirement("23", "Ana sayfa duzenini analiz et", evidence.uiAuditReady ? "complete_local" : "missing", ["docs/vip-gece-ui-audit-20260626.md"]),
    requirement("24", "Kart/list/grid yapisini analiz et", evidence.uiAuditReady ? "complete_local" : "missing", ["docs/vip-gece-ui-audit-20260626.md", "public/css/home-redesign.css"]),
    requirement("25", "Kategori ve filtre UX'ini analiz et", evidence.uiAuditReady ? "complete_local" : "missing", ["docs/vip-gece-ui-audit-20260626.md"]),
    requirement("26", "Responsive yapiyi analiz et", evidence.uiAuditReady ? "complete_local" : "missing", ["docs/vip-gece-ui-audit-20260626.md", "scripts/contracts.mjs"]),
    requirement("27", "Tipografi, renk, spacing ve component sistemini analiz et", evidence.brandSystemForgeReady ? "complete_local" : "missing", ["docs/home-design-system.md"]),
    requirement("28", "Mevcut sayfa icin UI audit cikar", evidence.uiAuditReady ? "complete_local" : "missing", ["docs/vip-gece-ui-audit-20260626.md"]),
    requirement("29", "Uc tasarim yonu cikar", evidence.threeDirectionsReady ? "complete_local" : "missing", ["WORKLIST.md"]),
    requirement("30", "Neon Minimal Feed'i baz al", evidence.homeCssTargetReady ? "complete_local" : "missing", ["public/css/home-redesign.css", "docs/vip-gece-completion-audit-20260626.md"]),
    requirement("31", "Secilen yonu brand-system-forge formatina dok", evidence.brandSystemForgeReady ? "complete_local" : "missing", ["docs/home-design-system.md"]),
    requirement("32", "Brand system dokumunde token, tipografi, spacing, pattern ve page map tanimla", evidence.brandSystemForgeReady ? "complete_local" : "missing", ["docs/home-design-system.md"]),
    requirement("33", "Secilen yonu figma-site-builder mantiginda sayfa iskeletine cevir", evidence.figmaSiteBuilderReady ? "complete_local" : "missing", ["docs/page-hierarchy-plan.md"]),
    requirement("34", "Ust katmana guclu hero alani ekle", evidence.heroStructureReady ? "complete_local_verified" : "incomplete", ["public/css/home-redesign.css", "npm run verify-release-candidate"]),
    requirement("35", "Hero kisa aciklama, kategori girisleri ve hizli gezinme olustur", evidence.heroStructureReady ? "complete_local_verified" : "incomplete", ["public/css/home-redesign.css", "scripts/contracts.mjs"]),
    requirement("36", "Ana hiyerarsiyi uc katmana bol", evidence.figmaSiteBuilderReady ? "complete_local_verified" : "missing", ["docs/page-hierarchy-plan.md", "WORKLIST.md"]),
    requirement("37", "Gorsel dili premium ve kontrollu hale getir", evidence.homeCssTargetReady ? "complete_local_verified" : "incomplete", ["public/css/home-redesign.css"]),
    requirement("38", "Arial/glow/mor-pembe grid hissini kontrollu accent sistemiyle duzenle", evidence.homeCssTargetReady ? "complete_local_verified" : "incomplete", ["public/css/home-redesign.css", "docs/home-design-system.md"]),
    requirement("39", "Kart anatomisini guclendir", evidence.cardStructureReady ? "complete_local_verified" : "incomplete", ["public/css/home-redesign.css"]),
    requirement("40", "Menu ile story strip dikkat rekabetini azalt", evidence.homeCssTargetReady ? "complete_local_verified" : "incomplete", ["public/css/home-redesign.css", "WORKLIST.md"]),
    requirement("41", "Mobil yogunluk riskini azalt", evidence.mobileDensityReady ? "complete_local_verified" : "incomplete", ["public/css/home-redesign.css", "scripts/contracts.mjs"]),
    requirement("42", "Renk/token sistemini netlestir", evidence.brandSystemForgeReady ? "complete_local_verified" : "missing", ["docs/home-design-system.md", "public/css/home-redesign.css"]),
    requirement("43", "Mevcut siteye uygun hero bolumunu metin + blok yapisi olarak yaz", evidence.heroStructureReady ? "complete_local_verified" : "incomplete", ["public/css/home-redesign.css", "src/services/render/homeRenderer.js"]),
    requirement("44", "Teknik tarafta UI/UX, temizlik, performans, asset, refactor, deploy/log/monitoring, erisilebilirlik ve responsive alanlarini acik tut", evidence.technicalOpenSurfaceReady ? "complete_local_verified" : "incomplete", ["scripts/contracts.mjs", "WORKLIST.md", "docs/vip-gece-live-seo-audit-20260626.md"])
  ];

  const summary = {
    ok: items.every((item) => !isIncompleteState(item.state)) && requirements.every((item) => !isIncompleteState(item.state)),
    local_gate_ok: items.every((item) => !isIncompleteState(item.state)) && requirements.every((item) => !isIncompleteState(item.state)),
    full_goal_complete: requirements.every((item) => isFullGoalCompleteState(item.state)) && items.every((item) => isFullGoalCompleteState(item.state)),
    complete: items.filter((item) => item.state.startsWith("complete")).length,
    waiting_external: items.filter((item) => !isFullGoalCompleteState(item.state) && (item.state.includes("external") || item.state.includes("waiting"))).length,
    live_drift: items.filter((item) => !isFullGoalCompleteState(item.state) && item.state.includes("drift")).length,
    missing_or_incomplete: items.filter((item) => isIncompleteState(item.state)).length,
    requirements_total: requirements.length,
    requirements_complete_or_local: requirements.filter((item) => isFullGoalCompleteState(item.state)).length,
    requirements_external_or_drift: requirements.filter((item) => !isFullGoalCompleteState(item.state) && !isIncompleteState(item.state)).length,
    requirements_missing_or_incomplete: requirements.filter((item) => isIncompleteState(item.state)).length
  };

  const report = {
    generated_at: new Date().toISOString(),
    source_evidence: COMPLETION_EVIDENCE_PATH,
    repo: ROOT_DIR,
    summary,
    evidence,
    items,
    requirements,
    remaining_external_conditions: remainingExternalConditions(evidence)
  };

  if (markdown) {
    console.log(`# VIP GECE List Completion Audit\n`);
    console.log(`Generated: ${report.generated_at}\n`);
    console.log(`Summary: local_gate_ok=${summary.local_gate_ok}, full_goal_complete=${summary.full_goal_complete}, complete_groups=${summary.complete}, waiting_external_groups=${summary.waiting_external}, live_drift_groups=${summary.live_drift}, missing_or_incomplete=${summary.missing_or_incomplete}, requirements=${summary.requirements_complete_or_local}/${summary.requirements_total} local-complete, requirements_external_or_drift=${summary.requirements_external_or_drift}, requirements_missing_or_incomplete=${summary.requirements_missing_or_incomplete}\n`);
    console.log("| Item | State | Evidence | Note |");
    console.log("| --- | --- | --- | --- |");
    for (const item of items) {
      console.log(`| ${item.id} ${item.title} | ${item.state} | ${item.evidence.join("<br>")} | ${item.note || ""} |`);
    }
    console.log("\n## Numbered Requirements\n");
    console.log("| No | State | Requirement | Evidence | Note |");
    console.log("| --- | --- | --- | --- | --- |");
    for (const item of requirements) {
      console.log(`| ${item.id} | ${item.state} | ${item.title} | ${item.evidence.join("<br>")} | ${item.note || ""} |`);
    }
  } else {
    console.log(JSON.stringify(report, null, 2));
  }

  if (strict && (summary.missing_or_incomplete > 0 || summary.requirements_missing_or_incomplete > 0)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
