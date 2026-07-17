# HANDOFF 2026-07-17

branch main | last commit 8d9393b test(server): cover core scheduling and migration | tests green
baseline green | oracle `npm.cmd run build`
uncommitted: HANDOFF.md (baton refresh; commit before resume)

## done this session
F1: call-site/test-runner research complete → 0e41446
F2: configured limits + shared URL helper + week parsing + videoId dedup → bf3c512
F3: history route folder enrichment + V6 accuracy check → 302046b
F4: built-in core function tests + npm test script → 8d9393b

## in progress (exact stop point)
F4 x: 4 tests green; T19 x in SPEC.md | NEXT STEP: execute F6 steps 1-4 in `server/downloader.js` and `server/scheduler.js`
mid-edit files: -

## next
F6 per PLAN.md | preconditions: F4 complete

## deviations & decisions
plan said research call sites + runner → confirmed expected map; PLAN.md updated: y
plan said `npm run build` baseline → used `npm.cmd run build` because PowerShell execution policy blocks `npm.ps1`; PLAN.md updated: n
plan said amend §V.6 → V6 already stated in-memory lifetime + restart clearing; no SPEC wording change required
plan said `node --test server/tests/**` → used `server/tests/**/*.test.js` so npm test discovers named test files on Windows
PowerShell `npm` shim blocked by execution policy → use `npm.cmd` equivalent
user decided: -

## watchouts
- F2 must update `server/utils.js` default export object when adding named `buildChannelUrl`
- F4 uses built-in `node:test`; no Vitest or existing test script
- ⊥ push or tag without explicit user ask

## final verification
item|status|evidence|decision
T16|HOLD|PLAN.md findings + `npm.cmd run build`|SPEC
T17|HOLD|`npm.cmd run build`; `node --check` touched files; parser smoke; server startup|SPEC
T18|HOLD|`npm.cmd run build`; `node --check` routes/database; history helper smoke; server startup|SPEC
T19|HOLD|`npm.cmd test` (4 pass); `npm.cmd run build`; syntax checks|SPEC
