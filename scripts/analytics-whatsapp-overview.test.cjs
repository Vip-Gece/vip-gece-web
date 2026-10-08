"use strict";

const { test, mock, after } = require("node:test");
const assert = require("node:assert/strict");
const database = require("../src/data/postgresClient");
let profileSql;
mock.method(database, "hasDatabaseUrl", () => true);
mock.method(database, "query", async (sql) => {
  if (sql.includes("profiles.is_active,")) {
    profileSql = sql;
    return { rows: [
      { id: "1", name: "A", profile_views: "10", contact_clicks: "9", whatsapp_clicks: "3" },
      { id: "2", name: "B", profile_views: "0", contact_clicks: "0", whatsapp_clicks: "0" }
    ] };
  }
  return { rows: [] };
});
const { getAdminAnalyticsOverview } = require("../src/services/profileAnalyticsService");
after(() => mock.restoreAll());

test("profile overview exposes WhatsApp clicks separately and includes zero-event profiles", async () => {
  const report = await getAdminAnalyticsOverview({ days: 7 });
  assert.equal(report.top_profiles[0].whatsapp_clicks, 3);
  assert.equal(report.top_profiles[0].contact_clicks, 9);
  assert.equal(report.top_profiles[1].whatsapp_clicks, 0);
  assert.match(profileSql, /from public\.profiles profiles\s+left join public\.analytics_events/);
  assert.match(profileSql, /events\.action = 'whatsapp'/);
  assert.doesNotMatch(profileSql, /limit 25/);
  assert.match(profileSql, /owner_user_id_snapshot = \$3::text/);
});
