import fs from "fs";
import path from "path";
import axios from "axios";
import { Parser, processors } from "xml2js";

import db from "./database.js";
import { autoMerge, isFolderBusy } from "./merger.js";
import { isAuthSkipped } from "./auth.js";
import { sleep, jitter, normalizeError, sanitize, isValidYouTubeUrl, nowIso, isSafeIdentifier, isSafeDownloadPath, downloadDirectory } from "./utils.js";
import {
  status,
  activeDownloads,
  canStartAnotherDownload,
  getRetryQueueCounts,
  inspectDownloadFolder,
  recordDownloadSuccess,
  upsertRetryJob,
  isScheduledStream,
  startYtDlp,
} from "./downloader.js";
import {
  DOWNLOAD_DIR,
  FEED_FETCH_RETRIES,
  FEED_FETCH_BACKOFF_MS,
  FEED_404_LOG_INTERVAL_MS,
  FEED_CHANNEL_DELAY_MS,
  FEED_BATCH_SIZE,
  FEED_BATCH_PAUSE_MS,
  SCHEDULED_STREAM_LEAD_TIME_MS,
  AXIOS_TIMEOUT_MS,
} from "./config.js";

// Set axios defaults
axios.defaults.timeout = AXIOS_TIMEOUT_MS;

// XML parser
const xmlParser = new Parser({
  explicitArray: true,
  tagNameProcessors: [processors.stripPrefix],
});

// Track feed 404 errors to reduce log spam - only log first occurrence
// Map: channelId -> { firstSeenAt: Date, lastLoggedAt: Date }
const feed404Cache = new Map();
let stopping = false;

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

// Fisher-Yates shuffle (in-place)
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Process scheduled streams: promote to retry queue when near their start time
export async function processScheduledStreams() {
  if (stopping) return;
  db.read();
  if (!db.data.scheduledStreams || db.data.scheduledStreams.length === 0) return;

  const now = Date.now();
  const promoted = [];
  const kept = [];

  const channelIds = new Set(db.data.channels.map((channel) => channel.id));
  const ignored = db.data.ignoreKeywords.map((keyword) => keyword.toLowerCase());
  for (const stream of db.data.scheduledStreams) {
    if (!channelIds.has(stream.channelId) || ignored.some((keyword) => String(stream.title).toLowerCase().includes(keyword))) continue;
    const scheduledTime = new Date(stream.scheduledFor).getTime();
    const timeUntilStart = scheduledTime - now;

    if (!Number.isFinite(scheduledTime) || timeUntilStart <= SCHEDULED_STREAM_LEAD_TIME_MS) {
      // Time to start checking — promote to retry queue
      promoted.push(stream);
    } else {
      kept.push(stream);
    }
  }

  if (promoted.length > 0) {
    for (const stream of promoted) {
      console.log(
        `[INFO] [Archived V] Promoting scheduled stream to download queue: "${stream.title}"`
      );
      upsertRetryJob(
        {
          channelId: stream.channelId,
          videoId: stream.videoId,
          title: stream.title,
          username: stream.username,
          channelName: stream.channelName,
          videoLink: stream.videoLink,
          dir: stream.dir,
        },
        {
          nextAttemptAt: nowIso(),
          inProgress: false,
        }
      );
    }
  }
  // Persist removal only after every promoted job is durable. A crash can leave
  // duplicate identities across queues; idempotent upserts reconcile them.
  db.read();
  db.data.scheduledStreams = kept;
  db.write();
}

// Headers for YouTube RSS feed requests.
// YouTube blocks the default axios User-Agent ("axios/x.x.x") with 404.
// A standard browser UA is needed since YouTube RSS is a public endpoint
// that serves content to browsers and legitimate feed readers.
const FEED_REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/atom+xml, application/xml, text/xml, */*",
};

async function fetchFeedWithRetry(url, channelLabel = "") {
  let lastErr;
  for (let attempt = 0; attempt <= FEED_FETCH_RETRIES; attempt++) {
    try {
      const res = await axios.get(url, {
        headers: FEED_REQUEST_HEADERS,
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 300,
      });
      return res.data;
    } catch (e) {
      lastErr = e;
      const { statusCode, code } = normalizeError(e);

      // Determine if this error is retryable
      const isNetworkError = code === "ETIMEDOUT" || code === "ECONNABORTED" || code === "ECONNRESET" || code === "ENOTFOUND";
      const isRetryableStatus = statusCode === 429 || (statusCode >= 500 && statusCode < 600);

      if (attempt >= FEED_FETCH_RETRIES || (!isNetworkError && !isRetryableStatus)) {
        throw e;
      }
      const delay = jitter(FEED_FETCH_BACKOFF_MS * Math.pow(2, attempt));
      console.warn(
        `[WARN] [Archived V] Feed fetch retry ${attempt + 1}/${FEED_FETCH_RETRIES} for ${channelLabel || url} after ${delay}ms (${statusCode || code || "error"})`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

let retryQueueRunning = false;
let checkRunning = false;
let checkPending = false;

export async function processRetryQueue() {
  if (stopping || retryQueueRunning) return;
  retryQueueRunning = true;
  try {
    db.read();
    if (!db.data.retryQueue) db.data.retryQueue = [];

    // Deduplicate retry queue by key (keep most recent)
    const uniqueJobs = new Map();
    for (const job of db.data.retryQueue) {
      const existing = uniqueJobs.get(job.key);
      if (!existing || new Date(job.updatedAt) > new Date(existing.updatedAt)) {
        uniqueJobs.set(job.key, job);
      }
    }
    if (uniqueJobs.size !== db.data.retryQueue.length) {
      db.data.retryQueue = Array.from(uniqueJobs.values());
      db.write();
      console.log(`[INFO] [Archived V] Deduplicated retry queue: ${db.data.retryQueue.length} unique jobs`);
    }

    // Refresh counts into status
    status.retryQueue = getRetryQueueCounts();

    const ignoreKeywords = (db.data.ignoreKeywords || []).map((k) => k.toLowerCase());

    // Reset stale inProgress flags (jobs marked as inProgress but not actually active)
    let resetCount = 0;
    for (const job of db.data.retryQueue) {
      if (job.inProgress) {
        let foundActive = false;
        for (const dl of activeDownloads.values()) {
          if (dl?.downloadInfo?.channel === job.channelId && dl?.downloadInfo?.videoId === job.videoId) {
            foundActive = true;
            break;
          }
        }
        if (!foundActive) {
          job.inProgress = false;
          job.updatedAt = nowIso();
          resetCount++;
        }
      }
    }
    if (resetCount > 0) {
      db.write();
      console.log(`[INFO] [Archived V] Reset ${resetCount} stale inProgress flag(s) in retry queue`);
    }

    // Start due jobs while capacity allows
    const now = Date.now();
    const due = db.data.retryQueue
      .filter((j) => !j.inProgress && new Date(j.nextAttemptAt).getTime() <= now)
      .sort((a, b) => new Date(a.nextAttemptAt).getTime() - new Date(b.nextAttemptAt).getTime());

    for (const job of due) {
      db.read();
      if (!isSafeIdentifier(job.channelId) || !isSafeIdentifier(job.videoId) ||
          !db.data.channels.some((channel) => channel.id === job.channelId) || isAuthSkipped(job.videoId)) {
        db.data.retryQueue = db.data.retryQueue.filter((entry) => entry.key !== job.key);
        db.write();
        continue;
      }
      // Check ignore keywords - skip and remove if matches
      if (ignoreKeywords.some((k) => String(job.title || "").toLowerCase().includes(k))) {
        db.data.retryQueue = db.data.retryQueue.filter((j) => j.key !== job.key);
        db.write();
        console.log(`[INFO] [Archived V] Skipping retry for "${job.title}" - matches ignore keyword`);
        continue;
      }

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
        // Mark as in progress and persist to avoid re-attempting
        job.inProgress = true;
        job.updatedAt = nowIso();
        db.data.retryQueue = db.data.retryQueue.map((j) => (j.key === job.key ? job : j));
        db.write();
        console.log(`[INFO] [Archived V] Skipping retry queue job for "${job.title}" - already downloading`);
        continue;
      }

      const downloadId = `${job.channelId}-${job.videoId}-${Date.now()}`;
      let dir;
      try {
        dir = job.dir || downloadDirectory({ id: job.channelId, username: job.username }, job.videoId, job.title, job.createdAt, db.data.dateFormat);
        if (!isSafeDownloadPath(dir)) throw new Error("Unsafe archive directory");
        if (isFolderBusy(dir)) continue;
        fs.mkdirSync(dir, { recursive: true });
      } catch (error) {
        upsertRetryJob(job, { lastError: error.message, nextAttemptAt: new Date(Date.now() + 60000).toISOString(), inProgress: false });
        continue;
      }

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

      if (inspectDownloadFolder(dir).kind === "complete") {
        recordDownloadSuccess(dir, downloadInfo);
        continue;
      }
      // Mark job as in progress and push current download
      job.inProgress = true;
      job.lastAttemptAt = nowIso();
      job.updatedAt = nowIso();

      status.currentDownloads.push(downloadInfo);
      db.read();
      db.data.currentDownloads = db.data.currentDownloads || [];
      db.data.currentDownloads.push(downloadInfo);

      // Persist the inProgress mark in the same write operation
      db.data.retryQueue = db.data.retryQueue.map((j) => (j.key === job.key ? job : j));
      db.write();

      const link = job.videoLink || `https://www.youtube.com/watch?v=${job.videoId}`;
      try {
        startYtDlp(downloadId, downloadInfo, dir, link);
      } catch (error) {
        status.currentDownloads = status.currentDownloads.filter((item) => item.id !== downloadId);
        db.read();
        db.data.currentDownloads = db.data.currentDownloads.filter((item) => item.id !== downloadId);
        db.write();
        upsertRetryJob(job, { lastError: error.message, inProgress: false, nextAttemptAt: new Date(Date.now() + 60000).toISOString() });
      }
    }
  } finally {
    retryQueueRunning = false;
  }
}

export async function checkUpdates() {
  if (stopping) return;
  if (checkRunning) {
    checkPending = true;
    return;
  }

  checkRunning = true;
  checkPending = false;

  try {
    db.read();

    // Remove duplicates from currentDownloads based on unique video ID
    const seenVideos = new Set();
    const uniqueDownloads = [];

    for (const download of db.data.currentDownloads) {
      // IDs may contain hyphens; use explicit identity when available.
      const videoKey = download.videoId
        ? `${download.channel}-${download.videoId}`
        : download.id;

      if (!seenVideos.has(videoKey)) {
        seenVideos.add(videoKey);
        uniqueDownloads.push(download);
      }
    }

    // Also remove currentDownloads that are not in activeDownloads (stale entries)
    const activeCurrentDownloads = uniqueDownloads.filter((download) => {
      return activeDownloads.has(download.id);
    });

    // Update with deduplicated and validated list
    if (activeCurrentDownloads.length !== db.data.currentDownloads.length) {
      const removedCount = db.data.currentDownloads.length - activeCurrentDownloads.length;
      db.data.currentDownloads = activeCurrentDownloads;
      status.currentDownloads = activeCurrentDownloads;
      db.write();
      if (removedCount > 0) {
        console.log(`[INFO] [Archived V] Removed ${removedCount} stale currentDownloads entry(ies)`);
      }
    } else {
      status.currentDownloads = db.data.currentDownloads;
    }

    const channels = db.data.channels;

    // Kick retry queue and process scheduled streams first so failed/partial work gets priority.
    await processScheduledStreams();
    await processRetryQueue();
    if (stopping) return;

    let feedSuccessCount = 0;
    let feedFailCount = 0;

    // Shuffle channel order each cycle to distribute rate-limit impact
    const shuffledChannels = shuffleArray([...channels]);
    // Track adaptive delay: increase on failures, reset on success
    let currentDelay = FEED_CHANNEL_DELAY_MS;

    for (let i = 0; i < shuffledChannels.length; i++) {
      const ch = shuffledChannels[i];
      try {
        // Throttle between channel requests with adaptive delay
        if (i > 0) {
          await sleep(jitter(currentDelay));
        }

        // Extra pause between batches to create natural gaps
        if (i > 0 && i % FEED_BATCH_SIZE === 0) {
          await sleep(jitter(FEED_BATCH_PAUSE_MS));
        }
        if (stopping) return;

        // Validate URL before making request to prevent SSRF
        if (!isValidYouTubeUrl(ch.link)) {
          console.error(`[ERROR] [Archived V] Skipping invalid channel URL: ${ch.link}`);
          continue;
        }
        const xml = await fetchFeedWithRetry(ch.link, ch.username || ch.id);

        // Feed succeeded - clear any 404 suppression for this channel
        clearFeed404(ch.id);
        feedSuccessCount++;
        // Reset adaptive delay on success
        currentDelay = FEED_CHANNEL_DELAY_MS;

        const result = await xmlParser.parseStringPromise(xml);
        if (stopping) return;
        const entries = result?.feed?.entry || [];
        db.read();
        // Requests can remove channels or change filters while the feed fetch is pending.
        if (!db.data.channels.some((channel) => channel.id === ch.id)) continue;
        const keywords = db.data.keywords.map((keyword) => keyword.toLowerCase());
        const ignoreKeywords = db.data.ignoreKeywords.map((keyword) => keyword.toLowerCase());

        // Extract actual channel name from RSS feed
        let channelName = ch.username; // fallback to username
        if (
          result.feed.author &&
          result.feed.author[0] &&
          result.feed.author[0].name &&
          result.feed.author[0].name[0]
        ) {
          channelName = result.feed.author[0].name[0];
          // Update channel name in database if not already set or different
          if (!ch.channelName || ch.channelName !== channelName) {
            db.read();
            const channelToUpdate = db.data.channels.find((c) => c.id === ch.id);
            if (channelToUpdate) {
              channelToUpdate.channelName = channelName;
              db.write();
            }
            ch.channelName = channelName;
          }
        }

        if (!isSafeIdentifier(ch.username || ch.id)) continue;
        const channelDir = path.join(DOWNLOAD_DIR, ch.username || ch.id);
        if (!isSafeDownloadPath(channelDir)) continue;
        if (!fs.existsSync(channelDir)) fs.mkdirSync(channelDir, { recursive: true });

        for (const entry of entries) {
          const videoId = entry.videoId?.[0];
          const title = entry.title?.[0];
          if (!isSafeIdentifier(videoId) || typeof title !== "string" || !title.trim()) continue;
          const videoLink = `https://www.youtube.com/watch?v=${videoId}`;
          let dir = downloadDirectory(ch, videoId, title, entry.published?.[0], db.data.dateFormat);

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

          if (isAuthSkipped(videoId) || isScheduledStream(ch.id, videoId)) continue;
          if ([...activeDownloads.values()].some((download) => download.downloadInfo.channel === ch.id && download.downloadInfo.videoId === videoId)) continue;

          // Stable identity wins over mutable titles and date-format preferences.
          const queued = db.data.retryQueue.find((job) => job.channelId === ch.id && job.videoId === videoId);
          const saved = db.data.history.find((item) => item.channelId === ch.id && item.videoId === videoId && item.status !== "skipped");
          if (queued?.dir) dir = queued.dir;
          else if (saved?.dir && fs.existsSync(saved.dir)) dir = saved.dir;
          else {
            const folders = fs.readdirSync(channelDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
            const identified = folders.find((entry) => entry.name.endsWith(` [${videoId}]`));
            if (identified) dir = path.join(channelDir, identified.name);
            else if (saved) {
              // Legacy folders have no ID. Reuse only when saved history identifies
              // this title uniquely; never conflate unrelated same-title streams.
              const sameTitle = db.data.history.filter((item) => item.channelId === ch.id && item.title === title);
              const legacy = folders.filter((entry) => entry.name.replace(/^\[\d{2,4}-\d{2}-\d{2,4}\]\s*/, "") === sanitize(title));
              if (sameTitle.length === 1 && legacy.length === 1) dir = path.join(channelDir, legacy[0].name);
            }
          }
          if (!isSafeDownloadPath(dir)) continue;
          if (inspectDownloadFolder(dir).kind === "complete" || isFolderBusy(dir)) continue;

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
            }
          );
        }
      } catch (e) {
        feedFailCount++;
        // Increase adaptive delay on failure (cap at 5000ms)
        currentDelay = Math.min(5000, Math.ceil(currentDelay * 1.5));
        const { statusCode, code, message } = normalizeError(e);
        if (statusCode === 404) {
          // Only log first occurrence, then suppress for 1 hour to reduce log spam
          if (shouldLogFeed404(ch.id)) {
            console.warn(
              `[WARN] [Archived V] Feed 404 for channel ${ch.username} (${ch.id}). Skipping this cycle (will suppress repeated logs for 1h).`
            );
          }
        } else if (code === "ETIMEDOUT" || code === "ECONNABORTED") {
          console.warn(`[WARN] [Archived V] Timeout fetching feed for channel ${ch.username}`);
        } else {
          console.error(`[ERROR] [Archived V] Feed error for channel ${ch.username}: ${message}`);
        }
      }
    }

    // Log feed check summary
    if (feedFailCount > 0) {
      if (feedSuccessCount === 0 && channels.length > 1) {
        // All channels failed — likely a systemic issue, not individual channel problems
        console.error(
          `[ERROR] [Archived V] Feed check: all ${feedFailCount} channel(s) failed. This usually means YouTube is blocking requests from this server's IP. Check network/proxy settings.`
        );
      } else if (feed404Cache.size > 0) {
        console.log(
          `[INFO] [Archived V] Feed check complete. ${feedSuccessCount} OK, ${feed404Cache.size} returning 404 (suppressing repeated logs).`
        );
      }
    }

    status.lastRun = new Date().toISOString();

    // Try starting any newly enqueued jobs.
    await processScheduledStreams();
    await processRetryQueue();

    let total = 0;
    for (const ch of db.data.channels) {
      if (!isSafeIdentifier(ch.username || ch.id)) continue;
      const channelDir = path.join(DOWNLOAD_DIR, ch.username || ch.id);
      if (!isSafeDownloadPath(channelDir)) continue;
      if (fs.existsSync(channelDir)) {
        const items = fs.readdirSync(channelDir, { withFileTypes: true });
        total += items.filter((entry) => entry.isDirectory() && !isFolderBusy(path.join(channelDir, entry.name)) && inspectDownloadFolder(path.join(channelDir, entry.name)).kind === "complete").length;
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
        checkUpdates().catch((err) => console.error("[ERROR] [Archived V] Queued check error:", err));
      });
    }
  }
}

export function startScheduler() {
  // Check for new streams every 10 minutes
  const feedTimer = setInterval(() => {
    console.log(`[INFO] [Archived V] Scheduler Checking for New Streams`);
    checkUpdates().catch((err) => console.error("[ERROR] [Archived V] Cron error:", err));
  }, 10 * 60 * 1000);

  // Start retry queue scheduler - every minute (also checks scheduled streams for promotion)
  const retryTimer = setInterval(() => {
    processScheduledStreams().catch((err) => console.error("[ERROR] [Archived V] Scheduled streams error:", err));
    processRetryQueue().catch((err) => console.error("[ERROR] [Archived V] Retry queue error:", err));
  }, 60 * 1000);
  return () => {
    stopping = true;
    checkPending = false;
    clearInterval(feedTimer);
    clearInterval(retryTimer);
  };
}

export function runInitialCheck() {
  console.log("[INFO] [Archived V] Initial Checking for New Streams");
  autoMerge(null, () => {
    checkUpdates().catch((err) => console.error("[ERROR] [Archived V] Startup refresh error:", err));
  });
}

export default {
  processRetryQueue,
  processScheduledStreams,
  checkUpdates,
  startScheduler,
  runInitialCheck,
};
