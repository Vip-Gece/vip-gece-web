import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildGscDemandSnapshot, queryIntentKeys, landingSlugFromPage, queryLandingSlug } = require(
  "../src/services/gscDemandSnapshotBuilder"
);
const { observedDemandKeys, searchDemandSnapshotStatus } = require(
  "../src/services/searchDemandSnapshotService"
);

assert.ok(queryIntentKeys("Şişli kızıl saçlı fit escort").includes("kizil"));
assert.ok(queryIntentKeys("Şişli kızıl saçlı fit escort").includes("atletik"));
assert.ok(queryIntentKeys("Kadıköy boy 170 cm escort").includes("boy170"));
assert.ok(queryIntentKeys("Kadıköy 55 kg escort").includes("kilo50"));
assert.deepEqual(queryIntentKeys("VIP Gece Şişli escort"), []);
assert.equal(queryLandingSlug("Kadıköy sarışın escort"), "kadikoy-escort");
assert.equal(landingSlugFromPage("https://another.example/sisli-escort"), "");
assert.equal(landingSlugFromPage("https://vip-gece.site/profil/sisli-escort"), "");

const rows = [
  { keys: ["https://vip-gece.site/sisli-escort", "Şişli kızıl saçlı escort"], impressions: 42, clicks: 3 },
  { keys: ["https://vip-gece.site/sisli-escort", "Şişli sarışın escort"], impressions: 20, clicks: 5 },
  { keys: ["https://vip-gece.site/kadikoy-escort", "Kadıköy boy 170 cm escort"], impressions: 18, clicks: 2 },
  { keys: ["https://vip-gece.site/kadikoy-escort", "Kadıköy 55 kg escort"], impressions: 16, clicks: 1 },
  { keys: ["https://vip-gece.site/", "Kadıköy esmer escort"], impressions: 17, clicks: 1 },
  { keys: ["https://another.example/sisli-escort", "Şişli sarışın escort"], impressions: 999, clicks: 100 }
];
const snapshot = buildGscDemandSnapshot(rows, {
  startDate: "2026-09-01",
  endDate: "2026-09-28"
});
assert.equal(snapshot.source, "google_search_console");
assert.equal(snapshot.raw_row_count, 6);
assert.equal(snapshot.matched_row_count, 5);
assert.equal(snapshot.landings["sisli-escort"][0].key, "kizil");
assert.ok(snapshot.landings["kadikoy-escort"].some((row) => row.key === "boy170"));
assert.ok(snapshot.landings["kadikoy-escort"].some((row) => row.key === "kilo50"));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vip-gsc-demand-"));
const previousPath = process.env.VIP_GECE_SEARCH_DEMAND_PATH;
try {
  const freshPath = path.join(tempDir, "fresh.json");
  fs.writeFileSync(freshPath, JSON.stringify(snapshot));
  process.env.VIP_GECE_SEARCH_DEMAND_PATH = freshPath;
  assert.equal(searchDemandSnapshotStatus().configured, true);
  assert.equal(searchDemandSnapshotStatus().stale, false);
  assert.equal(observedDemandKeys("sisli-escort")[0], "kizil");

  const stalePath = path.join(tempDir, "stale.json");
  fs.writeFileSync(stalePath, JSON.stringify({
    ...snapshot,
    generated_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
  }));
  process.env.VIP_GECE_SEARCH_DEMAND_PATH = stalePath;
  assert.equal(searchDemandSnapshotStatus().configured, false);
  assert.equal(searchDemandSnapshotStatus().stale, true);
  assert.deepEqual(observedDemandKeys("sisli-escort"), []);
} finally {
  if (previousPath === undefined) delete process.env.VIP_GECE_SEARCH_DEMAND_PATH;
  else process.env.VIP_GECE_SEARCH_DEMAND_PATH = previousPath;
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("GSC search-demand snapshot mapping, freshness, and safe fallback: PASS");
