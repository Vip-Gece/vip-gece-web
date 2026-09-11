# VIP GECE SERP Daily Rotation

Date: 2026-07-05
Status: automation runner ready, live SERP API key missing

## Purpose

The free SERP quota should be spent in fixed daily batches instead of trying to
measure every Istanbul district and semt keyword in one run.

Default scope:

- Provider: Serper
- Device: desktop
- Batch size: 40 queries per day
- Keyword set: Istanbul city, 39 districts, and semt landing keywords
- State file: `output/external-audits/serp-daily-rotation-state.json`
- Output prefix: `output/external-audits/serp-daily-YYYY-MM-DD-batch-N-of-M-*`

## Command

```sh
SERPER_API_KEY=<secret> npm run serp-daily-rotation -- --provider=serper --batch-size=40 --device=desktop
```

Dry-run without spending quota:

```sh
npm run serp-daily-rotation -- --dry-run --provider=serper --batch-size=40 --device=desktop
```

Primary 40 only, Istanbul plus 39 districts:

```sh
SERPER_API_KEY=<secret> npm run serp-daily-rotation -- --provider=serper --batch-size=40 --device=desktop --primary-only
```

## Rotation Behavior

- The runner reads the current offset from the state file.
- A successful run advances `next_offset` by `batch-size`.
- The last batch wraps `next_offset` back to `0`.
- If the same scope already ran successfully today, the runner exits without
  spending another batch.
- Use `--force` only when intentionally spending another same-day batch.
- Failed or missing-key runs do not advance the offset.

## Current Blocking Item

No usable SERP provider key was found in local env during setup:

- `SERPER_API_KEY`: missing
- `SERPAPI_KEY`: missing
- `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`: missing

Because of that, the runner is ready but the live rank measurement is not yet
externally verified.
