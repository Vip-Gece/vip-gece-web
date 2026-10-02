# VIP-GECE.online Supabase clean install proof

Checked at: 2026-09-30 20:31 Europe/Istanbul

Source:
- Supabase SQL Editor browser view showed project ref `wgsjtufkejeyawdwayip`.
- Supabase MCP read-only SQL verification returned the same clean-install proof shape.

Result:

```json
{
  "schemas": {
    "private": 3,
    "public": 7
  },
  "rls_enabled_for_all_detected_tables": true,
  "risky_client_dml_grants": 0
}
```

Detected tables:

```text
private.customer_accounts
private.profile_owner_mapping_reviews
private.trusted_admin_accounts
public.analytics_events
public.profile_identity_map
public.profile_owner_accounts
public.profile_public_projection
public.profile_records
public.profile_workflow_events
public.profiles
```

Interpretation:
- `.online` clean Supabase install is separated from the old `.site` project in the browser session.
- All detected `public` and `private` tables have RLS enabled.
- `anon` and `authenticated` have no detected risky DML privileges on `public` or `private` tables.
