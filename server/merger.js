import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { DOWNLOAD_DIR } from "./config.js";

// Check if file is a partial/fragment video file (e.g., .f299.mp4, .f140.mp4, .f303.webm)
function isFragmentFile(filename) {
  return /\.f\d+\.(mp4|webm|mkv|m4a|opus|ogg)$/i.test(filename);
}

// Extract the base title from a fragment filename
function getFragmentTitle(filename) {
  // Match patterns like "Title.f299.mp4" -> "Title"
  const match = filename.match(/^(.+)\.f\d+\.(mp4|webm|mkv|m4a|opus|ogg)$/i);
  return match ? match[1] : null;
}

// Get the format ID from a fragment filename
function getFormatId(filename) {
  const match = filename.match(/\.f(\d+)\.(mp4|webm|mkv|m4a|opus|ogg)$/i);
  return match ? match[1] : null;
}

// Clean up fragment files after successful merge with retry logic
function cleanupFragmentFiles(folder, title, parts, attempt = 1, maxAttempts = 5) {
  const filesToDelete = [];
  
  // Get all files in folder for scanning frag files
  let folderFiles = [];
  try {
    folderFiles = fs.readdirSync(folder);
  } catch (e) {
    console.warn(`[Archived V] Failed to read folder for cleanup: ${e.message}`);
  }
  
  // Collect all video fragments and their related files
  for (const vf of parts.videos) {
    filesToDelete.push(path.join(folder, vf));
    filesToDelete.push(path.join(folder, vf + '.ytdl'));
    
    // Find any -Frag### files for this fragment
    const fragPattern = vf + '-Frag';
    for (const file of folderFiles) {
      if (file.startsWith(fragPattern)) {
        filesToDelete.push(path.join(folder, file));
      }
    }
  }
  
  // Collect all audio fragments and their related files
  for (const af of parts.audios) {
    filesToDelete.push(path.join(folder, af));
    filesToDelete.push(path.join(folder, af + '.ytdl'));
    
    // Find any -Frag### files for this fragment
    const fragPattern = af + '-Frag';
    for (const file of folderFiles) {
      if (file.startsWith(fragPattern)) {
        filesToDelete.push(path.join(folder, file));
      }
    }
  }
  
  const failedFiles = [];
  
  for (const filePath of filesToDelete) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      if (e.code === 'EBUSY' || e.code === 'EPERM') {
        failedFiles.push(filePath);
      } else {
        console.warn(`[Archived V] Failed to delete "${path.basename(filePath)}": ${e.message}`);
      }
    }
  }
  
  // Retry failed files with exponential backoff
  if (failedFiles.length > 0 && attempt < maxAttempts) {
    const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s, 16s...
    console.log(`[Archived V] Retrying cleanup for "${title}" in ${delay / 1000}s (attempt ${attempt + 1}/${maxAttempts})`);
    setTimeout(() => {
      cleanupFragmentFilesRetry(failedFiles, title, attempt + 1, maxAttempts);
    }, delay);
  } else if (failedFiles.length > 0) {
    console.warn(`[Archived V] Could not delete ${failedFiles.length} file(s) for "${title}" after ${maxAttempts} attempts. Files may need manual cleanup.`);
  }
}

// Retry cleanup for specific files
function cleanupFragmentFilesRetry(files, title, attempt, maxAttempts) {
  const stillFailed = [];
  
  for (const filePath of files) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      if (e.code === 'EBUSY' || e.code === 'EPERM') {
        stillFailed.push(filePath);
      } else {
        console.warn(`[Archived V] Failed to delete "${path.basename(filePath)}": ${e.message}`);
      }
    }
  }
  
  if (stillFailed.length > 0 && attempt < maxAttempts) {
    const delay = Math.pow(2, attempt) * 1000;
    console.log(`[Archived V] Retrying cleanup for "${title}" in ${delay / 1000}s (attempt ${attempt + 1}/${maxAttempts})`);
    setTimeout(() => {
      cleanupFragmentFilesRetry(stillFailed, title, attempt + 1, maxAttempts);
    }, delay);
  } else if (stillFailed.length > 0) {
    console.warn(`[Archived V] Could not delete ${stillFailed.length} file(s) for "${title}" after ${maxAttempts} attempts: ${stillFailed.map(f => path.basename(f)).join(', ')}`);
  } else {
    console.log(`[Archived V] Successfully cleaned up fragment files for "${title}"`);
  }
}

// Check if a file is a video fragment (vs audio)
function isVideoFragment(filename, files) {
  // Common video format IDs (high quality video streams)
  // This is not exhaustive but covers the most common cases
  const videoFormatIds = [
    '299', '298', '303', '302', '308', '315', '313', '271', // VP9/AV1 high quality
    '137', '136', '135', '134', '133', '160', // H.264
    '248', '247', '244', '243', '242', '278', // VP9
    '616', '614', '612', '610', '608', '606', '604', '602', '600', '598', '596', '594', '571', // AV1
    '337', '336', '335', '334', '333', '332', '331', '330', '329', // HDR
    '400', '401', '402', // AV1
    '699', '698', '697', '696', '695', '694', // VP9
  ];
  
  const formatId = getFormatId(filename);
  if (!formatId) return false;
  
  // Check known video format IDs
  if (videoFormatIds.includes(formatId)) return true;
  
  // Check file extension - m4a, opus, ogg are typically audio
  if (/\.(m4a|opus|ogg)$/i.test(filename)) return false;
  
  // For mp4/webm/mkv, check if there's an audio file with same title
  // If this appears to be paired with an audio file, it's likely video
  const title = getFragmentTitle(filename);
  if (!title) return false;
  
  const hasAudioPair = files.some(f => {
    if (f === filename) return false;
    const fTitle = getFragmentTitle(f);
    if (fTitle !== title) return false;
    // If the other file is m4a/opus/ogg, treat current as video
    return /\.(m4a|opus|ogg)$/i.test(f);
  });
  
  return hasAudioPair;
}

// Check if a file is an audio fragment
function isAudioFragment(filename) {
  // Common audio format IDs
  const audioFormatIds = [
    '140', '141', '139', '251', '250', '249', '258', '256', '327', '328',
  ];
  
  const formatId = getFormatId(filename);
  if (!formatId) return false;
  
  // Check known audio format IDs
  if (audioFormatIds.includes(formatId)) return true;
  
  // Check file extension
  return /\.(m4a|opus|ogg)$/i.test(filename);
}

export function autoMerge(specificFolder = null, callback = null) {
  try {
    if (specificFolder) {
      mergeInFolder(specificFolder, callback);
    } else {
      console.log('[Archived V] Starting auto merge of audio and video in all folders');
      const videosFolders = findVideosFolders(DOWNLOAD_DIR);
      
      // Also scan direct download folders
      const directFolders = findDirectDownloadFolders(DOWNLOAD_DIR);
      const allFolders = [...new Set([...videosFolders, ...directFolders])];
      
      for (const folder of allFolders) {
        mergeInFolder(folder);
      }
      console.log('[Archived V] Auto merge completed for all folders');
    }
  } catch (e) {
    console.error('[Archived V] Error during auto merge:', e.message);
    if (callback) callback();
  }
}

function findVideosFolders(root) {
  const folders = [];
  function walk(dir) {
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            if (item === 'videos') {
              const parent = path.dirname(fullPath);
              if (path.basename(parent) === 'channels') {
                folders.push(fullPath);
              }
            } else {
              walk(fullPath);
            }
          }
        } catch (e) {
          // ignore errors on individual items
        }
      }
    } catch (e) {
      // ignore errors on directories
    }
  }
  walk(root);
  return folders;
}

// Find download folders that contain fragment files directly
function findDirectDownloadFolders(root) {
  const folders = [];
  
  function walk(dir, depth = 0) {
    if (depth > 4) return; // Limit depth to prevent scanning too deep
    
    try {
      const items = fs.readdirSync(dir);
      
      // Check if this folder has fragment files
      const hasFragments = items.some(item => isFragmentFile(item));
      if (hasFragments) {
        folders.push(dir);
      }
      
      // Continue walking subdirectories
      for (const item of items) {
        const fullPath = path.join(dir, item);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            walk(fullPath, depth + 1);
          }
        } catch (e) {
          // ignore errors on individual items
        }
      }
    } catch (e) {
      // ignore errors on directories
    }
  }
  
  walk(root);
  return folders;
}

export function mergeInFolder(folder, callback = null) {
  try {
    const files = fs.readdirSync(folder);
    
    // Check if there's already a final merged file (non-fragment video)
    const hasFinalVideo = files.some(f => 
      /\.(mp4|mkv|webm)$/i.test(f) && !isFragmentFile(f)
    );
    
    if (hasFinalVideo) {
      console.log(`[Archived V] Skipping merge in folder ${folder} - already has final video`);
      if (callback) callback();
      return;
    }
    
    // Group fragment files by title
    const titleMap = new Map();
    
    for (const file of files) {
      if (!isFragmentFile(file)) continue;
      
      const title = getFragmentTitle(file);
      if (!title) continue;
      
      if (!titleMap.has(title)) {
        titleMap.set(title, { videos: [], audios: [] });
      }
      
      const entry = titleMap.get(title);
      
      if (isAudioFragment(file)) {
        entry.audios.push(file);
      } else if (isVideoFragment(file, files)) {
        entry.videos.push(file);
      }
    }
    
    // If no pairs found, exit
    if (titleMap.size === 0) {
      if (callback) callback();
      return;
    }
    
    console.log(`[Archived V] Starting auto merge of audio and video in folder: ${folder}`);
    
    // Find titles that have both video and audio
    const titleParts = Array.from(titleMap.entries()).filter(
      ([title, parts]) => parts.videos.length > 0 && parts.audios.length > 0
    );
    
    if (titleParts.length === 0) {
      if (callback) callback();
      return;
    }
    
    let completed = 0;
    
    for (const [title, parts] of titleParts) {
      // Use the best quality video and audio (first in list, as yt-dlp sorts by quality)
      const videoFile = parts.videos[0];
      const audioFile = parts.audios[0];
      
      // Determine output extension based on input video
      const videoExt = path.extname(videoFile).toLowerCase();
      const outputExt = videoExt === '.webm' ? '.mkv' : '.mp4'; // webm video + m4a audio -> mkv; mp4 + m4a -> mp4
      const output = `${title}${outputExt}`;
      const outputPath = path.join(folder, output);
      
      if (fs.existsSync(outputPath)) {
        console.log(`[Archived V] Merged file already exists for "${title}", skipping.`);
        completed++;
        if (completed === titleParts.length && callback) callback();
        continue;
      }
      
      console.log(`[Archived V] Merging video "${videoFile}" + audio "${audioFile}" -> "${output}"`);
      
      try {
        const proc = spawn('ffmpeg', [
          '-loglevel', 'error',  // Quiet mode - only show errors
          '-y',                   // Overwrite output without asking
          '-i', path.join(folder, videoFile),
          '-i', path.join(folder, audioFile),
          '-c', 'copy',
          outputPath
        ], { stdio: ['ignore', 'ignore', 'pipe'] }); // Only capture stderr for errors
        
        let stderrOutput = '';
        proc.stderr.on('data', (data) => {
          stderrOutput += data.toString();
        });
        
        proc.on('close', (code) => {
          if (code === 0) {
            console.log(`[Archived V] Successfully merged "${title}"`);

            // Delay cleanup to allow file handles to be released
            setTimeout(() => {
              cleanupFragmentFiles(folder, title, parts);
            }, 1000);
          } else {
            console.error(`[Archived V] Failed to merge "${title}", ffmpeg exit code ${code}`);
            if (stderrOutput.trim()) {
              console.error(`[Archived V] ffmpeg error: ${stderrOutput.trim()}`);
            }

            // Delete corrupt/empty fragment files so yt-dlp can re-download them fresh.
            // With --no-part, yt-dlp treats existing files as "already downloaded" and skips them,
            // so corrupt fragments block recovery permanently unless removed.
            const corruptThreshold = 1024; // 1KB - fragments below this are certainly corrupt
            const allFrags = [...parts.videos, ...parts.audios];
            for (const frag of allFrags) {
              const fragPath = path.join(folder, frag);
              try {
                const stat = fs.statSync(fragPath);
                if (stat.size < corruptThreshold) {
                  fs.unlinkSync(fragPath);
                  console.log(`[Archived V] Deleted corrupt fragment "${frag}" (${stat.size} bytes) to allow re-download`);
                  // Also remove associated .ytdl metadata file
                  try { fs.unlinkSync(fragPath + '.ytdl'); } catch {}
                }
              } catch {}
            }
          }
          
          completed++;
          if (completed === titleParts.length && callback) {
            console.log(`[Archived V] Auto merge completed for folder: ${folder}`);
            callback();
          }
        });
      } catch (e) {
        console.error(`[Archived V] Error starting ffmpeg for "${title}": ${e.message}`);
        completed++;
        if (completed === titleParts.length && callback) callback();
      }
    }
  } catch (e) {
    console.error(`[Archived V] Error merging in folder ${folder}: ${e.message}`);
    if (callback) callback();
  }
}

export default {
  autoMerge,
  mergeInFolder,
};
