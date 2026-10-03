/**
 * ArchivedV - YouTube Video Archiver Server
 *
 * This is the main entry point that composes all modules together.
 * The codebase has been refactored into the following modules:
 *
 * - config.js: Configuration constants and environment variables
 * - utils.js: Utility functions (sanitize, sleep, URL validation, etc.)
 * - database.js: Atomic JSON database helper and data structure
 * - auth.js: YouTube authentication/cookies handling
 * - merger.js: Video/audio auto-merge functionality using ffmpeg
 * - downloader.js: yt-dlp download management with flexible format selection
 * - scheduler.js: RSS polling and retry queue processing
 * - routes.js: Express API routes
 */

import express from "express";
import { PORT, TRUST_PROXY } from "./config.js";
import router, { setupProductionMiddleware } from "./routes.js";
import { startScheduler, runInitialCheck } from "./scheduler.js";
import { startDownloadWatchdog, recoverStaleDownloads, cleanupRetryQueue, activeDownloads, stopDownloads } from "./downloader.js";
import { hasActiveMerges, stopMerges } from "./merger.js";

// Create Express app
const app = express();

// Trust proxy setting (needed for correct client IP behind reverse proxy / Docker)
app.set("trust proxy", TRUST_PROXY);

// Mount API routes
app.use(router);

// Set up production middleware (static files, SPA fallback)
setupProductionMiddleware(app);

// Start the server
let stopScheduler;
let watchdog;
const server = app.listen(PORT, () => {
  console.log(`[INFO] [Archived V] Server running on port ${PORT}`);
  console.log(`[INFO] [Archived V] Environment: ${process.env.NODE_ENV || "production"}`);

  // Recover stale downloads and clean up ghost retry queue entries
  recoverStaleDownloads();
  cleanupRetryQueue();

  // Start interval schedulers and retry queue processor
  stopScheduler = startScheduler();

  // Start download watchdog for stuck downloads
  watchdog = startDownloadWatchdog();

  // Run initial check and auto-merge on startup
  runInitialCheck();
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[INFO] [Archived V] Stopping server; unfinished jobs will resume on restart");
  stopScheduler?.();
  clearInterval(watchdog);
  server.close();
  stopDownloads();
  stopMerges();
  // yt-dlp gets 10s to close before its process group is killed. Recovery
  // mergers stop immediately and retain original fragments for the next run.
  const drained = () => activeDownloads.size === 0 && !hasActiveMerges();
  if (drained()) process.exit(0);
  setInterval(() => { if (drained()) process.exit(0); }, 50);
  setTimeout(() => {
    console.error("[ERROR] [Archived V] Shutdown timed out");
    process.exit(1);
  }, 12000);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
