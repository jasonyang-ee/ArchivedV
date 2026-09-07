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
import { DB_PATH, DOWNLOAD_DIR } from "../config.js";
import { activeDownloads, status, startYtDlp, upsertRetryJob } from "../downloader.js";
import { checkUpdates } from "../scheduler.js";
import { mergeInFolder } from "../merger.js";
import router from "../routes.js";
import { parseYtDlpFlags } from "../ytdlpFlags.js";

beforeEach(() => {
  db.data = {
    channels: [], keywords: [], ignoreKeywords: [], history: [], currentDownloads: [],
    retryQueue: [], scheduledStreams: [], auth: { useCookies: false }, ytdlpFlags: "",
  };
  db.write();
  activeDownloads.clear();
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

test("invalid JSON retains the documented reset behavior", () => {
  fs.writeFileSync(DB_PATH, "{invalid");
  db.read();
  assert.deepEqual(db.data.channels, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(DB_PATH, "utf8")), db.data);
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
