# AGENTS.md

## AI File Purpose
- `AGENTS.md` = repo work rules.
- `SPEC.md` = single system truth. Read before any change. Baked format header @ top. §V invariants, §T tasks, §R sourced research.
- `PLAN.md` + `HANDOFF.md` = short-lived cycle files. `PLAN.md` = next phase plan. `HANDOFF.md` = phase handoff summary. ∀ change → update `SPEC.md` + `PLAN.md` + `HANDOFF.md`.

## Skills
1. `/prep` → bootstrap guidance + minimal durable files
2. `/cook` → iterative PLAN.md + HANDOFF.md + SPEC.md handoff
3. `/review-plan` → research/refute plan → GO/NO-GO
4. `/workonplan` → execute phase → verify → commit → handoff. Single main agent.
5. `/dispatchplan` → same phases via sub-agents, parallel when file sets ⊥ intersect. 4 | 5 exclusive per phase, ⊥ both.
6. `/garnish` → spec cleanup → purge PLAN.md + HANDOFF.md
7. `/review-code` → baseline code sweep → cook

support: `/spec` sole SPEC.md mutator | `/handoff` baton | `/caveman-encode` file encoding | `/caveman` chat brevity | `/caveman-commit` commit summary | `/caveman-pr` PR review comments

## Project Scripts:

- `./start.sh` installs deps, builds, creates data/download dirs, runs dev servers.
- `release.sh` = one-command release. Bump → changelog → commit → tag → push.

## Caveman symbols

Use symbols below as short, exact operators. Preserve paths, code, IDs, URLs,
numbers, regex, errors verbatim.

- `→` leads to | becomes | triggers
- `∴` therefore | consequence
- `∀` every | for all
- `∃` some | exists
- `!` must | required
- `?` unknown | optional
- `⊥` never | forbidden | absent
- `≠` differs | `∈` member of | `∉` not member of
- `≤` at most | `≥` at least | `&` and | `|` or
- `§` section reference, e.g. `§V.3`

Tables use `|`; escape literal `\|`. `§T` status: `x` done, `~` wip, `.` todo.
`caveman` prose drops symbols; `caveman-encode` requires them for `SPEC.md`,
`PLAN.md`, and `HANDOFF.md`.

## End of Chat Checklist
- Ensure ∀ lint + tests pass.
- Update `CHANGELOG.md` `## [Unreleased]` ∀ feature/fix.
- Update `SPEC.md` ∀ code change / new feature (flip `§T`, add `§V`).
- Refresh `HANDOFF.md` when phase/session ends.
- Commit directly (single summary commit, no Claude co-author trailer). ⊥ push | tag without explicit ask.
