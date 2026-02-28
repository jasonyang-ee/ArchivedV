import fs from "fs";
import path from "path";
import axios from "axios";
import { Parser, processors } from "xml2js";
import cron from "node-cron";
import db from "./database.js";
import { autoMerge } from "./merger.js";
import { isAuthSkipped, canUseCookies } from "./auth.js";
import { sleep, jitter, normalizeError, sanitize, isValidYouTubeUrl, nowIso } from "./utils.js";
import {
  status,
  activeDownloads,
  canStartAnotherDownload,
  getRetryQueueCounts,
  inspectDownloadFolder,
  upsertRetryJob,
  startYtDlp,
} from "./downloader.js";
import {
  DOWNLOAD_DIR,
  FEED_FETCH_RETRIES,
  FEED_FETCH_BACKOFF_MS,
  FEED_404_LOG_INTERVAL_MS,
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
        `[WARN] [Archived V] Feed fetch retry ${attempt + 1}/${FEED_FETCH_RETRIES} for ${channelLabel || url} after ${delay}ms (${code || statusCode || "error"})`
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
  if (retryQueueRunning) return;
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
      // Check ignore keywords - skip and remove if matches
      if (ignoreKeywords.some((k) => job.title.toLowerCase().includes(k))) {
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

      // Persist the inProgress mark in the same write operation
      db.data.retryQueue = db.data.retryQueue.map((j) => (j.key === job.key ? job : j));
      db.write();

      const link = job.videoLink || `https://www.youtube.com/watch?v=${job.videoId}`;
      startYtDlp(downloadId, downloadInfo, dir, link);
    }
  } finally {
    retryQueueRunning = false;
  }
}

export async function checkUpdates() {
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
      // Extract video identifier from the download (channel + video portion of ID)
      const idParts = download.id.split("-");
      const videoKey = `${download.channel}-${idParts[1]}`; // channel-videoId

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
    const keywords = db.data.keywords.map((k) => k.toLowerCase());
    const ignoreKeywords = (db.data.ignoreKeywords || []).map((k) => k.toLowerCase());

    // Kick retry queue first so failed/partial work gets priority.
    await processRetryQueue();

    for (const ch of channels) {
      try {
        // Validate URL before making request to prevent SSRF
        if (!isValidYouTubeUrl(ch.link)) {
          console.error(`[ERROR] [Archived V] Skipping invalid channel URL: ${ch.link}`);
          continue;
        }
        const xml = await fetchFeedWithRetry(ch.link, ch.username || ch.id);

        // Feed succeeded - clear any 404 suppression for this channel
        clearFeed404(ch.id);

        const result = await xmlParser.parseStringPromise(xml);
        const entries = result.feed.entry || [];

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

        const channelDir = path.join(DOWNLOAD_DIR, ch.username);
        if (!fs.existsSync(channelDir)) fs.mkdirSync(channelDir, { recursive: true });

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

          const dateFormat = db.data.dateFormat || "YYYY-MM-DD";
          let datePrefix;
          if (dateFormat === "MM-DD-YYYY") {
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
            if (download.downloadInfo.channel === ch.id && download.downloadInfo.title === title) {
              isCurrentlyDownloading = true;
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
                    console.log(`[INFO] [Archived V] Removing empty folder: ${folderPath}`);
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

    // Log summary of 404 channels if any (less spammy than individual logs)
    if (feed404Cache.size > 0) {
      console.log(
        `[INFO] [Archived V] Feed check complete. ${feed404Cache.size} channel(s) returning 404 (suppressing repeated logs).`
      );
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
        checkUpdates().catch((err) => console.error("[ERROR] [Archived V] Queued check error:", err));
      });
    }
  }
}

export function startScheduler() {
  // Start normal cron scheduler - every 10 minutes
  cron.schedule("*/10 * * * *", () => {
    console.log(`[INFO] [Archived V] Scheduler Checking for New Streams`);
    checkUpdates().catch((err) => console.error("[ERROR] [Archived V] Cron error:", err));
  });

  // Start retry queue scheduler - every minute
  setInterval(() => {
    processRetryQueue().catch((err) => console.error("[ERROR] [Archived V] Retry queue error:", err));
  }, 60 * 1000);
}

export function runInitialCheck() {
  console.log("[INFO] [Archived V] Initial Checking for New Streams");
  checkUpdates().catch((err) => console.error("[ERROR] [Archived V] Startup refresh error:", err));

  // Run auto merge on startup
  autoMerge();
}

export default {
  processRetryQueue,
  checkUpdates,
  startScheduler,
  runInitialCheck,
};
