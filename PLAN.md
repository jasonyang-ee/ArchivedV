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
| F6 | fix dir propagation in scheduledStream → retryQueue path | F4 | ∀ promoted stream → dir has date prefix |
| F7 | fix release.sh bugs + best-practice alignment | - | ∀ V22-V24 hold; dry-run correct |
| F5 | final verification: code vs SPEC + PLAN | F4,F6,F7 | no drift, CHANGELOG updated |

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

## F6 fix scheduled-stream dir propagation
task: T21
goal: ∀ promoted scheduledStream → retryQueue job dir includes date prefix
inputs: `server/downloader.js` (`addScheduledStream`, call at ~L576), `server/scheduler.js` (`processScheduledStreams`), SPEC.md §V.21
findings (pre-researched):
- `addScheduledStream(info, scheduledFor)` ⊥ accepts/stores `dir`; entry object omits it
- caller at `downloader.js:576` ⊥ passes `dir` (in-scope at that point)
- `processScheduledStreams` calls `upsertRetryJob({...stream})` ⊥ `dir` field → job.dir=undefined → fallback path ⊥ date prefix
steps:
1. `downloader.js:addScheduledStream`: add `dir: info.dir` to the `entry` object literal
2. `downloader.js:576` `addScheduledStream` call: add `dir` to the info object passed (variable `dir` is in scope)
3. `scheduler.js:processScheduledStreams` `upsertRetryJob` call: add `dir: stream.dir` to the job object
4. smoke-test: `node server/index.js` starts without error
verification: grep `stream.dir` in scheduler.js; grep `dir: info.dir` in downloader.js addScheduledStream; grep `dir` in addScheduledStream call site
exit: all 3 sites patched; server starts cleanly
next: F5

---

## F7 fix release.sh
task: T22
goal: fix bugs + align with best-practice reference
inputs: `release.sh`, `.github/workflows/release.yml`, reference example (user-provided)
findings (research done inline):
- `set -e` only → missing `-u`, `-o pipefail`
- `echo -e` + `'\033[...'` → not portable; use `$'\033[...'` (no -e needed)
- uncommitted changes: soft warning w/ override → hard stop (tag must match committed tree)
- CHANGELOG awk: inserts empty template inside [Unreleased]; existing content falls under new version (works) but leaves duplicate template headers → replace with reference approach (leave [Unreleased] heading only, content flows naturally)
- no empty-changelog guard → can release with only `- ` placeholders → guard required
- no tag existence check → cryptic `git tag` error → pre-check required
- no `--dry-run` flag → can't preview plan
- no tests step → release without verification
- `git push --tags` → pushes ALL tags → push only new tag by name
- `read -p` without `-r` → backslash mangling
- `CHANGELOG.md.bak` temp file → fragile; use `CHANGELOG.md.tmp` + mv pattern only
- `gh` hard dep required (workflow's publish-release job does `gh release edit --draft=false`; release must exist as draft)
steps:
1. `set -e` → `set -euo pipefail`
2. rewrite color vars: `RED=$'\033[0;31m'` etc. (no echo -e needed; use plain `echo`)
3. add `--dry-run/-n` flag parsing; when true → print plan, exit 0 ⊥ touch anything
4. preflight: add `command -v node >/dev/null || die "node not installed"`
5. uncommitted changes check: remove override prompt → `die "uncommitted changes — commit or stash them first"`
6. add tag existence pre-check: `git rev-parse -q --verify "refs/tags/${TAG}" && die "tag ${TAG} already exists"`
7. empty changelog guard: extract [Unreleased] non-header non-blank non-placeholder lines; `[ -z ... ] && die "CHANGELOG.md [Unreleased] section is empty"`
8. show release notes preview (`$UNRELEASED_BODY`) before confirmation prompt
9. add `--yes` handling to dry-run output message
10. add `npm test` step (before file mutations); on fail → `die "tests red — not releasing"`
11. fix CHANGELOG awk: reference approach — `## [Unreleased]` stays, new version heading inserted after it; existing content naturally follows; ⊥ inject template
12. add CHANGELOG link-def update: replace `[Unreleased]:` line with compare URL; append `[NEW_VERSION]:` release URL
13. add mirror-gate verify (grep for new version in CHANGELOG + node version check) before `git add`
14. fix `read -r -p` ∀ prompts
15. `git push --tags` → `git push -q origin "$CURRENT_BRANCH"` then `git push -q origin "$TAG"` (separate)
16. dry-run exit path: show `Would: test → bump ${NEW_VERSION} → changelog → commit → tag ${TAG} → push`
verify: `./release.sh --dry-run` shows correct plan; `./release.sh --dry-run --major` shows correct major bump; CHANGELOG guard blocks empty section; hard stop on dirty tree
exit: ∀ V22-V24 hold; script shellcheck-clean on critical paths
next: F5

---

## F5 final verification
task: T20
goal: confirm code matches SPEC; CHANGELOG updated; no drift
inputs: SPEC.md, PLAN.md, all changed files, test results
steps:
1. re-read §V (V1-V24) against current code; verify each holds
2. confirm §V.6 accurately reflects in-memory authSkipCache behavior
3. verify rate limit config constants wired in routes.js (grep check)
4. verify §V.21: grep `stream.dir` in scheduler.js; grep `dir: info.dir` in addScheduledStream; confirm fallback path unreachable for promoted streams
5. verify §V.22-V24: read release.sh; confirm npm test present; confirm empty guard present; confirm push pattern correct
6. run `npm test` → green
7. run `node server/index.js` → starts without error
8. update `CHANGELOG.md` `## [Unreleased]` with all fixes from F2-F4+F6+F7
9. commit all changes (single summary commit)
verification: SPEC §V all hold; tests green; CHANGELOG has entries; no console errors on start
exit: clean commit, all findings addressed
next: ∅ (cycle done → /garnish)
