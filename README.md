# VIP GECE Clean Source

## Current Recovery Checkpoint

The active 2026-09-11 recovery handoff is recorded in:

- `docs/forensic-handoff-checkpoint-20260911.md`

Use that document as the starting point before continuing SSH, Hetzner deploy,
GitHub reset, Supabase image recovery, Cloudflare, Google Search Console,
Analytics, or the deferred Windows forensic review.

## Current Implementation Checkpoints

Fresh 2026-09-14 observations supersede older live-state claims for their scope:

- `docs/search-indexing-checkpoint-20260914.md`: live indexing release, cache correction, Google migration cancellation.
- `docs/runtime-integrity-checkpoint-20260914.md`: release comparison and local inspection coverage/limits.
- `docs/customer-android-implementation-checkpoint-20260914.md`: local Android work and explicit production activation blockers.
- [Android commercial package checkpoint](docs/customer-android-commercial-checkpoint-20260914.md): current signed APK 1.0.0 (10001), Firebase/update work, recorded verification, pending Remote Config approval and customer activation gates. Start here when resuming Android delivery.

The Android/customer changes are not part of the live indexing release. Keep
customer access closed until their separate verification and deployment.
