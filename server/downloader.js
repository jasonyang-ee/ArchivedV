import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import db from "./database.js";
import { autoMerge } from "./merger.js";
import {
  canUseCookies,
  getYtDlpAuthArgs,
  classifyYtDlpAuthFailure,
  markAuthSkipped,
} from "./auth.js";
import {
  nowIso,
  jitter,
  isFinalVideoFile,
  isPartialDownloadFile,
  isAuxiliaryFile,
} from "./utils.js";
import {
  DOWNLOAD_DIR,
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

export function canStartAnotherDownload() {
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
      const hasSubstantial = finalVideos.some((f) => {
        try {
          const stat = fs.statSync(path.join(folderPath, f));
          return stat.size > 1024 * 1024;
        } catch {
          return false;
        }
      });
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
    updatedAt: nowIso(),
    ...job,
    ...update,
    updatedAt: nowIso(),
  };

  if (idx === -1) db.data.retryQueue.push(merged);
  else db.data.retryQueue[idx] = { ...db.data.retryQueue[idx], ...merged };
  db.write();
  return merged;
}

// Safe directory cleanup - only removes truly empty directories, never deletes video files
export function safeCleanupDirectory(dir, reason = "") {
  try {
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

function handleDownloadSuccess(dir, downloadInfo, note = null) {
  autoMerge(dir, () => {
    status.lastCompleted = downloadInfo.title;
    const message = note ? `Stream ended: ${downloadInfo.title}` : `Downloaded: ${downloadInfo.title}`;
    if (PUSHOVER_APP_TOKEN && PUSHOVER_USER_TOKEN) {
      push.send({ message, title: downloadInfo.title }, () => {});
    }
    db.read();
    db.data.history.push({ title: downloadInfo.title, time: nowIso(), ...(note && { note }) });
    db.data.retryQueue = (db.data.retryQueue || []).filter(
      (j) => !(j.channelId === downloadInfo.channel && j.videoId === downloadInfo.videoId)
    );
    db.write();
  });
}

// Get user-defined yt-dlp flags from database
function getUserYtDlpFlags() {
  db.read();
  const flags = db.data.ytdlpFlags || '';
  if (!flags.trim()) return [];
  
  // Parse the flags string into an array of arguments
  // Handle quoted strings and escape sequences
  const args = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  
  for (let i = 0; i < flags.length; i++) {
    const char = flags[i];
    
    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
    } else if (char === ' ' || char === '\t') {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  
  if (current) {
    args.push(current);
  }
  
  return args;
}

export function startYtDlp(downloadId, downloadInfo, dir, videoLink) {
  const userFlags = getUserYtDlpFlags();
  
  const args = [
    ...getYtDlpAuthArgs(),
    "--live-from-start",
    "-ciw",
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
    "--no-abort-on-error",
    "--js-runtimes",
    "node",
    "--remote-components",
    "ejs:npm",
    "-o",
    path.join(dir, "%(title)s.%(ext)s"),
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
    videoLink,
  ];

  const proc = spawn("yt-dlp", args, { stdio: ["pipe", "pipe", "pipe"] });

  const startedAt = Date.now();
  const tracking = {
    proc,
    downloadInfo,
    dir,
    videoLink,
    startedAt,
    lastOutputAt: Date.now(),
    stderr: "",
    killedByWatchdog: false,
    killedByAuthSkip: false,
    killedBy403Loop: false,
    consecutive403Count: 0,
  };

  activeDownloads.set(downloadId, tracking);

  proc.stdout.on("data", (chunk) => {
    tracking.lastOutputAt = Date.now();
    chunk
      .toString()
      .split(/\r?\n/)
      .forEach((line) => {
        if (line) console.log(`[yt-dlp] ${line}`);
      });
  });

  proc.stderr.on("data", (chunk) => {
    tracking.lastOutputAt = Date.now();
    const text = chunk.toString();
    tracking.stderr += text;
    text.split(/\r?\n/).forEach((line) => {
      if (line) console.warn(`[yt-dlp] ${line}`);

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
              proc.kill("SIGTERM");
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
            proc.kill("SIGTERM");
          } catch {}
        }
      }
    });
  });

  proc.on("close", (code) => {
    // Always clear active tracking
    activeDownloads.delete(downloadId);

    // Remove from status + db current downloads
    status.currentDownloads = status.currentDownloads.filter((d) => d.id !== downloadId);
    db.read();
    db.data.currentDownloads = (db.data.currentDownloads || []).filter((d) => d.id !== downloadId);

    // If killed by 403 loop, treat as stream ended - clean up and mark as complete
    if (tracking.killedBy403Loop) {
      handleDownloadSuccess(dir, downloadInfo, "stream ended");
      db.write();
      console.log(`[INFO] [Archived V] Stream ended for "${downloadInfo.title}" - download complete (403 loop detected)`);
      return;
    }

    // If watchdog or auth-skip killed it, they already handled requeue - just clean up
    if (tracking.killedByWatchdog || tracking.killedByAuthSkip) {
      db.write();
      return;
    }

    if (code === 0) {
      handleDownloadSuccess(dir, downloadInfo);
      db.write();
      return;
    }

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
        db.data.history.push({
          title: downloadInfo.title,
          time: nowIso(),
          status: "skipped",
          reason: `auth_failed_${authFailure.reason}`,
          videoId: downloadInfo.videoId,
          channelId: downloadInfo.channel,
        });
        db.write();

        console.warn(
          `[WARN] [Archived V] Skipping "${downloadInfo.title}" after ${attempts} auth failures (${authFailure.reason}).`
        );
        return;
      }
    }

    // If we ended up with a usable merged file, treat it as success.
    if (folderState.kind === "complete") {
      handleDownloadSuccess(dir, downloadInfo);
      db.write();
      console.warn(
        `[WARN] [Archived V] yt-dlp exited ${code} but produced a usable file for "${downloadInfo.title}"; recording as success.`
      );
      return;
    }

    // Soft-failure cases should be retried.
    const retryReason = stderr.includes("This live event will begin")
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

    // Store the filtered currentDownloads before upsertRetryJob overwrites it
    const filteredCurrentDownloads = db.data.currentDownloads;

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

    // Restore and write the filtered currentDownloads (upsertRetryJob may have done a db.read())
    db.read();
    db.data.currentDownloads = filteredCurrentDownloads;
    db.write();

    // Try cleaning up only if truly empty
    if (folderState.kind === "empty") {
      safeCleanupDirectory(dir, "download failed (empty)");
    }
  });

  return proc;
}

export function startDownloadWatchdog() {
  setInterval(() => {
    const now = Date.now();
    for (const [downloadId, dl] of activeDownloads.entries()) {
      if (!dl?.proc || dl.proc.killed) continue;
      const runtime = now - (dl.startedAt || now);
      const quiet = now - (dl.lastOutputAt || now);

      if (runtime < DOWNLOAD_WATCHDOG_MIN_RUNTIME_MS) continue;
      if (quiet < DOWNLOAD_WATCHDOG_NO_OUTPUT_MS) continue;

      console.error(
        `[ERROR] [Archived V] Watchdog: killing stuck yt-dlp (no output for ${Math.round(quiet / 1000)}s) for "${dl.downloadInfo?.title}"`
      );
      try {
        dl.killedByWatchdog = true;
        dl.proc.kill("SIGTERM");
      } catch {}

      // Ensure retry is scheduled
      const info = dl.downloadInfo;
      if (info?.channel && info?.videoId) {
        db.read();
        const existing = (db.data.retryQueue || []).find(
          (j) => j.channelId === info.channel && j.videoId === info.videoId
        );
        const attempts = (existing?.attempts || 0) + 1;
        upsertRetryJob(
          {
            channelId: info.channel,
            videoId: info.videoId,
            title: info.title,
            username: info.username,
            channelName: info.channelName,
            videoLink: dl.videoLink,
            dir: dl.dir,
          },
          {
            attempts,
            lastError: `Watchdog killed process (quiet ${Math.round(quiet / 1000)}s)`,
            nextAttemptAt: computeNextAttempt(attempts),
            inProgress: false,
          }
        );
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
    const videoId = stale.videoId || (typeof stale.id === "string" ? stale.id.split("-")[1] : undefined);
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

export default {
  status,
  activeDownloads,
  canStartAnotherDownload,
  getRetryQueueCounts,
  inspectDownloadFolder,
  makeRetryKey,
  computeNextAttempt,
  upsertRetryJob,
  safeCleanupDirectory,
  startYtDlp,
  startDownloadWatchdog,
  recoverStaleDownloads,
};
