# HANDOFF 2026-07-18

branch main | last commit <F5 commit — see git log> chore: final verification pass | tests green
baseline green | oracle `npm.cmd test` (4 pass) + `npm.cmd run build` + server startup smoke
uncommitted: none

## done this session
F7: release.sh hardened → 8148bfa
F8: devcontainer rebuilt → 392c261
F9: CONTRIBUTING.md accurate; SPEC B3 logged → 4802e70
F10: cleanup-ghcr package-name archivedv + dependabot limit 0 → c404645
F5: final verification — ∀ §V grep-verified, tests+build+startup green, T20 x

## in progress (exact stop point)
∅ — plan complete. NEXT STEP: user invokes /garnish to close cycle (purge PLAN.md + HANDOFF.md)
mid-edit files: -

## next
∅ | ∀ PLAN.md phases x (T16-T25) | cycle done → /garnish

## deviations & decisions
F5: V1-V20 unchanged this cycle → spot-checked touched invariants + full test/build/startup oracle; ⊥ line-by-line re-read of untouched modules
see prior batons in git history for F7-F10 deviations
user decided: -

## watchouts
- repo owner ! manually disable "Dependabot security updates" in GitHub Settings (⊥ YAML)
- CHANGELOG [Unreleased] Added/Changed hold bare `- ` placeholders → release.sh guard strips them; harmless
- PowerShell `npm` shim blocked → `npm.cmd`; PS here-string commit msgs flaky → Bash tool
- ⊥ push or tag without explicit user ask

## final verification
item|status|evidence|decision
V-ratelimit (F2)|HOLD|routes.js:33,39 use AUTH/STATIC_RATELIMIT_MAX from config|-
V helper (F2)|HOLD|buildChannelUrl defined utils.js:23 only; 3 importers|-
V week (F2)|HOLD|downloader.js:143,153 + parseScheduledTime test|-
V2 dedup (F2)|HOLD|scheduler.js:464 videoId check|-
V6|HOLD|SPEC wording in-memory; authSkipCache in-process|-
V21|HOLD|downloader.js:182 dir: info.dir; :581 call passes dir; scheduler.js:111 dir: stream.dir|-
V22-V24|HOLD|release.sh:269 npm test gate, :228 empty guard, :328-329 push by name|-
V25-V26|HOLD|devcontainer.json:20 ports 3000+5173, :22 named volume, :26 postCreate npm install|-
V27-V28|HOLD|cleanup-ghcr.yml:28 archivedv; dependabot limit 0 ×3 ecosystems|-
T20|HOLD|npm test 4 pass; vite build ok; server starts port 3000 no errors|SPEC
