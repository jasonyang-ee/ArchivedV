import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const entrypoint = fileURLToPath(new URL("../index.js", import.meta.url));

function running(pid) {
  // A reaped child can briefly remain a zombie under the test host's init.
  try {
    if (process.platform === "linux" && fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].startsWith("Z")) return false;
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

async function until(check, message) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await delay(30);
  }
  assert.fail(message);
}

for (const mode of ["capture", "merge"]) {
  test(`server shutdown stops ${mode} children and preserves restart state`, { skip: process.platform === "win32" }, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "archivedv-shutdown-"));
    const bin = path.join(root, "bin");
    const dir = path.join(root, "download", "channel", "video");
    const ready = path.join(root, "child.json");
    fs.mkdirSync(bin);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(root, "data"));
    const fragments = ["Test.f137.mp4", "Test.f140.m4a"];
    for (const name of fragments) fs.writeFileSync(path.join(dir, name), Buffer.alloc(2048));
    if (mode === "capture") {
      fs.writeFileSync(path.join(root, "data", "db.json"), JSON.stringify({
        channels: [{ id: "channel", username: "channel", link: "invalid" }], keywords: [],
        retryQueue: [{ key: "channel-video", channelId: "channel", videoId: "video", title: "Test", dir, nextAttemptAt: new Date(0).toISOString(), inProgress: false }],
      }));
      // Startup recovery must not consume the fixture before the capture starts.
      for (const name of fragments) fs.rmSync(path.join(dir, name));
    }
    const executable = mode === "capture" ? "yt-dlp" : "ffmpeg";
    fs.writeFileSync(path.join(bin, executable), `#!${process.execPath}
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const child = ${mode === "capture" ? "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })" : "null"};
fs.writeFileSync(${JSON.stringify(ready)}, JSON.stringify([process.pid, child?.pid].filter(Boolean)));
setInterval(() => {}, 1000);
`, { mode: 0o755 });
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const server = spawn(process.execPath, [entrypoint], {
      cwd: root,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PORT: String(port), TRUST_PROXY: "false", PUSHOVER_APP_TOKEN: "", PUSHOVER_USER_TOKEN: "", YTDLP_COOKIES_PATH: path.join(root, "cookies.txt") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    server.stdout.on("data", (data) => { output += data; });
    server.stderr.on("data", (data) => { output += data; });
    let pids = [];
    t.after(() => {
      server.kill("SIGKILL");
      for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} }
      fs.rmSync(root, { recursive: true, force: true });
    });
    await until(() => fs.existsSync(ready), `child never started: ${output}`);
    pids = JSON.parse(fs.readFileSync(ready, "utf8"));
    server.kill("SIGTERM");
    await until(() => server.exitCode !== null || server.signalCode !== null, `server did not exit: ${output}`);
    await until(() => pids.every((pid) => !running(pid)), `${mode} children survived server shutdown`);
    const state = JSON.parse(fs.readFileSync(path.join(root, "data", "db.json"), "utf8"));
    assert.equal(state.history.length, 0);
    if (mode === "capture") {
      assert.equal(state.currentDownloads[0].videoId, "video");
      assert.equal(state.retryQueue[0].dir, dir);
    } else {
      assert.deepEqual(fs.readdirSync(dir), fragments);
    }
  });
}
