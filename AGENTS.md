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

## Development Workflow

- `./start.sh` installs deps, builds, creates data/download dirs, runs dev servers.

## Project Structure

```
ArchivedV/
  server/           # Express.js backend (Node.js)
    index.js        # Entry point, composes all modules
    config.js       # Environment variables and constants
    database.js     # JSON file DB (data/db.json)
    routes.js       # Express API routes
    downloader.js   # yt-dlp process management, retry queue, watchdog
    merger.js       # ffmpeg fragment merging
    scheduler.js    # Cron jobs, RSS feed polling, retry processing
    auth.js         # Cookie auth, auth failure classification
    utils.js        # Sanitize, URL validation, file type helpers
  client/           # React 19 + Vite frontend
    src/
      App.jsx
      components/   # ChannelList, KeywordList, StatusDisplay, CookieSettings, etc.
      utils/        # api.js (HTTP client), utils.js
  doc/              # Logo and screenshot assets
```

## Server Architecture

Single-process Node.js server with these subsystems:

1. **Scheduler** (`scheduler.js`): Polls YouTube RSS feeds every 10 minutes. Matches video titles against user-defined keywords. Enqueues new matches into retry queue.
2. **Retry Queue** (`scheduler.js` + `downloader.js`): Processes due jobs every minute. Exponential backoff (2min base, 1hr max). Deduplicates and resets stale flags.
3. **Downloader** (`downloader.js`): Spawns yt-dlp subprocesses. Monitors stderr for 403 loops (stream ended) and auth failures. On completion, triggers merge and records history.
4. **Merger** (`merger.js`): Pairs video+audio fragment files by title and format ID. Merges with `ffmpeg -c copy`. Cleans up fragments after success; deletes corrupt fragments on failure.
5. **Watchdog** (`downloader.js`): Kills yt-dlp processes with no output for 2 hours. Re-enqueues as retry.
6. **Auth** (`auth.js`): Optional YouTube cookie support. Classifies yt-dlp auth errors (private, members-only, age-restricted). Caches skipped video IDs (7-day TTL).

## Key Behaviors

- **Fragment files** follow pattern `Title.f{formatId}.{ext}` (e.g., `video.f299.mp4`, `audio.f140.m4a`).
- **403 loop detection** counts total consecutive 403 errors across all fragments/streams. Threshold: 100. Treats detected loops as "stream ended" success.
- **Auth failure classification** handles both cookie-enabled (`"Video unavailable. This video is private"`) and no-cookie (`"Private video. Sign in..."`) error messages from YouTube.
- yt-dlp is called with `--no-part`, `--skip-unavailable-fragments`, `--fragment-retries 50`, `-f bestvideo+bestaudio/best`.
- On merge failure, corrupt fragments (<1KB) are auto-deleted to unblock yt-dlp re-download.

## Code Style

- ES Modules (`import/export`) throughout, `"type": "module"` in package.json.
- Server log prefix: `[Archived V]` for app messages, `[yt-dlp]` for subprocess output.
- File naming: `camelCase.js` for server modules, `PascalCase.jsx` for React components.
- Server logs: ASCII only, format `[LEVEL] [ServiceName] Message`
- Server files: `{entity}Controller.js`, `{name}Service.js`, `{entity}.js` (routes)
- Client files: `{PageName}.jsx` (pages), `{ComponentName}.jsx` (components)
- Naming: camelCase (vars/functions), PascalCase (components), snake_case (DB columns/tables)

## Project Scripts
- `./start.sh` — install deps, build client, create data/download dirs, run dev servers.
- `node server/index.js` — start server only.
- `cd client && npm run build` — build client.
- `./release.sh` — release new version.

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
