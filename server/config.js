import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
export const DEFAULT_COOKIES_PATH = path.join(__dirname, "..", "data", "youtube_cookies.txt");
export const YTDLP_COOKIES_PATH = process.env.YTDLP_COOKIES_PATH || DEFAULT_COOKIES_PATH;
export const DATA_DIR = path.resolve(process.cwd(), "data");
export const DOWNLOAD_DIR = path.resolve(process.cwd(), "download");
export const DB_PATH = path.join(DATA_DIR, "db.json");

// Limits and timeouts
export const MAX_AUTH_FAILURE_ATTEMPTS = Number(process.env.MAX_AUTH_FAILURE_ATTEMPTS) || 3;
export const MAX_CONCURRENT_DOWNLOADS = Number(process.env.MAX_CONCURRENT_DOWNLOADS) || 0; // 0 = unlimited

// Auth skip cache settings
export const AUTH_SKIP_TTL_MS = Number(process.env.AUTH_SKIP_TTL_MS) || 7 * 24 * 60 * 60 * 1000;
export const AUTH_SKIP_CACHE_MAX = Number(process.env.AUTH_SKIP_CACHE_MAX) || 2000;

// Feed fetch settings
export const FEED_FETCH_RETRIES = Number(process.env.FEED_FETCH_RETRIES) || 3;
export const FEED_FETCH_BACKOFF_MS = Number(process.env.FEED_FETCH_BACKOFF_MS) || 1000;
export const FEED_404_LOG_INTERVAL_MS = 60 * 60 * 1000; // Only re-log after 1 hour
export const FEED_CHANNEL_DELAY_MS = Number(process.env.FEED_CHANNEL_DELAY_MS) || 1500; // Delay between channel RSS fetches to avoid rate-limiting

// Retry queue settings
export const RETRY_BASE_DELAY_MS = Number(process.env.RETRY_BASE_DELAY_MS) || 2 * 60 * 1000;
export const RETRY_MAX_DELAY_MS = Number(process.env.RETRY_MAX_DELAY_MS) || 60 * 60 * 1000;

// Download watchdog settings
export const DOWNLOAD_WATCHDOG_INTERVAL_MS = Number(process.env.DOWNLOAD_WATCHDOG_INTERVAL_MS) || 60 * 1000;
export const DOWNLOAD_WATCHDOG_NO_OUTPUT_MS = Number(process.env.DOWNLOAD_WATCHDOG_NO_OUTPUT_MS) || 2 * 60 * 60 * 1000; // 2 hours for live streams
export const DOWNLOAD_WATCHDOG_MIN_RUNTIME_MS = Number(process.env.DOWNLOAD_WATCHDOG_MIN_RUNTIME_MS) || 10 * 60 * 1000;

// HTTP settings
export const PORT = process.env.PORT || 3000;
export const AXIOS_TIMEOUT_MS = Number(process.env.AXIOS_TIMEOUT_MS) || 20000;

// Rate limit settings
export const STATIC_RATELIMIT_MAX = Number(process.env.STATIC_RATELIMIT_MAX) || 600;
export const AUTH_RATELIMIT_MAX = Number(process.env.AUTH_RATELIMIT_MAX) || 60;

// Trust proxy setting
export const TRUST_PROXY_RAW = process.env.TRUST_PROXY;

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
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  DOWNLOAD_WATCHDOG_INTERVAL_MS,
  DOWNLOAD_WATCHDOG_NO_OUTPUT_MS,
  DOWNLOAD_WATCHDOG_MIN_RUNTIME_MS,
  PORT,
  AXIOS_TIMEOUT_MS,
  STATIC_RATELIMIT_MAX,
  AUTH_RATELIMIT_MAX,
  TRUST_PROXY_RAW,
  PUSHOVER_APP_TOKEN,
  PUSHOVER_USER_TOKEN,
};
