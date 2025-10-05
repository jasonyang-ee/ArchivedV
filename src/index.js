const express = require("express");
const path = require("path");
const axios = require("axios");
// set a default timeout for all axios requests (in ms)
axios.defaults.timeout = Number(process.env.AXIOS_TIMEOUT_MS) || 20000;
const { Parser, processors } = require("xml2js");
const cron = require("node-cron");
const { spawn } = require("child_process");
const Pushover = require("pushover-notifications");
const fs = require("fs");
const { db } = require("./db");

// Status tracking
const status = {
  lastRun: null,
  downloadedCount: 0,
  current: null,
  lastCompleted: null,
};

const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOAD_DIR = path.resolve(process.cwd(), "download");

// Pushover setup
const push = new Pushover({
  token: process.env.PUSHOVER_APP_TOKEN || "",
  user: process.env.PUSHOVER_USER_TOKEN || "",
});

// XML parser that strips namespace prefixes
const xmlParser = new Parser({
  explicitArray: true,
  tagNameProcessors: [processors.stripPrefix],
});

// sanitize titles into filesystem-safe folder names
function sanitize(str) {
  return str.replace(/[\/\\:*?"<>|]/g, "").trim();
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
// serve favicon from src root folder
app.use("/favicon.ico", express.static(path.join(__dirname, "Logo.ico")));

// API endpoints
app.get("/api/config", async (req, res) => {
  await db.read();
  res.json({ channels: db.data.channels, keywords: db.data.keywords });
});

app.post("/api/channels", async (req, res) => {
  let { link } = req.body;
  if (!link) return res.status(400).json({ error: "No link provided" });
  let id, xmlLink, username;
  // Handle YouTube handle URLs (/@username)
  const handleMatch = link.match(/youtube\.com\/@([^\/\?]+)/);
  if (handleMatch) {
    username = handleMatch[1];
    const aboutUrl = `https://www.youtube.com/@${username}/about`;
    try {
      const html = (await axios.get(aboutUrl)).data;
      const canonMatch = html.match(
        /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/([^\"]+)"/
      );
      if (!canonMatch)
        return res
          .status(400)
          .json({ error: "Unable to resolve handle to channel ID" });
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
    // fallback username when no handle: use channel ID
    username = id;
  }
  await db.read();
  const existing = db.data.channels.find((c) => c.id === id);
  if (!existing) {
    db.data.channels.push({ id, link: xmlLink, username });
  } else if (!existing.username) {
    existing.username = username;
  }
  await db.write();
  res.json({ id, link: xmlLink, username });
});

app.delete("/api/channels/:id", async (req, res) => {
  const { id } = req.params;
  await db.read();
  db.data.channels = db.data.channels.filter((c) => c.id !== id);
  await db.write();
  res.json({ success: true });
});

app.post("/api/keywords", async (req, res) => {
  const { keyword } = req.body;
  if (!keyword) return res.status(400).json({ error: "No keyword provided" });
  await db.read();
  if (!db.data.keywords.includes(keyword)) {
    db.data.keywords.push(keyword);
    await db.write();
  }
  res.json({ success: true });
});

app.delete("/api/keywords/:keyword", async (req, res) => {
  const { keyword } = req.params;
  await db.read();
  db.data.keywords = db.data.keywords.filter((k) => k !== keyword);
  await db.write();
  res.json({ success: true });
});

// Serve UI
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// download job
async function checkUpdates() {
  await db.read();
  // clear current download at start
  status.current = null;
  const channels = db.data.channels;
  const keywords = db.data.keywords.map((k) => k.toLowerCase());
  let count = 0;

  for (const ch of channels) {
    try {
      const xml = (await axios.get(ch.link)).data;
      const result = await xmlParser.parseStringPromise(xml);
      const entries = result.feed.entry || [];
      // ensure channel directory using username
      const channelDir = path.join(DOWNLOAD_DIR, ch.username);
      if (!fs.existsSync(channelDir))
        fs.mkdirSync(channelDir, { recursive: true });
      for (const entry of entries) {
        // extract video ID, title, and link
        const videoId = entry.videoId
          ? entry.videoId[0]
          : entry["yt:videoId"][0];
        const title = entry.title[0];
        const linkObj = entry.link.find((l) => l.$ && l.$.href);
        const videoLink = linkObj ? linkObj.$.href : ch.link;
        // use title for folder name with date-time prefix in brackets
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const datePrefix = `[${year}-${month}-${day}] `;
        const folderName = `${datePrefix}${sanitize(title)}`;
        const dir = path.join(channelDir, folderName);
        // update status for UI
        status.current = title;
        // only proceed if title matches any keyword (empty list now skips all)
        const match = keywords.some((k) => title.toLowerCase().includes(k));
        if (!match) continue;
        // skip if already downloaded - check all folders and compare sanitized title only
        const sanitizedTitle = sanitize(title);
        let alreadyDownloaded = false;
        try {
          const channelFolders = fs.readdirSync(channelDir, { withFileTypes: true });
          for (const folder of channelFolders) {
            if (folder.isDirectory()) {
              // strip date-time prefix pattern [YYYY-MM-DD-hh] or [YYYY-MM-DD]
              const folderTitle = folder.name.replace(/^\[\d{4}-\d{2}-\d{2}(?:-\d{2})?\]\s*/, '');
              if (folderTitle === sanitizedTitle) {
                // check if folder has files
                const folderPath = path.join(channelDir, folder.name);
                const files = fs.readdirSync(folderPath);
                if (files.length > 0) {
                  alreadyDownloaded = true;
                  break;
                } else {
                  // empty folder, remove to retry download
                  fs.rmdirSync(folderPath, { recursive: true });
                }
              }
            }
          }
        } catch (e) {
          if (e.code !== "ENOENT") {
            throw e;
          }
        }
        if (alreadyDownloaded) {
          // already downloaded
          continue;
        }
        // create folder and download
        fs.mkdirSync(dir, { recursive: true });
        // record current download in DB
        await db.read();
        db.data.currentDownload = {
          channel: ch.id,
          title,
          username: ch.username,
        };
        await db.write();
        // download with prefixed logging and stderr capture
        const proc = spawn(
          "yt-dlp",
          [
            "--live-from-start",
            "-ciw",
            "--no-progress",
            "--no-cache-dir",
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
        // prefix stdout from yt-dlp
        proc.stdout.on("data", (chunk) => {
          chunk
            .toString()
            .split(/\r?\n/)
            .forEach((line) => {
              if (line) console.log(`[yt-dlp] ${line}`);
            });
        });
        // capture and prefix stderr for error/skip detection
        proc.stderr.on("data", (chunk) => {
          const text = chunk.toString();
          stderr += text;
          text.split(/\r?\n/).forEach((line) => {
            if (line) console.warn(`[yt-dlp] ${line}`);
          });
        });
        const downloadResult = await new Promise((res, rej) =>
          proc.on("close", (code) => {
            if (code === 0) {
              // clear currentDownload after yt-dlp completes
              (async () => {
                await db.read();
                db.data.currentDownload = { channel: null, title: null, username: null };
                await db.write();
              })();
              return res({ success: true });
            }
            // Check if live event hasn't started yet
            if (stderr.includes("This live event will begin")) {
              console.warn(
                `[Archived V] Live event for "${title}" hasn't started yet, skipping.`
              );
              // clear currentDownload and resolve without error
              (async () => {
                await db.read();
                db.data.currentDownload = { channel: null, title: null, username: null };
                await db.write();
              })();
              // remove empty folder since download was skipped
              try {
                fs.rmdirSync(dir, { recursive: true });
              } catch (e) {
                // ignore cleanup errors
              }
              return res({ success: false, skipped: true });
            }
            // clear on failure too
            (async () => {
              await db.read();
              db.data.currentDownload = { channel: null, title: null, username: null };
              await db.write();
            })();
            return rej(new Error("download failed"));
          })
        );
        
        // Only update status, send notification, and record history if download succeeded
        if (downloadResult.success) {
          // update status after completion
          status.lastCompleted = title;
          status.current = null;
          // ensure currentDownload is cleared (redundant safety)
          await db.read();
          db.data.currentDownload = { channel: null, title: null, username: null };
          await db.write();
          if (process.env.PUSHOVER_APP_TOKEN && process.env.PUSHOVER_USER_TOKEN) {
            // send notification via Pushover
            push.send({ message: `Downloaded: ${title}`, title }, () => {});
          }
          // record download history
          await db.read();
          db.data.history.push({ title, time: new Date().toISOString() });
          await db.write();
          count++;
        } else if (downloadResult.skipped) {
          // just clear current status for skipped downloads
          status.current = null;
        }
      }
    } catch (e) {
      if (e.code === "ETIMEDOUT") {
        console.warn(`[$
        {new Date().toISOString()}] Timeout fetching feed for channel ${ch.username}`);
      } else {
        console.error(e);
      }
      // on error, clear current status
      status.current = null;
    }
  }
  status.lastRun = new Date().toISOString();
  // recalculate total downloaded videos by counting subdirectories per channel
  let total = 0;
  for (const ch of db.data.channels) {
    const channelDir = path.join(DOWNLOAD_DIR, ch.username);
    if (fs.existsSync(channelDir)) {
      const items = fs.readdirSync(channelDir, { withFileTypes: true });
      total += items.filter((d) => d.isDirectory()).length;
    }
  }
  status.downloadedCount = total;
  // ensure no stale current value
  status.current = null;
}

// API: manual refresh and status
// start a background refresh without blocking the response
app.post("/api/refresh", (req, res) => {
  // reset current download only
  status.current = null;
  // kick off checkUpdates asynchronously
  checkUpdates().catch((err) => console.error("Refresh error:", err));
  // respond immediately with current status
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
  console.log(
    `[${now.toISOString()}][${timeStr}] Manual Checking for New Streams`
  );
});
// history endpoints
app.get("/api/status", (req, res) => {
  res.json(status);
});
app.get("/api/history", async (req, res) => {
  await db.read();
  res.json(db.data.history);
});
app.delete("/api/history", async (req, res) => {
  await db.read();
  db.data.history = [];
  await db.write();
  res.json({ success: true });
});

// start cron + server
db.read().then(() => {
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
    console.log(
      `[${now.toISOString()}][${timeStr}] Scheduled Checking for New Streams`
    );
    if (!status.current) {
      checkUpdates().catch((err) => console.error("Cron error:", err));
    }
  });
  app.listen(PORT, () => console.log(`Web UI Listening on Port: ${PORT}`));
});
