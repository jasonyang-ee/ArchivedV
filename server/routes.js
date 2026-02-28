import express from "express";
import fs from "fs";
import path from "path";
import axios from "axios";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import { Parser, processors } from "xml2js";
import db from "./database.js";
import { autoMerge } from "./merger.js";
import { clearAuthSkipCache } from "./auth.js";
import { isValidYouTubeUrl, sanitize } from "./utils.js";
import {
  status,
  activeDownloads,
  inspectDownloadFolder,
  upsertRetryJob,
  safeCleanupDirectory,
} from "./downloader.js";
import { checkUpdates } from "./scheduler.js";
import { YTDLP_COOKIES_PATH, DOWNLOAD_DIR } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rate limiters
const authFsLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  message: { error: "Too many auth requests, slow down" },
});

const staticFsLimiter = rateLimit({
  windowMs: 1_000,
  max: 50,
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
  const { ytdlpFlags } = req.body;
  if (typeof ytdlpFlags !== "string") {
    return res.status(400).json({ error: "ytdlpFlags must be a string" });
  }

  // Basic validation - prevent potentially dangerous flags
  const dangerousFlags = ["--exec", "--config-location", "--batch-file"];
  const flagsLower = ytdlpFlags.toLowerCase();
  for (const dangerous of dangerousFlags) {
    if (flagsLower.includes(dangerous)) {
      return res.status(400).json({
        error: `Flag "${dangerous}" is not allowed for security reasons`,
      });
    }
  }

  db.read();
  db.data.ytdlpFlags = ytdlpFlags.trim();
  db.write();
  res.json({ success: true, ytdlpFlags: db.data.ytdlpFlags });
});

// API: Add channel
router.post("/api/channels", async (req, res) => {
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
      console.error(`[ERROR] [Archived V] Invalid RSS URL for channel ${username}: ${xmlLink}`);
      channelName = username; // fallback
    } else {
      const xml = (await axios.get(xmlLink)).data;
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
router.delete("/api/channels/:id", (req, res) => {
  const { id } = req.params;
  db.read();
  db.data.channels = db.data.channels.filter((c) => c.id !== id);
  db.write();
  res.json({ success: true });
});

// API: Add keyword
router.post("/api/keywords", (req, res) => {
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
router.delete("/api/keywords/:keyword", (req, res) => {
  const { keyword } = req.params;
  db.read();
  db.data.keywords = db.data.keywords.filter((k) => k !== keyword);
  db.write();
  res.json({ success: true });
});

// API: Add ignore keyword
router.post("/api/ignore-keywords", (req, res) => {
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
  const { dateFormat } = req.body;
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
    download.proc.kill("SIGTERM");

    // Remove from active downloads
    activeDownloads.delete(downloadId);

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

    // Trigger auto-merge in case partial files exist
    console.log("[INFO] [Archived V] Triggering auto-merge after download cancellation");
    autoMerge(download.dir);

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
  res.json(db.data.history || []);
});

// API: Remove scheduled stream
router.delete("/api/scheduled-streams/:videoId", (req, res) => {
  const { videoId } = req.params;
  db.read();
  if (!db.data.scheduledStreams) db.data.scheduledStreams = [];
  const before = db.data.scheduledStreams.length;
  db.data.scheduledStreams = db.data.scheduledStreams.filter((s) => s.videoId !== videoId);
  if (db.data.scheduledStreams.length < before) {
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
router.post("/api/refresh", (req, res) => {
  status.current = null;
  checkUpdates().catch((err) => console.error("[ERROR] [Archived V] Refresh error:", err));
  res.json(status);
  console.log(`[INFO] [Archived V] Manual Checking for New Streams`);
});

// Export setup function that configures production static serving
export function setupProductionMiddleware(app) {
  if (process.env.NODE_ENV === "production") {
    const clientDist = path.join(__dirname, "..", "client", "dist");
    app.use(express.static(clientDist));

    // Fallback for React SPA
    app.use(staticFsLimiter, (req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }
}

export default router;
