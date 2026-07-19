# PLAN

goal: unify history channel-enrichment → 1 shared `resolveHistoryChannel` helper; gate `/api/history` folder scan; fold 2 review NOTEs

## ground rules
- ∀ phase → commit before next phase starts
- ⊥ push | tag without explicit user ask
- ∀ change → update §T in SPEC.md via `/spec`
- fixes stay focused; ⊥ refactor beyond named scope
- ⊥ new runtime deps
- `/api/history` output ! byte-identical before/after ∀ existing data shapes (pure refactor + gate; ⊥ behavior change except channelName-only enrichment now matches migration)
- oracle ∀ code phase: `npm test` green & `node --check` touched files & import smoke `routes.js`+`scheduler.js`

## existing assets
- baseline `v1.7.3` → HEAD `67aac01` reviewed → gate GO; prior cycle T16-T25 all `x`
- review findings: HARDEN-1 (efficiency: unconditional titleMap scan), HARDEN-2 (coherence: drifted precedence dup)
- `server/database.js`: home of `migrateHistoryEntries` (:66), `buildDownloadTitleMap` (:32), `normalizeHistoryTitle` (:25); already imports `buildChannelUrl` (:4). Gate `needsFolderLookup` already present :81-84
- `server/routes.js`: `normalizeHistoryItem` (:54), `/api/history` handler (:459); imports `buildDownloadTitleMap`,`normalizeHistoryTitle` from `./database.js` (:8); titleMap built unconditionally :469
- precedence dup: routes.js:59-63 (gated `titleMatches`) ≠ database.js:91-96 (ungated) → drift
- `server/tests/core.test.js`: `node:test`; already covers `migrateHistoryEntries`
- EOL (`git ls-files --eol server/` @ 2026-07-19): 4 pure-CRLF (`auth.js`,`config.js`,`index.js`,`merger.js`); 5 `i/mixed w/mixed` (`database.js`,`downloader.js`,`routes.js`,`scheduler.js`,`utils.js`); `core.test.js` = LF; ⊥ `.gitattributes`. ! F2 edits `database.js`+`routes.js` = both mixed → EOL-churn risk (see F2 watchout)
- SPEC §I env table NOW lists `AUTH_RATELIMIT_MAX`(60) & `STATIC_RATELIMIT_MAX`(600) (added @ cook, SPEC.md:95-96); wired routes.js:33,39 ← config.js:53-54

## phase order

| id | goal | depends | exit |
|----|------|---------|------|
| F1 | research: confirm 2 call sites + helper home/signature/return shape | - | signature fixed; no extra caller; later phases tightened |
| F2 | extract `resolveHistoryChannel`; both callers use it; gate `/api/history` titleMap; add tests | F1 | dup removed; scan gated; new tests green |
| F3 | ancillary: `.gitattributes` decision (optional) | F1 | attributes added or explicitly deferred w/ reason |
| F4 | final verify: code vs SPEC + CHANGELOG [Unreleased] | F2,F3 | `npm test` green; drift resolved; CHANGELOG updated |

note: SPEC §I env rows (`AUTH_RATELIMIT_MAX`,`STATIC_RATELIMIT_MAX`) + §V29 + §T26-29 handed to `/spec` at cook time (⊥ a phase)

---

## F1 research
task: T26
goal: confirm exact shared-helper contract before refactor
inputs: `server/routes.js` (:8,:54-77,:459-476), `server/database.js` (:66-136), `server/tests/core.test.js`
steps:
1. re-read `normalizeHistoryItem` (routes.js:54-77) + `migrateHistoryEntries` map body (database.js:90-133) side-by-side; enumerate every field each derives (channelId, username, channelName, channelUrl) + post-use (spread vs itemChanged/unresolvedCount)
2. confirm return shape `{channelId, username, channelName, channelUrl}` serves BOTH: routes spreads non-null onto item; migrate diffs each vs `item.*` for `itemChanged`
3. confirm helper home = `server/database.js` (co-located w/ `buildDownloadTitleMap`,`normalizeHistoryTitle`,`buildChannelUrl` import); export named `resolveHistoryChannel`
4. confirm ctx shape `{channelsById, channelsByUsername, singleChannel, titleMap}`; `titleMap` nullable → `titleMatches = titleMap?.get(normalizeHistoryTitle(item.title)) || []`
5. confirm unified precedence = migrate's (⊥ the routes gate `!channelId&&!username&&!channelName` on titleMatches) → resolves HARDEN-2 drift; verify channelName-only item ∴ now folder-matched in API too
6. grep confirm ⊥ 3rd caller of the precedence logic; confirm `normalizeHistoryTitle` stays exported (used by helper + tests)
7. confirm `needsFolderLookup = history.some(i => !i.channelId && !i.username && !i.channelName)` is the gate both callers apply before building titleMap
findings (CONFIRMED @ review-plan 2026-07-19, evidence cited):
- 2 call sites: `normalizeHistoryItem` (routes.js:54-77) + migrate map body (database.js:90-133); ⊥ 3rd caller (grep `channelsByUsername|singleChannel|resolveHistoryChannel` server/ → only these + /api/history:459); `resolveHistoryChannel` ⊥ exists yet
- return `{channelId, username, channelName, channelUrl}` serves BOTH: routes spreads truthy (routes.js:70-76); migrate diffs vs `item.*` → itemChanged/unresolvedCount (database.js:103-133)
- home = `server/database.js` (co-located `buildDownloadTitleMap`:32, `normalizeHistoryTitle`:25; `buildChannelUrl` imported :4)
- ctx `{channelsById, channelsByUsername, singleChannel, titleMap}`; titleMap nullable → `titleMatches = titleMap?.get(normalizeHistoryTitle(item.title)) || []`
- unified precedence = migrate ungated (database.js:91-96); routes currently gates titleMatches (routes.js:55-58) = HARDEN-2 drift → unify to ungated; channelName-only item ∴ folder-matched in API too, but only when ∃ coexisting bare item (needsFolderLookup TRUE) → matches migrate
- `buildChannelUrl(channelId, username)` = username→@handle | channelId→/channel/ | null (utils.js:23-27); `buildChannelUrl(null,null)=null` ∴ channelUrl byte-identical both callers
- `normalizeHistoryTitle` stays exported (buildDownloadTitleMap:52 + helper use it)
- needsFolderLookup identical both callers: `history.some(i => !i.channelId && !i.username && !i.channelName)` (database.js:81-83)
- oracle valid: `npm test` = `node --test server/tests/**/*.test.js` (package.json:20); core.test.js = 4 tests, covers migrate (:67-97) → post-F2 ≥5; `checkUpdates` exported scheduler.js:288 (import smoke)
verify: signature + home + return shape + ctx logged; no blocking unknown
exit: contract fixed (above); F2 steps adjusted if reality differs
next: F2
note: review-plan resolved all F1 confirmations w/ evidence → F1 = REMOVAL CANDIDATE on next `/cook` (workonplan may proceed direct to F2 using findings above)

---

## F2 extract shared helper + gate + tests
task: T27
goal: single-source enrichment precedence; `/api/history` scans folders only when needed
inputs: F1 findings, `server/database.js`, `server/routes.js`, `server/tests/core.test.js`
steps:
1. `database.js`: add `export function resolveHistoryChannel(item, { channelsById, channelsByUsername, singleChannel, titleMap })` → returns `{channelId, username, channelName, channelUrl}`; body = migrate precedence (titleMatches ungated within built titleMap; `titleMatches.length === 1` wins over singleChannel; `channelUrl = item.channelUrl || buildChannelUrl(channelId, username)`)
2. `database.js:migrateHistoryEntries`: replace inline `matchedChannel`+field derivation (:91-101) w/ `const { channelId, username, channelName, channelUrl } = resolveHistoryChannel(item, { channelsById, channelsByUsername, singleChannel, titleMap })`; keep existing `itemChanged`/`unresolvedCount` logic + `needsFolderLookup` gate unchanged
3. `routes.js`: import `resolveHistoryChannel` from `./database.js`; drop BOTH now-orphaned imports — `normalizeHistoryTitle` (from `./database.js`) & `buildChannelUrl` (from `./utils.js`); each used ONLY in `normalizeHistoryItem` (verified routes.js:57,68), helper owns both post-refactor; ⊥ eslint in devDeps & `node --check` ⊥ catches unused imports → drop explicitly here. keep `buildDownloadTitleMap`; keep `isValidYouTubeUrl`+`sanitize` in utils import (`sanitize` already-unused pre-existing → ⊥ touch = out of scope)
4. `routes.js:normalizeHistoryItem`: reduce to build ctx + call `resolveHistoryChannel`; spread `{...item, ...(channelId&&{channelId}), ...(username&&{username}), ...(channelName&&{channelName}), ...(channelUrl&&{channelUrl})}`
5. `routes.js:/api/history`: add `const needsFolderLookup = (db.data.history||[]).some(i => !i.channelId && !i.username && !i.channelName); const titleMap = needsFolderLookup ? buildDownloadTitleMap(channels) : null;` → replaces unconditional :469
6. `server/tests/core.test.js`: add `resolveHistoryChannel` unit test → cases: channelId-direct, username, folder-title single-match, channelName-only+folder-match (proves HARDEN-2 fix: now enriches), no-match+singleChannel, no-match+multi-channel→null; assert migrate & helper agree on same fixture
7. run `npm test`; `node --check` server/*.js; import smoke routes.js+scheduler.js
verify: `resolveHistoryChannel` ∈ database.js only; routes.js + migrate both call it; `/api/history` builds titleMap iff `needsFolderLookup`; `npm test` green (≥5 tests); `/api/history` shape unchanged for populated items; `buildChannelUrl`+`normalizeHistoryTitle` ⊥ imported in routes.js post-refactor (grep clean); `git diff` = only intended hunks, ⊥ EOL-only churn on `database.js`/`routes.js`
watchout: `database.js`+`routes.js` = `i/mixed w/mixed` EOL → ! targeted Edits (⊥ full-file rewrite) so untouched lines keep bytes; review `git diff --stat` + hunks for spurious CRLF↔LF flips
exit: dup eliminated; scan gated; tests green; server loads clean; diff focused
next: F3

---

## F3 ancillary: line-ending normalization (optional)
task: T28
goal: stop future CRLF↔LF diff churn w/o scope-creep renormalize commit
inputs: repo root, `git ls-files --eol server/`
verified state (@ 2026-07-19): ⊥ uniform CRLF — 4 pure-CRLF + 5 `i/mixed w/mixed` (`database.js`,`downloader.js`,`routes.js`,`scheduler.js`,`utils.js`) + `core.test.js` LF ∴ option B renormalize = LARGE mixed-file diff (higher churn than a clean-CRLF repo)
steps:
1. re-inspect `git ls-files --eol` on server/ → confirm mixed working-tree vs index state (expect 5 mixed per above)
2. DECISION (record in HANDOFF): add `.gitattributes` `* text=auto eol=lf`
   - option A (default, focused): add `.gitattributes` only; ⊥ mass `git add --renormalize` this cycle → normalizes per-file on next touch; ⊥ giant churn commit
   - option B: add + `git add --renormalize .` → one-time full LF normalize (large diff, amplified by 5 mixed files; only if user oks)
3. if A: write `.gitattributes`; confirm ⊥ unintended working-tree churn (`git status` clean beyond the new file)
4. ⊥ touch server logic here (file set ⊥ intersect F2)
verify: `.gitattributes` present w/ `eol=lf`; `git status` shows only intended change; decision + reason in HANDOFF
exit: attributes added (option A) or explicitly deferred w/ reason
next: F4

---

## F4 final verify
task: T29
goal: prove code matches SPEC + PLAN; no drift; CHANGELOG current
inputs: SPEC.md (§I,§V29,§T26-29), PLAN.md, all touched files, test results
steps:
1. re-read §V29 + §I env rows; classify HOLD | VIOLATE | UNVERIFIABLE w/ file evidence
2. grep confirm `resolveHistoryChannel` single definition (database.js); 2 callers (routes.js normalizeHistoryItem + database.js migrate)
3. confirm `/api/history` titleMap gated by `needsFolderLookup`; ⊥ unconditional `buildDownloadTitleMap`
4. confirm channelName-only item enrichment now identical between API + migrate (helper single-source)
5. run `npm test` → green; `node --check` touched; import smoke routes.js+scheduler.js
6. diff-review touched hunks: logic correctness, ⊥ leftover dead code (unused imports), ⊥ complexity added
7. update `CHANGELOG.md` `## [Unreleased]` w/ enrichment unification + folder-scan gating (+ `.gitattributes` if F3 option A)
8. commit (single summary, ⊥ Claude trailer)
verify: §V29 HOLD; tests green; CHANGELOG has entry; no console errors on import; no drift
exit: clean commit; cycle done → `/garnish`
next: ∅
