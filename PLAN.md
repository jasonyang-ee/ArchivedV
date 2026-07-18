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
| F8 | fix devcontainer (base image, node_modules, ports, extensions) | - | container opens clean; ports forward; npm install runs |
| F9 | fix CONTRIBUTING.md (accuracy + devcontainer section) | F8 | all commands accurate; devcontainer onboarding documented |
| F10 | fix cleanup-ghcr.yml (wrong package-name) + dependabot.yml (disable auto-PRs) | - | untagged GHCR images deleted; ⊥ public PRs opened |
| F5 | final verification: code vs SPEC + PLAN | F4,F6,F7,F8,F9,F10 | no drift, CHANGELOG updated |

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
findings:
- `buildChannelUrl` currently duplicated in `server/routes.js:49`, `server/database.js:21`, and `server/downloader.js:111`; no other server call sites found.
- `parseScheduledTime` defined/exported in `server/downloader.js:141` and called only by the close handler at `server/downloader.js:574`; default export exposure at `server/downloader.js:786` is not a second caller.
- `server/utils.js` uses named `export function` declarations plus a default export object; F2 should add the helper using the existing named-export style and update the default object.
- `server/routes.js` already imports config constants from `./config.js`; F2 can extend that import with the rate-limit constants.
- No test script, test directory, Vitest, or other test runner exists in `package.json`/CI; F4 should use built-in `node:test` with a new `npm test` script.
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

## F8 fix devcontainer
task: T23
goal: working devcontainer for contributors; zero manual setup after `Reopen in Container`
inputs: `.devcontainer/Dockerfile`, `.devcontainer/devcontainer.json`, `package.json`, `docker-compose.yml`
findings (research done inline):
- `node:24-trixie` base ⊥ devcontainer tooling (zsh, git extras, locale) → use `mcr.microsoft.com/devcontainers/javascript-node:24-bookworm`
- `workspaceMount` `/app` bind → overwrites `npm ci` node_modules from image → zero modules on container open
- `mounts` lists `data` + `download` separately → redundant (workspace mount already covers them)
- port 5173 (Vite) ⊥ forwarded → contributor browser hit fails on hot-reload URL
- `postCreateCommand` absent → contributor must manually `npm install` & `mkdir data download`
- VS Code extensions: missing ESLint (`dbaeumer.vscode-eslint`), REST Client (`humao.rest-client`), GitLens (`eamodio.gitlens`), Error Lens (`usernamehw.errorlens` — plan originally misspelled publisher `usernamehm`); TS extension redundant (JS-only project)
- CORRECTION (F8 exec): named node_modules volume mounts root-owned unless image pre-creates dir → Dockerfile adds `mkdir -p /app/node_modules && chown -R node:node /app` so first mount inherits `node` ownership; `remoteUser: node` can then `npm install`
steps:
1. `.devcontainer/Dockerfile`: replace `FROM node:24-trixie AS dev` → `FROM mcr.microsoft.com/devcontainers/javascript-node:24-bookworm`; remove `npm ci` + `COPY` steps (workspace mount + postCreateCommand handles deps); keep yt-dlp + ffmpeg + system dep install block; keep verify step; keep `WORKDIR /app`; remove final `COPY . .` + `CMD`
2. `.devcontainer/devcontainer.json`: remove redundant `data` + `download` entries from `mounts`; add named volume mount for node_modules: `"source=archivedv-node_modules,target=/app/node_modules,type=volume"`; add 5173 to `forwardPorts`; add `postCreateCommand`: `"npm install && mkdir -p data download"`; replace extensions list with: `esbenp.prettier-vscode`, `dbaeumer.vscode-eslint`, `humao.rest-client`, `eamodio.gitlens`, `bradlc.vscode-tailwindcss`, `usernamehw.errorlens`; add `"remoteUser": "node"`
verify: `docker build -f .devcontainer/Dockerfile .` succeeds; devcontainer.json valid JSON; ports 3000+5173 in forwardPorts
exit: ∀ V25-V26 hold; clean build, no dangling temp files
next: F9

---

## F9 fix CONTRIBUTING.md
task: T24
goal: accurate contributor guide; devcontainer as primary onboarding path
inputs: `.github/CONTRIBUTING.md`, `package.json`, `docker-compose.yml`, `release.sh`, `.devcontainer/`
findings (research done inline):
- release script path wrong: `./scripts/create-release.sh` → `./release.sh`
- `VERSIONING.md` referenced but ⊥ exists → replace with `CHANGELOG.md` + inline release info
- `start.bat` referenced but ⊥ exists → remove; `./start.sh` only
- `docker-compose exec app ...` → container name is `archivedv`; ⊥ `app`
- `npm run format` → ⊥ script in package.json → remove or note as planned
- CORRECTION (F9 exec): `npm test` EXISTS since F4 → keep/document it; only `docker-compose exec app npm run test` form was wrong (container name + no dev tests in prod image)
- husky setup recommended but ⊥ installed → remove
- external docker-compose port = 7000 (not 3000); CONTRIBUTING says 3000 → fix
- devcontainer section absent → add as primary onboarding path (zero-install)
- env vars for contributors (PUSHOVER tokens) not documented → add brief section
steps:
1. Add **Dev Container** section at top of Setup block; explain: install Docker + VS Code + Dev Containers extension → `Reopen in Container` → `npm run dev` (or auto-starts via `postStartCommand`) → frontend `http://localhost:5173`, backend `http://localhost:3000`
2. Remove `start.bat` reference; keep `./start.sh` for Linux/macOS local path
3. Fix `docker-compose` ports: external `7000` → `http://localhost:7000`; internal `3000` for API
4. Fix `docker-compose exec` container name: `app` → `archivedv`
5. Document `npm test` (exists since F4) + `npm run build` verification; drop the `docker-compose exec app npm run test` form
6. Remove `npm run format` — no format script; note Prettier used via editor integration
7. Remove husky setup block
8. Fix release script path: `./scripts/create-release.sh` → `./release.sh`; remove `VERSIONING.md` link; inline the release types table
9. Add **Environment Variables** section: list optional env vars (PUSHOVER tokens, PORT, etc.) with defaults; point to `docker-compose.yml` comments
10. Fix `ms-vscode.vscode-typescript-next` mention if any → remove (JS project)
verify: every `bash` block command exists in repo; every URL/port matches actual config; no broken file references
exit: CONTRIBUTING.md accurate end-to-end; devcontainer is first onboarding option
next: F5

---

## F10 fix CI/CD: cleanup-ghcr + dependabot
task: T25
goal: correct GHCR cleanup package name; disable dependabot auto-PRs while preserving scanning
inputs: `.github/workflows/cleanup-ghcr.yml`, `.github/dependabot.yml`, `release.yml` (for GHCR image name)
findings (research done inline):
CRITICAL: `cleanup-ghcr.yml` has `package-name: iclib` → wrong; GHCR image = `archivedv`; cleanup silently did nothing since creation
`if` condition checks `event == 'push'` unnecessarily; simplify to just `conclusion == 'success'`
Check workflow pushes to DockerHub only (⊥ GHCR) → cleanup trigger from Check is harmless but unnecessary; keep for symmetry
`dependabot.yml` `open-pull-requests-limit: 10/5/5` → opens public PRs exposing dependency drift
Setting to 0 → scan still runs; dependency graph visible in GitHub Insights → Dependency graph → Dependabot; ⊥ breaks security alerts
Security alerts (Dependabot alerts/CVE scanning) = separate GitHub repo Settings feature ⊥ controlled by this file
! repo owner must: Settings → Security → Code security → keep "Dependabot alerts" ON, turn "Dependabot security updates" OFF (auto-fix PRs) → UI change only, ⊥ YAML change possible
steps:
1. `cleanup-ghcr.yml`: fix `package-name: iclib` → `archivedv`
2. `cleanup-ghcr.yml`: simplify `if` condition: `github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success'`
3. `dependabot.yml` npm ecosystem: set `open-pull-requests-limit: 0`; remove `reviewers`, `labels`, `commit-message`, `allow` (irrelevant when no PRs)
4. `dependabot.yml` docker ecosystem: set `open-pull-requests-limit: 0`; remove `reviewers`, `labels`, `commit-message`
5. `dependabot.yml` github-actions ecosystem: set `open-pull-requests-limit: 0`; remove `reviewers`, `labels`, `commit-message`
6. keep `schedule`, `directory`, `ignore` blocks ∀ ecosystems (scan still runs on schedule)
note: repo owner ! manually disable "Dependabot security updates" in GitHub Settings → Security → Code security (cannot be done via YAML)
verify: `cleanup-ghcr.yml` package-name = `archivedv`; `dependabot.yml` ∀ ecosystems have `open-pull-requests-limit: 0`; valid YAML
exit: ∀ V27-V28 hold; no active PR-opening vectors remain
next: F5

---

## F5 final verification
task: T20
goal: confirm code matches SPEC; CHANGELOG updated; no drift
inputs: SPEC.md, PLAN.md, all changed files, test results
steps:
1. re-read §V (V1-V26) against current code; verify each holds
2. confirm §V.6 accurately reflects in-memory authSkipCache behavior
3. verify rate limit config constants wired in routes.js (grep check)
4. verify §V.21: grep `stream.dir` in scheduler.js; grep `dir: info.dir` in addScheduledStream; confirm fallback path unreachable for promoted streams
5. verify §V.22-V24: read release.sh; confirm npm test present; confirm empty guard present; confirm push pattern correct
6. verify §V.25-V26: read devcontainer.json; confirm ports 3000+5173 forwarded; confirm node_modules volume mount present; confirm postCreateCommand present
7. verify §V.27-V28: read cleanup-ghcr.yml (package-name=archivedv); read dependabot.yml (open-pull-requests-limit=0 ∀)
8. run `npm test` → green
7. run `node server/index.js` → starts without error
9. update `CHANGELOG.md` `## [Unreleased]` with all fixes from F2-F4+F6+F7+F8+F9+F10
9. commit all changes (single summary commit)
verification: SPEC §V all hold; tests green; CHANGELOG has entries; no console errors on start
exit: clean commit, all findings addressed
next: ∅ (cycle done → /garnish)
