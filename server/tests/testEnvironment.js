import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

// Initialize modules against disposable data, never the developer's database.
const originalCwd = process.cwd();
export const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "archivedv-test-"));
process.chdir(testRoot);
process.env.YTDLP_COOKIES_PATH = path.join(testRoot, "cookies.txt");

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(testRoot, { recursive: true, force: true });
});
