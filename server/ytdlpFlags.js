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

  const forbidden = ["--exec", "--exec-before-download", "--config-locations", "--batch-file", "--alias"];
  for (const arg of args) {
    const option = arg.split("=", 1)[0].toLowerCase();
    const blocked = option.startsWith("--") && option.length > 2 &&
      forbidden.some((flag) => flag.startsWith(option));
    // -a is the batch-file alias, including bundled short options/attached values.
    if (blocked || /^-[^-]*a/.test(arg)) {
      throw new Error(`Flag "${option}" is not allowed for security reasons`);
    }
  }
  return args;
}
