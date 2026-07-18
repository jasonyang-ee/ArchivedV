# HANDOFF 2026-07-18

branch main | last commit c404645 ci: fix GHCR cleanup target and silence dependabot PRs | tests green
baseline green | oracle `npm.cmd test` + `npm.cmd run build`
uncommitted: none

## done this session
F7: release.sh hardened → 8148bfa
F8: devcontainer rebuilt → 392c261
F9: CONTRIBUTING.md accurate; SPEC B3 logged → 4802e70
F10: cleanup-ghcr package-name archivedv + dependabot PR limit 0 → c404645

## in progress (exact stop point)
F10 x: both YAMLs valid (js-yaml); package-name matches release.yml GHCR image | NEXT STEP: F5 final verification per PLAN.md steps 1-9 (gate met: F4,F6,F7,F8,F9,F10 all x)
mid-edit files: -

## next
F5 final gate | preconditions: met | after F5 → /garnish

## deviations & decisions
F10: dependabot `ignore:` kept as comment-only null (parity with original)
F9: `npm test` documented (plan step stale); §I DATA_DIR/DOWNLOAD_DIR drift → B3
F8: `usernamehw.errorlens`; Dockerfile pre-chowns /app (PLAN.md updated: y)
user decided: -

## watchouts
- repo owner ! manually disable "Dependabot security updates" in GitHub Settings → ⊥ YAML-controllable
- PowerShell `npm` shim blocked → `npm.cmd`; PS here-string commit messages flaky → use Bash tool
- release.sh dirty-tree guard fires on any uncommitted file → commit before even `--dry-run`
- ⊥ push or tag without explicit user ask

## final verification
item|status|evidence|decision
T22|HOLD|scratch-clone runs: dry-run correct, guards die; `bash -n` clean|SPEC
T23|HOLD|`docker build` exit 0; volume write-ok as node; valid JSON|SPEC
T24|HOLD|grep: ⊥ stale refs; scripts+ports match repo|SPEC
T25|HOLD|js-yaml valid ×2; package-name=archivedv; limit 0 ∀ ecosystems|SPEC
