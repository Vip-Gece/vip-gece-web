"use strict";

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forbiddenFiles = [
  "scripts/seo-sprint-launch.mjs",
  "scripts/seo-social-auto.mjs"
];

async function exists(file) {
  try {
    await access(path.join(root, file));
    return true;
  } catch {
    return false;
  }
}

for (const file of forbiddenFiles) {
  if (await exists(file)) throw new Error(`forbidden legacy SEO automation remains: ${file}`);
}

const monitor = await readFile(path.join(root, "scripts/gsc-index-monitor.mjs"), "utf8");
const manualQueue = await readFile(path.join(root, "scripts/gsc-manual-index-queue.mjs"), "utf8");
const googleService = await readFile(path.join(root, "src/services/googleSearchConsoleService.js"), "utf8");
const selectionService = await readFile(path.join(root, "src/services/gscIndexSelectionService.js"), "utf8");
const systemdService = await readFile(path.join(root, "ops/systemd/vip-gece-seo-sync.service"), "utf8");
const indexNowScript = await readFile(path.join(root, "scripts/indexnow-submit.mjs"), "utf8");
const indexNowService = await readFile(path.join(root, "src/services/indexNowService.js"), "utf8");
const indexNowUnit = await readFile(path.join(root, "ops/systemd/vip-gece-indexnow.service"), "utf8");
const indexNowTimer = await readFile(path.join(root, "ops/systemd/vip-gece-indexnow.timer"), "utf8");

if (/indexing\.googleapis\.com|urlNotifications:publish|cloaking-template|parasite-content/i.test(monitor)) {
  throw new Error("GSC monitor contains unsupported indexing or spam automation");
}
if (!monitor.includes("runDiscoverySync") || !monitor.includes("querySearchAnalytics")) {
  throw new Error("GSC monitor must use sitemap, URL Inspection and Search Analytics services");
}
if (/indexing\.googleapis\.com|urlNotifications:publish/i.test(manualQueue) ||
    !manualQueue.includes("URL Inspection API itself cannot request indexing")) {
  throw new Error("manual indexing queue must stay within supported Search Console behavior");
}
if (!monitor.includes("allowExtendedInspectionLimit: inspectAll")) {
  throw new Error("full sitemap inspection must preserve the live explicit URL inventory");
}
if (!monitor.includes("priority_changed_count") || !monitor.includes("guaranteed_full_cycle_days")) {
  throw new Error("GSC monitor must report changed URL priority and full-cycle coverage");
}
if (!selectionService.includes("changedShare = 0.2") || !selectionService.includes("sitemap_lastmods")) {
  throw new Error("GSC selection must prioritize changed sitemap URLs without starving rotation");
}
const monitorCommand = systemdService
  .split(/\r?\n/)
  .find((line) => line.startsWith("ExecStart=") && line.includes("gsc-index-monitor"));
const monitorConcurrency = Number(monitorCommand?.match(/--concurrency=(\d+)/)?.[1] || 0);
if (!monitorCommand?.includes(" --all") || monitorConcurrency < 1 || monitorConcurrency > 4) {
  throw new Error("production GSC timer must inspect every sitemap URL each day");
}
if (!googleService.includes("Indexing API abuse for non-JobPosting/non-BroadcastEvent pages")) {
  throw new Error("public SEO policy guard is missing");
}
if (/indexing\.googleapis\.com|urlNotifications:publish/i.test(indexNowScript) ||
    !indexNowService.includes("https://api.indexnow.org/indexnow") ||
    !indexNowScript.includes("selectIndexNowUrls") ||
    !indexNowScript.includes("verifyIndexNowKey")) {
  throw new Error("IndexNow must remain a verified change-only notification independent from Google Indexing API");
}
if (!indexNowUnit.includes("npm run indexnow-submit") ||
    !indexNowTimer.includes("OnUnitActiveSec=1h") ||
    !indexNowTimer.includes("Persistent=true")) {
  throw new Error("production IndexNow timer must run the change-only notifier without a persistent worker");
}

console.log("ok SEO automation keeps Google on sitemap/inspection/analytics and IndexNow on its supported protocol");
