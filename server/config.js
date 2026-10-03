import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function envInteger(name, fallback, min = 1, max = 2147483647) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}: expected integer ${min}..${max}`);
  return value;
}

// Paths
export const DEFAULT_COOKIES_PATH = path.join(__dirname, "..", "data", "youtube_cookies.txt");
export const YTDLP_COOKIES_PATH = process.env.YTDLP_COOKIES_PATH || DEFAULT_COOKIES_PATH;
export const DATA_DIR = path.resolve(process.cwd(), "data");
export const DOWNLOAD_DIR = path.resolve(process.cwd(), "download");
export const DB_PATH = path.join(DATA_DIR, "db.json");

// Limits and timeouts
export const MAX_AUTH_FAILURE_ATTEMPTS = envInteger("MAX_AUTH_FAILURE_ATTEMPTS", 3);
export const MAX_CONCURRENT_DOWNLOADS = envInteger("MAX_CONCURRENT_DOWNLOADS", 0, 0); // 0 = unlimited

// Auth skip cache settings
export const AUTH_SKIP_TTL_MS = envInteger("AUTH_SKIP_TTL_MS", 7 * 24 * 60 * 60 * 1000);
export const AUTH_SKIP_CACHE_MAX = envInteger("AUTH_SKIP_CACHE_MAX", 2000);

// Feed fetch settings
export const FEED_FETCH_RETRIES = envInteger("FEED_FETCH_RETRIES", 3, 0);
export const FEED_FETCH_BACKOFF_MS = envInteger("FEED_FETCH_BACKOFF_MS", 1000);
export const FEED_404_LOG_INTERVAL_MS = 60 * 60 * 1000; // Only re-log after 1 hour
export const FEED_CHANNEL_DELAY_MS = envInteger("FEED_CHANNEL_DELAY_MS", 1500, 0); // Delay between channel RSS fetches to avoid rate-limiting

// Feed batch settings (stagger to avoid rate-limiting)
export const FEED_BATCH_SIZE = envInteger("FEED_BATCH_SIZE", 5); // Channels per batch
export const FEED_BATCH_PAUSE_MS = envInteger("FEED_BATCH_PAUSE_MS", 2000, 0); // Extra pause between batches

// Scheduled stream settings
export const SCHEDULED_STREAM_LEAD_TIME_MS = envInteger("SCHEDULED_STREAM_LEAD_TIME_MS", 5 * 60 * 1000, 0); // 5 min before scheduled time

// Retry queue settings
export const RETRY_BASE_DELAY_MS = envInteger("RETRY_BASE_DELAY_MS", 2 * 60 * 1000);
export const RETRY_MAX_DELAY_MS = envInteger("RETRY_MAX_DELAY_MS", 60 * 60 * 1000);

// Download watchdog settings
export const DOWNLOAD_WATCHDOG_INTERVAL_MS = envInteger("DOWNLOAD_WATCHDOG_INTERVAL_MS", 60 * 1000);
export const DOWNLOAD_WATCHDOG_NO_OUTPUT_MS = envInteger("DOWNLOAD_WATCHDOG_NO_OUTPUT_MS", 2 * 60 * 60 * 1000); // 2 hours for live streams
export const DOWNLOAD_WATCHDOG_MIN_RUNTIME_MS = envInteger("DOWNLOAD_WATCHDOG_MIN_RUNTIME_MS", 10 * 60 * 1000);

export const MERGE_TIMEOUT_MS = envInteger("MERGE_TIMEOUT_MS", 30 * 60 * 1000);

// HTTP settings
export const PORT = envInteger("PORT", 3000, 1, 65535);
export const AXIOS_TIMEOUT_MS = envInteger("AXIOS_TIMEOUT_MS", 20000);

// Rate limit settings
export const STATIC_RATELIMIT_MAX = envInteger("STATIC_RATELIMIT_MAX", 600);
export const AUTH_RATELIMIT_MAX = envInteger("AUTH_RATELIMIT_MAX", 60);

// Trust proxy setting (default: 1 — trust first proxy hop, typical for Docker/reverse proxy)
export const TRUST_PROXY_RAW = process.env.TRUST_PROXY;
export const TRUST_PROXY = (() => {
  const raw = TRUST_PROXY_RAW;
  if (raw === undefined || raw === "") return 1; // default: trust single proxy hop
  if (raw === "true") return true;
  if (raw === "false") return false;
  const num = Number(raw);
  return Number.isFinite(num) ? num : raw; // pass string values like "loopback" through
})();

// Pushover settings
export const PUSHOVER_APP_TOKEN = process.env.PUSHOVER_APP_TOKEN || "";
export const PUSHOVER_USER_TOKEN = process.env.PUSHOVER_USER_TOKEN || "";

export default {
  __dirname,
  DEFAULT_COOKIES_PATH,
  YTDLP_COOKIES_PATH,
  DATA_DIR,
  DOWNLOAD_DIR,
  DB_PATH,
  MAX_AUTH_FAILURE_ATTEMPTS,
  MAX_CONCURRENT_DOWNLOADS,
  AUTH_SKIP_TTL_MS,
  AUTH_SKIP_CACHE_MAX,
  FEED_FETCH_RETRIES,
  FEED_FETCH_BACKOFF_MS,
  FEED_404_LOG_INTERVAL_MS,
  FEED_CHANNEL_DELAY_MS,
  FEED_BATCH_SIZE,
  FEED_BATCH_PAUSE_MS,
  SCHEDULED_STREAM_LEAD_TIME_MS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  DOWNLOAD_WATCHDOG_INTERVAL_MS,
  DOWNLOAD_WATCHDOG_NO_OUTPUT_MS,
  DOWNLOAD_WATCHDOG_MIN_RUNTIME_MS,
  MERGE_TIMEOUT_MS,
  PORT,
  AXIOS_TIMEOUT_MS,
  STATIC_RATELIMIT_MAX,
  AUTH_RATELIMIT_MAX,
  TRUST_PROXY_RAW,
  TRUST_PROXY,
  PUSHOVER_APP_TOKEN,
  PUSHOVER_USER_TOKEN,
};
