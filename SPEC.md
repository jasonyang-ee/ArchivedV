<!-- SPEC FORMAT (baked by /encode-docs — keep; makes this file self-describing)
Sections, fixed order: §G goal | §C constraints | §I interfaces | §R research? | §V invariants
Symbols: → leads to | ∴ therefore | ∀ every | ∃ some | ! must | ? may/unknown | ⊥ never | ≠ | ∈ | ∉ | ≤ | ≥ | & and | § section
Durable truth only. Mutable: add sparingly (high bar), prune freely on evidence.
Address §<S>.<n> — §V.2 = invariants item 2. Commits/PRs cite by §.
Encoding: drop articles/filler/aux verbs. Fragments fine. Short synonyms (fix > implement).
Preserve verbatim: code, paths, identifiers, URLs, numbers, error strings, SQL, regex.
Tables (§C/§I/§R/§V): pipe-delimited, id-keyed; header row + GFM delimiter row (|---|---|), one cell per column. Escape literal \| . Empty cell = -
ids: monotonic, never reused — take the next from `next:` below, ⊥ from the highest row (rows get pruned)
next: C15 I28 R1 V30
One file rule: >1000 lines → prune stale §V, ⊥ split into more files.
Full rules: /encode-docs skill. Cutting a word that loses a fact ⊥ allowed.
-->

# SPEC

## §G GOAL
Monitor YouTube channels via RSS; auto-download matching live streams & videos using yt-dlp; merge video+audio fragments with ffmpeg; serve React UI for config & status.

## §C CONSTRAINTS
id|description
|---|---|
C1|Node.js (ES Modules, `"type": "module"`); ⊥ CommonJS
C2|React 19 + Vite frontend; Tailwind CSS
C3|JSON flat-file DB (`data/db.json`); ⊥ SQL/external DB
C4|yt-dlp + ffmpeg required on host; invoked as subprocesses
C5|Single-process server; ⊥ multi-worker; ⊥ message queues
C6|YouTube RSS only (`https://www.youtube.com/feeds/videos.xml?channel_id=`)
C7|yt-dlp flags: `--no-part --skip-unavailable-fragments --fragment-retries 50 -f bestvideo+bestaudio/best`
C8|Auth via Netscape-format cookies file only; ⊥ OAuth
C9|Download dir: `./download/{username}/{sanitized_date_title}/`
C10|Server port default `3000`; configurable via env
C11|File naming: `camelCase.js` server modules, `PascalCase.jsx` React components
C12|Naming: `camelCase` vars/functions, `PascalCase` components, `snake_case` DB columns
C13|Server module files: `{entity}Controller.js`, `{name}Service.js`, `{entity}.js` (routes)
C14|Client files: `{PageName}.jsx` (pages), `{ComponentName}.jsx` (components)

## §I INTERFACES
id|type|shape → output,purpose,condition
|---|---|---|
I1|api|`GET /api/config` → `{channels[], keywords[], ignoreKeywords[], dateFormat}`
I2|api|`POST /api/channels` body `{link}` → `{id, link, username, channelName}`; resolves `@handle` via YouTube `/about` page
I3|api|`DELETE /api/channels/:id` → `{success:true}`
I4|api|`POST /api/keywords` body `{keyword}` → `{success:true}`; deduped
I5|api|`DELETE /api/keywords/:keyword` → `{success:true}`
I6|api|`POST /api/ignore-keywords` body `{keyword}` → `{success:true}`; deduped
I7|api|`DELETE /api/ignore-keywords/:keyword` → `{success:true}`
I8|api|`POST /api/date-format` body `{dateFormat}` → validates `YYYY-MM-DD` \| `MM-DD-YYYY`
I9|api|`GET /api/status` → `{lastRun, downloadedCount, currentDownloads[], retryQueue, scheduledStreams[]}`
I10|api|`DELETE /api/downloads/:downloadId` → kill yt-dlp, add title to ignoreKeywords, `{success:true}`
I11|api|`GET /api/history` → array `{title, time, videoId, channelId, username, channelName, channelUrl}`
I12|api|`DELETE /api/history` → `{success:true}`
I13|api|`DELETE /api/scheduled-streams/:videoId` → `{success:true}` \| 404
I14|api|`POST /api/refresh` → immediate `checkUpdates()`, returns current status
I15|api|`GET /api/auth` → `{useCookies, cookiesFilePresent, cookiesPathHint}`
I16|api|`POST /api/auth` body `{useCookies:boolean}` → clears authSkipCache when enabling
I17|api|`PUT /api/auth/cookies` body `{cookiesText}` → validates <5MB, writes, chmod 0o600
I18|api|`DELETE /api/auth/cookies` → delete file, set useCookies=false
I19|api|`GET /api/ytdlp-flags` → `{ytdlpFlags}`
I20|api|`POST /api/ytdlp-flags` body `{ytdlpFlags}` → validate against `--exec`, `--config-location`, `--batch-file`
I21|file|`data/db.json` schema (below)
I22|env|config env vars (table below), `server/config.js`
I23|client|SPA served `/` via Express static; polls `GET /api/status` + `GET /api/history` every 5s; dev proxy `http://localhost:3000/api`
I24|script|`./start.sh` → install deps, build client, create data/download dirs, run dev servers
I25|script|`node server/index.js` → start server only
I26|script|`cd client && npm run build` → build client
I27|script|`./release.sh` → release new version

### I21 detail — `data/db.json` schema
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

### I22 detail — config env vars (`server/config.js`)
| var | default | purpose |
|-----|---------|---------|
| `YTDLP_COOKIES_PATH` | `data/youtube_cookies.txt` | Netscape cookies path |
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
| `TRUST_PROXY` | `1` | Express trust proxy; `false` when ⊥ behind proxy |
| `AUTH_RATELIMIT_MAX` | `60` | auth/FS-write endpoints max req / 60s window |
| `STATIC_RATELIMIT_MAX` | `600` | static/FS-read endpoints max req / 1s window |
| `AXIOS_TIMEOUT_MS` | `20000` | RSS HTTP timeout |
| `PUSHOVER_APP_TOKEN` | `""` | Pushover notification token |
| `PUSHOVER_USER_TOKEN` | `""` | Pushover user token |

Fixed paths (⊥ env): `DATA_DIR` = `{cwd}/data`, `DOWNLOAD_DIR` = `{cwd}/download` (`server/config.js:14-15`)

## §R RESEARCH
each row ! cite source.
id|claim|source
|---|---|---|

## §V INVARIANTS
id|invariant definition
|---|---|
V1|∀ video in retryQueue → key=`${channelId}-${videoId}` unique; dupes overwrite, ⊥ append
V2|∀ yt-dlp spawn → check activeDownloads for same channel+videoId first; skip if found
V3|folder "complete" iff ∃ final video file (mp4\|mkv\|webm ⊥ `.f\d+` prefix) & size ≥1MB
V4|fragment file pattern `{Title}.f{formatId}.{ext}`; final video ⊥ `.f\d+` in name
V5|∀ title matching ignoreKeyword → ⊥ download; applied at RSS scan, retry queue, cancel
V6|`markAuthSkipped(videoId)` → video ⊥ retried for AUTH_SKIP_TTL_MS (7 days) within process lifetime; in-memory only, cleared on restart
V7|currentDownloads = in-flight only; startup → `recoverStaleDownloads()` moves all → retryQueue
V8|scheduledStream → removed from retryQueue before insert; on promote → removed from scheduledStreams
V9|download dir structure = `{DOWNLOAD_DIR}/{username}/{datePrefix} {sanitizedTitle}/`
V10|watchdog kill condition: process runtime ≥10min & silent ≥2hr
V11|retry delay = `min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2^attempts)`
V12|403 loop threshold = 100 consecutive 403s across all fragments → treat as stream ended (success)
V13|cookies file chmod 0o600 on write; validated Netscape format, size <5MB
V14|∀ external URL input → validate HTTPS, youtube.com\|youtu.be domain, ⊥ private IPs (SSRF guard)
V15|yt-dlp custom flags validated against `--exec`, `--config-location`, `--batch-file` before use
V16|DB JSON parse fail → reset to `createDefaultData()`, overwrite file
V17|∀ server log → ASCII only, format `[LEVEL] [ServiceName] Message`
V18|corrupt fragment (<1KB) on merge fail → delete to unblock yt-dlp re-download
V19|⊥ delete final video files during cleanup; only `.f{N}.{ext}`, `.ytdl`, `-Frag###` deleted
V20|`POST /ytdlp-flags` → reject flags containing `--exec`, `--config-location`, `--batch-file`
V21|`dir` path ∀ scheduledStream → persisted in `scheduledStreams[]` entry; forwarded verbatim on promote to retryQueue; ⊥ fallback to undated path
V22|`release.sh` ! run `npm test` before any file mutation; red tests → die, ⊥ release
V23|`release.sh` ! guard [Unreleased] section non-empty (strip blank + `###` headers + bare `- ` placeholders) before creating release; empty → die
V24|`release.sh` git push ! push branch + tag separately (`git push origin $branch` & `git push origin $tag`); ⊥ `git push --tags`
V25|devcontainer ! forward ports 3000 (API) & 5173 (Vite); ⊥ omit 5173
V26|devcontainer node_modules ! live in named Docker volume; ⊥ overridden by workspace bind mount; `postCreateCommand` ! run `npm install`
V27|`cleanup-ghcr.yml` `package-name` ! = `archivedv`; ⊥ hardcode other repo names; cleanup `if` ! check only `conclusion == 'success'`
V28|`dependabot.yml` `open-pull-requests-limit` ! = `0` ∀ ecosystems; security alert scanning ⊥ affected (repo Settings control); ⊥ expose dependency drift via public PRs
V29|history channel enrichment single-source: `resolveHistoryChannel(item, ctx)` (`server/database.js`) ! sole precedence logic; both `GET /api/history` (`normalizeHistoryItem`, `routes.js`) & `migrateHistoryEntries` (`database.js`) ! call it; ctx = `{channelsById, channelsByUsername, singleChannel, titleMap}`; precedence = channelId → username → (titleMatches.length===1) → singleChannel; titleMap built iff `needsFolderLookup` = ∃ history item ⊥ channelId & ⊥ username & ⊥ channelName; ∴ ⊥ per-request unconditional folder scan; channelName-only item enrichment ! identical @ API & migration
