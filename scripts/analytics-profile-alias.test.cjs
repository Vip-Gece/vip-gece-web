"use strict";

const { test, beforeEach, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const database = require("../src/data/postgresClient");
const profiles = require("../src/data/profilesRepo");
const { findProfileBySlug } = require("../src/utils/profile");

process.env.ANALYTICS_EVENT_PROOF_SECRET = crypto.randomBytes(48).toString("hex");
const { mintAnalyticsEventProof } = require("../src/services/analyticsEventProofService");
const profile = { id: "77", name: "Bahar", slug: "bahar-39bc3dbe", is_active: true };
let publicRows, owners, databaseRows, inserts, seenEvents;

mock.method(database, "hasDatabaseUrl", () => true);
mock.method(database, "query", async () => ({ rows: [] }));
mock.method(profiles, "getSeoProfiles", async () => publicRows);
mock.method(profiles, "findPublicProfileBySlug", async (rows, slug) => findProfileBySlug(rows, slug, owners));
mock.method(database, "transaction", async (callback) => callback({
  query: async (sql, params) => {
    if (sql.includes("select id, name, owner_user_id")) {
      assert.match(sql, /where id = \$1/);
      assert.match(sql, /is_active = true/);
      assert.equal(String(params[0]), profile.id);
      return { rows: databaseRows };
    }
    assert.match(sql, /insert into public\.analytics_events/);
    assert.equal(String(params[2]), profile.id);
    if (seenEvents.has(params[5])) return { rows: [] };
    seenEvents.add(params[5]);
    inserts.push(params);
    return { rows: [{ profile_id: profile.id }] };
  }
}));
const { recordProfileAnalyticsEvent } = require("../src/services/profileAnalyticsService");

beforeEach(() => {
  publicRows = [profile];
  owners = [profile];
  databaseRows = [{ id: profile.id, name: profile.name, owner_user_id: "customer:fixture" }];
  inserts = [];
  seenEvents = new Set();
});
after(() => mock.restoreAll());

function event(slug = "bahar-istanbul", targetId = profile.id, type = "profile_view") {
  const pair = mintAnalyticsEventProof(targetId, type);
  return { profile_slug: slug, event_type: type, source: "direct", channel: type === "profile_view" ? "none" : "whatsapp", event_id: pair.event_id, proof: pair.proof };
}

test("canonical and stored profile addresses record the same verified identity", async () => {
  for (const slug of ["bahar-istanbul", "bahar-39bc3dbe"]) {
    assert.equal((await recordProfileAnalyticsEvent(event(slug))).tracked, true);
  }
  assert.equal(inserts.length, 2);
  assert.equal(inserts[0][4], "/profil/bahar-istanbul");
  assert.equal(inserts[0][3], "customer:fixture");
});

test("contact events retain their channel and reject proofs for another profile", async () => {
  assert.equal((await recordProfileAnalyticsEvent(event("bahar-istanbul", profile.id, "contact_click"))).tracked, true);
  assert.equal(inserts[0][9], "whatsapp");
  await assert.rejects(recordProfileAnalyticsEvent(event("bahar-istanbul", "78")), { code: "INVALID_ANALYTICS_PROOF" });
  assert.equal(inserts.length, 1);
});

test("duplicate event proofs do not increment the counter twice", async () => {
  const input = event();
  assert.equal((await recordProfileAnalyticsEvent(input)).tracked, true);
  assert.equal((await recordProfileAnalyticsEvent(input)).tracked, false);
  assert.equal(inserts.length, 1);
});

test("unpublished, missing, and ambiguous aliases do not create events", async () => {
  owners = [{ ...profile, is_active: false }];
  assert.equal((await recordProfileAnalyticsEvent(event())).tracked, false);
  owners = [profile];
  publicRows = [];
  assert.equal((await recordProfileAnalyticsEvent(event())).tracked, false);
  publicRows = [profile];
  assert.equal((await recordProfileAnalyticsEvent(event("missing-profile"))).tracked, false);
  owners = [profile, { ...profile, id: "78", slug: "second-bahar" }];
  assert.equal((await recordProfileAnalyticsEvent(event("bahar"))).tracked, false);
  assert.equal(inserts.length, 0);
});

test("a profile disabled in storage cannot receive an event", async () => {
  databaseRows = [];
  assert.equal((await recordProfileAnalyticsEvent(event())).tracked, false);
  assert.equal(inserts.length, 0);
});
