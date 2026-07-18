# HANDOFF 2026-07-18

branch main | last commit 392c261 fix(devcontainer): usable out-of-the-box dev environment | tests green
baseline green | oracle `npm.cmd test` + `npm.cmd run build`
uncommitted: none

## done this session
F7: release.sh hardened (strict mode, dry-run, guards, test gate, push by name) → 8148bfa
F8: devcontainer rebuilt (base image, node_modules volume, ports, postCreate, extensions) → 392c261

## in progress (exact stop point)
F8 x: `docker build` green; node-user write to named volume proven in container run | NEXT STEP: F9 — rewrite `.github/CONTRIBUTING.md` per PLAN.md F9 steps 1-10 (note: F9 finding "no test script" now stale — F4 added `npm test`; document it instead of removing)
mid-edit files: -

## next
F9 (F8 done → gate met) | then F10 | F5 final gate needs F4,F6,F7,F8,F9,F10

## deviations & decisions
F8: plan extension id `usernamehm.errorlens` wrong → `usernamehw.errorlens` (PLAN.md updated: y)
F8: named volume mounts root-owned → Dockerfile pre-chowns /app to node (PLAN.md updated: y)
F7: shellcheck ⊥ installed → `bash -n` + scratch-clone behavior tests instead (PLAN.md updated: n)
user decided: -

## watchouts
- PowerShell `npm` shim blocked by execution policy → use `npm.cmd`
- release.sh dirty-tree guard fires on any uncommitted file → commit before even `--dry-run`
- F9 plan step 5 stale: `npm test` EXISTS since F4; fix step during F9, record in PLAN.md
- ⊥ push or tag without explicit user ask

## final verification
item|status|evidence|decision
T22|HOLD|scratch-clone runs: dry-run correct, guards die; `bash -n` clean|SPEC
T23|HOLD|`docker build -f .devcontainer/Dockerfile .` exit 0; volume write-ok as node; devcontainer.json valid JSON|SPEC
