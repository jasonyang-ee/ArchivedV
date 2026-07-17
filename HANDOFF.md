# HANDOFF

## state
branch: main | head: 3cf2486 | tree: clean (SPEC.md, PLAN.md, HANDOFF.md updated)
next phase: F1 (or F7/F8/F9/F10 — all four independent of F1-F6 chain)
plan: PLAN.md F1→F2→F3→F4→F6→F7→F8→F9→F10→F5 defined; F7+F8+F9+F10 ⊥ depend on F1-F6
SPEC.md: §V V1-V28, §T T1-T25, §B B1-B2

## why we stopped
cook run 3: CI/CD audit (cleanup-ghcr + dependabot) complete. F10 added to PLAN.md; V27-V28 + T25 added to SPEC.md.
⊥ code changed yet.

## what was done this session (cumulative)
- SPEC.md: §V V22-V28 added; §T T22-T25 added
- PLAN.md: F7 (release.sh), F8 (devcontainer), F9 (CONTRIBUTING.md), F10 (CI/CD) appended; F5 depends now F4,F6,F7,F8,F9,F10
- HANDOFF.md: refreshed

## F10 findings summary (research done)
CRITICAL: `cleanup-ghcr.yml` `package-name: iclib` → wrong; GHCR image = `archivedv`; cleanup ⊥ deleted anything since creation
IMP-1: `if` condition checks `event == 'push'` in addition to `conclusion`; simplify to conclusion-only
IMP-2: dependabot `open-pull-requests-limit: 10/5/5` → opens public PRs; set to 0 ∀ ecosystems
NOTE: Check workflow pushes to DockerHub only (⊥ GHCR); cleanup trigger from Check harmless
NOTE: Dependabot security alerts (CVE scanning) ⊥ controlled by dependabot.yml; separate GitHub repo Settings feature
ACTION REQUIRED (UI only): repo owner ! Settings → Security → Code security → keep "Dependabot alerts" ON, turn "Dependabot security updates" OFF

## F8 findings summary (research done)
BUG-1: `node:24-trixie` base ⊥ devcontainer tooling → use `mcr.microsoft.com/devcontainers/javascript-node:24-bookworm`
BUG-2: workspace bind mount (`/app`) overwrites `npm ci` node_modules from image → ⊥ modules on open → fix: named volume for node_modules + postCreateCommand
BUG-3: `mounts` lists `data` + `download` separately → redundant under workspace bind → remove
BUG-4: port 5173 (Vite HMR) ⊥ forwarded → contributor browser fails → add to forwardPorts
BUG-5: `postCreateCommand` absent → manual `npm install` required
BUG-6: VS Code extensions: TS extension redundant (JS project); missing ESLint, REST Client, GitLens, ErrorLens
KEEP: `shutdownAction: stopContainer`, `workspaceMount` binding, `workspaceFolder: /app`

## F9 findings summary (research done)
BUG-1: release script path `./scripts/create-release.sh` → `./release.sh`
BUG-2: `VERSIONING.md` ref ⊥ exists → remove
BUG-3: `start.bat` ⊥ exists → remove
BUG-4: `docker-compose exec app` → container name is `archivedv`; ⊥ `app`
BUG-5: `npm run test` + `npm run format` ⊥ in package.json → remove/note
BUG-6: husky recommended but ⊥ installed → remove
BUG-7: docker-compose external port = 7000, CONTRIBUTING says 3000 → fix
IMP-1: devcontainer section absent → add as primary onboarding path
IMP-2: env vars section absent → add with defaults

## previous session findings (still current)
BLOCK-1: rate limiter hardcoded max:20/50 in routes.js; config vars dead
HARDEN-1: buildChannelUrl triplicated → extract to utils.js
HARDEN-3: parseScheduledTime misses "week" unit
HARDEN-4: normalizeHistoryItem lacks titleMap folder lookup
HARDEN-5: checkUpdates dedup uses title not videoId
B2: addScheduledStream ⊥ store dir; processScheduledStreams ⊥ forward stream.dir on promote

## next session start
1. read SPEC.md §V, §T; read PLAN.md
2. F10 (independent, fastest): fix cleanup-ghcr.yml package-name + dependabot.yml open-pull-requests-limit
3. F8 (independent): rewrite .devcontainer/ per F8 steps
4. F9 (after F8): rewrite .github/CONTRIBUTING.md per F9 steps
5. F7 (independent): rewrite release.sh per F7 steps
6. then resume F1→F2→F3→F4→F6 for server code fixes
7. F5 final verify: all phases complete

## watchouts
- ⊥ push during any phase; user pushes explicitly
- F10: dependabot.yml keep `schedule` + `directory` + `ignore` blocks; only remove PR-opening settings
- F10: security alerts (CVE scanning) ⊥ in YAML → owner must disable "Dependabot security updates" in GitHub Settings UI after F10 commit
- F8 Dockerfile: keep yt-dlp + ffmpeg install block; only change base image + remove npm ci/COPY/CMD
- F8 devcontainer.json: named volume `archivedv-node_modules` → must match exactly (Docker volume name)
- F9: `npm run dev` = concurrently server + vite; devcontainer section should show both URLs
- F7 CHANGELOG awk: guard must filter `- ` placeholder lines to avoid empty-release
- routes.js imports from config.js already confirmed (line 19: `import { YTDLP_COOKIES_PATH, DOWNLOAD_DIR } from "./config.js"`)
- F4 test runner choice: prefer `node:test` (zero deps) unless vitest already present (it is NOT in package.json dependencies)
- F6 fix sites: `downloader.js:addScheduledStream` entry object (add `dir: info.dir`), `downloader.js:~576` call site (add `dir` to info), `scheduler.js:processScheduledStreams` upsertRetryJob call (add `dir: stream.dir`)
- after F5 commit: invoke /garnish to purge PLAN.md + HANDOFF.md
