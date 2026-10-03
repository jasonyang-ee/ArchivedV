import fs from "fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import db from "./database.js";
import {
  YTDLP_COOKIES_PATH,
  AUTH_SKIP_TTL_MS,
  AUTH_SKIP_CACHE_MAX,
} from "./config.js";

// In-memory cache to avoid repeatedly attempting auth-required videos when cookies are not configured.
// Not persisted (avoids history growth). TTL is configurable.
export const authSkipCache = new Map(); // videoId -> { expiresAt: number }

export function isAuthSkipped(videoId) {
  if (!videoId) return false;
  const entry = authSkipCache.get(videoId);
  if (!entry) return false;
  if (entry.expiresAt <= Date.now()) {
    authSkipCache.delete(videoId);
    return false;
  }
  return true;
}

export function markAuthSkipped(videoId) {
  if (!videoId) return;
  // Simple size cap: drop oldest-ish by iterating insertion order.
  if (authSkipCache.size >= AUTH_SKIP_CACHE_MAX) {
    const firstKey = authSkipCache.keys().next().value;
    if (firstKey) authSkipCache.delete(firstKey);
  }
  authSkipCache.set(videoId, { expiresAt: Date.now() + AUTH_SKIP_TTL_MS });
}

export function clearAuthSkipCache() {
  authSkipCache.clear();
}

export function canUseCookies() {
  try {
    db.read();
    const enabled = !!db.data?.auth?.useCookies;
    if (!enabled) return false;
    return fs.existsSync(YTDLP_COOKIES_PATH);
  } catch {
    return false;
  }
}

export function getYtDlpAuthArgs() {
  if (!canUseCookies()) return [];
  return ["--cookies", YTDLP_COOKIES_PATH];
}

export function classifyYtDlpAuthFailure(text) {
  const t = String(text || "").toLowerCase();
  if (!t) return null;

  // Members-only / private / login-required patterns
  if (t.includes("private video") && t.includes("sign in")) return { kind: "auth_required", reason: "private_video" };
  // When cookies are enabled, YouTube returns a different error for private videos:
  // "Video unavailable. This video is private" (no "sign in" prompt)
  if (t.includes("video unavailable") && t.includes("this video is private")) return { kind: "auth_required", reason: "private_video" };
  if (t.includes("this video is available to this channel's members")) return { kind: "auth_required", reason: "members_only" };
  if (t.includes("join this channel") && t.includes("access")) return { kind: "auth_required", reason: "members_only" };
  if (t.includes("sign in") && t.includes("you've been granted access")) return { kind: "auth_required", reason: "private_video" };
  if (t.includes("confirm your age") || t.includes("age-restricted")) return { kind: "auth_required", reason: "age_restricted" };

  return null;
}

export default {
  isAuthSkipped,
  markAuthSkipped,
  clearAuthSkipCache,
  canUseCookies,
  getYtDlpAuthArgs,
  classifyYtDlpAuthFailure,
};

export function validateCookies(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (!/^# (?:Netscape )?HTTP Cookie File/.test(lines[0] || "")) throw new Error("Expected a Netscape cookies.txt file");
  let count = 0;
  for (let line of lines.slice(1)) {
    if (line.startsWith("#HttpOnly_")) line = line.slice(10);
    else if (!line.trim() || line.startsWith("#")) continue;
    const fields = line.split("\t");
    if (fields.length !== 7 || !fields[0] || !/^(TRUE|FALSE)$/.test(fields[1]) || !fields[2].startsWith("/") ||
      !/^(TRUE|FALSE)$/.test(fields[3]) || !/^\d+$/.test(fields[4]) || !fields[5] || line.includes("\0")) {
      throw new Error("Invalid Netscape cookie record");
    }
    count++;
  }
  if (!count) throw new Error("Cookie file has no cookie records");
}

export function saveCookies(text) {
  const temporaryPath = `${YTDLP_COOKIES_PATH}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(YTDLP_COOKIES_PATH), { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, text, { encoding: "utf8", mode: 0o600, flag: "wx", flush: true });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, YTDLP_COOKIES_PATH);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}
