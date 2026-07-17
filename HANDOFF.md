# HANDOFF 2026-07-17

branch main | last commit bf3c512 fix(server): apply configured limits and dedupe IDs | tests green
baseline green | oracle `npm.cmd run build`
uncommitted: HANDOFF.md (baton refresh; commit before resume)

## done this session
F1: call-site/test-runner research complete → 0e41446
F2: configured limits + shared URL helper + week parsing + videoId dedup → bf3c512

## in progress (exact stop point)
F2 x: implementation + verification complete; T17 x in SPEC.md | NEXT STEP: execute F3 steps 1-5 in `server/routes.js`, `server/database.js`, and SPEC.md §V.6
mid-edit files: -

## next
F3 per PLAN.md | preconditions: F2 complete

## deviations & decisions
plan said research call sites + runner → confirmed expected map; PLAN.md updated: y
plan said `npm run build` baseline → used `npm.cmd run build` because PowerShell execution policy blocks `npm.ps1`; PLAN.md updated: n
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
