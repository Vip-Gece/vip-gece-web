# VIP GECE API Credential Registry

This registry contains metadata only. Secret values, key material, tokens, and
full connection strings must never be added here.

| Service | Credential name | Purpose | Scope | Resource | Storage location | Created for audit | Expiry | Write capable | Rotate/revoke after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cloudflare | vip-gece-audit-read-2026-09-01-final | Production topology audit | Zone Read; DNS Read; Zone Settings Read | vip-gece.site; vip-gece.com; vip-gece.online | Ignored local `.env` as `CLOUDFLARE_API_TOKEN` | Yes | 2026-10-01T11:51:19Z | No | Revoke when reconstruction finishes or at expiry |
| Cloudflare | revoked legacy administrative token | Historical containment record | Formerly broad account and zone administration | One account and four zones | Removed from active consumers; revoked value not recorded | No | Revoked 2026-09-01 | No longer active | No action beyond optional SEC-GIT-001 housekeeping |
| Supabase | project publishable credential | Public/client API observations | Publishable/anonymous client role; effective data access remains conditional on RLS | Configured VIP GECE Supabase project | Ignored local `.env`; value omitted | No | Provider-managed | Not administrative; data writes may be allowed only where RLS permits | Keep as public client configuration; rotate only on provider/project need |
| Supabase | management or database audit credential | Schema and management audit | Not provisioned | Not yet proven as the production database | None | No | N/A | N/A | Provision only if PHASE 1C requires a minimum-privilege official route |
| Hetzner Cloud | read-only inventory credential | Server/network identity inventory | Not available | Expected server at 159.69.146.114 | None | No | N/A | N/A | Requires an existing owner-authorized Hetzner account route |
| Hetzner SSH | production host identity | Runtime, release, environment, jobs, logs, and backup inspection | Read-only operational use | 159.69.146.114:22 | No private key/config/agent identity exists on this PC | No | N/A | SSH account capability unknown | Restore the prior authorized identity; do not create or alter SSH access without chief approval |
| Production PostgreSQL | production database connection | Provider identity and schema inspection | Not available until production environment is readable | Unknown | None available locally | No | N/A | N/A | Read-only inspection only after DATABASE_URL identity is established |
| Google Search Console | property analytics credential | Sitemap and 7/28/90-day Search Analytics | Not provisioned | sc-domain:vip-gece.site candidate | None | No | N/A | No | Prefer an existing runtime identity; otherwise provision property-scoped read-only access |

## Controls

- The Cloudflare audit token must not be broadened or extended.
- Any future Cloudflare write operation requires a separate, short-lived,
  task-specific token approved for the exact change.
- Supabase publishable credentials are never service-role or management
  credentials.
- New tooling must use a separate audit/tool cache and must not add application
  dependencies merely to perform an audit.
- Every new secret must remain outside tracked files and be followed by the
  project secret scan.
- Temporary credentials are revoked when their approved audit purpose ends.
