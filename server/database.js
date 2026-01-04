import fs from "fs";
import { DB_PATH, DATA_DIR, DOWNLOAD_DIR } from "./config.js";

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// Database helper
const db = {
  data: {
    channels: [],
    keywords: [],
    ignoreKeywords: [],
    history: [],
    currentDownloads: [],
    retryQueue: [],
    dateFormat: 'YYYY-MM-DD',
    auth: { useCookies: false },
    ytdlpFlags: '',
  },
  
  read() {
    if (!fs.existsSync(DB_PATH)) {
      this.data = {
        channels: [],
        keywords: [],
        ignoreKeywords: [],
        history: [],
        currentDownloads: [],
        retryQueue: [],
        dateFormat: 'YYYY-MM-DD',
        auth: { useCookies: false },
        ytdlpFlags: '',
      };
      fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2));
    } else {
      try {
        const file = fs.readFileSync(DB_PATH, "utf-8");
        this.data = JSON.parse(file);
        
        // Ensure all fields exist with defaults
        if (!this.data.history) this.data.history = [];
        if (!this.data.ignoreKeywords) this.data.ignoreKeywords = [];
        if (!this.data.dateFormat) this.data.dateFormat = 'YYYY-MM-DD';
        if (!this.data.retryQueue) this.data.retryQueue = [];
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
        }
        
        // Ensure currentDownloads exists
        if (!this.data.currentDownloads) this.data.currentDownloads = [];
        
        // Clean up old currentDownload field if currentDownloads exists
        if (this.data.currentDownloads && this.data.currentDownload) {
          delete this.data.currentDownload;
          this.write(); // Save the cleanup
        }
      } catch {
        this.data = {
          channels: [],
          keywords: [],
          ignoreKeywords: [],
          history: [],
          currentDownloads: [],
          retryQueue: [],
          dateFormat: 'YYYY-MM-DD',
          auth: { useCookies: false },
          ytdlpFlags: '',
        };
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
