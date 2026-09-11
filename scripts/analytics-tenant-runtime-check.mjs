import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("dotenv").config();

const { query } = require("../src/data/postgresClient");
const {
  getAdminAnalyticsOverview,
  getCustomerProfileAnalytics
} = require("../src/services/profileAnalyticsService");

const tenants = (
  await query(
    `select owner_user_id, min(id)::text as profile_id
     from public.profiles
     where owner_user_id like 'customer:%'
     group by owner_user_id
     order by owner_user_id
     limit 2`
  )
).rows;

if (tenants.length < 2) {
  throw new Error("Two isolated customer tenants are required for the runtime check.");
}

const first = tenants[0];
const second = tenants[1];
const owned = await getCustomerProfileAnalytics({
  days: 7,
  ownerUserId: first.owner_user_id,
  profileId: first.profile_id
});

let crossTenantBlocked = false;
try {
  await getCustomerProfileAnalytics({
    days: 7,
    ownerUserId: second.owner_user_id,
    profileId: first.profile_id
  });
} catch (error) {
  crossTenantBlocked =
    error?.status === 404 && error?.code === "ANALYTICS_PROFILE_NOT_FOUND";
}

const customerOverview = await getAdminAnalyticsOverview({
  days: 90,
  ownerUserId: first.owner_user_id
});
const siteOverview = await getAdminAnalyticsOverview({ days: 90 });

const result = {
  ok:
    String(owned.profile.id) === first.profile_id &&
    crossTenantBlocked &&
    customerOverview.top_profiles.every(
      (profile) => profile.owner_user_id === first.owner_user_id
    ) &&
    siteOverview.totals.profile_views > 0,
  two_tenants: true,
  owned_profile_ok: String(owned.profile.id) === first.profile_id,
  cross_tenant_404: crossTenantBlocked,
  customer_scope_rows: customerOverview.top_profiles.length,
  customer_scope_owner_safe: customerOverview.top_profiles.every(
    (profile) => profile.owner_user_id === first.owner_user_id
  ),
  site_history_preserved: siteOverview.totals.profile_views > 0
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
