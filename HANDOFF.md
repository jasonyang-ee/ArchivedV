# HANDOFF 2026-07-17

branch main | last commit 302046b fix(history): enrich route metadata from folders | tests green
baseline green | oracle `npm.cmd run build`
uncommitted: HANDOFF.md (baton refresh; commit before resume)

## done this session
F1: call-site/test-runner research complete → 0e41446
F2: configured limits + shared URL helper + week parsing + videoId dedup → bf3c512
F3: history route folder enrichment + V6 accuracy check → 302046b

## in progress (exact stop point)
F3 x: implementation + verification complete; T18 x in SPEC.md | NEXT STEP: execute F4 steps 1-8; create `server/tests/` and add built-in `node:test` coverage
mid-edit files: -

## next
F4 per PLAN.md | preconditions: F3 complete

## deviations & decisions
plan said research call sites + runner → confirmed expected map; PLAN.md updated: y
plan said `npm run build` baseline → used `npm.cmd run build` because PowerShell execution policy blocks `npm.ps1`; PLAN.md updated: n
plan said amend §V.6 → V6 already stated in-memory lifetime + restart clearing; no SPEC wording change required
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
