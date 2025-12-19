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

// Directories
const DATA_DIR = path.resolve(process.cwd(), "data");
const DOWNLOAD_DIR = path.resolve(process.cwd(), "download");
const DB_PATH = path.join(DATA_DIR, "db.json");

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// Database helper
const db = {
  data: { channels: [], keywords: [], ignoreKeywords: [], history: [], currentDownloads: [], dateFormat: 'YYYY-MM-DD' },
  read() {
    if (!fs.existsSync(DB_PATH)) {
      this.data = { channels: [], keywords: [], ignoreKeywords: [], history: [], currentDownloads: [], dateFormat: 'YYYY-MM-DD' };
      fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2));
    } else {
      try {
        const file = fs.readFileSync(DB_PATH, "utf-8");
        this.data = JSON.parse(file);
        if (!this.data.history) this.data.history = [];
        if (!this.data.ignoreKeywords) this.data.ignoreKeywords = [];
        if (!this.data.dateFormat) this.data.dateFormat = 'YYYY-MM-DD';
        
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
        this.data = { channels: [], keywords: [], ignoreKeywords: [], history: [], currentDownloads: [] };
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

// Clear all current downloads on app start (any previous downloads are no longer valid)
db.data.currentDownloads = [];
db.write();

// Status tracking
const status = {
  lastRun: null,
  downloadedCount: 0,
  currentDownloads: [],
  lastCompleted: null,
};

// Active downloads tracking (for cancellation)
const activeDownloads = new Map(); // downloadId -> { proc, downloadInfo, dir }

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
    
    // Remove intermediate fragment files (.f123.mp4)
    const fragmentFiles = files.filter(f => /^\.f\d+\.mp4$/i.test(f));
    fragmentFiles.forEach(f => {
      try {
        fs.unlinkSync(path.join(dir, f));
        console.log(`[Archived V] Cleaned up intermediate fragment: ${f}`);
      } catch (e) {
        console.warn(`[Archived V] Failed to remove intermediate file ${f}: ${e.message}`);
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
    
    console.log(`[Archived V] Cleanup completed for "${title}" - removed ${fragmentFiles.length} fragments`);
  } catch (e) {
    console.error(`[Archived V] Error during intermediate file cleanup: ${e.message}`);
  }
}

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting to prevent DoS attacks
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: "Too many requests from this IP, please try again later."
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply rate limiting to all requests
app.use(limiter);

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

// Stricter rate limiting for expensive operations (like refresh)
const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // limit each IP to 5 requests per minute for expensive operations
  message: {
    error: "Too many requests for this operation, please wait before trying again."
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// API: Manual refresh
app.post("/api/refresh", strictLimiter, (req, res) => {
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
  let count = 0;

  for (const ch of channels) {
    try {
      // Validate URL before making request to prevent SSRF
      if (!isValidYouTubeUrl(ch.link)) {
        console.error(`Skipping invalid channel URL: ${ch.link}`);
        continue;
      }
      const xml = (await axios.get(ch.link)).data;
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
        const dir = path.join(channelDir, folderName);
        
        // Check keyword match first before adding to downloads
        const match = keywords.some((k) => title.toLowerCase().includes(k));
        if (!match) {
          continue;
        }
        
        // Check ignore keywords - exclude if any ignore keyword is found
        const shouldIgnore = ignoreKeywords.some((k) => title.toLowerCase().includes(k));
        if (shouldIgnore) {
          continue;
        }
        
        const sanitizedTitle = sanitize(title);
        let alreadyDownloaded = false;
        let isCurrentlyDownloading = false;
        
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
                const files = fs.readdirSync(folderPath);
                
                // Check if any video files (.mp4, .mkv, .webm, .part) exist
                const hasVideoFiles = files.some(f => 
                  /\.(mp4|mkv|webm|part|ytdl|f\d+)$/i.test(f)
                );
                
                if (hasVideoFiles) {
                  // Video files exist - consider it downloaded or in progress
                  alreadyDownloaded = true;
                  break;
                } else if (files.length > 0) {
                  // Has files but no video files (e.g., only thumbnails) - still consider downloaded
                  alreadyDownloaded = true;
                  break;
                } else {
                  // Only delete truly empty folders (no files at all)
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
        
        fs.mkdirSync(dir, { recursive: true });
        
        // Add to current downloads list AFTER all checks pass
        const downloadId = `${ch.id}-${videoId}-${Date.now()}`;
        const downloadInfo = {
          id: downloadId,
          channel: ch.id,
          title: title,
          username: ch.username,
          channelName: ch.channelName || ch.username,
          startTime: new Date().toISOString()
        };
        status.currentDownloads.push(downloadInfo);
        db.read();
        db.data.currentDownloads.push(downloadInfo);
        db.write();
        
        const proc = spawn(
          "yt-dlp",
          [
            "--live-from-start",
            "--wait-for-video",
            "30",
            "-ciw",
            "--no-progress",
            "--no-cache-dir",
            "--socket-timeout",
            "30",
            "--retries",
            "20",
            "--fragment-retries",
            "infinite",
            "--skip-unavailable-fragments",
            "--no-abort-on-error",
            "--keep-fragments",
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
        
        // Store process reference for cancellation
        activeDownloads.set(downloadId, { proc, downloadInfo, dir });
        
        let stderr = "";
        proc.stdout.on("data", (chunk) => {
          chunk.toString().split(/\r?\n/).forEach((line) => {
            if (line) console.log(`[yt-dlp] ${line}`);
          });
        });
        
        proc.stderr.on("data", (chunk) => {
          const text = chunk.toString();
          stderr += text;
          text.split(/\r?\n/).forEach((line) => {
            if (line) console.warn(`[yt-dlp] ${line}`);
          });
        });
        
        const downloadResult = await new Promise((resolve, reject) =>
          proc.on("close", (code) => {
            const clearDownload = async () => {
              // Remove from active downloads map
              activeDownloads.delete(downloadId);
              
              // Remove from current downloads
              status.currentDownloads = status.currentDownloads.filter(d => d.id !== downloadId);
              db.read();
              db.data.currentDownloads = db.data.currentDownloads.filter(d => d.id !== downloadId);
              db.write();
            };
            
            if (code === 0) {
              // Clean up intermediate files before marking as complete
              cleanupIntermediateFiles(dir, title);
              clearDownload();
              return resolve({ success: true });
            }
            
            if (stderr.includes("This live event will begin")) {
              console.warn(`[Archived V] Live event for "${title}" hasn't started yet, skipping.`);
              clearDownload();
              // Delay cleanup to allow process to fully release file handles
              // ONLY removes empty directories - never deletes video files
              setTimeout(() => {
                safeCleanupDirectory(dir, "live event not started");
              }, 10000);
              return resolve({ success: false, skipped: true });
            }
            
            // Download failed for other reasons
            console.error(`[Archived V] Download failed for "${title}" with code ${code}`);
            
            // Check if we got any usable video despite the error
            // (e.g., fragment errors during live stream but merge completed)
            let hasPartialDownload = false;
            let isLiveOngoing = false;
            try {
              if (fs.existsSync(dir)) {
                const files = fs.readdirSync(dir);
                const videoFiles = files.filter(f => /\.(mp4|mkv|webm)$/i.test(f) && !f.includes('.f'));
                const partFiles = files.filter(f => /\.(part|ytdl|f\d+\.mp4)$/i.test(f));
                
                if (videoFiles.length > 0) {
                  // We have a merged video file - this might be usable!
                  const videoSizes = videoFiles.map(f => {
                    try {
                      return { name: f, size: fs.statSync(path.join(dir, f)).size };
                    } catch { return { name: f, size: 0 }; }
                  });
                  
                  const hasSubstantialVideo = videoSizes.some(v => v.size > 1024 * 1024); // > 1MB
                  if (hasSubstantialVideo) {
                    console.log(`[Archived V] Download failed but found usable video file(s): ${videoFiles.join(", ")}`);
                    console.log(`[Archived V] Keeping directory for manual review: ${dir}`);
                    hasPartialDownload = true;
                    
                    // Clean up intermediate files even on partial success
                    cleanupIntermediateFiles(dir, title);
                  }
                } else if (partFiles.length > 0) {
                  console.log(`[Archived V] Download failed with partial files: ${partFiles.slice(0, 3).join(", ")}${partFiles.length > 3 ? '...' : ''}`);
                  console.log(`[Archived V] Keeping directory for potential resume: ${dir}`);
                  hasPartialDownload = true;
                }
              }
              
              // Check if this is a live stream that's still ongoing
              if (stderr.includes("This live event will begin") || 
                  stderr.includes("fragment not found") ||
                  stderr.includes("Live stream")) {
                isLiveOngoing = true;
                console.log(`[Archived V] Detected ongoing live stream for "${title}" - may retry later`);
              }
              
            } catch (checkErr) {
              console.error(`[Archived V] Error checking for partial download: ${checkErr.message}`);
            }
            
            clearDownload();
            
            // Only attempt cleanup if no partial download detected
            // Safe cleanup will still protect any video files
            if (!hasPartialDownload) {
              setTimeout(() => {
                safeCleanupDirectory(dir, "download failed");
              }, 10000);
            }
            
            // For live streams that are still ongoing, don't treat as complete failure
            if (isLiveOngoing && hasPartialDownload) {
              console.log(`[Archived V] Live stream "${title}" partially downloaded - will not retry automatically`);
              
              // Add to ignore list temporarily to prevent repeated attempts
              db.read();
              if (!db.data.ignoreKeywords) db.data.ignoreKeywords = [];
              const ignoreEntry = `${title} (live ongoing)`;
              if (!db.data.ignoreKeywords.includes(ignoreEntry)) {
                db.data.ignoreKeywords.push(ignoreEntry);
                db.write();
                console.log(`[Archived V] Added "${ignoreEntry}" to ignore list - remove manually when stream ends`);
              }
              
              return resolve({ success: false, liveOngoing: true });
            }
            
            return reject(new Error("download failed"));
          })
        ).catch(err => {
          // Catch download errors to prevent them from stopping other downloads
          console.warn(`[Archived V] Download error handled: ${err.message}`);
          return { success: false, error: err.message };
        });
        
        if (downloadResult.success || downloadResult.liveOngoing) {
          if (downloadResult.success) {
            status.lastCompleted = title;
            
            if (process.env.PUSHOVER_APP_TOKEN && process.env.PUSHOVER_USER_TOKEN) {
              push.send({ message: `Downloaded: ${title}`, title }, () => {});
            }
            
            db.read();
            db.data.history.push({ title, time: new Date().toISOString() });
            db.write();
            count++;
          } else if (downloadResult.liveOngoing) {
            console.log(`[Archived V] Recorded partial download for live stream: ${title}`);
            // Don't add to history for partial downloads, but don't count as error
          }
        }
      }
    } catch (e) {
      if (e.code === "ETIMEDOUT") {
        console.warn(`[${new Date().toISOString()}] Timeout fetching feed for channel ${ch.username}`);
      } else {
        console.error(e);
      }
    }
  }
  
  status.lastRun = new Date().toISOString();
  
  let total = 0;
  for (const ch of db.data.channels) {
    const channelDir = path.join(DOWNLOAD_DIR, ch.username);
    if (fs.existsSync(channelDir)) {
      const items = fs.readdirSync(channelDir, { withFileTypes: true });
      total += items.filter((d) => d.isDirectory()).length;
    }
  }
  status.downloadedCount = total;
}

// Serve React app in production
if (process.env.NODE_ENV === "production") {
  app.use((req, res) => {
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  
  // Run initial check for new streams on startup
  console.log("Running initial check for new streams...");
  checkUpdates().catch((err) => console.error("Startup refresh error:", err));
});
