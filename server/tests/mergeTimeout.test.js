import "./testEnvironment.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// A real child that never exits proves the timeout/close path without ffmpeg installed.
process.env.MERGE_TIMEOUT_MS = "100";
const { DOWNLOAD_DIR } = await import("../config.js");
const { mergeInFolder } = await import("../merger.js");

test("hung recovery process times out and preserves its source media", { skip: process.platform === "win32" }, async (t) => {
  const bin = path.join(process.cwd(), "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "ffmpeg"), `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`, { mode: 0o755 });
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
  t.after(() => { process.env.PATH = originalPath; });
  const dir = path.join(DOWNLOAD_DIR, "hung");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "Test.f137.mp4"), Buffer.alloc(2048));
  fs.writeFileSync(path.join(dir, "Test.f140.m4a"), Buffer.alloc(2048));
  const result = await new Promise((resolve) => mergeInFolder(dir, resolve));
  assert.equal(result.ok, false);
  assert.deepEqual(fs.readdirSync(dir), ["Test.f137.mp4", "Test.f140.m4a"]);
});
