# Full codebase review — 2026-10-03

Scope: every tracked source, test, configuration, script, workflow and document; static assets by format/use. Priorities: data integrity, download recovery, security boundaries, UI consistency and a durable system spec. No BACKLOG ingestion, live downloads, publishing or release actions.

Baseline: `main` at `ae5d2a77fa799bc334e0b557b01b3a4e8f9716fc`; clean working tree. No PLAN.md or HANDOFF.md cycle existed. All changes in this review are owned by this session. The main agent performed the directly requested review-vibe workflow, using encode-docs/header for SPEC.md and encode-commit for the summary commit.

## Coverage

| Section | Paths / surfaces | State | Inspection and verification evidence |
|---|---|---|---|
| Download lifecycle | `server/downloader.js`, `server/merger.js` | Reviewed | Traced start, output, close, 403/auth failures, cancellation, capacity ownership, watchdog, retries, saving, cleanup and shutdown; mocked regressions plus real children/ffmpeg fixtures |
| Discovery and scheduling | `server/scheduler.js` | Reviewed | Traced RSS retries/throttling, filters, in-flight config changes, folder identity, dedupe, promotion, startup and interval shutdown; behavioral regressions |
| Persistence and config | `server/database.js`, `server/config.js`, `server/utils.js` | Reviewed | Read complete modules and migration callers; checked atomic replacement, malformed data, metadata precedence, paths/symlinks, Unicode bounds, environment defaults and date/retry helpers |
| HTTP and security | `server/routes.js`, `server/auth.js`, `server/ytdlpFlags.js`, `server/index.js` | Reviewed | Traced every endpoint to persistence/subprocess effects; checked cookies, flags, URL resolution, rate limiting, same-origin policy, JSON errors, SPA serving and shutdown; HTTP/process tests and container smoke |
| UI | `client/src/**`, `client/index.html`, favicon | Reviewed | Read every component, shared transport/formatting and CSS; traced callers/loading/empty/pending/error/success states; browser checks for keyboard, both themes, widths, long content, mutation failures and response races. CookieSettings remains unmounted; its source and API contracts were reviewed |
| Tests | `server/tests/**` | Reviewed | Read all assertions/fixtures; preserved existing distinct tests, added failure/concurrency/restart boundaries; disposable data, fake external services and controlled real children; 50 passing tests |
| Build and operations | `package*.json`, Vite/PostCSS/Tailwind configuration, Docker/compose/devcontainer, `start.sh`, `release.sh`, `.github/**`, `.gitignore`, `.dockerignore`, `.gitattributes` | Reviewed | Read all configuration/scripts/workflows; traced dependency changes and lockfile, build contexts, UID/volumes/ports, CI/publication boundaries, release guards, shell exits and notes; checks below |
| Docs and assets | `AGENTS.md`, `CLAUDE.md`, `SPEC.md`, `README.md`, `CHANGELOG.md`, `LICENSE.md`, `doc/*` | Reviewed | Reconciled guidance/spec with code and user priorities; corrected stale contracts/links; inspected PNG/PSD/ICO formats and references (not executable code or a visual redesign) |

There are no unexamined codebase sections in this inventory. SQL, interchangeable service adapters, multi-tenant authorization and media playback do not exist here and are inapplicable review surfaces. Application access relies on a trusted network or authenticated reverse proxy; source cookies are not application login.

## Findings and disposition

| ID | Trigger / impact | Disposition |
|---|---|---|
| R1 | Exit zero or 403 stop could produce successful history with missing/failed output | Fixed: finalization checks substantial saved output, then reconciles history/queues; incomplete work remains retryable |
| R2 | Startup and completion could merge concurrently or read active files; failed output used a final filename | Fixed: folder ownership, shared merge completion, temporary output, explicit stream mapping, exclusive publication and selective cleanup; usable sources preserved on failure |
| R3 | Channel URL fallbacks/identifiers could reach unsafe archive paths | Fixed: strict URL/ID parsing, canonical links, no redirects, descendant-symlink rejection and bounded Unicode directory components |
| R4 | Flag denylist left executable/path/config/simulation options reachable | Fixed: explicit supported options/arities at API and invocation; unsafe stored flags fall back to defaults with a diagnostic |
| R5 | Cookie uploads accepted arbitrary text and could truncate previous credentials | Fixed: Netscape record validation and atomic private replacement; failure preserves previous bytes |
| R6 | Title-only folders conflated videos; stale feed responses or removed scheduled/channel entries could recreate work | Fixed: video-ID identity, retained persisted paths, unique legacy-history fallback, re-read filters/subscriptions, title exclusion for scheduled removal and removed-channel retry suppression |
| R7 | Stale inProgress flags, promotion order, recovered finals and cookies-enabled cooldown had inconsistent transitions | Fixed: durable queue reset/promotion, no-capture completion reconciliation and cooldown enforcement; restart/path tests |
| R8 | Invalid JSON/schema and ordinary writes had weak preservation guarantees | Fixed: exact corrupt-byte backup before reset, schema rejection without overwrite, exclusive flushed temporary files |
| R9 | Quiet active media could be killed; stalled mergers or detached children could survive shutdown | Fixed: media activity in watchdog, merge deadline, process-group termination and bounded server shutdown with retained restart state; real-process regressions |
| R10 | UI swallowed HTTP failures, lost drafts, exposed stale poll data silently and had inconsistent forms/themes | Fixed: shared API/action/keyword behavior, error/status feedback, labels/focus, safe theme storage, saving phase and accurate counts |
| R11 | Fixed desktop columns and long titles/errors overflowed; late config responses erased newer saved changes | Fixed: flexible grid tracks/wrapping and latest-read guards for config/status/history; browser reproduction and verification |
| R12 | Check workflow published test images/required secrets; health checks accepted weak responses; shell cleanup hid failures; breaking release subjects were missed | Fixed: secret-free reusable local checks, real API/JSON assertions, non-root runtime, exit-code propagation and breaking subject/footer parsing; isolated script fixtures |
| R13 | Dependency audit reported 5 affected packages; unused watcher/CORS/config increased maintenance surface | Fixed: native Node watch, removed unused dependencies and obsolete Tailwind JS config, updated ip-address lock entry; clean install and audit report 0 vulnerabilities |
| R14 | SPEC omitted ownership/lifecycle/UI contracts and contained stale path/env/schema claims | Fixed: complete module/API/schema/state/path/UI/config/operations coverage with limits and expansion acceptance criteria. Preserved stable IDs; retired duplicate V20 under V15 without reusing it |

Eight initial behavioral regressions failed before fixes: false exit-zero success, false 403 success, failed merge publication, duplicate merges, unsafe channel URLs, unsafe options, invalid cookies and removed-channel queues. Later real shutdown regressions reproduced surviving capture/merge children. Browser fixtures separately reproduced long-title overflow and late-response loss of a newer saved change. These cases pass after correction.

## Verification

| Check | Result |
|---|---|
| Baseline `npm test`, `npm run build` | 20 tests passed; build passed |
| Final `npm ci` / dependency audit | Clean install succeeded; `found 0 vulnerabilities` after dependency/lock changes |
| Final `npm test` | 50 passed, 0 failed/skipped; source/network/process fixtures use disposable state |
| Final `npm run build` | Passed; 343 modules transformed; JS 243.57kB / CSS 27.19kB before gzip |
| `bash -n start.sh release.sh` | Passed |
| Isolated script fixtures | Startup propagates delayed server exit 7; breaking subject/footer selects major; failed release test gate prevents package/changelog/tag mutation. No real release command executed |
| Local image build | Passed: `archivedv-review:local`, Linux amd64; no image publication |
| Final container smoke | UID 1000; frontend/config/status/history return 200; APIs parse as JSON; unknown API 404 and malformed JSON 400; Docker healthcheck healthy; graceful stop exits 0 |
| Tests inside final image | 50 passed with network disabled and `client/src` mounted read-only for the client transport test; production image normally ships built frontend only |
| Real ffmpeg recovery | Generated MP4/AAC and WebM/AAC inputs recovered; ffprobe reports video + audio and durations 8.000s / 8.021s; consumed fragments removed. Corrupt input reports failure, retains sources and publishes no final |
| Browser: empty/ordinary flows | Chromium; 375/768/1440/1600/1920px fit; malformed theme storage, theme switching, keyboard forms, failed channel/keyword/flags operations, retained drafts, retry/delete/save/clear, date/refresh and polling recovery passed; no page errors |
| Browser: populated/failure/race flows | Both themes at all five widths; long titles/channel names/keywords/errors fit; keyboard focus, failed abort then retry, scheduled removal and history clear passed. Delayed config response cannot erase a newer saved change |
| SPEC and owned diff | IDs/counters, section order and table shapes passed; full owned diff and affected callers reviewed; `git diff --check` passed |

Environment restrictions were resolved without weakening assertions: host socket/network checks ran with sandbox permission; the native browser tool lacked Chrome, so a temporary Playwright runner used installed Chromium. An optional first container test invocation failed with `ERR_MODULE_NOT_FOUND` for `/app/client/src/utils/api.js`; mounting that test source read-only resolved it. No outstanding required check is blocked.

Primary research, checked 2026-10-03: [yt-dlp option contract](https://github.com/yt-dlp/yt-dlp#usage-and-options), [ffmpeg stream selection](https://ffmpeg.org/ffmpeg.html#Stream-selection), [Node native watch](https://nodejs.org/api/cli.html#--watch); dependency advisories for [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [brace-expansion](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) and [ip-address](https://github.com/advisories/GHSA-j6r3-76f7-8jcv).

## Limits and completion

All inventoried source areas and the resulting owned changes were examined; evidenced fixes and required local verification are complete. This is not proof that every possible upstream/runtime failure is eliminated. Live YouTube/feed/account-authentication and Pushover delivery, hosted GitHub Actions/publication, ARM64 runtime and an editor-driven devcontainer session were not exercised. CI/devcontainer configuration was inspected; the local production runtime was built and tested.

Durable limits are explicit in SPEC: completion remains a regular-file/name/size heuristic (>1MiB), not proof of every packet or a complete broadcast; unavailable fragments/RSS downtime can lose content; ambiguous legacy identity is preserved for operator recovery; ordinary retries/history are unbounded and concurrency defaults to unlimited. CookieSettings remains unmounted. Stronger media integrity checks, retention and richer progress are future contracts, not delivered claims.

Disposable preview processes and smoke container were stopped/removed; no live archive was touched. Next action: none for this review. Future work should start from SPEC.md and add acceptance tests for the chosen expansion; this ledger records completed examination rather than an active planning cycle.
