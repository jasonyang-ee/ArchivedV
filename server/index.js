/**
 * ArchivedV - YouTube Video Archiver Server
 *
 * This is the main entry point that composes all modules together.
 * The codebase has been refactored into the following modules:
 *
 * - config.js: Configuration constants and environment variables
 * - utils.js: Utility functions (sanitize, sleep, URL validation, etc.)
 * - database.js: LowDB database helper and data structure
 * - auth.js: YouTube authentication/cookies handling
 * - merger.js: Video/audio auto-merge functionality using ffmpeg
 * - downloader.js: yt-dlp download management with flexible format selection
 * - scheduler.js: Cron jobs and retry queue processing
 * - routes.js: Express API routes
 */

import express from "express";
import cors from "cors";
import { PORT } from "./config.js";
import router, { setupProductionMiddleware } from "./routes.js";
import { startScheduler, runInitialCheck } from "./scheduler.js";
import { startDownloadWatchdog } from "./downloader.js";

// Create Express app
const app = express();

// Enable CORS
app.use(cors());

// Mount API routes
app.use(router);

// Set up production middleware (static files, SPA fallback)
setupProductionMiddleware(app);

// Start the server
app.listen(PORT, () => {
  console.log(`[Archived V] Server running on port ${PORT}`);
  console.log(`[Archived V] Environment: ${process.env.NODE_ENV || "production"}`);

  // Start cron schedulers and retry queue processor
  startScheduler();

  // Start download watchdog for stuck downloads
  startDownloadWatchdog();

  // Run initial check and auto-merge on startup
  runInitialCheck();
});
