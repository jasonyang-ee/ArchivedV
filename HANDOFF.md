# HANDOFF 2026-07-18

branch main | last commit 8148bfa fix(release): harden release.sh guards and push flow | tests green
baseline green | oracle `npm.cmd test` + `npm.cmd run build`
uncommitted: none

## done this session
F7: release.sh hardened (strict mode, dry-run, guards, test gate, push by name) → 8148bfa

## in progress (exact stop point)
F7 x: guards proven in scratch clone (dry-run patch/major, empty-changelog die, tag-exists die, dirty-tree die) | NEXT STEP: F8 — edit `.devcontainer/Dockerfile` + `.devcontainer/devcontainer.json` per PLAN.md F8 steps 1-2
mid-edit files: -

## next
F8 | preconditions: none; then F9 (needs F8), F10, F5 final gate (needs F4,F6,F7,F8,F9,F10)

## deviations & decisions
plan verify said shellcheck-clean → shellcheck ⊥ installed on host; verified via `bash -n` + behavior tests in scratch clone (PLAN.md updated: n)
release notes source = pre-mutation `$UNRELEASED_BODY` (⊥ re-extract post-awk); equivalent + simpler
CHANGELOG has ⊥ link-def block today → script appends `[Unreleased]:` + `[vX]:` defs when absent
user decided: -

## watchouts
- PowerShell `npm` shim blocked by execution policy → use `npm.cmd`
- release.sh dirty-tree guard fires on any uncommitted file (incl. HANDOFF.md) → commit before running even `--dry-run`
- ⊥ push or tag without explicit user ask

## final verification
item|status|evidence|decision
T22|HOLD|scratch-clone runs: dry-run plan correct, guards die as specified; `bash -n` clean|SPEC
