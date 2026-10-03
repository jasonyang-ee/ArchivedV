import express from "express";
import fs from "fs";
import path from "path";
import axios from "axios";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import { Parser, processors } from "xml2js";
import db, { buildDownloadTitleMap, resolveHistoryChannel } from "./database.js";
import { clearAuthSkipCache, validateCookies, saveCookies } from "./auth.js";
import { isValidYouTubeUrl, isSafeIdentifier } from "./utils.js";
import { parseYtDlpFlags } from "./ytdlpFlags.js";
import {
  status,
  activeDownloads,
  safeCleanupDirectory,
  stopDownload,
  getRetryQueueCounts,
} from "./downloader.js";
import { checkUpdates } from "./scheduler.js";
import {
  AUTH_RATELIMIT_MAX,
  AXIOS_TIMEOUT_MS,
  STATIC_RATELIMIT_MAX,
  YTDLP_COOKIES_PATH,
} from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rate limiters
const authFsLimiter = rateLimit({
  windowMs: 60_000,
  max: AUTH_RATELIMIT_MAX,
  message: { error: "Too many auth requests, slow down" },
});

const staticFsLimiter = rateLimit({
  windowMs: 1_000,
  max: STATIC_RATELIMIT_MAX,
  message: { error: "Too many requests, slow down" },
});

// XML parser
const xmlParser = new Parser({
  explicitArray: true,
  tagNameProcessors: [processors.stripPrefix],
});

const router = express.Router();

// Middleware
router.use(express.json({ limit: "6mb" }));

function normalizeHistoryItem(item, channelsById, channelsByUsername, singleChannel, titleMap) {
  const { channelId, username, channelName, channelUrl } = resolveHistoryChannel(item, {
    channelsById,
    channelsByUsername,
    singleChannel,
    titleMap,
  });

  return {
    ...item,
    ...(channelId && { channelId }),
    ...(username && { username }),
    ...(channelName && { channelName }),
    ...(channelUrl && { channelUrl }),
  };
}

// API: Get config
router.get("/api/config", (req, res) => {
  db.read();
  res.json({
    channels: db.data.channels,
    keywords: db.data.keywords,
    ignoreKeywords: db.data.ignoreKeywords || [],
    dateFormat: db.data.dateFormat || "YYYY-MM-DD",
  });
});

// API: Cookies/auth settings (members-only videos)
router.get("/api/auth", authFsLimiter, (req, res) => {
  db.read();
  const useCookies = !!db.data?.auth?.useCookies;
  const cookiesFilePresent = fs.existsSync(YTDLP_COOKIES_PATH);
  res.json({
    useCookies,
    cookiesFilePresent,
    cookiesPathHint: path.basename(YTDLP_COOKIES_PATH),
  });
});

router.post("/api/auth", authFsLimiter, (req, res) => {
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
  if (useCookies && cookiesFilePresent) clearAuthSkipCache();

  res.json({ ok: true, useCookies, cookiesFilePresent });
});

router.put("/api/auth/cookies", authFsLimiter, (req, res) => {
  const { cookiesText } = req.body || {};
  if (typeof cookiesText !== "string" || cookiesText.trim().length === 0) {
    return res.status(400).json({ error: "cookiesText is required" });
  }
  if (Buffer.byteLength(cookiesText, "utf8") > 5 * 1024 * 1024) {
    return res.status(413).json({ error: "cookiesText too large" });
  }

  try { validateCookies(cookiesText); } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    saveCookies(cookiesText);

    db.read();
    if (!db.data.auth) db.data.auth = { useCookies: false };
    db.data.auth.useCookies = true;
    db.write();

    clearAuthSkipCache();
    res.json({ ok: true, cookiesFilePresent: true, useCookies: true });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

router.delete("/api/auth/cookies", authFsLimiter, (req, res) => {
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

// API: Get yt-dlp custom flags
router.get("/api/ytdlp-flags", (req, res) => {
  db.read();
  res.json({ ytdlpFlags: db.data.ytdlpFlags || "" });
});

// API: Update yt-dlp custom flags
router.post("/api/ytdlp-flags", (req, res) => {
  const { ytdlpFlags } = req.body || {};
  if (typeof ytdlpFlags !== "string") {
    return res.status(400).json({ error: "ytdlpFlags must be a string" });
  }

  try {
    parseYtDlpFlags(ytdlpFlags);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  db.read();
  db.data.ytdlpFlags = ytdlpFlags.trim();
  db.write();
  res.json({ success: true, ytdlpFlags: db.data.ytdlpFlags });
});

// API: Add channel
router.post("/api/channels", authFsLimiter, async (req, res) => {
  let { link } = req.body || {};
  if (typeof link !== "string" || !link.trim()) {
    return res.status(400).json({ error: "A non-empty channel link is required" });
  }

  // Trim whitespace
  link = link.trim();

  let id, username;
  const handleMatch = link.match(/^@?([A-Za-z0-9_-]+)$/);
  if (handleMatch) {
    username = handleMatch[1];
  } else {
    if (!isValidYouTubeUrl(link)) return res.status(400).json({ error: "Invalid YouTube channel URL" });
    const url = new URL(link);
    const handle = url.pathname.match(/^\/@([A-Za-z0-9_-]+)(?:\/(?:about|videos|streams))?\/?$/);
    const channel = url.pathname.match(/^\/channel\/([A-Za-z0-9_-]+)(?:\/(?:about|videos|streams))?\/?$/);
    if (handle) username = handle[1];
    else if (channel) id = channel[1];
    else if (url.pathname === "/feeds/videos.xml") id = url.searchParams.get("channel_id");
    else return res.status(400).json({ error: "Use a channel URL, RSS feed or @handle" });
  }
  if (username) {
    if (!isSafeIdentifier(username)) return res.status(400).json({ error: "Invalid username" });
    try {
      const html = (await axios.get(`https://www.youtube.com/@${username}/about`, { timeout: AXIOS_TIMEOUT_MS, maxRedirects: 0 })).data;
      id = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/([A-Za-z0-9_-]+)"/)?.[1];
    } catch {
      return res.status(400).json({ error: "Failed to fetch channel page" });
    }
  }
  if (!isSafeIdentifier(id)) return res.status(400).json({ error: "Invalid or unresolved channel ID" });
  username ||= id;
  const xmlLink = `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;

  // Try to fetch the actual channel name from RSS feed
  let channelName = username;
  try {
    if (!isValidYouTubeUrl(xmlLink)) {
      console.error(`[ERROR] [Archived V] Invalid RSS URL for channel ${username}: ${xmlLink}`);
      channelName = username; // fallback
    } else {
      const xml = (await axios.get(xmlLink, { timeout: AXIOS_TIMEOUT_MS, maxRedirects: 0 })).data;
      const result = await xmlParser.parseStringPromise(xml);
      if (
        result.feed.author &&
        result.feed.author[0] &&
        result.feed.author[0].name &&
        result.feed.author[0].name[0]
      ) {
        channelName = result.feed.author[0].name[0];
      }
    }
  } catch (e) {
    console.warn("[WARN] [Archived V] Failed to fetch channel name from RSS, using username");
  }

  // Fetches yield to other requests; resolve the existing row only after them.
  db.read();
  const existing = db.data.channels.find((c) => c.id === id);
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
  res.json(existing || { id, link: xmlLink, username, channelName });
});

// API: Delete channel
router.delete("/api/channels/:id", (req, res) => {
  const { id } = req.params;
  db.read();
  db.data.channels = db.data.channels.filter((c) => c.id !== id);
  db.data.retryQueue = db.data.retryQueue.filter((job) => job.channelId !== id);
  db.data.scheduledStreams = db.data.scheduledStreams.filter((job) => job.channelId !== id);
  db.write();
  res.json({ success: true });
});

// API: Add keyword
router.post("/api/keywords", (req, res) => {
  let { keyword } = req.body || {};
  if (typeof keyword !== "string" || !keyword.trim()) {
    return res.status(400).json({ error: "A non-empty keyword is required" });
  }
  keyword = keyword.trim();
  db.read();
  if (!db.data.keywords.includes(keyword)) {
    db.data.keywords.push(keyword);
    db.write();
  }
  res.json({ success: true });
});

// API: Delete keyword
router.delete("/api/keywords/:keyword", (req, res) => {
  const { keyword } = req.params;
  db.read();
  db.data.keywords = db.data.keywords.filter((k) => k !== keyword);
  db.write();
  res.json({ success: true });
});

// API: Add ignore keyword
router.post("/api/ignore-keywords", (req, res) => {
  let { keyword } = req.body || {};
  if (typeof keyword !== "string" || !keyword.trim()) {
    return res.status(400).json({ error: "A non-empty keyword is required" });
  }
  keyword = keyword.trim();
  db.read();
  if (!db.data.ignoreKeywords) db.data.ignoreKeywords = [];
  if (!db.data.ignoreKeywords.includes(keyword)) {
    db.data.ignoreKeywords.push(keyword);
    db.write();
  }
  res.json({ success: true });
});

// API: Delete ignore keyword
router.delete("/api/ignore-keywords/:keyword", (req, res) => {
  const { keyword } = req.params;
  db.read();
  if (!db.data.ignoreKeywords) db.data.ignoreKeywords = [];
  db.data.ignoreKeywords = db.data.ignoreKeywords.filter((k) => k !== keyword);
  db.write();
  res.json({ success: true });
});

// API: Update date format
router.post("/api/date-format", (req, res) => {
  const { dateFormat } = req.body || {};
  if (!dateFormat || !["YYYY-MM-DD", "MM-DD-YYYY"].includes(dateFormat)) {
    return res
      .status(400)
      .json({ error: "Invalid date format. Must be 'YYYY-MM-DD' or 'MM-DD-YYYY'" });
  }
  db.read();
  db.data.dateFormat = dateFormat;
  db.write();
  res.json({ success: true, dateFormat });
});

// API: Get status
router.get("/api/status", (req, res) => {
  db.read();
  res.json({
    ...status,
    currentDownloads: [...activeDownloads.values()].filter((dl) => !dl.cancelled).map((dl) => dl.downloadInfo),
    retryQueue: getRetryQueueCounts(),
    scheduledStreams: db.data.scheduledStreams || [],
  });
});

// API: Cancel download
router.delete("/api/downloads/:downloadId", (req, res) => {
  const { downloadId } = req.params;

  const download = activeDownloads.get(downloadId);
  if (!download) {
    return res.status(404).json({ error: "Download not found or already completed" });
  }

  try {
    // Kill the yt-dlp process
    download.cancelled = true;
    stopDownload(download);

    // Remove from status and database
    status.currentDownloads = status.currentDownloads.filter((d) => d.id !== downloadId);
    db.read();
    db.data.currentDownloads = db.data.currentDownloads.filter((d) => d.id !== downloadId);

    // Remove from retry queue if present
    db.data.retryQueue = (db.data.retryQueue || []).filter(
      (j) =>
        !(j.channelId === download.downloadInfo.channel && j.videoId === download.downloadInfo.videoId)
    );

    // Add the cancelled video title to ignore keywords to prevent re-downloading
    if (!db.data.ignoreKeywords) db.data.ignoreKeywords = [];
    const cancelledTitle = download.downloadInfo.title;
    if (!db.data.ignoreKeywords.includes(cancelledTitle)) {
      db.data.ignoreKeywords.push(cancelledTitle);
      console.log(`[INFO] [Archived V] Added cancelled video to ignore list: ${cancelledTitle}`);
    }

    db.write();

    // Clean up the download directory after a delay to allow process to release file handles
    // ONLY removes empty directories - never deletes video files
    setTimeout(() => {
      if (download.dir) {
        safeCleanupDirectory(download.dir, "cancelled download");
      }
    }, 10000);

    console.log(`[INFO] [Archived V] Cancelled download: ${cancelledTitle}`);

    // The process close handler merges partial files after handles are released.

    res.json({
      success: true,
      message: "Download cancelled, removed from retry queue, and added to ignore list",
    });
  } catch (err) {
    console.error(`[ERROR] [Archived V] Error cancelling download: ${err.message}`);
    res.status(500).json({ error: "Failed to cancel download" });
  }
});

// API: Get history
router.get("/api/history", (req, res) => {
  db.read();
  const channels = db.data.channels || [];
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  const channelsByUsername = new Map(
    channels
      .filter((channel) => channel.username)
      .map((channel) => [channel.username, channel])
  );
  const singleChannel = channels.length === 1 ? channels[0] : null;
  const history = db.data.history || [];
  const needsFolderLookup = history.some(
    (item) => !item.channelId && !item.username && !item.channelName
  );
  const titleMap = needsFolderLookup ? buildDownloadTitleMap(channels) : null;

  res.json(
    history.map((item) =>
      normalizeHistoryItem(item, channelsById, channelsByUsername, singleChannel, titleMap)
    )
  );
});

// API: Remove scheduled stream
router.delete("/api/scheduled-streams/:videoId", (req, res) => {
  const { videoId } = req.params;
  db.read();
  if (!db.data.scheduledStreams) db.data.scheduledStreams = [];
  const removed = db.data.scheduledStreams.filter((stream) => stream.videoId === videoId);
  const before = db.data.scheduledStreams.length;
  db.data.scheduledStreams = db.data.scheduledStreams.filter((s) => s.videoId !== videoId);
  if (db.data.scheduledStreams.length < before) {
    for (const stream of removed) {
      if (stream.title && !db.data.ignoreKeywords.includes(stream.title)) db.data.ignoreKeywords.push(stream.title);
    }
    db.data.retryQueue = db.data.retryQueue.filter((job) => job.videoId !== videoId);
    db.write();
    console.log(`[INFO] [Archived V] Removed scheduled stream: ${videoId}`);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Scheduled stream not found" });
  }
});

// API: Clear history
router.delete("/api/history", (req, res) => {
  db.read();
  db.data.history = [];
  db.write();
  res.json({ success: true });
});

// API: Manual refresh
router.post("/api/refresh", authFsLimiter, (req, res) => {
  checkUpdates().catch((err) => console.error("[ERROR] [Archived V] Refresh error:", err));
  res.json(status);
  console.log(`[INFO] [Archived V] Manual Checking for New Streams`);
});

// Export setup function that configures production static serving
export function setupProductionMiddleware(app) {
  if (process.env.NODE_ENV !== "development") {
    const clientDist = path.join(__dirname, "..", "client", "dist");
    app.use(staticFsLimiter, express.static(clientDist));

    // Fallback for React SPA
    app.get(/.*/, (req, res, next) => {
      if (req.path === "/api" || req.path.startsWith("/api/")) return next();
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }
  app.use((req, res) => res.status(404).json({ error: "Not found" }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const statusCode = error.type === "entity.too.large" ? 413 : error.type === "entity.parse.failed" ? 400 : 500;
    if (statusCode === 500) console.error(`[ERROR] [Archived V] Request failed: ${error.message}`);
    res.status(statusCode).json({ error: statusCode === 413 ? "Request too large" : statusCode === 400 ? "Invalid JSON body" : "Request failed" });
  });
}

export default router;
