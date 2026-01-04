import { useEffect, useState } from "react";
import api from '../utils/api';

export default function CookieSettings() {
  const [status, setStatus] = useState(null);
  const [cookiesText, setCookiesText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const data = await api.getAuthStatus();
    setStatus(data);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e?.message || String(e)));
  }, []);

  async function handleToggleUseCookies() {
    if (!status) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.setUseCookies(!status.useCookies);
      if (res?.error) throw new Error(res.error);
      await refresh();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCookies() {
    setBusy(true);
    setError("");
    try {
      const res = await api.uploadCookies(cookiesText);
      if (res?.error) throw new Error(res.error);
      setCookiesText("");
      await refresh();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleClearCookies() {
    if (!window.confirm("Remove saved cookies.txt from the server?")) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.clearCookies();
      if (res?.error) throw new Error(res.error);
      await refresh();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Members-only Cookies
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            For members-only videos
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            yt-dlp needs cookies.txt
          </p>
        </div>
        <button
          onClick={handleToggleUseCookies}
          disabled={busy || !status}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Enable/disable using cookies for yt-dlp"
        >
          {status?.useCookies ? "Enabled" : "Disabled"}
        </button>
      </div>

      {status && (
        <div className="p-3 bg-gray-50 dark:bg-[#333333] rounded-lg border border-gray-200 dark:border-[#444444] mb-4 text-sm">
          <div className="text-gray-700 dark:text-gray-300">
            Cookies file: {status.cookiesFilePresent ? "Present" : "Not found"}
            {status.cookiesPathHint ? ` (${status.cookiesPathHint})` : ""}
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <textarea
          value={cookiesText}
          onChange={(e) => setCookiesText(e.target.value)}
          placeholder="Paste the full cookies.txt content here"
          rows={6}
          className="input w-full font-mono text-xs"
        />

        <div className="flex gap-2">
          <button
            onClick={handleSaveCookies}
            disabled={busy || !cookiesText.trim()}
            className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save Cookies
          </button>
          <button
            onClick={handleClearCookies}
            disabled={busy}
            className="btn btn-danger text-sm"
          >
            Clear Cookies
          </button>
        </div>

        <div className="text-xs text-gray-600 dark:text-gray-400">
          Cookies contain your account session. Only use this on a trusted machine.
        </div>
      </div>
    </div>
  );
}
