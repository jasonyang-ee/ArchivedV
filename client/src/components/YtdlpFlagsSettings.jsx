import { useEffect, useState } from "react";
import api from '../utils/api';

export default function YtdlpFlagsSettings() {
  const [flags, setFlags] = useState("");
  const [savedFlags, setSavedFlags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function refresh() {
    const data = await api.getYtdlpFlags();
    setFlags(data.ytdlpFlags || "");
    setSavedFlags(data.ytdlpFlags || "");
  }

  useEffect(() => {
    refresh().catch((e) => setError(e?.message || String(e)));
  }, []);

  async function handleSave() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.setYtdlpFlags(flags);
      if (res?.error) throw new Error(res.error);
      setSavedFlags(res.ytdlpFlags || "");
      setSuccess("Settings saved successfully!");
      setTimeout(() => setSuccess(""), 3000);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleClear() {
    setFlags("");
  }

  const hasChanges = flags !== savedFlags;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Custom yt-dlp Flags
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Additional flags to pass to yt-dlp for every download
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Use with caution as incorrect flags may cause download failures
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-300">
          {success}
        </div>
      )}

      <div className="space-y-3">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          <p className="mb-2">Enter any additional yt-dlp flags, separated by spaces</p>
          <p className="mb-2">Examples:</p>
          <ul className="list-disc list-inside ml-2 space-y-1">
            <li><code className="bg-gray-100 dark:bg-[#333333] px-1 rounded">--write-description</code> - Save video description</li>
            <li><code className="bg-gray-100 dark:bg-[#333333] px-1 rounded">--embed-subs</code> - Embed subtitles in video</li>
            <li><code className="bg-gray-100 dark:bg-[#333333] px-1 rounded">--limit-rate 2M</code> - Limit download speed to 2MB/s</li>
          </ul>
        </div>

        <textarea
          value={flags}
          onChange={(e) => setFlags(e.target.value)}
          placeholder="e.g., --write-description --embed-subs"
          rows={3}
          className="input w-full font-mono text-sm"
        />

        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={busy || !hasChanges}
            className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save Settings
          </button>
          <button
            onClick={handleClear}
            disabled={busy || !flags}
            className="btn btn-danger text-sm"
          >
            Clear
          </button>
        </div>

        {savedFlags && (
          <div className="p-3 bg-gray-50 dark:bg-[#333333] rounded-lg border border-gray-200 dark:border-[#444444] text-sm">
            <span className="text-gray-500 dark:text-gray-400">Current saved flags: </span>
            <code className="text-gray-700 dark:text-gray-300">{savedFlags}</code>
          </div>
        )}
      </div>
    </div>
  );
}
