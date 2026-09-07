# AGENTS.md

## AI File Purpose
- `AGENTS.md` = repo work rules.
- `SPEC.md` = single system truth, durable & mutable. Read before any change. only for durable change. ⊥ one-time fixes; high bar to add.
- `PLAN.md` + `HANDOFF.md` = short-lived cycle files. `PLAN.md` = next phase plan & owns task tracking (§T). `HANDOFF.md` = session progress tracking.
- `BACKLOG.md` = optional, free style pending prep inputs and notes. only ingested by `/prep`.

## Skills
1. `/setup` → bootstrap guidance + minimal durable files
2. `/prep` → iterative PLAN.md + HANDOFF.md + SPEC.md handoff
3. `/review-plan` → research/refute plan → GO/NO-GO
4. `/cook` → execute all remaining phases in order → verify → commit → handoff after each phase. Optional phase arg → target one phase. Single main agent.
5. `/cater` → adapt per ready phase: direct via loaded `cook` when delegation lacks material benefit | sub-agents when parallelism, context isolation, or specialist capability pays; before dispatch show scope, agent type, model, effort, rationale. Top-level 4 | 5 exclusive; one phase ⊥ direct + delegated.
6. `/garnish` → SPEC.md cleanup → blank PLAN.md + HANDOFF.md to template
7. `/review-code` → baseline code sweep → prep for accepted, authorized follow-up work

Default order above; authorized retained-cycle review may precede garnish: `/review-code` against an explicit branch/ref uses plan/baton context → preserve findings, baseline and task evidence → `/garnish` only after valid completion → `/prep` for accepted actionable work. Failed closure preserves old cycle; active execution → authorized prep queues findings. Plain review ⊥ authorize cleanup/planning; no actionable work ⊥ empty cycle.

Standalone `/review-vibe` → current-codebase review + direct evidenced fixes without requiring baseline or plan. Preserve active task ownership and unrelated edits; durable spec corrections via `encode-docs`.

support: `/handoff` session baton | `/encode-docs` sole mutator of `SPEC.md`, `PLAN.md`, and `HANDOFF.md` | `encode-header` header template | `/encode-agent` bounded sub-agent prompt | `/encode-commit` commit summary | `/encode-pr` PR review comments

## Project Scripts:

- `./start.sh` installs deps, builds, creates data/download dirs, runs dev servers.
- `release.sh` = one-command release. Bump → changelog → commit → tag → push.

## Encoding Symbols

Use symbols below as short, exact operators. Preserve paths, code, IDs, URLs, numbers, regex, errors verbatim.

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

Tables use `|`; escape literal `\|`. SPEC `§C`/`§I`/`§R`/`§V` tables carry a GFM delimiter row (`|---|---|`, one cell per column) under the header. `§T` status: `x` done, `~` wip, `.` todo.

## End of Chat Checklist
- Run required repository checks; report exact failures or unavailable checks.
- Update `CHANGELOG.md` `## [Unreleased]` ∀ feature/fix.
- Follow repository commit policy: commit directly as a single summary commit without an AI co-author trailer; stage only owned work. ⊥ push | tag without explicit ask.
