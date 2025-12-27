import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import fs from "fs";
import axios from "axios";
import { Parser, processors } from "xml2js";
import cron from "node-cron";
import { spawn } from "child_process";
import Pushover from "pushover-notifications";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";

dotenv.config({quiet: true});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_COOKIES_PATH = path.join(__dirname, "..", "data", "youtube_cookies.txt");
const YTDLP_COOKIES_PATH = process.env.YTDLP_COOKIES_PATH || DEFAULT_COOKIES_PATH;
const MAX_AUTH_FAILURE_ATTEMPTS = Number(process.env.MAX_AUTH_FAILURE_ATTEMPTS) || 3;

// In-memory cache to avoid repeatedly attempting auth-required videos when cookies are not configured.
// Not persisted (avoids history growth). TTL is configurable.
const AUTH_SKIP_TTL_MS = Number(process.env.AUTH_SKIP_TTL_MS) || 7 * 24 * 60 * 60 * 1000;
const AUTH_SKIP_CACHE_MAX = Number(process.env.AUTH_SKIP_CACHE_MAX) || 2000;
const authSkipCache = new Map(); // videoId -> { expiresAt: number }

function isAuthSkipped(videoId) {
  if (!videoId) return false;
  const entry = authSkipCache.get(videoId);
  if (!entry) return false;
  if (entry.expiresAt <= Date.now()) {
    authSkipCache.delete(videoId);
    return false;
  }
  return true;
}

function markAuthSkipped(videoId) {
  if (!videoId) return;
  // Simple size cap: drop oldest-ish by iterating insertion order.
  if (authSkipCache.size >= AUTH_SKIP_CACHE_MAX) {
    const firstKey = authSkipCache.keys().next().value;
    if (firstKey) authSkipCache.delete(firstKey);
  }
  authSkipCache.set(videoId, { expiresAt: Date.now() + AUTH_SKIP_TTL_MS });
}

// Track feed 404 errors to reduce log spam - only log first occurrence
// Map: channelId -> { firstSeenAt: Date, lastLoggedAt: Date }
const feed404Cache = new Map();
const FEED_404_LOG_INTERVAL_MS = 60 * 60 * 1000; // Only re-log after 1 hour

function shouldLogFeed404(channelId) {
  const now = Date.now();
  const entry = feed404Cache.get(channelId);
  if (!entry) {
    // First time seeing this 404
    feed404Cache.set(channelId, { firstSeenAt: now, lastLoggedAt: now });
    return true;
  }
  // Only log again after interval passes
  if (now - entry.lastLoggedAt >= FEED_404_LOG_INTERVAL_MS) {
    entry.lastLoggedAt = now;
    return true;
  }
  return false;
}

function clearFeed404(channelId) {
  feed404Cache.delete(channelId);
}

// Reverse proxy support (Caddy, nginx, etc.)
// Set TRUST_PROXY=1 when behind a reverse proxy so req.ip reflects the real client IP
// Default to 1 (trust first proxy only) for security while supporting common Docker reverse proxy deployments
const TRUST_PROXY_RAW = process.env.TRUST_PROXY;
if (TRUST_PROXY_RAW !== undefined) {
  const lowered = String(TRUST_PROXY_RAW).toLowerCase();
  if (lowered === "true") app.set("trust proxy", true);
  else if (lowered === "false") app.set("trust proxy", false);
  else {
    const asNumber = Number(TRUST_PROXY_RAW);
    if (!Number.isNaN(asNumber)) app.set("trust proxy", asNumber);
    else app.set("trust proxy", 1);
  }
} else {
  // Default to 1 (trust only first/immediate proxy) for security in Docker deployments
  app.set("trust proxy", 1);
}

function isLoopbackIp(ip) {
  if (!ip) return false;
  // Express may provide IPv4-mapped IPv6 form like ::ffff:127.0.0.1
  return ip === "127.0.0.1" || ip === "::1" || ip.startsWith("::ffff:127.");
}

// Rate limit for expensive file system operations (CodeQL: js/missing-rate-limiting)
// Skip loopback so Docker health checks and local reverse proxy access aren't blocked.
const staticFsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.STATIC_RATELIMIT_MAX) || 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isLoopbackIp(req.ip),
  validate: { trustProxy: false }, // Suppress validation warnings - we control the proxy setup
});

// Rate limit endpoints that touch filesystem / sensitive auth state.
// Skip loopback so local UI access and health checks aren't impacted.
const authFsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.AUTH_RATELIMIT_MAX) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isLoopbackIp(req.ip),
  validate: { trustProxy: false }, // Suppress validation warnings - we control the proxy setup
});

const MAX_CONCURRENT_DOWNLOADS = Number(process.env.MAX_CONCURRENT_DOWNLOADS) || 0; // 0 = unlimited
const FEED_FETCH_RETRIES = Number(process.env.FEED_FETCH_RETRIES) || 3;
const FEED_FETCH_BACKOFF_MS = Number(process.env.FEED_FETCH_BACKOFF_MS) || 1000;
const RETRY_BASE_DELAY_MS = Number(process.env.RETRY_BASE_DELAY_MS) || 2 * 60 * 1000;
const RETRY_MAX_DELAY_MS = Number(process.env.RETRY_MAX_DELAY_MS) || 60 * 60 * 1000;
const DOWNLOAD_WATCHDOG_INTERVAL_MS = Number(process.env.DOWNLOAD_WATCHDOG_INTERVAL_MS) || 60 * 1000;
const DOWNLOAD_WATCHDOG_NO_OUTPUT_MS = Number(process.env.DOWNLOAD_WATCHDOG_NO_OUTPUT_MS) || 2 * 60 * 60 * 1000; // 2 hours for live streams with network issues
const DOWNLOAD_WATCHDOG_MIN_RUNTIME_MS = Number(process.env.DOWNLOAD_WATCHDOG_MIN_RUNTIME_MS) || 10 * 60 * 1000;

// Directories
const DATA_DIR = path.resolve(process.cwd(), "data");
const DOWNLOAD_DIR = path.resolve(process.cwd(), "download");
const DB_PATH = path.join(DATA_DIR, "db.json");

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// Database helper
const db = {
  data: { channels: [], keywords: [], ignoreKeywords: [], history: [], currentDownloads: [], retryQueue: [], dateFormat: 'YYYY-MM-DD', auth: { useCookies: false } },
  read() {
    if (!fs.existsSync(DB_PATH)) {
      this.data = { channels: [], keywords: [], ignoreKeywords: [], history: [], currentDownloads: [], retryQueue: [], dateFormat: 'YYYY-MM-DD', auth: { useCookies: false } };
      fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2));
    } else {
      try {
        const file = fs.readFileSync(DB_PATH, "utf-8");
        this.data = JSON.parse(file);
        if (!this.data.history) this.data.history = [];
        if (!this.data.ignoreKeywords) this.data.ignoreKeywords = [];
        if (!this.data.dateFormat) this.data.dateFormat = 'YYYY-MM-DD';
        if (!this.data.retryQueue) this.data.retryQueue = [];
        if (!this.data.auth) this.data.auth = { useCookies: false };
        if (typeof this.data.auth.useCookies !== "boolean") this.data.auth.useCookies = false;
        
        // Migrate old format to new format
        if (this.data.currentDownload && !this.data.currentDownloads) {
          this.data.currentDownloads = [];
          if (this.data.currentDownload.title) {
            this.data.currentDownloads.push({
              id: Date.now().toString(),
              channel: this.data.currentDownload.channel,
              title: this.data.currentDownload.title,
              username: this.data.currentDownload.username,
              startTime: new Date().toISOString()
            });
          }
          delete this.data.currentDownload;
        }
        
        // Ensure currentDownloads exists
        if (!this.data.currentDownloads) this.data.currentDownloads = [];
        
        // Clean up old currentDownload field if currentDownloads exists
        if (this.data.currentDownloads && this.data.currentDownload) {
          delete this.data.currentDownload;
          this.write(); // Save the cleanup
        }
      } catch {
        this.data = { channels: [], keywords: [], ignoreKeywords: [], history: [], currentDownloads: [], retryQueue: [], dateFormat: 'YYYY-MM-DD', auth: { useCookies: false } };
        fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2));
      }
    }
  },
  write() {
    fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2));
  },
};

// Initialize database
db.read();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms) {
  const spread = Math.min(250, Math.max(50, Math.floor(ms * 0.1)));
  return ms + Math.floor((Math.random() - 0.5) * 2 * spread);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeError(err) {
  const statusCode = err?.response?.status;
  const code = err?.code;
  const message = err?.message || String(err);
  return { statusCode, code, message };
}

function canUseCookies() {
  try {
    db.read();
    const enabled = !!db.data?.auth?.useCookies;
    if (!enabled) return false;
    return fs.existsSync(YTDLP_COOKIES_PATH);
  } catch {
    return false;
  }
}

function getYtDlpAuthArgs() {
  if (!canUseCookies()) return [];
  return ["--cookies", YTDLP_COOKIES_PATH];
}

function classifyYtDlpAuthFailure(text) {
  const t = String(text || "").toLowerCase();
  if (!t) return null;

  // Members-only / private / login-required patterns
  if (t.includes("private video") && t.includes("sign in")) return { kind: "auth_required", reason: "private_video" };
  if (t.includes("this video is available to this channel's members")) return { kind: "auth_required", reason: "members_only" };
  if (t.includes("join this channel") && t.includes("access")) return { kind: "auth_required", reason: "members_only" };
  if (t.includes("sign in") && t.includes("you've been granted access")) return { kind: "auth_required", reason: "private_video" };
  if (t.includes("confirm your age") || t.includes("age-restricted")) return { kind: "auth_required", reason: "age_restricted" };

  return null;
}

function isFinalVideoFile(name) {
  return /\.(mp4|mkv|webm|avi|mov|flv|wmv)$/i.test(name) && !/\.f\d+\.mp4$/i.test(name);
}

function isPartialDownloadFile(name) {
  return /\.(part|ytdl)$/i.test(name) || /\.f\d+\.mp4$/i.test(name);
}

function isAuxiliaryFile(name) {
  return /\.(jpg|jpeg|png|webp|json|info\.json|description|txt|vtt|srt|ass|lrc|m4a|aac)$/i.test(name);
}

function inspectDownloadFolder(folderPath) {
  try {
    if (!fs.existsSync(folderPath)) return { kind: "missing" };
    const files = fs.readdirSync(folderPath);
    if (files.length === 0) return { kind: "empty" };

    const finalVideos = files.filter((f) => isFinalVideoFile(f));
    const partials = files.filter((f) => isPartialDownloadFile(f));
    const nonAux = files.filter((f) => !isFinalVideoFile(f) && !isPartialDownloadFile(f) && !isAuxiliaryFile(f));

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

function makeRetryKey(channelId, videoId) {
  return `${channelId}-${videoId}`;
}

function upsertRetryJob(job, update = {}) {
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

function computeNextAttempt(attempts) {
  const exp = Math.min(10, Math.max(0, attempts));
  const delay = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * Math.pow(2, exp));
  return new Date(Date.now() + jitter(delay)).toISOString();
}

// Recover and clear any stale currentDownloads on startup.
// Those processes are gone after restart, but the work should be retried.
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

// Status tracking
const status = {
  lastRun: null,
  downloadedCount: 0,
  currentDownloads: [],
  lastCompleted: null,
  retryQueue: { total: 0, due: 0 },
};

// Active downloads tracking (for cancellation)
const activeDownloads = new Map(); // downloadId -> { proc, downloadInfo, dir }

let retryQueueRunning = false;
let checkRunning = false;
let checkPending = false;

function canStartAnotherDownload() {
  if (!MAX_CONCURRENT_DOWNLOADS) return true;
  return activeDownloads.size < MAX_CONCURRENT_DOWNLOADS;
}

function getRetryQueueCounts() {
  db.read();
  const total = (db.data.retryQueue || []).length;
  const due = (db.data.retryQueue || []).filter((j) => !j.inProgress && new Date(j.nextAttemptAt).getTime() <= Date.now()).length;
  return { total, due };
}

async function fetchFeedWithRetry(url, channelLabel = "") {
  let lastErr;
  for (let attempt = 0; attempt <= FEED_FETCH_RETRIES; attempt++) {
    try {
      const res = await axios.get(url, {
        validateStatus: (s) => s >= 200 && s < 300,
      });
      return res.data;
    } catch (e) {
      lastErr = e;
      const { statusCode, code } = normalizeError(e);

      // 404 is very likely permanent (channel deleted/terminated). Don't spam retries.
      if (statusCode === 404) throw e;

      // Transient network errors: retry with backoff.
      const isTimeout = code === "ETIMEDOUT" || code === "ECONNABORTED";
      const isNetwork = !!code;
      if (attempt >= FEED_FETCH_RETRIES || (!isTimeout && !isNetwork)) {
        throw e;
      }
      const delay = jitter(FEED_FETCH_BACKOFF_MS * Math.pow(2, attempt));
      console.warn(
        `[Archived V] Feed fetch retry ${attempt + 1}/${FEED_FETCH_RETRIES} for ${channelLabel || url} after ${delay}ms (${code || statusCode || "error"})`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

function startYtDlp(downloadId, downloadInfo, dir, videoLink) {
  const proc = spawn(
    "yt-dlp",
    [
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
      "--merge-output-format",
      "mp4",
      videoLink,
    ],
    { stdio: ["pipe", "pipe", "pipe"] }
  );

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
    last403Fragment: null,
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
    text
      .split(/\r?\n/)
      .forEach((line) => {
        if (line) console.warn(`[yt-dlp] ${line}`);

        // Detect 403 Forbidden retry loops (stream ended but yt-dlp keeps retrying same fragment)
        if (!tracking.killedBy403Loop && line) {
          const match403 = line.match(/Got error: HTTP Error 403.*Retrying fragment (\d+)/i);
          if (match403) {
            const fragmentNum = match403[1];
            if (tracking.last403Fragment === fragmentNum) {
              tracking.consecutive403Count++;
              // If we've seen 100+ consecutive 403 errors on the same fragment, stream has ended
              if (tracking.consecutive403Count >= 100) {
                tracking.killedBy403Loop = true;
                console.warn(
                  `[Archived V] Stopping yt-dlp for "${downloadInfo.title}" - stream appears to have ended (${tracking.consecutive403Count} consecutive 403 errors on fragment ${fragmentNum})`
                );
                try {
                  proc.kill("SIGTERM");
                } catch {}
              }
            } else {
              // Different fragment, reset counter
              tracking.last403Fragment = fragmentNum;
              tracking.consecutive403Count = 1;
            }
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
              `[Archived V] Stopping yt-dlp for auth-required video "${downloadInfo.title}" (no cookies; ${authFailure.reason}).`
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
      cleanupIntermediateFiles(dir, downloadInfo.title);
      autoMerge(dir);
      status.lastCompleted = downloadInfo.title;
      console.log(`[Archived V] Stream ended for "${downloadInfo.title}" - download complete (403 loop detected)`);
      if (process.env.PUSHOVER_APP_TOKEN && process.env.PUSHOVER_USER_TOKEN) {
        push.send({ message: `Stream ended: ${downloadInfo.title}`, title: downloadInfo.title }, () => {});
      }
      db.data.history.push({ title: downloadInfo.title, time: nowIso(), note: "stream ended" });
      // Remove any retry job for this video
      db.data.retryQueue = (db.data.retryQueue || []).filter(
        (j) => !(j.channelId === downloadInfo.channel && j.videoId === downloadInfo.videoId)
      );
      db.write();
      return;
    }

    // If watchdog or auth-skip killed it, they already handled requeue - just clean up
    if (tracking.killedByWatchdog || tracking.killedByAuthSkip) {
      db.write();
      return;
    }

    if (code === 0) {
      cleanupIntermediateFiles(dir, downloadInfo.title);
      autoMerge(dir);
      status.lastCompleted = downloadInfo.title;
      if (process.env.PUSHOVER_APP_TOKEN && process.env.PUSHOVER_USER_TOKEN) {
        push.send({ message: `Downloaded: ${downloadInfo.title}`, title: downloadInfo.title }, () => {});
      }
      db.read();
      db.data.history.push({ title: downloadInfo.title, time: nowIso() });
      // Remove any retry job for this video
      db.data.retryQueue = (db.data.retryQueue || []).filter(
        (j) => !(j.channelId === downloadInfo.channel && j.videoId === downloadInfo.videoId)
      );
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
      // Also remove any retry job to prevent scheduler churn. A small in-memory cache
      // prevents re-attempting the same video every scan cycle.
      if (!cookiesAvailable) {
        db.read();
        db.data.retryQueue = (db.data.retryQueue || []).filter(
          (j) => !(j.channelId === downloadInfo.channel && j.videoId === downloadInfo.videoId)
        );
        db.write();

        markAuthSkipped(downloadInfo.videoId);
        console.warn(
          `[Archived V] Skipping auth-required video "${downloadInfo.title}" (no cookies; ${authFailure.reason}).`
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
          `[Archived V] Skipping "${downloadInfo.title}" after ${attempts} auth failures (${authFailure.reason}).`
        );
        return;
      }

      // Continue to normal retry logic below (cookies might be temporarily invalid / network flakiness)
    }

    // If we ended up with a usable merged file, treat it as success.
    if (folderState.kind === "complete") {
      cleanupIntermediateFiles(dir, downloadInfo.title);
      autoMerge(dir);
      status.lastCompleted = downloadInfo.title;
      db.read();
      db.data.history.push({ title: downloadInfo.title, time: nowIso() });
      db.data.retryQueue = (db.data.retryQueue || []).filter(
        (j) => !(j.channelId === downloadInfo.channel && j.videoId === downloadInfo.videoId)
      );
      db.write();
      console.warn(`[Archived V] yt-dlp exited ${code} but produced a usable file for "${downloadInfo.title}"; recording as success.`);
      return;
    }

    // Soft-failure cases should be retried.
    const retryReason =
      stderr.includes("This live event will begin")
        ? "Live scheduled; retry later"
        : folderState.kind === "incomplete"
          ? "Partial/incomplete download; retry"
          : "Download failed; retry";

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

  return proc;
}

async function processRetryQueue() {
  if (retryQueueRunning) return;
  retryQueueRunning = true;
  try {
    db.read();
    if (!db.data.retryQueue) db.data.retryQueue = [];

    // Refresh counts into status
    status.retryQueue = getRetryQueueCounts();

    // Start due jobs while capacity allows
    const now = Date.now();
    const due = db.data.retryQueue
      .filter((j) => !j.inProgress && new Date(j.nextAttemptAt).getTime() <= now)
      .sort((a, b) => new Date(a.nextAttemptAt).getTime() - new Date(b.nextAttemptAt).getTime());

    for (const job of due) {
      if (!canStartAnotherDownload()) break;

      // Avoid duplicates: if already active for same channel/video, skip.
      let alreadyActive = false;
      for (const dl of activeDownloads.values()) {
        if (dl?.downloadInfo?.channel === job.channelId && dl?.downloadInfo?.videoId === job.videoId) {
          alreadyActive = true;
          break;
        }
      }
      if (alreadyActive) {
        job.inProgress = true;
        job.updatedAt = nowIso();
        continue;
      }

      const downloadId = `${job.channelId}-${job.videoId}-${Date.now()}`;
      const dir = job.dir || path.join(DOWNLOAD_DIR, job.username || job.channelId, sanitize(job.title || job.videoId));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const downloadInfo = {
        id: downloadId,
        channel: job.channelId,
        videoId: job.videoId,
        title: job.title,
        username: job.username,
        channelName: job.channelName || job.username,
        videoLink: job.videoLink,
        dir,
        startTime: nowIso(),
      };

      // Mark job as in progress and push current download
      job.inProgress = true;
      job.lastAttemptAt = nowIso();
      job.updatedAt = nowIso();

      status.currentDownloads.push(downloadInfo);
      db.read();
      db.data.currentDownloads = db.data.currentDownloads || [];
      db.data.currentDownloads.push(downloadInfo);
      db.write();

      // Persist the inProgress mark
      db.read();
      db.data.retryQueue = db.data.retryQueue.map((j) => (j.key === job.key ? job : j));
      db.write();

      const link = job.videoLink || `https://www.youtube.com/watch?v=${job.videoId}`;
      startYtDlp(downloadId, downloadInfo, dir, link);
    }
  } finally {
    retryQueueRunning = false;
  }
}

function startDownloadWatchdog() {
  setInterval(() => {
    const now = Date.now();
    for (const [downloadId, dl] of activeDownloads.entries()) {
      if (!dl?.proc || dl.proc.killed) continue;
      const runtime = now - (dl.startedAt || now);
      const quiet = now - (dl.lastOutputAt || now);

      if (runtime < DOWNLOAD_WATCHDOG_MIN_RUNTIME_MS) continue;
      if (quiet < DOWNLOAD_WATCHDOG_NO_OUTPUT_MS) continue;

      console.error(
        `[Archived V] Watchdog: killing stuck yt-dlp (no output for ${Math.round(quiet / 1000)}s) for "${dl.downloadInfo?.title}"`
      );
      try {
        dl.killedByWatchdog = true;
        dl.proc.kill("SIGTERM");
      } catch {}

      // Ensure retry is scheduled
      const info = dl.downloadInfo;
      if (info?.channel && info?.videoId) {
        db.read();
        const existing = (db.data.retryQueue || []).find((j) => j.channelId === info.channel && j.videoId === info.videoId);
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

// Pushover setup
const push = new Pushover({
  token: process.env.PUSHOVER_APP_TOKEN || "",
  user: process.env.PUSHOVER_USER_TOKEN || "",
});

// XML parser
axios.defaults.timeout = Number(process.env.AXIOS_TIMEOUT_MS) || 20000;
const xmlParser = new Parser({
  explicitArray: true,
  tagNameProcessors: [processors.stripPrefix],
});

// Sanitize titles
function sanitize(str) {
  return str.replace(/[\/\\:*?"<>|]/g, "").trim();
}

// URL validation to prevent SSRF attacks
function isValidYouTubeUrl(urlString) {
  try {
    const url = new URL(urlString);
    
    // Only allow HTTPS
    if (url.protocol !== 'https:') {
      return false;
    }
    
    // Only allow youtube.com and youtu.be domains
    const allowedDomains = ['youtube.com', 'www.youtube.com', 'youtu.be'];
    if (!allowedDomains.includes(url.hostname)) {
      return false;
    }
    
    // Prevent localhost and private IP ranges
    const hostname = url.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('127.')) {
      return false;
    }
    
    // Check for private IP ranges
    const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipMatch) {
      const [_, a, b, c, d] = ipMatch.map(Number);
      // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
      if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
        return false;
      }
    }
    
    return true;
  } catch {
    return false;
  }
}

// Safe directory cleanup - only removes truly empty directories, never deletes video files
function safeCleanupDirectory(dir, reason = "") {
  try {
    if (!fs.existsSync(dir)) {
      return { cleaned: false, reason: "Directory does not exist" };
    }
    
    const files = fs.readdirSync(dir);
    
    // Check for any video or media files that should never be deleted
    const protectedFiles = files.filter(f => 
      /\.(mp4|mkv|webm|avi|mov|flv|wmv|part|ytdl|f\d+\.mp4)$/i.test(f)
    );
    
    if (protectedFiles.length > 0) {
      console.log(`[Archived V] NOT deleting "${dir}" - contains ${protectedFiles.length} video/media file(s): ${protectedFiles.slice(0, 3).join(", ")}${protectedFiles.length > 3 ? '...' : ''}`);
      return { cleaned: false, reason: "Contains protected video files", files: protectedFiles };
    }
    
    // Only delete if truly empty (no files at all)
    if (files.length === 0) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`[Archived V] Cleaned up empty directory: ${dir}${reason ? ` (${reason})` : ''}`);
      return { cleaned: true, reason: "Empty directory removed" };
    }
    
    // Has non-video files (thumbnails, metadata, etc.) - don't delete
    console.log(`[Archived V] NOT deleting "${dir}" - contains ${files.length} file(s): ${files.slice(0, 3).join(", ")}${files.length > 3 ? '...' : ''}`);
    return { cleaned: false, reason: "Contains other files", files };
    
  } catch (e) {
    console.error(`[Archived V] Error during cleanup of "${dir}": ${e.message}`);
    return { cleaned: false, reason: e.message };
  }
}

// Clean up intermediate yt-dlp files after successful download
function cleanupIntermediateFiles(dir, title) {
  try {
    if (!fs.existsSync(dir)) return;
    
    const files = fs.readdirSync(dir);

    // Remove intermediate fragment files left by yt-dlp during live downloads.
    // Examples:
    // - <title>.f140.mp4
    // - <title>.f140.mp4.part-Frag7
    // - .f140.mp4 (older pattern)
    const fragmentFiles = files.filter((f) => {
      if (/\.part-frag\d+$/i.test(f)) return true;
      if (/^\.f\d+\.(mp4|mkv|webm|m4a|aac)$/i.test(f)) return true;
      if (/\.f\d+\.(mp4|mkv|webm|m4a|aac)$/i.test(f)) return true;
      if (/\.f\d+\.(mp4|mkv|webm|m4a|aac)\.part-frag\d+$/i.test(f)) return true;
      return false;
    });

    let removedFragments = 0;
    fragmentFiles.forEach((f) => {
      try {
        fs.unlinkSync(path.join(dir, f));
        removedFragments += 1;
      } catch (e) {
        console.warn(`[Archived V] Failed to remove fragment ${f}: ${e.message}`);
      }
    });
    
    // Remove original webp thumbnail if png exists
    const hasPng = files.some(f => f.endsWith('.png'));
    if (hasPng) {
      const webpFile = files.find(f => f.endsWith('.webp'));
      if (webpFile) {
        try {
          fs.unlinkSync(path.join(dir, webpFile));
          console.log(`[Archived V] Cleaned up duplicate thumbnail: ${webpFile}`);
        } catch (e) {
          console.warn(`[Archived V] Failed to remove duplicate thumbnail ${webpFile}: ${e.message}`);
        }
      }
    }
    
    console.log(`[Archived V] Cleanup completed for "${title}" - removed ${removedFragments} fragment file(s)`);
  } catch (e) {
    console.error(`[Archived V] Error during intermediate file cleanup: ${e.message}`);
  }
}

function zautoMerge(specificFolder = null) {
  console.log('[Archived V] Starting auto merge of audio and video files...');
  try {
    if (specificFolder) {
      mergeInFolder(specificFolder);
    } else {
      const videosFolders = findVideosFolders(DOWNLOAD_DIR);
      for (const folder of videosFolders) {
        mergeInFolder(folder);
      }
    }
  } catch (e) {
    console.error('[Archived V] Error during auto merge:', e.message);
  }
}

function findVideosFolders(root) {
  const folders = [];
  function walk(dir) {
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            if (item === 'videos') {
              const parent = path.dirname(fullPath);
              if (path.basename(parent) === 'channels') {
                folders.push(fullPath);
              }
            } else {
              walk(fullPath);
            }
          }
        } catch (e) {
          // ignore errors on individual items
        }
      }
    } catch (e) {
      // ignore errors on directories
    }
  }
  walk(root);
  return folders;
}

function mergeInFolder(folder) {
  try {
    const files = fs.readdirSync(folder);
    const titleMap = new Map();
    for (const file of files) {
      if (file.endsWith('.f299.mp4')) {
        const title = file.slice(0, -9); // remove .f299.mp4
        if (!titleMap.has(title)) titleMap.set(title, {});
        titleMap.get(title).video = file;
      } else if (file.endsWith('.f140.mp4')) {
        const title = file.slice(0, -9);
        if (!titleMap.has(title)) titleMap.set(title, {});
        titleMap.get(title).audio = file;
      }
    }
    for (const [title, parts] of titleMap) {
      if (parts.video && parts.audio) {
        const output = `${title}.mp4`;
        const outputPath = path.join(folder, output);
        if (fs.existsSync(outputPath)) {
          console.log(`[Archived V] Merged file already exists for "${title}", skipping.`);
          continue;
        }
        console.log(`[Archived V] Merging audio and video for "${title}"`);
        try {
          const proc = spawn('ffmpeg', [
            '-i', path.join(folder, parts.video),
            '-i', path.join(folder, parts.audio),
            '-c', 'copy',
            outputPath
          ], { stdio: 'inherit' });
          proc.on('close', (code) => {
            if (code === 0) {
              console.log(`[Archived V] Successfully merged "${title}"`);
              // remove the parts
              try {
                fs.unlinkSync(path.join(folder, parts.video));
                fs.unlinkSync(path.join(folder, parts.audio));
                // also remove .ytdl files if exist
                const ytdlVideo = `${parts.video}.ytdl`;
                const ytdlAudio = `${parts.audio}.ytdl`;
                const ytdlVideoPath = path.join(folder, ytdlVideo);
                const ytdlAudioPath = path.join(folder, ytdlAudio);
                if (fs.existsSync(ytdlVideoPath)) fs.unlinkSync(ytdlVideoPath);
                if (fs.existsSync(ytdlAudioPath)) fs.unlinkSync(ytdlAudioPath);
              } catch (e) {
                console.warn(`[Archived V] Failed to clean up parts for "${title}": ${e.message}`);
              }
            } else {
              console.error(`[Archived V] Failed to merge "${title}", ffmpeg exit code ${code}`);
            }
          });
        } catch (e) {
          console.error(`[Archived V] Error starting ffmpeg for "${title}": ${e.message}`);
        }
      }
    }
  } catch (e) {
    console.error(`[Archived V] Error merging in folder ${folder}: ${e.message}`);
  }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: "6mb" }));

// Serve static files in production
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "..", "dist")));
}

// API: Get config
app.get("/api/config", (req, res) => {
  db.read();
  res.json({ 
    channels: db.data.channels, 
    keywords: db.data.keywords,
    ignoreKeywords: db.data.ignoreKeywords || [],
    dateFormat: db.data.dateFormat || 'YYYY-MM-DD'
  });
});

// API: Cookies/auth settings (members-only videos)
app.get("/api/auth", authFsLimiter, (req, res) => {
  db.read();
  const useCookies = !!db.data?.auth?.useCookies;
  const cookiesFilePresent = fs.existsSync(YTDLP_COOKIES_PATH);
  res.json({
    useCookies,
    cookiesFilePresent,
    cookiesPathHint: path.basename(YTDLP_COOKIES_PATH),
  });
});

app.post("/api/auth", authFsLimiter, (req, res) => {
  const { useCookies } = req.body || {};
  if (typeof useCookies !== "boolean") {
    return res.status(400).json({ error: "useCookies must be boolean" });
  }

  db.read();
  if (!db.data.auth) db.data.auth = { useCookies: false };
  db.data.auth.useCookies = useCookies;
  db.write();

  const cookiesFilePresent = fs.existsSync(YTDLP_COOKIES_PATH);
  // If cookies are enabled, allow previously skipped IDs to be retried.
  if (useCookies && cookiesFilePresent) authSkipCache.clear();

  res.json({ ok: true, useCookies, cookiesFilePresent });
});

app.put("/api/auth/cookies", authFsLimiter, (req, res) => {
  const { cookiesText } = req.body || {};
  if (typeof cookiesText !== "string" || cookiesText.trim().length === 0) {
    return res.status(400).json({ error: "cookiesText is required" });
  }
  if (Buffer.byteLength(cookiesText, "utf8") > 5 * 1024 * 1024) {
    return res.status(413).json({ error: "cookiesText too large" });
  }

  try {
    const dir = path.dirname(YTDLP_COOKIES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(YTDLP_COOKIES_PATH, cookiesText, { encoding: "utf8" });
    try {
      fs.chmodSync(YTDLP_COOKIES_PATH, 0o600);
    } catch {}

    db.read();
    if (!db.data.auth) db.data.auth = { useCookies: false };
    db.data.auth.useCookies = true;
    db.write();

    authSkipCache.clear();
    res.json({ ok: true, cookiesFilePresent: true, useCookies: true });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

app.delete("/api/auth/cookies", authFsLimiter, (req, res) => {
  try {
    if (fs.existsSync(YTDLP_COOKIES_PATH)) {
      fs.rmSync(YTDLP_COOKIES_PATH, { force: true });
    }
    db.read();
    if (!db.data.auth) db.data.auth = { useCookies: false };
    db.data.auth.useCookies = false;
    db.write();
    res.json({ ok: true, cookiesFilePresent: false, useCookies: false });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// API: Add channel
app.post("/api/channels", async (req, res) => {
  let { link } = req.body;
  if (!link) return res.status(400).json({ error: "No link provided" });
  
  // Trim whitespace
  link = link.trim();
  
  let id, xmlLink, username;
  
  // Handle plain username input (with or without @)
  // Match: @username, username (no spaces, no special URL characters)
  const plainHandleMatch = link.match(/^@?([a-zA-Z0-9_-]+)$/);
  if (plainHandleMatch) {
    username = plainHandleMatch[1];
    
    // Sanitize username to prevent URL manipulation
    // Only allow alphanumeric, underscore, and hyphen
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return res.status(400).json({ error: "Invalid username format" });
    }
    
    const aboutUrl = `https://www.youtube.com/@${username}/about`;
    if (!isValidYouTubeUrl(aboutUrl)) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }
    try {
      const html = (await axios.get(aboutUrl)).data;
      const canonMatch = html.match(
        /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/([^\"]+)"/
      );
      if (!canonMatch)
        return res.status(400).json({ error: "Unable to resolve handle to channel ID" });
      id = canonMatch[1];
    } catch {
      return res.status(400).json({ error: "Failed to fetch channel page" });
    }
    xmlLink = `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
  }
  // Handle YouTube handle URLs (/@username)
  else if (link.match(/youtube\.com\/@([^\/\?]+)/)) {
    const handleMatch = link.match(/youtube\.com\/@([^\/\?]+)/);
    username = handleMatch[1];
    
    // Sanitize username to prevent URL manipulation
    // Only allow alphanumeric, underscore, and hyphen
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return res.status(400).json({ error: "Invalid username format" });
    }
    
    const aboutUrl = `https://www.youtube.com/@${username}/about`;
    if (!isValidYouTubeUrl(aboutUrl)) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }
    try {
      const html = (await axios.get(aboutUrl)).data;
      const canonMatch = html.match(
        /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/([^\"]+)"/
      );
      if (!canonMatch)
        return res.status(400).json({ error: "Unable to resolve handle to channel ID" });
      id = canonMatch[1];
    } catch {
      return res.status(400).json({ error: "Failed to fetch channel page" });
    }
    xmlLink = `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
  } else {
    // If user provided the raw feed URL
    const feedMatch = link.match(/feeds\/videos\.xml\?channel_id=([^&]+)/);
    if (feedMatch) {
      id = feedMatch[1].replace(/^@/, "");
      xmlLink = `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
    } else {
      try {
        const u = new URL(link);
        id = u.searchParams.get("channel_id") || link.split("/").pop();
      } catch {
        return res.status(400).json({ error: "Invalid link" });
      }
      xmlLink = `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
    }
    username = id;
  }
  
  db.read();
  const existing = db.data.channels.find((c) => c.id === id);
  
  // Try to fetch the actual channel name from RSS feed
  let channelName = username;
  try {
    if (!isValidYouTubeUrl(xmlLink)) {
      console.error(`Invalid RSS URL for channel ${username}: ${xmlLink}`);
      channelName = username; // fallback
    } else {
      const xml = (await axios.get(xmlLink)).data;
      const result = await xmlParser.parseStringPromise(xml);
      if (result.feed.author && result.feed.author[0] && result.feed.author[0].name && result.feed.author[0].name[0]) {
        channelName = result.feed.author[0].name[0];
      }
    }
  } catch (e) {
    console.warn("Failed to fetch channel name from RSS, using username");
  }
  
  if (!existing) {
    // Final validation before saving
    if (!isValidYouTubeUrl(xmlLink)) {
      return res.status(400).json({ error: "Generated RSS URL is invalid" });
    }
    db.data.channels.push({ id, link: xmlLink, username, channelName });
  } else {
    // Validate existing link too
    if (!isValidYouTubeUrl(xmlLink)) {
      return res.status(400).json({ error: "Generated RSS URL is invalid" });
    }
    if (!existing.username) existing.username = username;
    if (!existing.channelName) existing.channelName = channelName;
  }
  db.write();
  res.json({ id, link: xmlLink, username, channelName });
});

// API: Delete channel
app.delete("/api/channels/:id", (req, res) => {
  const { id } = req.params;
  db.read();
  db.data.channels = db.data.channels.filter((c) => c.id !== id);
  db.write();
  res.json({ success: true });
});

// API: Add keyword
app.post("/api/keywords", (req, res) => {
  const { keyword } = req.body;
  if (!keyword) return res.status(400).json({ error: "No keyword provided" });
  db.read();
  if (!db.data.keywords.includes(keyword)) {
    db.data.keywords.push(keyword);
    db.write();
  }
  res.json({ success: true });
});

// API: Delete keyword
app.delete("/api/keywords/:keyword", (req, res) => {
  const { keyword } = req.params;
  db.read();
  db.data.keywords = db.data.keywords.filter((k) => k !== keyword);
  db.write();
  res.json({ success: true });
});

// API: Add ignore keyword
app.post("/api/ignore-keywords", (req, res) => {
  const { keyword } = req.body;
  if (!keyword) return res.status(400).json({ error: "No keyword provided" });
  db.read();
  if (!db.data.ignoreKeywords) db.data.ignoreKeywords = [];
  if (!db.data.ignoreKeywords.includes(keyword)) {
    db.data.ignoreKeywords.push(keyword);
    db.write();
  }
  res.json({ success: true });
});

// API: Delete ignore keyword
app.delete("/api/ignore-keywords/:keyword", (req, res) => {
  const { keyword } = req.params;
  db.read();
  if (!db.data.ignoreKeywords) db.data.ignoreKeywords = [];
  db.data.ignoreKeywords = db.data.ignoreKeywords.filter((k) => k !== keyword);
  db.write();
  res.json({ success: true });
});

// API: Update date format
app.post("/api/date-format", (req, res) => {
  const { dateFormat } = req.body;
  if (!dateFormat || !['YYYY-MM-DD', 'MM-DD-YYYY'].includes(dateFormat)) {
    return res.status(400).json({ error: "Invalid date format. Must be 'YYYY-MM-DD' or 'MM-DD-YYYY'" });
  }
  db.read();
  db.data.dateFormat = dateFormat;
  db.write();
  res.json({ success: true, dateFormat });
});

// API: Get status
app.get("/api/status", (req, res) => {
  res.json(status);
});

// API: Cancel download
app.delete("/api/downloads/:downloadId", (req, res) => {
  const { downloadId } = req.params;
  
  const download = activeDownloads.get(downloadId);
  if (!download) {
    return res.status(404).json({ error: "Download not found or already completed" });
  }
  
  try {
    // Kill the yt-dlp process
    download.proc.kill('SIGTERM');
    
    // Remove from active downloads
    activeDownloads.delete(downloadId);
    
    // Remove from status and database
    status.currentDownloads = status.currentDownloads.filter(d => d.id !== downloadId);
    db.read();
    db.data.currentDownloads = db.data.currentDownloads.filter(d => d.id !== downloadId);
    
    // Add the cancelled video title to ignore keywords to prevent re-downloading
    if (!db.data.ignoreKeywords) db.data.ignoreKeywords = [];
    const cancelledTitle = download.downloadInfo.title;
    if (!db.data.ignoreKeywords.includes(cancelledTitle)) {
      db.data.ignoreKeywords.push(cancelledTitle);
      console.log(`[Archived V] Added cancelled video to ignore list: ${cancelledTitle}`);
    }
    
    db.write();
    
    // Clean up the download directory after a delay to allow process to release file handles
    // ONLY removes empty directories - never deletes video files
    setTimeout(() => {
      if (download.dir) {
        safeCleanupDirectory(download.dir, "cancelled download");
      }
    }, 10000);
    
    console.log(`[Archived V] Cancelled download: ${cancelledTitle}`);
    res.json({ success: true, message: "Download cancelled and added to ignore list" });
  } catch (err) {
    console.error(`[Archived V] Error cancelling download: ${err.message}`);
    res.status(500).json({ error: "Failed to cancel download" });
  }
});

// API: Get history
app.get("/api/history", (req, res) => {
  db.read();
  res.json(db.data.history || []);
});

// API: Clear history
app.delete("/api/history", (req, res) => {
  db.read();
  db.data.history = [];
  db.write();
  res.json({ success: true });
});

// API: Manual refresh
app.post("/api/refresh", (req, res) => {
  status.current = null;
  checkUpdates().catch((err) => console.error("Refresh error:", err));
  res.json(status);
  
  const now = new Date();
  const timeStr = now.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  console.log(`[${now.toISOString()}][${timeStr}] Manual Checking for New Streams`);
});

// Download job
async function checkUpdates() {
  if (checkRunning) {
    checkPending = true;
    return;
  }

  checkRunning = true;
  checkPending = false;

  try {
    db.read();
  
  // Remove duplicates from currentDownloads based on unique video ID
  // Keep only the first occurrence of each channel-video combination
  const seenVideos = new Set();
  const uniqueDownloads = [];
  
  for (const download of db.data.currentDownloads) {
    // Extract video identifier from the download (channel + video portion of ID)
    const idParts = download.id.split('-');
    const videoKey = `${download.channel}-${idParts[1]}`; // channel-videoId
    
    if (!seenVideos.has(videoKey)) {
      seenVideos.add(videoKey);
      uniqueDownloads.push(download);
    }
  }
  
  // Update with deduplicated list if there were duplicates
  if (uniqueDownloads.length !== db.data.currentDownloads.length) {
    db.data.currentDownloads = uniqueDownloads;
    status.currentDownloads = uniqueDownloads;
    db.write();
  } else {
    status.currentDownloads = db.data.currentDownloads;
  }
  
  const channels = db.data.channels;
  const keywords = db.data.keywords.map((k) => k.toLowerCase());
  const ignoreKeywords = (db.data.ignoreKeywords || []).map((k) => k.toLowerCase());

    // Kick retry queue first so failed/partial work gets priority.
    await processRetryQueue();

    for (const ch of channels) {
      try {
      // Validate URL before making request to prevent SSRF
      if (!isValidYouTubeUrl(ch.link)) {
        console.error(`Skipping invalid channel URL: ${ch.link}`);
        continue;
      }
      const xml = await fetchFeedWithRetry(ch.link, ch.username || ch.id);
      
      // Feed succeeded - clear any 404 suppression for this channel
      clearFeed404(ch.id);
      
      const result = await xmlParser.parseStringPromise(xml);
      const entries = result.feed.entry || [];
      
      // Extract actual channel name from RSS feed
      let channelName = ch.username; // fallback to username
      if (result.feed.author && result.feed.author[0] && result.feed.author[0].name && result.feed.author[0].name[0]) {
        channelName = result.feed.author[0].name[0];
        // Update channel name in database if not already set or different
        if (!ch.channelName || ch.channelName !== channelName) {
          db.read();
          const channelToUpdate = db.data.channels.find(c => c.id === ch.id);
          if (channelToUpdate) {
            channelToUpdate.channelName = channelName;
            db.write();
          }
          ch.channelName = channelName;
        }
      }
      
      const channelDir = path.join(DOWNLOAD_DIR, ch.username);
      if (!fs.existsSync(channelDir))
        fs.mkdirSync(channelDir, { recursive: true });
      
      for (const entry of entries) {
        const videoId = entry.videoId ? entry.videoId[0] : entry["yt:videoId"][0];
        const title = entry.title[0];
        const linkObj = entry.link.find((l) => l.$ && l.$.href);
        const videoLink = linkObj ? linkObj.$.href : ch.link;
        
        // Extract upload date from RSS feed (published field)
        let uploadDate = new Date();
        if (entry.published && entry.published[0]) {
          uploadDate = new Date(entry.published[0]);
        }
        
        // Format date based on user setting
        const year = uploadDate.getFullYear();
        const month = String(uploadDate.getMonth() + 1).padStart(2, "0");
        const day = String(uploadDate.getDate()).padStart(2, "0");
        
        const dateFormat = db.data.dateFormat || 'YYYY-MM-DD';
        let datePrefix;
        if (dateFormat === 'MM-DD-YYYY') {
          datePrefix = `[${month}-${day}-${year}] `;
        } else {
          datePrefix = `[${year}-${month}-${day}] `;
        }
        
        const folderName = `${datePrefix}${sanitize(title)}`;
        let dir = path.join(channelDir, folderName);
        
        // Check ignore keywords - exclude if any ignore keyword is found
        const shouldIgnore = ignoreKeywords.some((k) => title.toLowerCase().includes(k));
        if (shouldIgnore) {
          continue;
        }
        
        // Check keyword match if keywords are set
        if (keywords.length > 0) {
          const match = keywords.some((k) => title.toLowerCase().includes(k));
          if (!match) {
            continue;
          }
        }
        
        const sanitizedTitle = sanitize(title);
        let alreadyDownloaded = false;
        let isCurrentlyDownloading = false;
        let resumeDir = null;

        // If cookies aren't configured and we've already seen an auth-required failure for this video,
        // skip it to avoid repeatedly attempting it every scan.
        if (!canUseCookies() && isAuthSkipped(videoId)) {
          continue;
        }
        
        // CHECK 1: Is this video currently being downloaded by an active process?
        for (const [downloadId, download] of activeDownloads.entries()) {
          if (download.downloadInfo.channel === ch.id && 
              download.downloadInfo.title === title) {
            isCurrentlyDownloading = true;
            console.log(`[Archived V] Skipping "${title}" - already downloading (ID: ${downloadId})`);
            break;
          }
        }
        
        if (isCurrentlyDownloading) continue;
        
        // CHECK 2: Does the folder exist with video files (completed or partial)?
        try {
          const channelFolders = fs.readdirSync(channelDir, { withFileTypes: true });
          for (const folder of channelFolders) {
            if (folder.isDirectory()) {
              // Match both YYYY-MM-DD and MM-DD-YYYY formats
              const folderTitle = folder.name.replace(/^\[\d{2,4}-\d{2}-\d{2,4}\]\s*/, "");
              if (folderTitle === sanitizedTitle) {
                const folderPath = path.join(channelDir, folder.name);
                const state = inspectDownloadFolder(folderPath);

                if (state.kind === "complete") {
                  alreadyDownloaded = true;
                  break;
                }

                if (state.kind === "incomplete" || state.kind === "metadata") {
                  // Incomplete or metadata-only folders should be retried/resumed, not treated as complete.
                  resumeDir = folderPath;
                  break;
                }

                if (state.kind === "empty") {
                  console.log(`[Archived V] Removing empty folder: ${folderPath}`);
                  fs.rmSync(folderPath, { recursive: true, force: true });
                }
              }
            }
          }
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        
        if (alreadyDownloaded) continue;

        if (resumeDir) {
          dir = resumeDir;
        }

        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Enqueue this as a retry job (new match) and let the scheduler start it.
        upsertRetryJob(
          {
            channelId: ch.id,
            videoId,
            title,
            username: ch.username,
            channelName: ch.channelName || ch.username,
            videoLink,
            dir,
          },
          {
            nextAttemptAt: nowIso(),
            inProgress: false,
          }
        );
      }
      } catch (e) {
        const { statusCode, code, message } = normalizeError(e);
        if (statusCode === 404) {
          // Only log first occurrence, then suppress for 1 hour to reduce log spam
          if (shouldLogFeed404(ch.id)) {
            console.warn(`[${nowIso()}] Feed 404 for channel ${ch.username} (${ch.id}). Skipping this cycle (will suppress repeated logs for 1h).`);
          }
        } else if (code === "ETIMEDOUT" || code === "ECONNABORTED") {
          console.warn(`[${nowIso()}] Timeout fetching feed for channel ${ch.username}`);
        } else {
          console.error(`[Archived V] Feed error for channel ${ch.username}: ${message}`);
        }
      }
    }

    // Log summary of 404 channels if any (less spammy than individual logs)
    if (feed404Cache.size > 0) {
      console.log(`[${nowIso()}] Feed check complete. ${feed404Cache.size} channel(s) returning 404 (suppressing repeated logs).`);
    }
  
    status.lastRun = new Date().toISOString();

    // Try starting any newly enqueued jobs.
    await processRetryQueue();
  
  let total = 0;
  for (const ch of db.data.channels) {
    const channelDir = path.join(DOWNLOAD_DIR, ch.username);
    if (fs.existsSync(channelDir)) {
      const items = fs.readdirSync(channelDir, { withFileTypes: true });
      total += items.filter((d) => d.isDirectory()).length;
    }
  }
    status.downloadedCount = total;

    status.retryQueue = getRetryQueueCounts();
  } finally {
    checkRunning = false;
    if (checkPending) {
      checkPending = false;
      // Run one more pass if something requested while we were running
      setImmediate(() => {
        checkUpdates().catch((err) => console.error("Queued check error:", err));
      });
    }
  }
}

// Serve React app in production
if (process.env.NODE_ENV === "production") {
  app.use(staticFsLimiter, (req, res) => {
    res.sendFile(path.join(__dirname, "..", "dist", "index.html"));
  });
}

// Start cron + server
cron.schedule("*/10 * * * *", () => {
  const now = new Date();
  const timeStr = now.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  console.log(`[${now.toISOString()}][${timeStr}] Scheduled Checking for New Streams`);
  // Always run check - it will handle concurrent downloads internally
  checkUpdates().catch((err) => console.error("Cron error:", err));
});

// Retry scheduler and watchdog
setInterval(() => {
  processRetryQueue().catch((err) => console.error("Retry queue error:", err));
}, 60 * 1000);

startDownloadWatchdog();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  
  // Run initial check for new streams on startup
  console.log("Running initial check for new streams...");
  checkUpdates().catch((err) => console.error("Startup refresh error:", err));

  // Run auto merge on startup
  autoMerge();
});
