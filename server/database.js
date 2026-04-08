import fs from "fs";
import path from "path";
import { DB_PATH, DATA_DIR, DOWNLOAD_DIR } from "./config.js";
import { sanitize } from "./utils.js";

function createDefaultData() {
  return {
    channels: [],
    keywords: [],
    ignoreKeywords: [],
    history: [],
    currentDownloads: [],
    retryQueue: [],
    scheduledStreams: [],
    dateFormat: 'YYYY-MM-DD',
    auth: { useCookies: false },
    ytdlpFlags: '',
  };
}

function buildChannelUrl(channelId, username) {
  if (username) return `https://www.youtube.com/@${username}`;
  if (channelId) return `https://www.youtube.com/channel/${channelId}`;
  return null;
}

function stripDatePrefix(folderName) {
  return folderName.replace(/^\[\d{2,4}-\d{2}-\d{2,4}\]\s*/, "");
}

function normalizeHistoryTitle(title) {
  return sanitize(String(title || ""))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildDownloadTitleMap(channels) {
  const titleMap = new Map();

  for (const channel of channels) {
    const channelDirName = channel.username || channel.id;
    if (!channelDirName) continue;

    const channelDir = path.join(DOWNLOAD_DIR, channelDirName);
    if (!fs.existsSync(channelDir)) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(channelDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const normalizedTitle = normalizeHistoryTitle(stripDatePrefix(entry.name));
      if (!normalizedTitle) continue;

      const matches = titleMap.get(normalizedTitle) || [];
      if (!matches.some((candidate) => candidate.id === channel.id)) {
        matches.push(channel);
        titleMap.set(normalizedTitle, matches);
      }
    }
  }

  return titleMap;
}

function migrateHistoryEntries(data) {
  const history = Array.isArray(data.history) ? data.history : [];
  const channels = Array.isArray(data.channels) ? data.channels : [];

  if (history.length === 0 || channels.length === 0) {
    return { changed: false, updatedCount: 0, unresolvedCount: 0 };
  }

  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  const channelsByUsername = new Map(
    channels
      .filter((channel) => channel.username)
      .map((channel) => [channel.username, channel])
  );
  const singleChannel = channels.length === 1 ? channels[0] : null;
  const needsFolderLookup = history.some(
    (item) => !item.channelId && !item.username && !item.channelName
  );
  const titleMap = needsFolderLookup ? buildDownloadTitleMap(channels) : null;

  let changed = false;
  let updatedCount = 0;
  let unresolvedCount = 0;

  data.history = history.map((item) => {
    const titleMatches = titleMap?.get(normalizeHistoryTitle(item.title)) || [];
    const matchedChannel =
      (item.channelId && channelsById.get(item.channelId)) ||
      (item.username && channelsByUsername.get(item.username)) ||
      (titleMatches.length === 1 ? titleMatches[0] : null) ||
      (!item.channelId && !item.username && !item.channelName ? singleChannel : null);

    const channelId = item.channelId || matchedChannel?.id || null;
    const username = item.username || matchedChannel?.username || null;
    const channelName = item.channelName || matchedChannel?.channelName || username || null;
    const channelUrl = item.channelUrl || buildChannelUrl(channelId, username);

    const nextItem = { ...item };
    let itemChanged = false;

    if (channelId && item.channelId !== channelId) {
      nextItem.channelId = channelId;
      itemChanged = true;
    }
    if (username && item.username !== username) {
      nextItem.username = username;
      itemChanged = true;
    }
    if (channelName && item.channelName !== channelName) {
      nextItem.channelName = channelName;
      itemChanged = true;
    }
    if (channelUrl && item.channelUrl !== channelUrl) {
      nextItem.channelUrl = channelUrl;
      itemChanged = true;
    }

    if (itemChanged) {
      changed = true;
      updatedCount++;
    }

    if (!nextItem.channelName && !nextItem.username && !nextItem.channelId) {
      unresolvedCount++;
    }

    return nextItem;
  });

  return { changed, updatedCount, unresolvedCount };
}

let hasAttemptedHistoryMigration = false;

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// Database helper
const db = {
  data: createDefaultData(),
  
  read() {
    if (!fs.existsSync(DB_PATH)) {
      this.data = createDefaultData();
      fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2));
    } else {
      try {
        const file = fs.readFileSync(DB_PATH, "utf-8");
        this.data = JSON.parse(file);
        let shouldWrite = false;
        
        // Ensure all fields exist with defaults
        if (!this.data.history) this.data.history = [];
        if (!this.data.ignoreKeywords) this.data.ignoreKeywords = [];
        if (!this.data.dateFormat) this.data.dateFormat = 'YYYY-MM-DD';
        if (!this.data.retryQueue) this.data.retryQueue = [];
        if (!this.data.scheduledStreams) this.data.scheduledStreams = [];
        if (!this.data.auth) this.data.auth = { useCookies: false };
        if (typeof this.data.auth.useCookies !== "boolean") this.data.auth.useCookies = false;
        if (typeof this.data.ytdlpFlags !== "string") this.data.ytdlpFlags = '';
        
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
          shouldWrite = true;
        }
        
        // Ensure currentDownloads exists
        if (!this.data.currentDownloads) {
          this.data.currentDownloads = [];
          shouldWrite = true;
        }
        
        // Clean up old currentDownload field if currentDownloads exists
        if (this.data.currentDownloads && this.data.currentDownload) {
          delete this.data.currentDownload;
          shouldWrite = true;
        }

        if (!hasAttemptedHistoryMigration) {
          const migration = migrateHistoryEntries(this.data);
          hasAttemptedHistoryMigration = true;

          if (migration.changed) {
            shouldWrite = true;
            console.log(
              `[INFO] [Archived V] Migrated ${migration.updatedCount} history entr${migration.updatedCount === 1 ? 'y' : 'ies'} with channel metadata`
            );
          }

          if (migration.unresolvedCount > 0) {
            console.warn(
              `[WARN] [Archived V] ${migration.unresolvedCount} history entr${migration.unresolvedCount === 1 ? 'y is' : 'ies are'} still missing channel metadata`
            );
          }
        }

        if (shouldWrite) {
          this.write();
        }
      } catch {
        this.data = createDefaultData();
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

export default db;
