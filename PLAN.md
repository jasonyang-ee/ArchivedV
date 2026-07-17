# PLAN

goal: fix rate-limit dead-config BLOCK + 5 HARDENs from review-code v1.6.0→HEAD

## ground rules
- ∀ phase → commit before next phase starts
- ⊥ push | tag without explicit user ask
- ∀ change → update §T in SPEC.md via `/spec`
- fixes stay focused; ⊥ refactor beyond named scope
- no new runtime deps

## existing assets
- baseline: `v1.6.0` → HEAD (`3cf2486`) reviewed, gate NO-GO
- review findings: BLOCK-1 (rate limit dead config), HARDEN 1-5
- `server/utils.js` → home for extracted `buildChannelUrl`
- `server/routes.js` imports from `./config.js` already (precedent set)
- zero unit tests today; F4 adds them

## phase order

| id | goal | depends | exit |
|----|------|---------|------|
| F1 | research: confirm callers + extraction approach | - | all impacted call sites listed, approach confirmed |
| F2 | BLOCK-1 + HARDEN-1,3,5 | F1 | rate limit uses config; helper extracted; week unit works; title→videoId |
| F3 | HARDEN-4 + SPEC §V.6 amend | F2 | history enrichment consistent; V6 corrected |
| F4 | unit tests for parseScheduledTime, computeNextAttempt, classifyYtDlpAuthFailure, migrateHistoryEntries | F3 | all new tests green |
| F5 | final verification: code vs SPEC + PLAN | F4 | no drift, CHANGELOG updated |

---

## F1 research
task: T16
goal: confirm all callers of `buildChannelUrl` + `parseScheduledTime`, check utils.js conventions
inputs: `server/utils.js`, `server/routes.js`, `server/database.js`, `server/downloader.js`, `server/scheduler.js`
steps:
1. grep for `buildChannelUrl` across all server files → list every call site
2. grep for `parseScheduledTime` → confirm only one caller (downloader.js close handler)
3. confirm `utils.js` uses named `export function` style (not default object)
4. confirm `routes.js` already imports from `./config.js` (pattern exists)
5. confirm no test infra exists yet; note chosen test runner (vitest or node:test)
6. record findings; update later phase steps if call sites differ from expected
verification: findings logged; F2 steps adjusted if needed
exit: confirmed call site map, no blocking unknown
next: F2

---

## F2 BLOCK-1 + HARDEN-1,3,5
task: T17
goal: fix rate-limit dead config; extract buildChannelUrl; add week unit; use videoId dedup
inputs: F1 findings, `server/routes.js`, `server/config.js`, `server/utils.js`, `server/downloader.js`, `server/scheduler.js`
steps:
1. **BLOCK-1** `routes.js`: add `AUTH_RATELIMIT_MAX`, `STATIC_RATELIMIT_MAX` to imports from `./config.js`; replace hardcoded `max:20` → `max: AUTH_RATELIMIT_MAX`; `max:50` → `max: STATIC_RATELIMIT_MAX`
2. **HARDEN-1** `utils.js`: add `export function buildChannelUrl(channelId, username)` (same logic as existing 3 copies)
3. **HARDEN-1** `routes.js`: import `buildChannelUrl` from `./utils.js`; remove local definition
4. **HARDEN-1** `database.js`: import `buildChannelUrl` from `./utils.js`; remove local definition
5. **HARDEN-1** `downloader.js`: import `buildChannelUrl` from `./utils.js`; remove local definition
6. **HARDEN-3** `downloader.js:parseScheduledTime`: extend regex alternation to `(minute|hour|day|week)s?`; add `else if (unit === 'week') ms = amount * 7 * 24 * 60 * 60 * 1000`
7. **HARDEN-5** `scheduler.js:checkUpdates` active-download loop: add `&& download.downloadInfo.videoId === videoId` to dedup condition
8. run `node server/index.js` start smoke check; confirm no import errors
verification: grep confirms `AUTH_RATELIMIT_MAX`, `STATIC_RATELIMIT_MAX` used in routes.js; `buildChannelUrl` ∈ utils.js only; week test: `parseScheduledTime('This live event will begin in 1 week.')` returns ISO ≈ now+7d; scheduler diff shows videoId check
exit: all 4 targeted issues fixed, server starts cleanly
next: F3

---

## F3 HARDEN-4 + SPEC §V.6 amend
task: T18
goal: make GET /api/history enrichment consistent with migration; correct V6
inputs: `server/routes.js`, `server/database.js`, SPEC.md
steps:
1. read `normalizeHistoryItem` in routes.js and `migrateHistoryEntries` in database.js side-by-side
2. export `buildDownloadTitleMap` + `normalizeHistoryTitle` from `database.js` (or move to utils.js)
3. update `GET /api/history` handler in `routes.js`: when item has no channelId/username/channelName, build titleMap (same pattern as migration) and try folder-based lookup before falling through
4. invoke `/spec amend §V.6`: change "even across restarts (persisted)" → "in-memory, cleared on restart; survives within process lifetime"
5. smoke test: confirm `GET /api/history` returns consistent channel metadata for a test entry
verification: history route returns same enrichment as migration for same data; §V.6 no longer says "persisted"
exit: HARDEN-4 resolved; V6 accurate
next: F4

---

## F4 unit tests
task: T19
goal: add focused unit tests for 4 core pure functions
inputs: `server/downloader.js` (parseScheduledTime, computeNextAttempt), `server/auth.js` (classifyYtDlpAuthFailure), `server/database.js` (migrateHistoryEntries)
steps:
1. choose test runner: `node:test` (built-in, zero deps) unless project already has vitest
2. create `server/tests/` dir; add `utils.test.js` (or equivalent)
3. test `parseScheduledTime`: minute, hour, day, week, no-match → null, empty string → null
4. test `computeNextAttempt`: attempts 0..12 → verify capped at RETRY_MAX_DELAY_MS
5. test `classifyYtDlpAuthFailure`: private_video patterns (both cookie/no-cookie), members_only, age_restricted, no-match → null
6. test `migrateHistoryEntries`: item with channelId, item with username, item with matching title (single channel), item with no match
7. add `"test": "node --test server/tests/**"` to package.json scripts
8. run tests: all pass
verification: `npm test` exits 0; output shows 4 test suites passing
exit: test suite green; package.json has test script
next: F5

---

## F5 final verification
task: T20
goal: confirm code matches SPEC; CHANGELOG updated; no drift
inputs: SPEC.md, PLAN.md, all changed files, test results
steps:
1. re-read §V (V1-V20) against current code; verify each holds
2. confirm §V.6 accurately reflects in-memory authSkipCache behavior
3. verify rate limit config constants wired in routes.js (grep check)
4. run `npm test` → green
5. run `node server/index.js` → starts without error
6. update `CHANGELOG.md` `## [Unreleased]` with all fixes from F2-F4
7. commit all changes (single summary commit)
verification: SPEC §V all hold; tests green; CHANGELOG has entries; no console errors on start
exit: clean commit, all findings addressed
next: ∅ (cycle done → /garnish)
