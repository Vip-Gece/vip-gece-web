# Runtime Influence Checkpoint - 2026-09-14

## Scope and limits

Read-only inspection of website runtime inputs, release drift, local project inventory, and Windows startup/influence surfaces. This is not a phone forensic task, a full malware investigation, or proof that every disk file is harmless. No suspicious/user files were deleted, no legacy project code executed, and no operating-system protections changed.

## Confirmed observations

- The live release and immediately preceding release were hashed: 2,052 current files, including deployed dependencies; zero read errors; exactly the six expected auto-indexing differences; no removals.
- The sole release symlink, `node_modules/.bin/semver`, resolves inside the release.
- The deploy-user PM2 application is online, points to the correct current release, and is not in watch mode. No unexpected Node launch arguments or initial `NODE_OPTIONS`, `NODE_PATH`, `LD_PRELOAD`, or `LD_LIBRARY_PATH` were observed.
- Nginx configuration passed syntax validation. Relevant Nginx blocks, systemd units, cron state and selected loader/configuration files were read into a redacted report.
- Root and deploy have no crontabs. Related units are the expected Nginx, PM2, backup, healthcheck and index-notification services/timers.
- Cloudflare's stale public HTML was a demonstrated cause of behavior differing from the origin. The approved hostname cache purge corrected the eight reproduced cases.
- Nginx, `/var/www/vip-gece-site/.env`, PM2, the database, and Cloudflare are legitimate runtime influences outside the release directory. A clean source tree alone cannot establish live behavior.

`/proc/<pid>/environ` captures the launch environment, not necessarily variables loaded later by dotenv. Null entries there must not be interpreted as disabled runtime features. Production environment values and readiness were checked separately during activation; secrets were not printed.

## Local disk and source coverage

- C: was the mounted real drive available during this check. Temp is an alias, not evidence of a second physical disk.
- Filename traversal visited 92,311 directories and 430,911 files.
- 102 directories were inaccessible; 70 symlinks/junctions were recorded but not followed.
- 150 project-named paths were found, including 33 outside the canonical project. This count is a name-based inventory, not an all-content review.
- 589 tracked/non-ignored source files were hashed without read errors. Ignored build output, dependencies and work artifacts are not included in that source-content claim.
- Two other source trees exist: `C:\Users\o-neo\Documents\VIP-GECE-ESCORT` and `C:\Users\o-neo\Documents\VIP-GECE-ILAN`. Their top-level inventory, manifests and server entry points were read as reference only. They were neither imported nor started.
- Other matches include old deployment archives, handoff files, recovery artifacts and SSH-key filenames. Private key contents were not read for this audit.
- No VIP GECE override was present in the Windows hosts file. User proxy was disabled, no PAC was configured, WinHTTP showed direct access, and the four normal PowerShell profile paths were absent.
- 177 scheduled tasks, 277 services and four startup entries were inspected. No project/Node/PM2-related startup action was found by the applied name/action matching.
- 200 processes were inspected, with 20 matching the project/Node-related filter. Their command lines identify Codex runtime, browser-control, app-tools and security-plugin helpers. Four relative `./server.mjs` launches were traced to parent `launch_codex_app_tools_mcp.cmd` commands. No running legacy VIP GECE server was observed.

This does not establish historical process behavior, inspect all executable contents, follow every link, or cover inaccessible directories. A missing match is not proof of absence outside those limits.

## Local versus live differences

The working tree is intentionally dirty and not identical to production. Eighteen common files differed from the live hash inventory at the check:

```text
admin-sw.js
admin.css
ops/hetzner/vip-gece-backup.sh
package.json
public/css/home-render.min.css
public/js/deferred-css.js
public/js/detail/index.js
public/js/google-analytics.js
scripts/contracts.mjs
scripts/full-sitemap-seo-audit.mjs
scripts/profile-publication-contract.mjs
scripts/smoke.mjs
src/app.js
src/data/postgresProfilesRepo.js
src/routes/adminRoutes.js
src/routes/customerMobileRoutes.js
src/services/customerMobileAccountService.js
src/services/customerProfileImageService.js
```

Several are the local, unreleased customer-app/original-image implementation. Other public frontend/contract differences need individual attribution before any whole-tree release. Hash inequality is not a finding of malicious modification. Do not overwrite or deploy the whole local tree as a shortcut. New local files absent from production are a separate set, not included in this eighteen-file comparison.

## Evidence

- `work/runtime-integrity-remote-20260914.json`: full live hash inventory, baseline comparison, process/configuration and IndexNow observations.
- `work/runtime-integrity-local-20260914.json`: source hashes, filename traversal, errors and links.
- `work/windows-project-influence-20260914.json`: Windows process/startup/service/task/proxy observations.
- Parent-process attribution and legacy entry-point reads are recorded in the task tool output.

Result: no unexpected live release drift from the immediately preceding baseline was found; an actual cache discrepancy was fixed. This is not an independent clean-baseline certification. The remaining local/live differences and inaccessible scope are explicitly unresolved, not silently treated as clean.
