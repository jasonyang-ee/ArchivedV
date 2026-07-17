# HANDOFF 2026-07-17

branch main | last commit 0e41446 docs(plan): record F1 research findings | tests green
baseline green | oracle `npm.cmd run build`
uncommitted: HANDOFF.md (baton refresh; commit before resume)

## done this session
F1: call-site/test-runner research complete → 0e41446

## in progress (exact stop point)
F1 x: findings recorded in PLAN.md; T16 x in SPEC.md | NEXT STEP: execute F2 steps 1-8
mid-edit files: -

## next
F2 per PLAN.md | preconditions: F1 complete

## deviations & decisions
plan said research call sites + runner → confirmed expected map; PLAN.md updated: y
PowerShell `npm` shim blocked by execution policy → use `npm.cmd` equivalent
user decided: -

## watchouts
- F2 must update `server/utils.js` default export object when adding named `buildChannelUrl`
- F4 uses built-in `node:test`; no Vitest or existing test script
- ⊥ push or tag without explicit user ask

## final verification
item|status|evidence|decision
T16|HOLD|PLAN.md findings + `npm.cmd run build`|SPEC
