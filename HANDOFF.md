# HANDOFF

## state
branch: main | head: 3cf2486 | tree: clean (SPEC.md, PLAN.md, HANDOFF.md updated)
next phase: F1 (or F7 — independent of F1-F6 chain)
plan: PLAN.md F1→F2→F3→F4→F6→F7→F5 defined; F7 ⊥ depends F1-F6 (independent, can run anytime)
SPEC.md: §V V1-V24, §T T1-T22, §B B1-B2

## why we stopped
cook run: release.sh audit complete. F7 added to PLAN.md; V22-V24 + T22 added to SPEC.md.
⊥ code changed yet.

## what was done this session
- SPEC.md: §V V22-V24 added (release.sh invariants); §T T22 added (F7 task)
- PLAN.md: F7 phase appended (fix release.sh); phase order table updated (F5 now depends F4,F6,F7)
- HANDOFF.md: refreshed

## F7 findings summary (research done)
BUG-1: `set -e` only → missing `-u` (unbound vars) + `-o pipefail` (pipeline fail)
BUG-2: `echo -e` w/ `'\033[...'` → not portable; `$'\033[...'` + plain echo = correct
BUG-3: uncommitted changes: soft warning w/ override → hard stop required (tag must match committed state)
BUG-4: CHANGELOG awk inserts empty template inside [Unreleased]; content falls under new version (accidentally works) but pollutes [Unreleased] with duplicate headers → use reference approach
BUG-5: ⊥ empty-changelog guard → release w/ only `- ` placeholders allowed
BUG-6: ⊥ tag existence pre-check → cryptic error at `git tag`
BUG-7: `git push --tags` → pushes ALL local tags; must push new tag by name
BUG-8: `read -p` ⊥ `-r` → backslash mangling in prompts
IMP-1: add `--dry-run/-n` flag (show plan, touch nothing)
IMP-2: add `node` availability check in preflight
IMP-3: add `npm test` step before file mutations (§V.22)
IMP-4: show release notes preview before confirmation
IMP-5: add CHANGELOG link-definition update (Unreleased compare URL + new release URL)
IMP-6: add mirror-gates before git add (grep changelog section + node version confirm)
KEEP: `gh` hard dep (workflow's `publish-release` job does `gh release edit --draft=false`; draft must exist)
KEEP: draft release creation (workflow publishes it)

## next session start
1. read SPEC.md §V, §T; read PLAN.md
2. F7 (independent): rewrite release.sh per 16 steps in F7 section
3. verify: `./release.sh --dry-run` + `./release.sh --dry-run --major` work correctly
4. then resume F1→F2→F3→F4→F6→F5 chain for server code fixes

## watchouts
- ⊥ push during any phase; user pushes explicitly
- F7 step 11 (CHANGELOG awk): [Unreleased] currently has empty template (`- ` placeholders); after fix, those placeholders naturally land under new version heading → guard in step 7 must filter them out to prevent empty-release
- `extract_changelog` function also needs review: must extract content between NEW version heading and previous version heading (not from [Unreleased])
- routes.js imports from config.js already confirmed (line 19: `import { YTDLP_COOKIES_PATH, DOWNLOAD_DIR } from "./config.js"`)
- F4 test runner choice: prefer `node:test` (zero deps) unless vitest already present (it is NOT in package.json dependencies)
- F6 fix sites: `downloader.js:addScheduledStream` entry object (add `dir: info.dir`), `downloader.js:~576` call site (add `dir` to info), `scheduler.js:processScheduledStreams` upsertRetryJob call (add `dir: stream.dir`)
- after F5 commit: invoke /garnish to purge PLAN.md + HANDOFF.md
