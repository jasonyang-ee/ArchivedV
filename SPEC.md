<!-- SPEC FORMAT (baked by /spec — keep; makes this file self-describing)
Sections, fixed order: §G goal | §C constraints | §I interfaces | §R research? | §V invariants | §T tasks | §B bugs
Address §<S>.<n> — §V.2 = invariants item 2. Commits/PRs cite by §.
Encoding caveman: drop articles/filler/aux verbs. Fragments fine. Short synonyms (fix > implement).
Preserve verbatim: code, paths, identifiers, URLs, numbers, error strings, SQL, regex.
Symbols: → leads to | ∴ therefore | ∀ every | ∃ some | ! must | ? may/unknown | ⊥ never | ≠ | ∈ | ∉ | ≤ | ≥ | & and | § section
Tables (§R,§T,§B): pipe-delimited. ids monotonic, never reused. Escape literal \| . Empty cell = -
§T status: x done | ~ wip | . todo
One file rule: >500 lines → compact §B oldest-first, ⊥ split into more files.
Full rules: /spec skill (§FORMAT). Cutting a word that loses a fact ⊥ allowed.
-->

# SPEC

## §G GOAL
Monitor YouTube channels via RSS; auto-download matching live streams & videos using yt-dlp; merge video+audio fragments with ffmpeg; serve React UI for config & status.

## §C CONSTRAINTS
- Node.js (ES Modules, `"type": "module"`). ⊥ CommonJS.
- React 19 + Vite frontend. Tailwind CSS.
- JSON flat-file DB (`data/db.json`). ⊥ SQL/external DB.
- yt-dlp + ffmpeg required on host. Invoked as subprocesses.
- Single-process server. ⊥ multi-worker. ⊥ message queues.
- YouTube RSS only (`https://www.youtube.com/feeds/videos.xml?channel_id=`).
- yt-dlp flags: `--no-part --skip-unavailable-fragments --fragment-retries 50 -f bestvideo+bestaudio/best`.
- Auth via Netscape-format cookies file only. ⊥ OAuth.
- Download dir: `./download/{username}/{sanitized_date_title}/`.
- Server port default `3000`. Configurable via env.
- File naming: `camelCase.js` server modules, `PascalCase.jsx` React components.
- Naming: `camelCase` vars/functions, `PascalCase` components, `snake_case` DB columns.
- Server module files: `{entity}Controller.js`, `{name}Service.js`, `{entity}.js` (routes).
- Client files: `{PageName}.jsx` (pages), `{ComponentName}.jsx` (components).

## §I INTERFACES

### API (Express, prefix `/api`)
- `GET  /config` → `{channels[], keywords[], ignoreKeywords[], dateFormat}`
- `POST /channels` body `{link}` → `{id, link, username, channelName}`; resolves `@handle` via YouTube `/about` page
- `DELETE /channels/:id` → `{success:true}`
- `POST /keywords` body `{keyword}` → `{success:true}`; deduped
- `DELETE /keywords/:keyword` → `{success:true}`
- `POST /ignore-keywords` body `{keyword}` → `{success:true}`; deduped
- `DELETE /ignore-keywords/:keyword` → `{success:true}`
- `POST /date-format` body `{dateFormat}` → validates `YYYY-MM-DD` | `MM-DD-YYYY`
- `GET  /status` → `{lastRun, downloadedCount, currentDownloads[], retryQueue, scheduledStreams[]}`
- `DELETE /downloads/:downloadId` → kill yt-dlp, add title to ignoreKeywords, `{success:true}`
- `GET  /history` → array `{title, time, videoId, channelId, username, channelName, channelUrl}`
- `DELETE /history` → `{success:true}`
- `DELETE /scheduled-streams/:videoId` → `{success:true}` | 404
- `POST /refresh` → immediate `checkUpdates()`, returns current status
- `GET  /auth` → `{useCookies, cookiesFilePresent, cookiesPathHint}`
- `POST /auth` body `{useCookies:boolean}` → clears authSkipCache when enabling
- `PUT  /auth/cookies` body `{cookiesText}` → validates <5MB, writes, chmod 0o600
- `DELETE /auth/cookies` → delete file, set useCookies=false
- `GET  /ytdlp-flags` → `{ytdlpFlags}`
- `POST /ytdlp-flags` body `{ytdlpFlags}` → validate against `--exec`, `--config-location`, `--batch-file`

### DB schema (`data/db.json`)
```
channels[]:   {id, link, username, channelName}
keywords[]:   string[]
ignoreKeywords[]: string[]
history[]:    {title, time, videoId, channelId, username, channelName, channelUrl, note?}
currentDownloads[]: {id, channel, videoId, title, username, channelName, startTime, dir}
retryQueue[]: {key, channelId, videoId, title, username, channelName, videoLink, dir, attempts, lastError, lastAttemptAt, nextAttemptAt, inProgress, createdAt, updatedAt}
scheduledStreams[]: {key, channelId, videoId, title, username, channelName, videoLink, scheduledFor, detectedAt, lastCheckedAt}
dateFormat: string
auth: {useCookies: boolean}
ytdlpFlags: string
```

### Config env vars (`server/config.js`)
| var | default | purpose |
|-----|---------|---------|
| `YTDLP_COOKIES_PATH` | `data/youtube_cookies.txt` | Netscape cookies path |
| `DATA_DIR` | `./data` | DB directory |
| `DOWNLOAD_DIR` | `./download` | Download root |
| `DB_PATH` | `data/db.json` | DB file |
| `MAX_AUTH_FAILURE_ATTEMPTS` | `3` | Attempts before skipping auth video |
| `MAX_CONCURRENT_DOWNLOADS` | `0` | 0 = unlimited |
| `AUTH_SKIP_TTL_MS` | `604800000` | 7 days |
| `AUTH_SKIP_CACHE_MAX` | `2000` | In-memory FIFO cap |
| `FEED_FETCH_RETRIES` | `3` | RSS retries |
| `FEED_FETCH_BACKOFF_MS` | `1000` | Initial RSS backoff |
| `FEED_404_LOG_INTERVAL_MS` | `3600000` | 1hr 404 log suppression |
| `FEED_CHANNEL_DELAY_MS` | `1500` | Delay between channel fetches |
| `FEED_BATCH_SIZE` | `5` | Channels per batch |
| `FEED_BATCH_PAUSE_MS` | `2000` | Extra pause between batches |
| `SCHEDULED_STREAM_LEAD_TIME_MS` | `300000` | 5min promote-to-queue lead |
| `RETRY_BASE_DELAY_MS` | `120000` | 2min base retry delay |
| `RETRY_MAX_DELAY_MS` | `3600000` | 1hr retry cap |
| `DOWNLOAD_WATCHDOG_INTERVAL_MS` | `60000` | Watchdog check interval |
| `DOWNLOAD_WATCHDOG_NO_OUTPUT_MS` | `7200000` | 2hr silence threshold |
| `DOWNLOAD_WATCHDOG_MIN_RUNTIME_MS` | `600000` | 10min min before kill |
| `PORT` | `3000` | Express port |
| `AXIOS_TIMEOUT_MS` | `20000` | RSS HTTP timeout |
| `PUSHOVER_APP_TOKEN` | `""` | Pushover notification token |
| `PUSHOVER_USER_TOKEN` | `""` | Pushover user token |

### Client
- SPA served from `/` via Express static
- Polls `GET /api/status` + `GET /api/history` every 5s
- Dev proxy: `http://localhost:3000/api`

### Scripts
- `./start.sh` → install deps, build client, create data/download dirs, run dev servers
- `node server/index.js` → start server only
- `cd client && npm run build` → build client
- `./release.sh` → release new version

## §V INVARIANTS

V1: ∀ video in retryQueue → key=`${channelId}-${videoId}` unique; dupes overwrite, ⊥ append
V2: ∀ yt-dlp spawn → check activeDownloads for same channel+videoId first; skip if found
V3: folder "complete" iff ∃ final video file (mp4|mkv|webm ⊥ `.f\d+` prefix) & size ≥1MB
V4: fragment file pattern `{Title}.f{formatId}.{ext}`; final video ⊥ `.f\d+` in name
V5: ∀ title matching ignoreKeyword → ⊥ download; applied at RSS scan, retry queue, cancel
V6: `markAuthSkipped(videoId)` → video ⊥ retried for AUTH_SKIP_TTL_MS (7 days) within process lifetime; in-memory only, cleared on restart
V7: currentDownloads = in-flight only; startup → `recoverStaleDownloads()` moves all → retryQueue
V8: scheduledStream → removed from retryQueue before insert; on promote → removed from scheduledStreams
V9: download dir structure = `{DOWNLOAD_DIR}/{username}/{datePrefix} {sanitizedTitle}/`
V10: watchdog kill condition: process runtime ≥10min & silent ≥2hr
V11: retry delay = `min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2^attempts)`
V12: 403 loop threshold = 100 consecutive 403s across all fragments → treat as stream ended (success)
V13: cookies file chmod 0o600 on write; validated Netscape format, size <5MB
V14: ∀ external URL input → validate HTTPS, youtube.com|youtu.be domain, ⊥ private IPs (SSRF guard)
V15: yt-dlp custom flags validated against `--exec`, `--config-location`, `--batch-file` before use
V16: DB JSON parse fail → reset to `createDefaultData()`, overwrite file
V17: ∀ server log → ASCII only, format `[LEVEL] [ServiceName] Message`
V18: corrupt fragment (<1KB) on merge fail → delete to unblock yt-dlp re-download
V19: ⊥ delete final video files during cleanup; only `.f{N}.{ext}`, `.ytdl`, `-Frag###` deleted
V20: `POST /ytdlp-flags` → reject flags containing `--exec`, `--config-location`, `--batch-file`
V21: `dir` path ∀ scheduledStream → persisted in `scheduledStreams[]` entry; forwarded verbatim on promote to retryQueue; ⊥ fallback to undated path
V22: `release.sh` ! run `npm test` before any file mutation; red tests → die, ⊥ release
V23: `release.sh` ! guard [Unreleased] section non-empty (strip blank + `###` headers + bare `- ` placeholders) before creating release; empty → die
V24: `release.sh` git push ! push branch + tag separately (`git push origin $branch` & `git push origin $tag`); ⊥ `git push --tags`
V25: devcontainer ! forward ports 3000 (API) & 5173 (Vite); ⊥ omit 5173
V26: devcontainer node_modules ! live in named Docker volume; ⊥ overridden by workspace bind mount; `postCreateCommand` ! run `npm install`
V27: `cleanup-ghcr.yml` `package-name` ! = `archivedv`; ⊥ hardcode other repo names; cleanup `if` ! check only `conclusion == 'success'`
V28: `dependabot.yml` `open-pull-requests-limit` ! = `0` ∀ ecosystems; security alert scanning ⊥ affected (repo Settings control); ⊥ expose dependency drift via public PRs

## §T TASKS

| id | status | title | cites |
|----|--------|-------|-------|
| T1 | x | RSS polling + keyword matching | V1,V5,V14 |
| T2 | x | yt-dlp subprocess download manager | V2,V3,V4,V10,V12 |
| T3 | x | ffmpeg fragment merger | V18,V19 |
| T4 | x | Retry queue w/ exponential backoff | V1,V11 |
| T5 | x | Scheduled stream detection + promotion | V8 |
| T6 | x | Cookie auth + auth failure classification | V6,V13 |
| T7 | x | Watchdog (2hr no-output kill + requeue) | V10 |
| T8 | x | React UI: channel/keyword/status/history mgmt | - |
| T9 | x | Custom yt-dlp flags (user-defined, validated) | V15,V20 |
| T10 | x | Ignore keyword list | V5 |
| T11 | x | Download history w/ channel metadata | - |
| T12 | x | Pushover notifications ? (token optional) | - |
| T13 | x | Mobile-responsive layout | - |
| T14 | x | Date format preference (YYYY-MM-DD \| MM-DD-YYYY) | - |
| T15 | . | ? further features / bug fixes | - |
| T16 | x | F1 research: confirm call sites + test runner | - |
| T17 | x | F2: BLOCK-1 rate limit + HARDEN 1,3,5 | V15,V20 |
| T18 | x | F3: HARDEN-4 history enrichment + §V.6 amend | V6 |
| T19 | x | F4: unit tests parseScheduledTime/computeNextAttempt/classifyYtDlpAuthFailure/migrateHistoryEntries | - |
| T20 | . | F5: final verify code vs SPEC + CHANGELOG | - |
| T21 | x | F6: fix dir propagation in addScheduledStream + processScheduledStreams | V21,V9 |
| T22 | x | F7: fix release.sh bugs + align with best-practice example | V22,V23,V24 |
| T23 | x | F8: fix devcontainer (base image, node_modules volume, ports, postCreateCommand, extensions) | V25,V26 |
| T24 | . | F9: fix CONTRIBUTING.md (accuracy, devcontainer section, correct commands) | - |
| T25 | . | F10: fix cleanup-ghcr.yml (wrong package-name) + dependabot.yml (disable auto-PRs) | V27,V28 |

## §B BUGS

| id | date | cause | fix |
|----|------|-------|-----|
| B1 | 2026-03-07 | cron thread blocked main server thread during feed refresh | replaced cron with `setInterval`; §V.17 |
| B2 | 2026-07-17 | `addScheduledStream` ⊥ accept/store `dir`; `processScheduledStreams` ⊥ pass `stream.dir` on promote → scheduled folder ⊥ date prefix | §V.21 |
