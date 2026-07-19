# HANDOFF 2026-07-19

branch main | last commit 225265a chore: normalize line endings to LF via .gitattributes (T28) | tests green (5 pass)
baseline green | oracle `npm test` (5 pass, Node v25.9.0) + `node --check` server/*.js + import smoke routes.js/scheduler.js
uncommitted: HANDOFF.md (this baton) — commit as `docs: handoff`

## done this session
F1 (T26): re-verified `resolveHistoryChannel` contract + landed planning baseline → ff81f5a
F2 (T27): extracted `resolveHistoryChannel` (database.js) single-source; both callers use it; `/api/history` titleMap gated by `needsFolderLookup`; orphan imports dropped; +unit test (6 cases); npm test 5 pass → cd536a6
F3 (T28): added root `.gitattributes` `* text=auto eol=lf` (option A). VERIFIED: core.autocrlf=false → `git status` clean beyond new file (⊥ mass renormalize churn); files normalize per-file on next `git add` → 225265a

## in progress (exact stop point)
∅ — F3 committed. NEXT STEP: `/workonplan` → execute F4 (T29) per PLAN.md F4 steps 1-8: re-read §V29+§I env rows → classify HOLD/VIOLATE; grep `resolveHistoryChannel` = 1 def (database.js) + 2 callers; confirm `/api/history` titleMap gated; confirm CHANGELOG §Changed has enrichment + `.gitattributes` entries (ALREADY added F2/F3 → verify, ⊥ duplicate); rerun `npm test`(5)+`node --check`+import smoke; fill final-verification table; commit
mid-edit files: none

## next
F4 (T29) final verify + fill verification table + confirm CHANGELOG | preconditions: F2,F3 done ✓
after F4 → cycle complete → `/garnish` (purge PLAN.md + HANDOFF.md)
F1 (T26) = REMOVAL CANDIDATE on next `/cook`

## deviations & decisions
CHANGELOG: enrichment entry added in F2 commit, `.gitattributes` entry in F3 commit (plan assigned both to F4) — per workonplan per-phase contract; F4 VERIFIES present, ⊥ duplicate
F3 = option A (attributes only) confirmed clean by empirical `git status` test (core.autocrlf=false → ⊥ retroactive dirty)
note: enrichment unification aligns API → migrate ungated precedence for ALL under-populated shapes (⊥ only channelName-only) = §V29 single-source intent; fully-populated items byte-identical
user decided: -

## watchouts
- F4 is verify-only: ⊥ edit server logic; if drift found, classify code|SPEC bug via `/spec` before fixing
- `sanitize` in routes.js:11 still imported-but-unused (pre-existing, out of scope; flag future cleanup)
- `.gitattributes` now active: any FUTURE `git add` of a mixed/CRLF file → LF-renormalizes that file (expected, per-file). F4 touches ⊥ server files ∴ ⊥ triggered this cycle
- PowerShell `npm` shim may be blocked → `npm.cmd` | Bash tool
- ⊥ push | tag without explicit user ask

## final verification
item|status|evidence|decision
-|-|-|-
(F4 fills this)
