# HANDOFF 2026-07-18

branch main | last commit 4802e70 docs(contributing): accurate guide with devcontainer onboarding | tests green
baseline green | oracle `npm.cmd test` + `npm.cmd run build`
uncommitted: none

## done this session
F7: release.sh hardened (strict mode, dry-run, guards, test gate, push by name) → 8148bfa
F8: devcontainer rebuilt (base image, node_modules volume, ports, postCreate, extensions) → 392c261
F9: CONTRIBUTING.md accurate + devcontainer onboarding; SPEC B3 env-table drift fixed → 4802e70

## in progress (exact stop point)
F9 x: ∀ referenced commands/ports verified vs repo | NEXT STEP: F10 — edit `.github/workflows/cleanup-ghcr.yml` (package-name `iclib`→`archivedv`, simplify `if`) + `.github/dependabot.yml` (open-pull-requests-limit 0 ∀, strip reviewers/labels/commit-message)
mid-edit files: -

## next
F10 | preconditions: none | then F5 final gate (needs F4,F6,F7,F8,F9,F10 — all but F10 done)

## deviations & decisions
F9: plan step 5 stale — `npm test` exists since F4 → documented instead of removed (PLAN.md updated: y)
F9: found §I drift DATA_DIR/DOWNLOAD_DIR ⊥ env vars → B3 logged, §I corrected, TRUST_PROXY row added
F8: extension id `usernamehw.errorlens` (plan had `usernamehm`); Dockerfile pre-chowns /app for node volume (PLAN.md updated: y)
user decided: -

## watchouts
- PowerShell `npm` shim blocked by execution policy → use `npm.cmd`
- release.sh dirty-tree guard fires on any uncommitted file → commit before even `--dry-run`
- F10 note: repo owner ! manually disable "Dependabot security updates" in GitHub Settings (⊥ YAML-controllable)
- ⊥ push or tag without explicit user ask

## final verification
item|status|evidence|decision
T22|HOLD|scratch-clone runs: dry-run correct, guards die; `bash -n` clean|SPEC
T23|HOLD|`docker build` exit 0; volume write-ok as node; valid JSON|SPEC
T24|HOLD|grep: ⊥ stale refs (start.bat/VERSIONING/husky/format/exec app); scripts+ports match repo|SPEC
