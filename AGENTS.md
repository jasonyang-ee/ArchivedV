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
- `CHANGELOG.md` maintained for the `## [Unreleased]` section. Consolidate multi-step fixes into one entry.

## Versioning

- Update CHANGELOG.md `## [Unreleased]` section for every feature or fix
