import fs from "node:fs";
import path from "node:path";
import { DOWNLOAD_DIR } from "./config.js";

// Utility functions

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitter(ms) {
  const spread = Math.min(250, Math.max(50, Math.floor(ms * 0.1)));
  return Math.max(0, ms + Math.floor((Math.random() - 0.5) * 2 * spread));
}

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeError(err) {
  const statusCode = err?.response?.status;
  const code = err?.code;
  const message = err?.message || String(err);
  return { statusCode, code, message };
}

export function buildChannelUrl(channelId, username) {
  if (username && username !== channelId) return `https://www.youtube.com/@${encodeURIComponent(username)}`;
  if (channelId) return `https://www.youtube.com/channel/${channelId}`;
  return null;
}

// Sanitize titles for filesystem
export function sanitize(str) {
  return String(str || "").replace(/[\/\\:*?"<>|\x00-\x1f\x7f]/g, "").trim().replace(/[. ]+$/, "");
}

// URL validation to prevent SSRF attacks
export function isValidYouTubeUrl(urlString) {
  try {
    const url = new URL(urlString);

    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    if (!["youtube.com", "www.youtube.com", "youtu.be"].includes(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export function isLoopbackIp(ip) {
  if (!ip) return false;
  // Express may provide IPv4-mapped IPv6 form like ::ffff:127.0.0.1
  return ip === "127.0.0.1" || ip === "::1" || ip.startsWith("::ffff:127.");
}

// File type detection helpers
export function isFinalVideoFile(name) {
  return /\.(mp4|mkv|webm|avi|mov|flv|wmv)$/i.test(name) && !/\.f\d+\.(mp4|mkv|webm|avi|mov|flv|wmv)$/i.test(name);
}

export function isPartialDownloadFile(name) {
  return /\.(part|ytdl)$/i.test(name) || /\.f\d+\.(mp4|webm|mkv)$/i.test(name);
}

export function isAuxiliaryFile(name) {
  return /\.(jpg|jpeg|png|webp|json|info\.json|description|txt|vtt|srt|ass|lrc|m4a|aac|opus|ogg)$/i.test(name);
}

export default {
  sleep,
  jitter,
  nowIso,
  normalizeError,
  buildChannelUrl,
  sanitize,
  isValidYouTubeUrl,
  isLoopbackIp,
  isFinalVideoFile,
  isPartialDownloadFile,
  isAuxiliaryFile,
};

export function isSafeIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function isSafeDownloadPath(folder) {
  if (typeof folder !== "string") return false;
  const relative = path.relative(DOWNLOAD_DIR, path.resolve(folder));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  let current = DOWNLOAD_DIR;
  try {
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part);
      try { if (fs.lstatSync(current).isSymbolicLink()) return false; }
      catch (error) { if (error.code !== "ENOENT") return false; }
    }
    return true;
  } catch { return false; }
}

export function isSubstantialFile(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && stat.size > 1024 * 1024;
  } catch { return false; }
}

export function downloadDirectory(channel, videoId, title, published, dateFormat = "YYYY-MM-DD") {
  const username = channel.username || channel.id;
  if (!isSafeIdentifier(username) || !isSafeIdentifier(videoId)) throw new Error("Invalid download identity");
  let date = new Date(published || Date.now());
  if (!Number.isFinite(date.getTime())) date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const prefix = dateFormat === "MM-DD-YYYY" ? `${month}-${day}-${year}` : `${year}-${month}-${day}`;
  let safeTitle = sanitize(title) || videoId;
  // Include the full identity even at the supported identifier length boundary.
  const titleBudget = Math.min(120, 255 - Buffer.byteLength(`[${prefix}]  [${videoId}]`, "utf8"));
  while (Buffer.byteLength(safeTitle, "utf8") > titleBudget) safeTitle = [...safeTitle].slice(0, -1).join("");
  const dir = path.join(DOWNLOAD_DIR, username, `[${prefix}] ${safeTitle} [${videoId}]`);
  if (!isSafeDownloadPath(dir)) throw new Error("Unsafe download directory");
  return dir;
}
