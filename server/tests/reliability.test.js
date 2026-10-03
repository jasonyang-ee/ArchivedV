import "./testEnvironment.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import test, { beforeEach } from "node:test";
import axios from "axios";
import express from "express";
import db from "../database.js";
import { DB_PATH, DOWNLOAD_DIR, YTDLP_COOKIES_PATH } from "../config.js";
import { activeDownloads, status, startYtDlp, upsertRetryJob, cleanupRetryQueue, recoverStaleDownloads, startDownloadWatchdog } from "../downloader.js";
import { checkUpdates, processRetryQueue, processScheduledStreams } from "../scheduler.js";
import { autoMerge, mergeInFolder, downloadingFolders } from "../merger.js";
import router from "../routes.js";
import { clearAuthSkipCache, markAuthSkipped } from "../auth.js";
import { parseYtDlpFlags } from "../ytdlpFlags.js";
import { downloadDirectory, isSafeDownloadPath } from "../utils.js";

beforeEach(() => {
  db.data = {
    channels: [], keywords: [], ignoreKeywords: [], history: [], currentDownloads: [],
    retryQueue: [], scheduledStreams: [], auth: { useCookies: false }, ytdlpFlags: "",
  };
  db.write();
  activeDownloads.clear();
  downloadingFolders.clear();
  clearAuthSkipCache();
  status.currentDownloads = [];
});

function fakeSpawn(t) {
  const processes = [];
  t.mock.method(childProcess, "spawn", () => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => true;
    processes.push(proc);
    return proc;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return processes;
}

function beginDownload(t) {
  const processes = fakeSpawn(t);
  const info = { id: "channel-video-123", channel: "channel", videoId: "video", title: "Test" };
  const dir = fs.mkdtempSync(path.join(DOWNLOAD_DIR, "lifecycle-"));
  db.data.channels = [{ id: "channel", username: "channel" }];
  db.data.currentDownloads = [info];
  db.write();
  status.currentDownloads = [info];
  startYtDlp(info.id, info, dir, "https://www.youtube.com/watch?v=video");
  return { proc: processes[0], info, dir };
}

test("database read errors preserve stored data", (t) => {
  const previous = fs.readFileSync(DB_PATH, "utf8");
  const read = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (file, ...args) => {
    if (file === DB_PATH) throw Object.assign(new Error("read denied"), { code: "EACCES" });
    return read(file, ...args);
  });
  assert.throws(() => db.read(), /read denied/);
  assert.equal(read(DB_PATH, "utf8"), previous);
});

test("failed database replacement leaves previous JSON intact", (t) => {
  const previous = fs.readFileSync(DB_PATH, "utf8");
  db.data.keywords = ["new"];
  t.mock.method(fs, "renameSync", () => { throw new Error("replacement denied"); });
  assert.throws(() => db.write(), /replacement denied/);
  assert.equal(fs.readFileSync(DB_PATH, "utf8"), previous);
  assert.deepEqual(fs.readdirSync(path.dirname(DB_PATH)), ["db.json"]);
});

test("invalid JSON is backed up exactly before resetting", () => {
  fs.writeFileSync(DB_PATH, "{invalid");
  db.read();
  assert.deepEqual(db.data.channels, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(DB_PATH, "utf8")), db.data);
  const backup = fs.readdirSync(path.dirname(DB_PATH)).find((file) => file.startsWith("db.json.corrupt-"));
  assert.equal(fs.readFileSync(path.join(path.dirname(DB_PATH), backup), "utf8"), "{invalid");
});

test("one unreadable directory does not stop recovery of other folders", async (t) => {
  const unreadable = path.join(DOWNLOAD_DIR, "unreadable");
  const healthy = path.join(DOWNLOAD_DIR, "healthy");
  fs.mkdirSync(healthy);
  const read = fs.readdirSync;
  let visitedHealthy = false;
  t.mock.method(fs, "readdirSync", (folder, ...args) => {
    if (folder === DOWNLOAD_DIR) return ["unreadable", "healthy"].map((name) => ({ name, isDirectory: () => true }));
    if (folder === unreadable) throw Object.assign(new Error("read denied"), { code: "EACCES" });
    if (folder === healthy) visitedHealthy = true;
    return read(folder, ...args);
  });
  await new Promise((resolve) => autoMerge(null, resolve));
  assert.equal(visitedHealthy, true);
});

test("archive paths reject symlinks and bound long Unicode names without losing identity", () => {
  const videoId = "v".repeat(128);
  const dir = downloadDirectory({ id: "boundary" }, videoId, "長".repeat(200), "2026-10-03");
  assert.ok(Buffer.byteLength(path.basename(dir)) <= 255);
  assert.ok(dir.endsWith(`[${videoId}]`));
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(isSafeDownloadPath(dir), true);
  const link = path.join(DOWNLOAD_DIR, "linked");
  fs.symlinkSync(path.dirname(DOWNLOAD_DIR), link, "dir");
  assert.equal(isSafeDownloadPath(path.join(link, "escaped")), false);
});

test("retry metadata updates preserve attempts, deadline and creation time", () => {
  const job = { channelId: "channel", videoId: "video", title: "Old" };
  upsertRetryJob(job, { attempts: 4, nextAttemptAt: "2099-01-01T00:00:00.000Z", createdAt: "2020-01-01T00:00:00.000Z" });
  upsertRetryJob({ ...job, title: "New" });
  db.read();
  assert.equal(db.data.retryQueue.length, 1);
  assert.equal(db.data.retryQueue[0].title, "New");
  assert.equal(db.data.retryQueue[0].attempts, 4);
  assert.equal(db.data.retryQueue[0].nextAttemptAt, "2099-01-01T00:00:00.000Z");
  assert.equal(db.data.retryQueue[0].createdAt, "2020-01-01T00:00:00.000Z");
});

test("feed refresh preserves pending retry backoff", async (t) => {
  const processes = fakeSpawn(t);
  db.data.channels = [{ id: "channel", username: "channel", link: "https://www.youtube.com/feeds/videos.xml?channel_id=channel" }];
  db.write();
  upsertRetryJob({ channelId: "channel", videoId: "video", title: "Test", username: "channel" }, {
    attempts: 4, nextAttemptAt: "2099-01-01T00:00:00.000Z",
  });
  t.mock.method(axios, "get", async () => ({ data: '<feed><entry><videoId>video</videoId><title>Test</title><link href="https://www.youtube.com/watch?v=video"/></entry></feed>' }));
  await checkUpdates();
  db.read();
  assert.equal(db.data.retryQueue[0].attempts, 4);
  assert.equal(db.data.retryQueue[0].nextAttemptAt, "2099-01-01T00:00:00.000Z");
  assert.equal(processes.length, 0);
});

test("refresh keeps distinct active videos with hyphenated identifiers", async () => {
  const downloads = ["one", "two"].map((videoId) => ({
    id: `channel-with-hyphens-${videoId}-123`, channel: "channel-with-hyphens", videoId,
  }));
  db.data.currentDownloads = downloads;
  db.write();
  for (const info of downloads) activeDownloads.set(info.id, { downloadInfo: info });
  await checkUpdates();
  db.read();
  assert.deepEqual(db.data.currentDownloads, downloads);
  assert.deepEqual(status.currentDownloads, downloads);
});

test("failed download is removed from persisted current downloads and retried once", (t) => {
  const { proc } = beginDownload(t);
  proc.emit("close", 1);
  db.read();
  assert.deepEqual(db.data.currentDownloads, []);
  assert.deepEqual(status.currentDownloads, []);
  assert.equal(activeDownloads.size, 0);
  assert.equal(db.data.retryQueue.length, 1);
  assert.equal(db.data.retryQueue[0].attempts, 1);
});

test("yt-dlp spawn errors are handled and requeued on close", (t) => {
  const { proc } = beginDownload(t);
  assert.doesNotThrow(() => proc.emit("error", Object.assign(new Error("spawn yt-dlp ENOENT"), { code: "ENOENT" })));
  proc.emit("close", -2);
  db.read();
  assert.equal(activeDownloads.size, 0);
  assert.deepEqual(db.data.currentDownloads, []);
  assert.equal(db.data.retryQueue.length, 1);
});

test("ffmpeg spawn errors complete the callback once and keep fragments", (t) => {
  const processes = fakeSpawn(t);
  const dir = fs.mkdtempSync(path.join(DOWNLOAD_DIR, "merge-"));
  fs.writeFileSync(path.join(dir, "Test.f137.mp4"), Buffer.alloc(2048));
  fs.writeFileSync(path.join(dir, "Test.f140.m4a"), Buffer.alloc(2048));
  let callbacks = 0;
  mergeInFolder(dir, () => callbacks++);
  assert.equal(processes.length, 1);
  assert.doesNotThrow(() => processes[0].emit("error", new Error("spawn ffmpeg ENOENT")));
  processes[0].emit("close", -2);
  assert.equal(callbacks, 1);
  assert.equal(fs.readdirSync(dir).length, 2);
});

test("duplicate start requests reuse the active process", (t) => {
  const { proc, info, dir } = beginDownload(t);
  assert.equal(startYtDlp("duplicate", info, dir, "https://www.youtube.com/watch?v=video"), proc);
  assert.equal(childProcess.spawn.mock.callCount(), 1);
});

test("custom flags reject quoting, abbreviation, alias and batch-file bypasses", () => {
  for (const flags of ['--ex""ec command', '--exe=command', '--config /tmp/config', '-a /tmp/list', '-ia/tmp/list', '--batch /tmp/list', '--alias custom options', '--limit-rate "2M', "--exec\0command"]) {
    assert.throws(() => parseYtDlpFlags(flags), Error, flags);
  }
  assert.deepEqual(parseYtDlpFlags('--write-description\n--limit-rate 2M --sub-langs "en.*,ja"'),
    ["--write-description", "--limit-rate", "2M", "--sub-langs", "en.*,ja"]);
});

test("prohibited flags already saved in the database do not reach yt-dlp", (t) => {
  db.data.ytdlpFlags = '--ex""ec command';
  db.write();
  beginDownload(t);
  const args = childProcess.spawn.mock.calls[0].arguments[1];
  assert.equal(args.includes("--exec"), false);
  assert.equal(args.includes("command"), false);
});

async function serve(t) {
  const app = express();
  app.use(router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("cancelled process closure cannot recreate a retry or successful history", async (t) => {
  const { proc, info } = beginDownload(t);
  const base = await serve(t);
  // Avoid waiting ten seconds for the empty-directory cleanup timer.
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) =>
    delay === 10000 ? { unref() {} } : schedule(callback, delay, ...args));
  const response = await fetch(`${base}/api/downloads/${info.id}`, { method: "DELETE" });
  assert.equal(response.status, 200);
  proc.emit("close", 0);
  db.read();
  assert.deepEqual(db.data.currentDownloads, []);
  assert.deepEqual(db.data.retryQueue, []);
  assert.deepEqual(db.data.history, []);
  assert.deepEqual(db.data.ignoreKeywords, [info.title]);
});

test("concurrent channel additions persist a single channel", async (t) => {
  const base = await serve(t);
  const pending = [];
  let ready;
  const bothFetching = new Promise((resolve) => { ready = resolve; });
  t.mock.method(axios, "get", () => new Promise((resolve) => {
    pending.push(resolve);
    if (pending.length === 2) ready();
  }));
  const add = () => fetch(`${base}/api/channels`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ link: "https://www.youtube.com/channel/UCtest" }),
  });
  const responses = [add(), add()];
  await bothFetching;
  for (const resolve of pending) resolve({ data: "<feed><author><name>Channel</name></author></feed>" });
  assert.deepEqual((await Promise.all(responses)).map((res) => res.status), [200, 200]);
  db.read();
  assert.equal(db.data.channels.length, 1);
});

test("malformed keyword and channel bodies are rejected without poisoning config", async (t) => {
  const base = await serve(t);
  for (const route of ["keywords", "ignore-keywords", "channels"]) {
    for (const value of [123, {}, [], "   "]) {
      const response = await fetch(`${base}/api/${route}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [route === "channels" ? "link" : "keyword"]: value }),
      });
      assert.equal(response.status, 400, `${route}: ${JSON.stringify(value)}`);
    }
  }
  db.read();
  assert.deepEqual(db.data.keywords, []);
  assert.deepEqual(db.data.ignoreKeywords, []);
  assert.deepEqual(db.data.channels, []);
});

test("exit zero without a saved video stays retryable", (t) => {
  const { proc } = beginDownload(t);
  proc.emit("close", 0);
  db.read();
  assert.deepEqual(db.data.history, []);
  assert.equal(db.data.retryQueue.length, 1);
});

test("403 termination without media is not a successful archive", (t) => {
  const { proc } = beginDownload(t);
  proc.stderr.emit("data", Buffer.from("Got error: HTTP Error 403. Retrying fragment\n".repeat(100)));
  proc.emit("close", null);
  db.read();
  assert.deepEqual(db.data.history, []);
  assert.equal(db.data.retryQueue.length, 1);
});

test("failed merge never publishes a final filename or discards source fragments", (t) => {
  const processes = fakeSpawn(t);
  const dir = fs.mkdtempSync(path.join(DOWNLOAD_DIR, "failed-merge-"));
  fs.writeFileSync(path.join(dir, "Test.f137.mp4"), Buffer.alloc(2048));
  fs.writeFileSync(path.join(dir, "Test.f140.m4a"), Buffer.alloc(2048));
  let callbacks = 0;
  mergeInFolder(dir, () => callbacks++);
  const args = childProcess.spawn.mock.calls[0].arguments[1];
  const output = args.at(-1);
  fs.writeFileSync(output, Buffer.alloc(2048));
  processes[0].emit("close", 1);
  assert.equal(callbacks, 1);
  assert.equal(fs.existsSync(path.join(dir, "Test.mp4")), false);
  assert.equal(fs.existsSync(path.join(dir, "Test.f137.mp4")), true);
  assert.equal(fs.existsSync(path.join(dir, "Test.f140.m4a")), true);
});

test("concurrent recovery scans share one merge", (t) => {
  const processes = fakeSpawn(t);
  const dir = fs.mkdtempSync(path.join(DOWNLOAD_DIR, "shared-merge-"));
  fs.writeFileSync(path.join(dir, "Test.f137.mp4"), Buffer.alloc(2048));
  fs.writeFileSync(path.join(dir, "Test.f140.m4a"), Buffer.alloc(2048));
  let callbacks = 0;
  mergeInFolder(dir, () => callbacks++);
  mergeInFolder(dir, () => callbacks++);
  assert.equal(processes.length, 1);
  processes[0].emit("close", 1);
  assert.equal(callbacks, 2);
});

test("channel URL parsing rejects path traversal and foreign hosts", async (t) => {
  const base = await serve(t);
  t.mock.method(axios, "get", async () => ({ data: "<feed/>" }));
  for (const link of [
    "https://www.youtube.com/feeds/videos.xml?channel_id=../../outside",
    "https://evil.example/channel/UCtest", "https://www.youtube.com/watch?v=video",
    "https://www.youtube.com:8443/channel/UCtest",
  ]) {
    const response = await fetch(`${base}/api/channels`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link }),
    });
    assert.equal(response.status, 400, link);
  }
  assert.equal(axios.get.mock.callCount(), 0);
});

test("custom flags cannot change executables, destinations or add URLs", () => {
  for (const flags of ["--ffmpeg-location /tmp/program", "--output /tmp/file", "--paths /tmp", "--use-postprocessor Exec:cmd=whoami", "--print-to-file title /tmp/file", "--downloader /tmp/program", "https://example.com/file", "--simulate", "--no-continue"]) {
    assert.throws(() => parseYtDlpFlags(flags), Error, flags);
  }
});

test("cookie uploads reject non-Netscape input before replacing credentials", async (t) => {
  const base = await serve(t);
  const response = await fetch(`${base}/api/auth/cookies`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cookiesText: "not a cookie file" }),
  });
  assert.equal(response.status, 400);
  db.read();
  assert.equal(db.data.auth.useCookies, false);
});

test("channel deletion removes queued and scheduled work", async (t) => {
  const base = await serve(t);
  db.data.channels = [{ id: "channel", username: "channel" }];
  db.data.retryQueue = [{ channelId: "channel", videoId: "video", key: "channel-video" }];
  db.data.scheduledStreams = [{ channelId: "channel", videoId: "future" }];
  db.write();
  assert.equal((await fetch(`${base}/api/channels/channel`, { method: "DELETE" })).status, 200);
  db.read();
  assert.deepEqual(db.data.retryQueue, []);
  assert.deepEqual(db.data.scheduledStreams, []);
});


test("failed yt-dlp output is recovered before completion, with ownership held through ffmpeg", (t) => {
  const { proc, info, dir } = beginDownload(t);
  fs.writeFileSync(path.join(dir, "Test.f137.mp4"), Buffer.alloc(2048));
  fs.writeFileSync(path.join(dir, "Test.f140.m4a"), Buffer.alloc(2048));
  proc.emit("close", 1);
  assert.equal(activeDownloads.size, 1);
  assert.equal(db.data.history.length, 0);
  assert.equal(startYtDlp("duplicate", info, dir, "ignored"), proc);
  const call = childProcess.spawn.mock.calls[1];
  fs.writeFileSync(call.arguments[1].at(-1), Buffer.alloc(1024 * 1024 + 1));
  call.result.emit("close", 0);
  db.read();
  assert.equal(db.data.history.length, 1);
  assert.equal(db.data.history[0].dir, dir);
  assert.deepEqual(db.data.retryQueue, []);
  assert.equal(activeDownloads.size, 0);
  assert.deepEqual(fs.readdirSync(dir), ["Test.mp4"]);
});

test("startup merge cannot touch an active writer's fragments", (t) => {
  const { dir } = beginDownload(t);
  fs.writeFileSync(path.join(dir, "Test.f137.mp4"), Buffer.alloc(512));
  fs.writeFileSync(path.join(dir, "Test.f140.m4a"), Buffer.alloc(512));
  mergeInFolder(dir);
  assert.equal(childProcess.spawn.mock.callCount(), 1);
  assert.equal(fs.readdirSync(dir).length, 2);
});

test("same-title streams retain distinct video identities and dates", async (t) => {
  const processes = fakeSpawn(t);
  db.data.channels = [{ id: "same-title", username: "same-title", link: "https://www.youtube.com/feeds/videos.xml?channel_id=same-title" }];
  db.write();
  const old = path.join(DOWNLOAD_DIR, "same-title", "[2026-01-01] Singing");
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, "Singing.mp4"), Buffer.alloc(1024 * 1024 + 1));
  t.mock.method(axios, "get", async () => ({ data: '<feed><entry><videoId>first</videoId><title>Singing</title><published>2026-02-01T12:00:00Z</published></entry><entry><videoId>second</videoId><title>Singing</title><published>2026-02-01T12:00:00Z</published></entry></feed>' }));
  await checkUpdates();
  assert.equal(processes.length, 2);
  const dirs = [...activeDownloads.values()].map((download) => download.dir);
  assert.equal(new Set(dirs).size, 2);
  assert.ok(dirs.some((dir) => dir.endsWith("[first]")));
  assert.ok(dirs.some((dir) => dir.endsWith("[second]")));
});

test("channel removed during feed fetch cannot enqueue new work", async (t) => {
  const processes = fakeSpawn(t);
  db.data.channels = [{ id: "channel", username: "channel", link: "https://www.youtube.com/feeds/videos.xml?channel_id=channel" }];
  db.write();
  t.mock.method(axios, "get", async () => {
    db.read();
    db.data.channels = [];
    db.write();
    return { data: '<feed><entry><videoId>video</videoId><title>Test</title></entry></feed>' };
  });
  await checkUpdates();
  db.read();
  assert.deepEqual(db.data.retryQueue, []);
  assert.equal(processes.length, 0);
});

test("restart resets inProgress even when no queue entries are removed", () => {
  db.data.channels = [{ id: "channel", username: "channel" }];
  db.write();
  upsertRetryJob({ channelId: "channel", videoId: "video", title: "Test" }, { inProgress: true });
  cleanupRetryQueue();
  db.read();
  assert.equal(db.data.retryQueue.length, 1);
  assert.equal(db.data.retryQueue[0].inProgress, false);
});

test("restart preserves hyphenated video IDs and the original directory", () => {
  const dir = path.join(DOWNLOAD_DIR, "channel", "[2026-01-01] Legacy title");
  db.data.currentDownloads = [{ id: "channel-with-dashes-video-with-dashes-123", channel: "channel-with-dashes", videoId: "video-with-dashes", dir, title: "Legacy title" }];
  db.write();
  recoverStaleDownloads();
  db.read();
  assert.equal(db.data.retryQueue[0].videoId, "video-with-dashes");
  assert.equal(db.data.retryQueue[0].dir, dir);
  assert.deepEqual(db.data.currentDownloads, []);
});

test("scheduled promotion preserves paths and drops removed channels", async () => {
  db.data.channels = [{ id: "channel", username: "channel" }];
  db.data.scheduledStreams = [
    { channelId: "channel", videoId: "video", dir: path.join(DOWNLOAD_DIR, "dated"), scheduledFor: "2000-01-01T00:00:00Z" },
    { channelId: "removed", videoId: "other", scheduledFor: "2000-01-01T00:00:00Z" },
  ];
  const dir = db.data.scheduledStreams[0].dir;
  db.write();
  await processScheduledStreams();
  db.read();
  assert.deepEqual(db.data.scheduledStreams, []);
  assert.equal(db.data.retryQueue.length, 1);
  assert.equal(db.data.retryQueue[0].dir, dir);
});

test("auth cooldown blocks queued attempts even when cookies are enabled", async (t) => {
  const processes = fakeSpawn(t);
  db.data.channels = [{ id: "channel", username: "channel" }];
  db.data.auth.useCookies = true;
  db.write();
  upsertRetryJob({ channelId: "channel", videoId: "video", title: "Test" });
  markAuthSkipped("video");
  await processRetryQueue();
  assert.equal(processes.length, 0);
});

test("malformed database shapes preserve the original JSON", () => {
  for (const text of ["null", "[]", '{"channels":{}}', '{"auth":true}']) {
    fs.writeFileSync(DB_PATH, text);
    assert.throws(() => db.read(), /original file preserved/);
    assert.equal(fs.readFileSync(DB_PATH, "utf8"), text);
  }
});

test("valid cookie replacement is atomic and private", async (t) => {
  const base = await serve(t);
  const cookiesText = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSESSION\ttest-value\n";
  const upload = () => fetch(`${base}/api/auth/cookies`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cookiesText }) });
  assert.equal((await upload()).status, 200);
  assert.equal(fs.statSync(YTDLP_COOKIES_PATH).mode & 0o777, 0o600);
  t.mock.method(fs, "renameSync", () => { throw new Error("replacement denied"); });
  assert.equal((await upload()).status, 500);
  assert.equal(fs.readFileSync(YTDLP_COOKIES_PATH, "utf8"), cookiesText);
});

test("watchdog preserves quiet processes while media files are growing", (t) => {
  const { proc, info, dir } = beginDownload(t);
  const tracking = activeDownloads.get(info.id);
  tracking.startedAt = Date.now() - 3 * 60 * 60 * 1000;
  tracking.lastOutputAt = tracking.startedAt;
  fs.writeFileSync(path.join(dir, "Test.f137.mp4"), Buffer.alloc(2048));
  let tick;
  t.mock.method(globalThis, "setInterval", (callback) => { tick = callback; return {}; });
  let signals = 0;
  proc.kill = () => { signals++; return true; };
  startDownloadWatchdog();
  tick();
  assert.equal(signals, 0);
});


test("recovered complete queue entries reconcile history without another capture", async (t) => {
  const processes = fakeSpawn(t);
  const dir = fs.mkdtempSync(path.join(DOWNLOAD_DIR, "recovered-"));
  fs.writeFileSync(path.join(dir, "Test.mp4"), Buffer.alloc(1024 * 1024 + 1));
  db.data.channels = [{ id: "channel", username: "channel" }];
  db.write();
  upsertRetryJob({ channelId: "channel", videoId: "video", title: "Test", dir });
  await processRetryQueue();
  db.read();
  assert.equal(processes.length, 0);
  assert.equal(db.data.history.length, 1);
  assert.deepEqual(db.data.retryQueue, []);
});

test("removing a scheduled stream prevents RSS rediscovery", async (t) => {
  const processes = fakeSpawn(t);
  const base = await serve(t);
  db.data.channels = [{ id: "channel", username: "channel", link: "https://www.youtube.com/feeds/videos.xml?channel_id=channel" }];
  db.data.scheduledStreams = [{ channelId: "channel", videoId: "video", title: "Removed show" }];
  db.write();
  assert.equal((await fetch(`${base}/api/scheduled-streams/video`, { method: "DELETE" })).status, 200);
  t.mock.method(axios, "get", async () => ({ data: '<feed><entry><videoId>video</videoId><title>Removed show</title></entry></feed>' }));
  await checkUpdates();
  db.read();
  assert.deepEqual(db.data.ignoreKeywords, ["Removed show"]);
  assert.deepEqual(db.data.retryQueue, []);
  assert.equal(processes.length, 0);
});

test("removing an active channel prevents failure from recreating its retry", async (t) => {
  const { proc } = beginDownload(t);
  const base = await serve(t);
  await fetch(`${base}/api/channels/channel`, { method: "DELETE" });
  proc.emit("close", 1);
  db.read();
  assert.deepEqual(db.data.retryQueue, []);
});
