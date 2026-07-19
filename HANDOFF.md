# HANDOFF 2026-07-19

branch main | last commit ff81f5a docs: confirm history-enrichment refactor contract (T26) | tests green
baseline green | oracle `npm test` (4 pass, Node v25.9.0) + `node --check` server/*.js + import smoke routes.js/scheduler.js
uncommitted: HANDOFF.md (this baton) — commit as `docs: handoff`

## done this session
F1 (T26): re-verified `resolveHistoryChannel` contract vs live code (routes.js:8,54-77,459-476; database.js:66-136; utils.js:23-27; core.test.js) + landed cook/review-plan planning baseline (SPEC §V29,§I env rows,§T26-29; PLAN F1-F4) → ff81f5a. T26→x

## in progress (exact stop point)
∅ — F1 closed, F2 ⊥ started. NEXT STEP: `/workonplan` → execute F2 (T27) per PLAN.md F2 steps 1-7. Add `export function resolveHistoryChannel(item,{channelsById,channelsByUsername,singleChannel,titleMap})` to `server/database.js` (body = migrate ungated precedence, database.js:91-101); both callers call it; gate `/api/history` titleMap by `needsFolderLookup`; add unit test in core.test.js
mid-edit files: none

## next
F2 (T27) extract helper + gate + tests | preconditions: none (F1 findings in PLAN.md F2 inputs). then F3 (T28) `.gitattributes` decision; F4 (T29) final verify + CHANGELOG
F1 (T26) = REMOVAL CANDIDATE on next `/cook` (all unknowns resolved)

## deviations & decisions
plan: F1 = formality (review-plan pre-confirmed) → workonplan re-verified vs live code + flipped T26→x + committed PLAN/SPEC baseline (PLAN.md updated: y, prior cycle)
note: enrichment unification aligns routes → migrate ungated precedence for ALL under-populated item shapes (⊥ only channelName-only) e.g. channelId∉channels + folder title-match + coexisting bare item → now folder-matched in API too, = §V29 single-source intent; fully-populated items stay byte-identical
CHANGELOG: plan puts entry in F4; will add in F2 (phase that ships code) per workonplan per-phase contract, F4 verifies present (minor, end-state identical)
user decided: -

## watchouts
- `/api/history` byte-identical for fully-populated items (pure refactor + gate); under-populated items now enriched to match migrate (see deviation note) — intended §V29
- F2 gate: build titleMap iff `needsFolderLookup` = ∃ item ⊥ channelId & ⊥ username & ⊥ channelName; ⊥ per-request scan
- F2 orphan imports: drop `normalizeHistoryTitle` (`./database.js`) & `buildChannelUrl` (`./utils.js`) from routes.js — each used ONLY in `normalizeHistoryItem` (routes.js:57,68 confirmed via grep); ⊥ `node --check` catch → grep routes.js post-refactor. KEEP `buildDownloadTitleMap` (routes.js:469) + `sanitize` (pre-existing unused, out of scope)
- EOL: `database.js`+`routes.js` = `i/mixed w/mixed` → F2 ! targeted Edits (⊥ full rewrite); review `git diff` for spurious CRLF↔LF flips
- regression guard: core.test.js migrate test (updatedCount===3) ! stay green post-F2 = proves migrate preserved thru helper extraction
- PowerShell `npm` shim may be blocked → `npm.cmd` | Bash tool; Node v25 confirms `node --test` glob works
- ⊥ push | tag without explicit user ask

## final verification
item|status|evidence|decision
-|-|-|-
