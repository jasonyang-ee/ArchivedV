// Utility functions

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitter(ms) {
  const spread = Math.min(250, Math.max(50, Math.floor(ms * 0.1)));
  return ms + Math.floor((Math.random() - 0.5) * 2 * spread);
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

// Sanitize titles for filesystem
export function sanitize(str) {
  return str.replace(/[\/\\:*?"<>|]/g, "").trim();
}

// URL validation to prevent SSRF attacks
export function isValidYouTubeUrl(urlString) {
  try {
    const url = new URL(urlString);
    
    // Only allow HTTPS
    if (url.protocol !== 'https:') {
      return false;
    }
    
    // Only allow youtube.com and youtu.be domains
    const allowedDomains = ['youtube.com', 'www.youtube.com', 'youtu.be'];
    if (!allowedDomains.includes(url.hostname)) {
      return false;
    }
    
    // Prevent localhost and private IP ranges
    const hostname = url.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('127.')) {
      return false;
    }
    
    // Check for private IP ranges
    const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipMatch) {
      const [_, a, b, c, d] = ipMatch.map(Number);
      // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
      if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
        return false;
      }
    }
    
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
  return /\.(mp4|mkv|webm|avi|mov|flv|wmv)$/i.test(name) && !/\.f\d+\.(mp4|webm|mkv)$/i.test(name);
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
  sanitize,
  isValidYouTubeUrl,
  isLoopbackIp,
  isFinalVideoFile,
  isPartialDownloadFile,
  isAuxiliaryFile,
};
