# HANDOFF 2026-07-19

branch main | last commit (this F4 commit) | tests green (5 pass)
baseline green | oracle `npm test` (5 pass, Node v25.9.0) + `node --check` server/*.js + import smoke routes.js/scheduler.js
uncommitted: none (HANDOFF.md folded into F4 commit)

## done this session
F1 (T26): re-verified `resolveHistoryChannel` contract + landed planning baseline → ff81f5a
F2 (T27): extracted `resolveHistoryChannel` (database.js) single-source; both callers use it; `/api/history` titleMap gated by `needsFolderLookup`; orphan imports dropped; +unit test (6 cases); npm test 5 pass → cd536a6
F3 (T28): added root `.gitattributes` `* text=auto eol=lf` (option A, verified no churn) → 225265a
F4 (T29): final verify — §V29 + §I env rows HOLD; oracle green; CHANGELOG confirmed → this commit

## in progress (exact stop point)
∅ — ALL PLAN phases (F1-F4 / T26-T29) done, §T all `x`. NEXT STEP: run `/garnish` to purge PLAN.md + HANDOFF.md (SPEC.md + history preserved). Cycle complete; ⊥ code work remaining
mid-edit files: none

## next
`/garnish` (close cycle) | preconditions: all §T x ✓, tests green ✓, no unrelated dirty ✓
future cleanup (⊥ this cycle): remove pre-existing unused `sanitize` import in routes.js:11 — defer to a cycle that already touches routes.js (editing it now → `.gitattributes` LF-renormalizes whole mixed file = mass churn)

## deviations & decisions
CHANGELOG: enrichment entry landed in F2 commit, `.gitattributes` entry in F3 commit (plan assigned both to F4); F4 verified both present under §Changed (CHANGELOG.md:16-17), ⊥ duplicated. end-state = plan intent
F3 = option A confirmed clean by empirical `git status` (core.autocrlf=false → ⊥ retroactive dirty)
note: enrichment unification aligns API → migrate ungated precedence for ALL under-populated shapes (⊥ only channelName-only) = §V29 single-source intent; fully-populated items byte-identical
user decided: -

## watchouts
- `sanitize` in routes.js:11 imported-but-unused (pre-existing, out of scope; see `next`)
- `.gitattributes` active: FUTURE `git add` of any mixed/CRLF file → LF-renormalizes that whole file (expected, per-file)
- PowerShell `npm` shim may be blocked → `npm.cmd` | Bash tool
- ⊥ push | tag without explicit user ask (10+ unpushed commits on main)

## final verification
item|status|evidence|decision
§V29 sole precedence logic|HOLD|`resolveHistoryChannel` 1 def database.js:66; 2 callers routes.js:55 + database.js:110; ⊥ 3rd caller (grep server/)|code
§V29 titleMap gated by needsFolderLookup|HOLD|routes.js:462-465 (`? buildDownloadTitleMap : null`); database.js:81-84; ⊥ unconditional scan|code
§V29 channelName-only enrichment identical API↔migrate|HOLD|shared helper single-source; core.test.js case 4 (npm test 5 pass)|code
§I AUTH_RATELIMIT_MAX=60|HOLD|config.js:54 (`|| 60`); routes.js authFsLimiter max|code
§I STATIC_RATELIMIT_MAX=600|HOLD|config.js:53 (`|| 600`); routes.js staticFsLimiter max|code
T26,T27,T28,T29|x|ff81f5a / cd536a6 / 225265a / this commit|-
oracle full suite|HOLD|`npm test` 5 pass (0 fail); +`node --check` 4 files; +import smoke routes/scheduler|-
