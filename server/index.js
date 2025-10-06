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

dotenv.config();

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
  data: { channels: [], keywords: [], history: [], currentDownloads: [] },
  read() {
    if (!fs.existsSync(DB_PATH)) {
      this.data = { channels: [], keywords: [], history: [], currentDownloads: [] };
      fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2));
    } else {
      try {
        const file = fs.readFileSync(DB_PATH, "utf-8");
        this.data = JSON.parse(file);
        if (!this.data.history) this.data.history = [];
        
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
        this.data = { channels: [], keywords: [], history: [], currentDownloads: [] };
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

// Status tracking
const status = {
  lastRun: null,
  downloadedCount: 0,
  currentDownloads: [],
  lastCompleted: null,
};

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

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files in production
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "..", "dist")));
}

// API: Get config
app.get("/api/config", (req, res) => {
  db.read();
  res.json({ channels: db.data.channels, keywords: db.data.keywords });
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
    const aboutUrl = `https://www.youtube.com/@${username}/about`;
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
    const aboutUrl = `https://www.youtube.com/@${username}/about`;
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
    const xml = (await axios.get(xmlLink)).data;
    const result = await xmlParser.parseStringPromise(xml);
    if (result.feed.author && result.feed.author[0] && result.feed.author[0].name && result.feed.author[0].name[0]) {
      channelName = result.feed.author[0].name[0];
    }
  } catch (e) {
    console.warn("Failed to fetch channel name from RSS, using username");
  }
  
  if (!existing) {
    db.data.channels.push({ id, link: xmlLink, username, channelName });
  } else {
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

// API: Get status
app.get("/api/status", (req, res) => {
  res.json(status);
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
  let count = 0;

  for (const ch of channels) {
    try {
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
        
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        const datePrefix = `[${year}-${month}-${day}] `;
        const folderName = `${datePrefix}${sanitize(title)}`;
        const dir = path.join(channelDir, folderName);
        
        // Check keyword match first before adding to downloads
        const match = keywords.some((k) => title.toLowerCase().includes(k));
        if (!match) {
          continue;
        }
        
        const sanitizedTitle = sanitize(title);
        let alreadyDownloaded = false;
        try {
          const channelFolders = fs.readdirSync(channelDir, { withFileTypes: true });
          for (const folder of channelFolders) {
            if (folder.isDirectory()) {
              const folderTitle = folder.name.replace(/^\[\d{4}-\d{2}-\d{2}(?:-\d{2})?\]\s*/, "");
              if (folderTitle === sanitizedTitle) {
                const folderPath = path.join(channelDir, folder.name);
                const files = fs.readdirSync(folderPath);
                if (files.length > 0) {
                  alreadyDownloaded = true;
                  break;
                } else {
                  fs.rmdirSync(folderPath, { recursive: true });
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
            "-ciw",
            "--no-progress",
            "--no-cache-dir",
            "--socket-timeout",
            "30",
            "--retries",
            "10",
            "--fragment-retries",
            "10",
            "-o",
            path.join(dir, "%(title)s.%(ext)s"),
            "--embed-thumbnail",
            "--add-metadata",
            "--merge-output-format",
            "mp4",
            videoLink,
          ],
          { stdio: ["pipe", "pipe", "pipe"] }
        );
        
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
              // Remove from current downloads
              status.currentDownloads = status.currentDownloads.filter(d => d.id !== downloadId);
              db.read();
              db.data.currentDownloads = db.data.currentDownloads.filter(d => d.id !== downloadId);
              db.write();
            };
            
            if (code === 0) {
              clearDownload();
              return resolve({ success: true });
            }
            
            if (stderr.includes("This live event will begin")) {
              console.warn(`[Archived V] Live event for "${title}" hasn't started yet, skipping.`);
              clearDownload();
              try {
                fs.rmdirSync(dir, { recursive: true });
              } catch (e) {}
              return resolve({ success: false, skipped: true });
            }
            
            clearDownload();
            return reject(new Error("download failed"));
          })
        );
        
        if (downloadResult.success) {
          status.lastCompleted = title;
          
          if (process.env.PUSHOVER_APP_TOKEN && process.env.PUSHOVER_USER_TOKEN) {
            push.send({ message: `Downloaded: ${title}`, title }, () => {});
          }
          
          db.read();
          db.data.history.push({ title, time: new Date().toISOString() });
          db.write();
          count++;
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
  app.get("*", (req, res) => {
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
