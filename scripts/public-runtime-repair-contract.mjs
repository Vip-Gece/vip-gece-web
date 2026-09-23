import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { once } from "node:events";

process.env.DATABASE_URL = "";
process.env.SUPABASE_URL = "";
process.env.SUPABASE_ANON_KEY = "";
process.env.SITE_URL = "https://vip-gece.site";
process.env.VIP_GECE_ALLOW_SUPABASE_PROFILE_DATA = "false";
const require = createRequire(import.meta.url);
const { findProfileBySlug } = require("../src/utils/profile");
const repo = require("../src/data/profilesRepo");
const { renderCategoryHtml } = require("../src/services/render/landingRenderer");
const express = require("express");
const failures = [];
let assertions = 0;
async function check(name, action) {
  assertions += 1;
  try { await action(); } catch (error) { failures.push({ name, error: error.message }); }
}

const inactive = { id: "9", name: "MERVE", slug: "istanbul-merve-9", city: "Istanbul", is_active: false };
const live = { id: "71", name: "MERVE", slug: "merve-90bd8272", city: "Istanbul", is_active: true };
const card = { id: "18", name: "Kardelen", slug: "istanbul-kardelen", city: "Istanbul", is_active: true };
const owners = [inactive, live, card];
const rows = [live, card].map((row) => ({ ...row, description: "Fixture description", images: ["/logo.png.webp"] }));

await check("inactive canonical cannot resolve to a same-name active record", () => {
  assert.equal(findProfileBySlug(rows, "merve-istanbul", owners), undefined);
});
await check("ambiguous name alias cannot pick a record by list order", () => {
  assert.equal(findProfileBySlug(rows, "merve", owners), undefined);
});
await check("active canonical still resolves by stable identity", () => {
  assert.equal(findProfileBySlug(rows, live.slug, owners)?.id, "71");
});
await check("reactivation gives the reserved canonical back to its own record", () => {
  const reactivated = { ...inactive, is_active: true };
  assert.equal(findProfileBySlug([reactivated, ...rows], "merve-istanbul", [reactivated, live, card])?.id, "9");
});
await check("fresh inactive ownership overrides stale public rows", () => {
  assert.equal(findProfileBySlug([{ ...inactive, is_active: true }, ...rows], "merve-istanbul", owners), undefined);
});
await check("retired-only images cannot become a public logo profile", () => {
  const profile = { ...rows[0], images: ["https://hofblpqaxzhybozavtaz.supabase.co/storage/v1/object/public/images/missing.jpg"] };
  assert.equal(repo.publicProfilesWithUsableImages([profile]).length, 0);
  assert.equal(profile.description, "Fixture description");
});
await check("empty category obeys its noindex decision", () => {
  assert.equal(/name="robots" content="noindex, follow"/.test(renderCategoryHtml("kumral-escort", [])), true);
});
await check("the city hub keeps its indexable decision", () => {
  assert.match(renderCategoryHtml("istanbul-escort", []), /name="robots" content="index, follow/);
});

// Only the data boundary is replaced; HTTP routing and rendering are real.
repo.getProfiles = async () => rows;
repo.getSeoProfiles = async () => rows;
repo.findPublicProfileBySlug = async (profiles, slug) => findProfileBySlug(profiles, slug, owners);
const { createPublicRouter } = require("../src/routes/publicRoutes");
const { createPublicApiRouter } = require("../src/routes/publicApiRoutes");
const app = express();
app.use(createPublicApiRouter());
app.use(createPublicRouter());
app.use((req, res) => res.status(404).send("Not found"));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
try {
  for (const [pathname, target] of [
    ["/profil/ISTANBUL-KARDELEN", "/profil/istanbul-kardelen"],
    ["/profil/istanbul-kardelen/", "/profil/istanbul-kardelen"],
    ["/ISTANBUL-ESCORT", "/istanbul-escort"],
    ["/istanbul-escort/", "/istanbul-escort"],
    ["/ILANLAR/", "/ilanlar"],
    ["/INDEX.HTML/", "/"],
    ["/HOME", "/"]
  ]) {
    await check(`one-hop canonical redirect ${pathname}`, async () => {
      const response = await fetch(`${base}${pathname}?source=a%2Fb`, { redirect: "manual" });
      await response.arrayBuffer();
      assert.equal(response.status, 301);
      assert.equal(response.headers.get("location"), `${target}?source=a%2Fb`);
    });
  }
  for (const pathname of ["/profil/merve-istanbul", "/api/v1/public/profiles/merve-istanbul"]) {
    await check(`inactive profile HTTP denial ${pathname}`, async () => {
      const response = await fetch(`${base}${pathname}`, { redirect: "manual" });
      await response.arrayBuffer();
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("location"), null);
    });
  }
  await check("active detail still renders", async () => {
    const response = await fetch(`${base}/profil/istanbul-kardelen`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /https:\/\/vip-gece.site\/profil\/istanbul-kardelen/);
  });
  await check("API/media paths do not receive public-page normalization", async () => {
    for (const pathname of ["/api/PRIVATE/", "/media/FILE.JPG/"]) {
      const response = await fetch(`${base}${pathname}`, { redirect: "manual" });
      await response.arrayBuffer();
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("location"), null);
    }
  });
} finally {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
console.log(JSON.stringify({ ok: failures.length === 0, assertions, failures }, null, 2));
process.exitCode = failures.length ? 1 : 0;
