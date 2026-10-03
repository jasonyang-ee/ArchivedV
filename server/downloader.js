import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import db from "./database.js";
import { autoMerge, downloadingFolders, isFolderBusy } from "./merger.js";
import {
  canUseCookies,
  getYtDlpAuthArgs,
  classifyYtDlpAuthFailure,
  markAuthSkipped,
} from "./auth.js";
import {
  buildChannelUrl,
  nowIso,
  jitter,
  isFinalVideoFile,
  isPartialDownloadFile,
  isAuxiliaryFile,
  isSafeDownloadPath,
  isSafeIdentifier,
  isSubstantialFile,
} from "./utils.js";
import {
  MAX_AUTH_FAILURE_ATTEMPTS,
  MAX_CONCURRENT_DOWNLOADS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  DOWNLOAD_WATCHDOG_INTERVAL_MS,
  DOWNLOAD_WATCHDOG_NO_OUTPUT_MS,
  DOWNLOAD_WATCHDOG_MIN_RUNTIME_MS,
  PUSHOVER_APP_TOKEN,
  PUSHOVER_USER_TOKEN,
} from "./config.js";
import Pushover from "pushover-notifications";
import { parseYtDlpFlags } from "./ytdlpFlags.js";

// Pushover setup
const push = new Pushover({
  token: PUSHOVER_APP_TOKEN,
  user: PUSHOVER_USER_TOKEN,
});

// Status tracking (exported so routes can access it)
export const status = {
  lastRun: null,
  downloadedCount: 0,
  currentDownloads: [],
  lastCompleted: null,
  retryQueue: { total: 0, due: 0 },
};

// Active downloads tracking (for cancellation)
export const activeDownloads = new Map(); // downloadId -> { proc, downloadInfo, dir }
let shuttingDown = false;

export function canStartAnotherDownload() {
  if (shuttingDown) return false;
  if (!MAX_CONCURRENT_DOWNLOADS) return true;
  return activeDownloads.size < MAX_CONCURRENT_DOWNLOADS;
}

export function getRetryQueueCounts() {
  db.read();
  const total = (db.data.retryQueue || []).length;
  const due = (db.data.retryQueue || []).filter(
    (j) => !j.inProgress && new Date(j.nextAttemptAt).getTime() <= Date.now()
  ).length;
  return { total, due };
}

export function inspectDownloadFolder(folderPath) {
  try {
    if (!isSafeDownloadPath(folderPath)) return { kind: "unknown", error: "Unsafe archive path" };
    if (!fs.existsSync(folderPath)) return { kind: "missing" };
    const files = fs.readdirSync(folderPath);
    if (files.length === 0) return { kind: "empty" };

    const finalVideos = files.filter((f) => isFinalVideoFile(f));
    const partials = files.filter((f) => isPartialDownloadFile(f));
    const nonAux = files.filter(
      (f) => !isFinalVideoFile(f) && !isPartialDownloadFile(f) && !isAuxiliaryFile(f)
    );

    if (finalVideos.length > 0) {
      // Heuristic: consider it complete if any final video is > 1MB
      const hasSubstantial = finalVideos.some((file) => isSubstantialFile(path.join(folderPath, file)));
      if (hasSubstantial) return { kind: "complete", finalVideos, partials };
      // A tiny final file can be a failed merge; treat as incomplete
      return { kind: "incomplete", finalVideos, partials };
    }

    if (partials.length > 0) return { kind: "incomplete", partials };
    if (nonAux.length > 0) return { kind: "incomplete", nonAux };
    return { kind: "metadata" };
  } catch (e) {
    return { kind: "unknown", error: e?.message || String(e) };
  }
}

export function makeRetryKey(channelId, videoId) {
  return `${channelId}-${videoId}`;
}

export function computeNextAttempt(attempts) {
  const exp = Math.min(10, Math.max(0, attempts));
  const delay = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * Math.pow(2, exp));
  return new Date(Date.now() + jitter(delay)).toISOString();
}

function buildHistoryEntry(downloadInfo, extra = {}) {
  const channelId = downloadInfo.channel || downloadInfo.channelId;
  const username = downloadInfo.username || null;
  const channelName = downloadInfo.channelName || downloadInfo.username || null;
  const channelUrl = buildChannelUrl(channelId, username);

  return {
    title: downloadInfo.title,
    time: nowIso(),
    videoId: downloadInfo.videoId,
    dir: downloadInfo.dir,
    ...(channelId && { channelId }),
    ...(username && { username }),
    ...(channelName && { channelName }),
    ...(channelUrl && { channelUrl }),
    ...extra,
  };
}

// --- Scheduled Stream helpers ---

/**
 * Parse yt-dlp's "This live event will begin in ..." message to extract the scheduled start time.
 * Returns an ISO timestamp, or null if unparseable.
 */
export function parseScheduledTime(stderr) {
  // Match patterns like:
  //   "This live event will begin in 4 hours."
  //   "This live event will begin in about 2 hours."
  //   "This live event will begin in 30 minutes."
  //   "This live event will begin in 1 day."
  const match = stderr.match(
    /This live event will begin in (?:about )?(\d+)\s+(minute|hour|day|week)s?/i
  );
  if (!match) return null;

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  let ms = 0;
  if (unit === "minute") ms = amount * 60 * 1000;
  else if (unit === "hour") ms = amount * 60 * 60 * 1000;
  else if (unit === "day") ms = amount * 24 * 60 * 60 * 1000;
  else if (unit === "week") ms = amount * 7 * 24 * 60 * 60 * 1000;

  return new Date(Date.now() + ms).toISOString();
}

/**
 * Add or update a scheduled stream entry. Removes from retryQueue if present.
 */
export function addScheduledStream(info, scheduledFor) {
  db.read();
  if (!db.data.scheduledStreams) db.data.scheduledStreams = [];

  const key = makeRetryKey(info.channelId, info.videoId);

  // Remove from retry queue
  db.data.retryQueue = (db.data.retryQueue || []).filter(
    (j) => !(j.channelId === info.channelId && j.videoId === info.videoId)
  );

  // Upsert into scheduledStreams
  const idx = db.data.scheduledStreams.findIndex((s) => s.key === key);
  const entry = {
    key,
    channelId: info.channelId || info.channel,
    videoId: info.videoId,
    title: info.title,
    username: info.username,
    channelName: info.channelName,
    videoLink: info.videoLink,
    dir: info.dir,
    scheduledFor,
    detectedAt: idx === -1 ? nowIso() : db.data.scheduledStreams[idx].detectedAt,
    lastCheckedAt: nowIso(),
  };

  if (idx === -1) {
    db.data.scheduledStreams.push(entry);
    console.log(
      `[INFO] [Archived V] Scheduled stream detected: "${info.title}" starts at ${new Date(scheduledFor).toISOString()}`
    );
  } else {
    db.data.scheduledStreams[idx] = entry;
  }

  db.write();
  return entry;
}

/**
 * Check if a video is already tracked as a scheduled stream.
 */
export function isScheduledStream(channelId, videoId) {
  db.read();
  if (!db.data.scheduledStreams) return false;
  return db.data.scheduledStreams.some(
    (s) => s.channelId === channelId && s.videoId === videoId
  );
}

/**
 * Get count of scheduled streams.
 */
export function getScheduledStreamCounts() {
  db.read();
  return (db.data.scheduledStreams || []).length;
}

export function upsertRetryJob(job, update = {}) {
  db.read();
  if (!db.data.retryQueue) db.data.retryQueue = [];

  const key = makeRetryKey(job.channelId, job.videoId);
  const idx = db.data.retryQueue.findIndex((j) => j.key === key);

  const merged = {
    key,
    channelId: job.channelId,
    videoId: job.videoId,
    title: job.title,
    username: job.username,
    channelName: job.channelName,
    videoLink: job.videoLink,
    dir: job.dir,
    attempts: 0,
    lastError: "",
    nextAttemptAt: nowIso(),
    inProgress: false,
    createdAt: nowIso(),
    ...(idx === -1 ? {} : db.data.retryQueue[idx]),
    ...job,
    ...update,
    updatedAt: nowIso(),
  };

  if (idx === -1) db.data.retryQueue.push(merged);
  else db.data.retryQueue[idx] = merged;
  db.write();
  return merged;
}

// Safe directory cleanup - only removes truly empty directories, never deletes video files
export function safeCleanupDirectory(dir, reason = "") {
  try {
    if (!isSafeDownloadPath(dir)) return { cleaned: false, reason: "Unsafe archive path" };
    if (!fs.existsSync(dir)) {
      return { cleaned: false, reason: "Directory does not exist" };
    }

    const files = fs.readdirSync(dir);

    // Check for any video or media files that should never be deleted
    const protectedFiles = files.filter((f) =>
      /\.(mp4|mkv|webm|avi|mov|flv|wmv|part|ytdl|f\d+\.mp4|f\d+\.webm|f\d+\.mkv|m4a|opus|ogg)$/i.test(f)
    );

    if (protectedFiles.length > 0) {
      console.log(
        `[INFO] [Archived V] NOT deleting "${dir}" - contains ${protectedFiles.length} video/media file(s): ${protectedFiles.slice(0, 3).join(", ")}${protectedFiles.length > 3 ? "..." : ""}`
      );
      return { cleaned: false, reason: "Contains protected video files", files: protectedFiles };
    }

    // Only delete if truly empty (no files at all)
    if (files.length === 0) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`[INFO] [Archived V] Cleaned up empty directory: ${dir}${reason ? ` (${reason})` : ""}`);
      return { cleaned: true, reason: "Empty directory removed" };
    }

    // Has non-video files (thumbnails, metadata, etc.) - don't delete
    console.log(
      `[INFO] [Archived V] NOT deleting "${dir}" - contains ${files.length} file(s): ${files.slice(0, 3).join(", ")}${files.length > 3 ? "..." : ""}`
    );
    return { cleaned: false, reason: "Contains other files", files };
  } catch (e) {
    console.error(`[ERROR] [Archived V] Error during cleanup of "${dir}": ${e.message}`);
    return { cleaned: false, reason: e.message };
  }
}

export function recordDownloadSuccess(dir, downloadInfo, note = null) {
  status.lastCompleted = downloadInfo.title;
  db.read();
  if (!db.data.history.some((item) => item.videoId === downloadInfo.videoId && item.channelId === downloadInfo.channel && item.status !== "skipped")) {
    db.data.history.push(buildHistoryEntry({ ...downloadInfo, dir }, note ? { note } : {}));
  }
  db.data.retryQueue = db.data.retryQueue.filter((job) => !(job.channelId === downloadInfo.channel && job.videoId === downloadInfo.videoId));
  db.data.scheduledStreams = db.data.scheduledStreams.filter((job) => !(job.channelId === downloadInfo.channel && job.videoId === downloadInfo.videoId));
  db.write();
  if (PUSHOVER_APP_TOKEN && PUSHOVER_USER_TOKEN) {
    push.send({ message: `Downloaded: ${downloadInfo.title}`, title: downloadInfo.title }, (error) => {
      if (error) console.warn("[WARN] [Archived V] Download notification failed");
    });
  }
}

// Keep ownership until close, even after SIGTERM; a sent signal is not an exited process.
export function stopDownload(tracking) {
  if (tracking.stopping || tracking.closed) return;
  tracking.stopping = true;
  const signal = (name) => {
    try {
      if (process.platform !== "win32" && tracking.proc.pid) process.kill(-tracking.proc.pid, name);
      else tracking.proc.kill(name);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  signal("SIGTERM");
  tracking.killTimer = setTimeout(() => {
    if (!tracking.closed) signal("SIGKILL");
  }, 10000);
  tracking.killTimer.unref?.();
}

export function stopDownloads() {
  shuttingDown = true;
  for (const tracking of activeDownloads.values()) {
    try { stopDownload(tracking); } catch (error) {
      console.error(`[ERROR] [Archived V] Could not stop download: ${error.message}`);
    }
  }
}

// Get user-defined yt-dlp flags from database
function getUserYtDlpFlags() {
  db.read();
  try {
    return parseYtDlpFlags(db.data.ytdlpFlags || "");
  } catch {
    console.error("[ERROR] [Archived V] Ignoring invalid or prohibited saved yt-dlp flags");
    return [];
  }
}

export function startYtDlp(downloadId, downloadInfo, dir, videoLink) {
  if (shuttingDown) throw new Error("Server is shutting down");
  for (const download of activeDownloads.values()) {
    if (download.downloadInfo.channel === downloadInfo.channel &&
        download.downloadInfo.videoId === downloadInfo.videoId) return download.proc;
  }
  if (!isSafeDownloadPath(dir) || !isSafeIdentifier(downloadInfo.channel) || !isSafeIdentifier(downloadInfo.videoId)) throw new Error("Unsafe download identity or directory");
  if (isFolderBusy(dir)) return null;
  const userFlags = getUserYtDlpFlags();

  const args = [
    "--ignore-config",
    "--no-playlist",
    ...getYtDlpAuthArgs(),
    "--live-from-start",
    "-cw",
    "--no-part",
    "--no-progress",
    "--no-cache-dir",
    "--socket-timeout",
    "30",
    "--retries",
    "20",
    "--fragment-retries",
    "50",
    "--skip-unavailable-fragments",
    "--js-runtimes",
    "node",
    "--remote-components",
    "ejs:npm",
    "-o",
    path.join(dir.replaceAll("%", "%%"), "%(title).180B.%(ext)s"),
    "--write-thumbnail",
    "--convert-thumbnails",
    "png",
    "--embed-thumbnail",
    "--add-metadata",
    // Use flexible format selection: best video + best audio, falling back to best combined
    "-f",
    "bestvideo+bestaudio/best",
    "--merge-output-format",
    "mp4",
    // Append user-defined flags
    ...userFlags,
    "--",
    `https://www.youtube.com/watch?v=${downloadInfo.videoId}`,
  ];

  const proc = spawn("yt-dlp", args, { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });

  const startedAt = Date.now();
  const tracking = {
    proc,
    downloadInfo,
    dir,
    videoLink,
    startedAt,
    lastOutputAt: Date.now(),
    stderr: "",
    stderrLine: "",
    killedByWatchdog: false,
    killedByAuthSkip: false,
    killedBy403Loop: false,
    consecutive403Count: 0,
  };

  activeDownloads.set(downloadId, tracking);
  downloadingFolders.add(path.resolve(dir));

  // Failed spawns emit error before close; close owns cleanup and retrying.
  proc.on("error", (error) => {
    tracking.stderr = (tracking.stderr + `\n${error.message}`).slice(-65536);
    console.error(`[ERROR] [Archived V] yt-dlp process error: ${error.message}`);
  });

  proc.stdout.on("data", (chunk) => {
    tracking.lastOutputAt = Date.now();
    chunk
      .toString()
      .split(/\r?\n/)
      .forEach((line) => {
        if (line) console.log(`[INFO] [yt-dlp] ${line}`);
      });
  });

  proc.stderr.on("data", (chunk) => {
    tracking.lastOutputAt = Date.now();
    const text = chunk.toString();
    tracking.stderr = (tracking.stderr + text).slice(-65536);
    const lines = (tracking.stderrLine + text).split(/\r?\n/);
    tracking.stderrLine = lines.pop().slice(-8192);
    lines.forEach((line) => {
      if (line) console.warn(`[WARN] [yt-dlp] ${line}`);

      // Detect 403 Forbidden retry loops (stream ended but yt-dlp keeps retrying fragments)
      // Count ALL consecutive 403 errors regardless of fragment number, since video+audio
      // streams interleave different fragment numbers in their error output.
      if (!tracking.killedBy403Loop && line) {
        const match403 = line.match(/Got error: HTTP Error 403.*Retrying fragment/i);
        if (match403) {
          tracking.consecutive403Count++;
          // If we've seen 100+ consecutive 403 errors (across all fragments/streams), stream has ended
          if (tracking.consecutive403Count >= 100) {
            tracking.killedBy403Loop = true;
            console.warn(
              `[WARN] [Archived V] Stopping yt-dlp for "${downloadInfo.title}" - stream appears to have ended (${tracking.consecutive403Count} consecutive 403 errors)`
            );
            try {
              stopDownload(tracking);
            } catch {}
          }
        } else if (line.trim()) {
          // Any non-403 output resets the counter (successful fragment, progress, etc.)
          tracking.consecutive403Count = 0;
        }
      }

      // If yt-dlp reports a login/members-only requirement, it may keep looping due to --wait-for-video.
      // Detect early and stop immediately when cookies aren't configured.
      if (!tracking.killedByAuthSkip && line) {
        const authFailure = classifyYtDlpAuthFailure(line);
        if (authFailure && !canUseCookies()) {
          tracking.killedByAuthSkip = true;

          try {
            db.read();
            db.data.retryQueue = (db.data.retryQueue || []).filter(
              (j) => !(j.channelId === downloadInfo.channel && j.videoId === downloadInfo.videoId)
            );
            db.write();
          } catch {}

          markAuthSkipped(downloadInfo.videoId);
          console.warn(
            `[WARN] [Archived V] Stopping yt-dlp for auth-required video "${downloadInfo.title}" (no cookies; ${authFailure.reason}).`
          );

          try {
            stopDownload(tracking);
          } catch {}
        }
      }
    });
  });

  proc.once("close", (code) => {
    tracking.closed = true;
    clearTimeout(tracking.killTimer);
    // A parent may close its pipes before an ignored-SIGTERM descendant exits.
    if (tracking.stopping && process.platform !== "win32" && proc.pid) {
      try { process.kill(-proc.pid, "SIGKILL"); } catch (error) {
        if (error.code !== "ESRCH") console.error(`[ERROR] [Archived V] Could not stop process group: ${error.message}`);
      }
    }
    downloadingFolders.delete(path.resolve(dir));
    // Preserve persisted current/retry rows for startup recovery; do not begin
    // a new recovery subprocess while the server is stopping.
    if (shuttingDown) {
      activeDownloads.delete(downloadId);
      return;
    }
    tracking.finalizing = true;
    downloadInfo.phase = "saving";
    autoMerge(dir, () => {
      activeDownloads.delete(downloadId);
      if (shuttingDown) return;
      status.currentDownloads = status.currentDownloads.filter((d) => d.id !== downloadId);
      db.read();
      db.data.currentDownloads = db.data.currentDownloads.filter((d) => d.id !== downloadId);
      db.write();
      if (tracking.cancelled) return;
      if (inspectDownloadFolder(dir).kind === "complete") {
        recordDownloadSuccess(dir, downloadInfo, tracking.killedBy403Loop ? "stream ended" : null);
        return;
      }
      if (tracking.killedByAuthSkip || !db.data.channels.some((channel) => channel.id === downloadInfo.channel)) return;

      const stderr = tracking.stderr || "";
      const folderState = inspectDownloadFolder(dir);

      const authFailure = classifyYtDlpAuthFailure(stderr);
      if (authFailure) {
        const cookiesAvailable = canUseCookies();

        db.read();
        const existing = (db.data.retryQueue || []).find(
          (j) => j.channelId === downloadInfo.channel && j.videoId === downloadInfo.videoId
        );
        const attempts = (existing?.attempts || 0) + 1;

        // If no cookies configured, skip this video without tracking it in history.
        if (!cookiesAvailable) {
          db.read();
          db.data.retryQueue = (db.data.retryQueue || []).filter(
            (j) => !(j.channelId === downloadInfo.channel && j.videoId === downloadInfo.videoId)
          );
          db.write();

          markAuthSkipped(downloadInfo.videoId);
          console.warn(
            `[WARN] [Archived V] Skipping auth-required video "${downloadInfo.title}" (no cookies; ${authFailure.reason}).`
          );
          return;
        }

        // Cookies are configured but auth still failed: retry a few times, then stop.
        if (attempts >= MAX_AUTH_FAILURE_ATTEMPTS) {
          db.read();
          db.data.retryQueue = (db.data.retryQueue || []).filter(
            (j) => !(j.channelId === downloadInfo.channel && j.videoId === downloadInfo.videoId)
          );
          markAuthSkipped(downloadInfo.videoId);
          db.data.history.push(buildHistoryEntry(downloadInfo, {
            status: "skipped",
            reason: `auth_failed_${authFailure.reason}`,
          }));
          db.write();

          console.warn(
            `[WARN] [Archived V] Skipping "${downloadInfo.title}" after ${attempts} auth failures (${authFailure.reason}).`
          );
          return;
        }
      }

      // Soft-failure cases should be retried.
      const isScheduledLiveEvent = stderr.includes("This live event will begin");

      // If this is a scheduled live event, move to scheduledStreams instead of retryQueue
      if (isScheduledLiveEvent) {
        const scheduledFor = parseScheduledTime(stderr);
        if (scheduledFor) {
          addScheduledStream(
            {
              channelId: downloadInfo.channel,
              videoId: downloadInfo.videoId,
              title: downloadInfo.title,
              username: downloadInfo.username,
              channelName: downloadInfo.channelName,
              videoLink,
              dir,
            },
            scheduledFor
          );

          // Clean up empty folder if one was created
          if (folderState.kind === "empty") {
            safeCleanupDirectory(dir, "scheduled stream (not yet live)");
          }
          return;
        }
        // If we couldn't parse the time, fall through to normal retry
      }

      const retryReason = isScheduledLiveEvent
        ? "Live scheduled; retry later"
        : folderState.kind === "incomplete"
          ? "Partial/incomplete download; retry"
          : "Download failed; retry";

      // upsertRetryJob will do db.read(), but we need to get the attempt count first
      db.read();
      const existing = (db.data.retryQueue || []).find(
        (j) => j.channelId === downloadInfo.channel && j.videoId === downloadInfo.videoId
      );
      const attempts = (existing?.attempts || 0) + 1;

      upsertRetryJob(
        {
          channelId: downloadInfo.channel,
          videoId: downloadInfo.videoId,
          title: downloadInfo.title,
          username: downloadInfo.username,
          channelName: downloadInfo.channelName,
          videoLink,
          dir,
        },
        {
          attempts,
          lastError: `${retryReason} (exit ${code})`,
          nextAttemptAt: computeNextAttempt(attempts),
          inProgress: false,
        }
      );

      // Try cleaning up only if truly empty
      if (folderState.kind === "empty") {
        safeCleanupDirectory(dir, "download failed (empty)");
      }
    });
  });

  return proc;
}

export function startDownloadWatchdog() {
  return setInterval(() => {
    const now = Date.now();
    for (const [downloadId, dl] of activeDownloads.entries()) {
      if (!dl?.proc || dl.stopping || dl.closed) continue;
      const runtime = now - (dl.startedAt || now);
      let lastActivity = dl.lastOutputAt || now;
      try {
        for (const file of fs.readdirSync(dl.dir)) {
          const stat = fs.statSync(path.join(dl.dir, file));
          if (stat.isFile()) lastActivity = Math.max(lastActivity, stat.mtimeMs);
        }
      } catch {}
      const quiet = now - lastActivity;

      if (runtime < DOWNLOAD_WATCHDOG_MIN_RUNTIME_MS) continue;
      if (quiet < DOWNLOAD_WATCHDOG_NO_OUTPUT_MS) continue;

      console.error(
        `[ERROR] [Archived V] Watchdog: killing stuck yt-dlp (no output for ${Math.round(quiet / 1000)}s) for "${dl.downloadInfo?.title}"`
      );
      dl.killedByWatchdog = true;
      try { stopDownload(dl); } catch (error) {
        console.error(`[ERROR] [Archived V] Could not stop download: ${error.message}`);
      }
    }
  }, DOWNLOAD_WATCHDOG_INTERVAL_MS);
}

// Initialize: recover and clear any stale currentDownloads on startup.
export function recoverStaleDownloads() {
  db.read();
  const staleDownloads = Array.isArray(db.data.currentDownloads) ? db.data.currentDownloads : [];
  for (const stale of staleDownloads) {
    const channelId = stale.channel;
    const videoId = stale.videoId;
    if (!channelId || !videoId) continue;
    const fallbackLink = stale.videoLink || `https://www.youtube.com/watch?v=${videoId}`;
    upsertRetryJob(
      {
        channelId,
        videoId,
        title: stale.title,
        username: stale.username,
        channelName: stale.channelName || stale.username,
        videoLink: fallbackLink,
        dir: stale.dir,
      },
      {
        lastError: "Recovered after restart",
        nextAttemptAt: nowIso(),
        inProgress: false,
      }
    );
  }
  db.data.currentDownloads = [];
  db.write();
}

// Startup cleanup: purge ghost/invalid entries from retryQueue
export function cleanupRetryQueue() {
  db.read();
  if (!db.data.retryQueue || db.data.retryQueue.length === 0) return;

  const before = db.data.retryQueue.length;
  const channelIds = new Set((db.data.channels || []).map((c) => c.id));
  const ignoreKeywords = (db.data.ignoreKeywords || []).map((k) => k.toLowerCase());

  // Deduplicate by key, keeping the newest entry
  const byKey = new Map();
  for (const job of db.data.retryQueue) {
    const existing = byKey.get(job.key);
    if (!existing || new Date(job.updatedAt) > new Date(existing.updatedAt)) {
      byKey.set(job.key, job);
    }
  }

  const cleaned = [];
  for (const [, job] of byKey) {
    // Remove entries with missing essential fields
    if (!job.videoId || !job.channelId) continue;

    // Remove entries for channels no longer monitored
    if (!channelIds.has(job.channelId)) continue;

    // Remove entries matching ignore keywords
    if (job.title && ignoreKeywords.some((k) => job.title.toLowerCase().includes(k))) continue;

    // Complete recovered jobs stay queued until success/history is reconciled.

    // Reset inProgress flag (no active processes at startup)
    job.inProgress = false;

    cleaned.push(job);
  }

  const removed = before - cleaned.length;
  db.data.retryQueue = cleaned;
  db.write();
  if (removed > 0) {
    console.log(`[INFO] [Archived V] Startup cleanup: removed ${removed} ghost/invalid retry queue entry(ies) (${before} -> ${cleaned.length})`);
  }
}

export default {
  status,
  activeDownloads,
  canStartAnotherDownload,
  getRetryQueueCounts,
  inspectDownloadFolder,
  makeRetryKey,
  computeNextAttempt,
  parseScheduledTime,
  addScheduledStream,
  isScheduledStream,
  getScheduledStreamCounts,
  upsertRetryJob,
  safeCleanupDirectory,
  startYtDlp,
  startDownloadWatchdog,
  recoverStaleDownloads,
  cleanupRetryQueue,
};
