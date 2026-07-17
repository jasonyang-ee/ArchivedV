# HANDOFF

## state
branch: main | head: 3cf2486 | tree: clean (AGENTS.md, SPEC.md, PLAN.md added)
next phase: F1 (research)
plan: PLAN.md exists, F1..F5 defined
SPEC.md: updated §V.6, §T T16-T20 added

## why we stopped
review-code sweep complete → gate NO-GO → cook produced PLAN.md. ⊥ code changed yet.

## what was done this session
- `/prep` run: AGENTS.md refreshed (Skills + Caveman symbols + Rules + Checklist added), SPEC.md created (DISTILL from code), CLAUDE.md verified
- `review-code` v1.6.0 → HEAD: 1 BLOCK + 5 HARDEN + 2 NOTE

## findings summary
BLOCK-1: `routes.js:27,32` rate limiters hardcode `max:20/50`; `AUTH_RATELIMIT_MAX` + `STATIC_RATELIMIT_MAX` from config.js never imported → dead env vars
HARDEN-1: `buildChannelUrl` triplicated in routes.js + database.js + downloader.js → extract to utils.js
HARDEN-2: SPEC §V.6 said "persisted" but authSkipCache is in-memory → corrected in SPEC.md this session
HARDEN-3: `parseScheduledTime` misses "week" unit → stream 1 week out enters retry queue (1hr max backoff) not scheduledStreams
HARDEN-4: `normalizeHistoryItem` in routes.js lacks titleMap folder lookup that migration has → post-migration items unresolvable by folder
HARDEN-5: `checkUpdates` dedup check uses channel+title not channel+videoId → inconsistent with §V.2

## next session start
1. read SPEC.md §V, §T; read PLAN.md
2. start F1: grep buildChannelUrl + parseScheduledTime callers; confirm utils.js export style; confirm no test runner installed; log findings
3. adjust F2..F4 steps if F1 findings differ
4. execute F2 (BLOCK + HARDEN 1,3,5) → commit
5. execute F3 (HARDEN-4 + §V.6 code verification) → commit
6. execute F4 (unit tests) → commit
7. execute F5 (final verify + CHANGELOG) → commit → /garnish

## watchouts
- ⊥ push during any phase; user pushes explicitly
- `buildChannelUrl` extract: verify db.read() call sites in database.js still work after import change (circular import risk: database.js → utils.js should be fine since utils.js ⊥ imports database.js)
- routes.js imports from config.js already confirmed (line 19: `import { YTDLP_COOKIES_PATH, DOWNLOAD_DIR } from "./config.js"`)
- F4 test runner choice: prefer `node:test` (zero deps) unless vitest already present (it is NOT in package.json dependencies)
- after F5 commit: invoke /garnish to purge PLAN.md + HANDOFF.md
