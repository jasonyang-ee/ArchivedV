// Parse once for both API validation and subprocess arguments. Validating the
// raw string alone misses concatenated quotes and yt-dlp option abbreviations.
export function parseYtDlpFlags(flags) {
  if (typeof flags !== "string") throw new Error("ytdlpFlags must be a string");
  if (flags.includes("\0")) throw new Error("ytdlpFlags must not contain null bytes");

  const args = [];
  let current = "";
  let quote = null;
  let started = false;
  for (const char of flags) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) throw new Error("Unterminated quote in ytdlpFlags");
  if (started) args.push(current);

  // Arbitrary yt-dlp options can launch executables, read secrets or write outside
  // the archive. Only options whose effects remain inside the managed job belong here.
  const switches = new Set([
    "--write-description", "--no-write-description", "--write-info-json", "--no-write-info-json",
    "--write-subs", "--no-write-subs", "--write-auto-subs", "--no-write-auto-subs",
    "--embed-subs", "--no-embed-subs", "--embed-chapters", "--no-embed-chapters",
    "--embed-metadata", "--no-embed-metadata", "--add-metadata", "--no-add-metadata",
    "--force-ipv4", "--force-ipv6", "-4", "-6",
  ]);
  const values = new Set([
    "--format", "-f", "--format-sort", "-S", "--limit-rate", "-r", "--throttled-rate",
    "--retries", "-R", "--fragment-retries", "--file-access-retries", "--socket-timeout",
    "--concurrent-fragments", "-N", "--sleep-interval", "--max-sleep-interval",
    "--sub-langs", "--sub-format",
  ]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const equals = arg.indexOf("=");
    const option = equals === -1 ? arg : arg.slice(0, equals);
    if (switches.has(option) && equals === -1) continue;
    if (!values.has(option)) throw new Error(`Flag "${option}" is not allowed; use supported download, format or subtitle options`);
    const value = equals === -1 ? args[++index] : arg.slice(equals + 1);
    if (!value || value.startsWith("-")) throw new Error(`Flag "${option}" requires a value`);
  }
  return args;
}
