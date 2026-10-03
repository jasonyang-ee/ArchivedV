import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { DOWNLOAD_DIR, MERGE_TIMEOUT_MS } from "./config.js";
import { isFinalVideoFile, isSubstantialFile, isSafeDownloadPath } from "./utils.js";

// Shared ownership prevents startup recovery from reading files still being written.
export const downloadingFolders = new Set();
const mergingFolders = new Map();
const mergeProcesses = new Set();
let stopping = false;
export function hasActiveMerges() { return mergingFolders.size > 0; }

export function stopMerges() {
  stopping = true;
  for (const proc of mergeProcesses) proc.kill("SIGKILL");
}
export function isFolderBusy(folder) {
  const key = path.resolve(folder);
  return downloadingFolders.has(key) || mergingFolders.has(key);
}

function fragmentInfo(filename) {
  const match = filename.match(/^(.+)\.f(\d+)\.(mp4|webm|mkv|m4a|opus|ogg)$/i);
  if (!match) return null;
  const audio = /^(139|140|141|249|250|251|256|258|327|328)$/.test(match[2]) || /^(m4a|opus|ogg)$/i.test(match[3]);
  return { title: match[1], audio };
}

// Walk only real directories under the archive; never follow symlinks.
function findDownloadFolders(root, depth = 0) {
  if (depth > 4) return [];
  const folders = [];
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (error) {
    console.warn(`[WARN] [Archived V] Cannot scan ${root}: ${error.message}`);
    return folders;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const folder = path.join(root, entry.name);
      folders.push(folder, ...findDownloadFolders(folder, depth + 1));
    }
  }
  return folders;
}

export function autoMerge(specificFolder = null, callback = null) {
  if (specificFolder) return mergeInFolder(specificFolder, callback);
  let folders;
  try {
    folders = findDownloadFolders(DOWNLOAD_DIR);
  } catch (error) {
    console.error(`[ERROR] [Archived V] Cannot scan archive: ${error.message}`);
    callback?.({ ok: false });
    return;
  }
  // Keep startup recovery serial to bound ffmpeg concurrency.
  let index = 0;
  const next = () => {
    if (stopping) return callback?.({ ok: false });
    if (index === folders.length) return callback?.({ ok: true });
    mergeInFolder(folders[index++], () => setImmediate(next));
  };
  next();
}

function cleanupFragments(folder, selected) {
  const files = fs.readdirSync(folder);
  for (const fragment of selected) {
    const related = files.filter((name) => name === fragment || name === `${fragment}.ytdl` ||
      (name.startsWith(`${fragment}-Frag`) && /^\d+(?:\.part)?$/.test(name.slice(`${fragment}-Frag`.length))));
    for (const name of related) {
      try {
        fs.unlinkSync(path.join(folder, name));
      } catch (error) {
        console.warn(`[WARN] [Archived V] Could not clean fragment ${name}: ${error.message}`);
      }
    }
  }
}

export function mergeInFolder(folder, callback = null) {
  const key = path.resolve(folder);
  if (stopping || !isSafeDownloadPath(key) || downloadingFolders.has(key)) {
    callback?.({ ok: false });
    return;
  }
  if (mergingFolders.has(key)) {
    if (callback) mergingFolders.get(key).push(callback);
    return;
  }
  mergingFolders.set(key, callback ? [callback] : []);
  const finish = (ok) => {
    const callbacks = mergingFolders.get(key) || [];
    mergingFolders.delete(key);
    for (const cb of callbacks) cb({ ok });
  };

  let groups;
  try {
    const files = fs.readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
    const titleMap = new Map();
    for (const file of files) {
      const info = fragmentInfo(file);
      if (!info) continue;
      if (!titleMap.has(info.title)) titleMap.set(info.title, { videos: [], audios: [] });
      titleMap.get(info.title)[info.audio ? "audios" : "videos"].push(file);
    }
    groups = [...titleMap].filter(([, parts]) => parts.videos.length && parts.audios.length);
  } catch (error) {
    console.error(`[ERROR] [Archived V] Cannot inspect merge folder: ${error.message}`);
    finish(false);
    return;
  }

  let index = 0;
  let allOk = true;
  const next = () => {
    if (stopping) return finish(false);
    if (index === groups.length) return finish(allOk);
    const [title, parts] = groups[index++];
    // Prefer the largest available streams, not lexicographic format IDs.
    const bySize = (a, b) => fs.statSync(path.join(folder, b)).size - fs.statSync(path.join(folder, a)).size;
    let selected, outputPath, temporaryPath;
    try {
      const existing = fs.readdirSync(folder).some((file) =>
        (file === `${title}.mp4` || file === `${title}.mkv` || file === `${title}.webm` ||
          file === `${title}.recovered.mp4` || file === `${title}.recovered.mkv`) &&
        isFinalVideoFile(file) && isSubstantialFile(path.join(folder, file)));
      if (existing) return next();
      selected = [parts.videos.sort(bySize)[0], parts.audios.sort(bySize)[0]];
      let corrupt = false;
      for (const file of selected) {
        if (fs.statSync(path.join(folder, file)).size < 1024) {
          fs.unlinkSync(path.join(folder, file));
          fs.rmSync(path.join(folder, `${file}.ytdl`), { force: true });
          corrupt = true;
        }
      }
      if (corrupt) { allOk = false; return next(); }
      const extension = path.extname(selected[0]).toLowerCase() === ".mp4" ? ".mp4" : ".mkv";
      outputPath = path.join(folder, `${title}${extension}`);
      // Preserve even a small existing final file; recovery gets its own name.
      if (fs.existsSync(outputPath)) outputPath = path.join(folder, `${title}.recovered${extension}`);
      if (fs.existsSync(outputPath)) { allOk = false; return next(); }
      temporaryPath = `${outputPath}.merging.part`;
      const proc = spawn("ffmpeg", [
        "-nostdin", "-loglevel", "error", "-y",
        "-i", path.join(folder, selected[0]), "-i", path.join(folder, selected[1]),
        "-map", "0:v:0", "-map", "1:a:0", "-c", "copy",
        "-f", extension === ".mp4" ? "mp4" : "matroska", temporaryPath,
      ], { stdio: ["ignore", "ignore", "pipe"], timeout: MERGE_TIMEOUT_MS, killSignal: "SIGKILL" });
      mergeProcesses.add(proc);
      let stderr = "";
      proc.stderr.on("data", (data) => { stderr = (stderr + data).slice(-16384); });
      proc.on("error", (error) => { stderr = (stderr + error.message).slice(-16384); });
      proc.once("close", (code) => {
        mergeProcesses.delete(proc);
        try {
          if (stopping || code !== 0 || !isSubstantialFile(temporaryPath)) throw new Error(`ffmpeg exit ${code}; ${stderr.trim() || "no substantial output"}`);
          // Exclusive publication never overwrites a final file created by another writer.
          fs.linkSync(temporaryPath, outputPath);
          fs.unlinkSync(temporaryPath);
          cleanupFragments(folder, selected);
          console.log(`[INFO] [Archived V] Recovered video: ${path.basename(outputPath)}`);
        } catch (error) {
          allOk = false;
          console.error(`[ERROR] [Archived V] Merge failed: ${error.message}`);
          try { fs.rmSync(temporaryPath, { force: true }); } catch {}
        }
        next();
      });
    } catch (error) {
      allOk = false;
      console.error(`[ERROR] [Archived V] Could not start merge: ${error.message}`);
      next();
    }
  };
  next();
}

export default { autoMerge, mergeInFolder };
