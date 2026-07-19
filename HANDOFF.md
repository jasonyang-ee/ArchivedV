# HANDOFF 2026-07-19

branch main | last commit cd536a6 refactor: single-source history channel enrichment (T27, §V29) | tests green (5 pass)
baseline green | oracle `npm test` (5 pass, Node v25.9.0) + `node --check` server/*.js + import smoke routes.js/scheduler.js
uncommitted: HANDOFF.md (this baton) — commit as `docs: handoff`

## done this session
F1 (T26): re-verified `resolveHistoryChannel` contract vs live code + landed cook/review-plan planning baseline (SPEC §V29,§I env rows,§T26-29; PLAN F1-F4) → ff81f5a
F2 (T27): extracted `resolveHistoryChannel` (database.js) as sole precedence logic; both callers use it; `/api/history` titleMap gated by `needsFolderLookup`; dropped orphan routes.js imports (`normalizeHistoryTitle`,`buildChannelUrl`); +unit test (6 cases). npm test 5 pass. EOL verified byte-identical on untouched lines → cd536a6. T27→x

## in progress (exact stop point)
∅ — F2 committed. NEXT STEP: `/workonplan` → execute F3 (T28) per PLAN.md F3. Re-inspect `git ls-files --eol server/`; DECISION default = option A: write `.gitattributes` at repo root = `* text=auto eol=lf` ONLY (⊥ `git add --renormalize` mass commit — 5 mixed files = churn); confirm `git status` shows only new `.gitattributes` (+ HANDOFF/SPEC); ⊥ touch server logic. Record decision+reason in HANDOFF
mid-edit files: none

## next
F3 (T28) `.gitattributes` decision (option A) | preconditions: none. then F4 (T29) final verify + confirm CHANGELOG
F1 (T26) = REMOVAL CANDIDATE on next `/cook`

## deviations & decisions
plan: F1 formality → re-verified + committed planning baseline in ff81f5a (PLAN.md updated: y prior cycle)
CHANGELOG: added enrichment-unification entry under §Changed in F2 commit (plan assigned it to F4) — per workonplan per-phase contract (code ships in F2); F4 will VERIFY present, ⊥ duplicate. end-state identical
note: enrichment unification aligns API → migrate ungated precedence for ALL under-populated item shapes (⊥ only channelName-only), = §V29 single-source intent; fully-populated items byte-identical (F1 analysis)
user decided: -

## watchouts
- F3: repo is `text=auto eol=lf` target but working tree is mixed (server/ = 4 pure-CRLF + 5 mixed + tests LF). option A adds attributes only → per-file LF normalize on NEXT touch, ⊥ giant churn now. option B (`git add --renormalize .`) = large diff → only w/ explicit user ok
- F3 ! ⊥ intersect F2 file set (server logic) — attributes file only
- F4: confirm `resolveHistoryChannel` single def (database.js) + 2 callers; `/api/history` titleMap gated; CHANGELOG §Changed entry present; rerun `npm test`(5)+`node --check`+import smoke; §V29 HOLD
- `sanitize` in routes.js:11 still imported-but-unused (pre-existing, out of scope; flag for future cleanup)
- PowerShell `npm` shim may be blocked → `npm.cmd` | Bash tool
- ⊥ push | tag without explicit user ask

## final verification
item|status|evidence|decision
-|-|-|-
