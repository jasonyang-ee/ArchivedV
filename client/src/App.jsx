import React, { useState, useEffect, useRef } from "react";
import { api } from "./utils/api.js";
import Header from "./components/Header";
import ChannelList from "./components/ChannelList";
import KeywordList from "./components/KeywordList";
import IgnoreKeywordList from "./components/IgnoreKeywordList";
// import CookieSettings from "./components/CookieSettings"; // TODO: Re-enable when cookie feature is complete
import YtdlpFlagsSettings from "./components/YtdlpFlagsSettings";
import StatusDisplay from "./components/StatusDisplay";
import DownloadHistory from "./components/DownloadHistory";

function App() {
  const [channels, setChannels] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [ignoreKeywords, setIgnoreKeywords] = useState([]);
  const [dateFormat, setDateFormat] = useState('YYYY-MM-DD');
  const [status, setStatus] = useState({
    lastRun: null,
    downloadedCount: 0,
    currentDownloads: [],
    lastCompleted: null,
  });
  const [history, setHistory] = useState([]);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const reads = useRef({ config: 0, status: 0, history: 0 });
  const [darkMode, setDarkMode] = useState(() => {
    // Initialize from localStorage or default to true
    try { return localStorage.getItem('darkMode') !== 'false'; } catch { return true; }
  });

  // Apply dark mode class to document
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    try { localStorage.setItem('darkMode', JSON.stringify(darkMode)); } catch { /* Storage may be unavailable. */ }
  }, [darkMode]);

  // Schedule the next poll after the previous one finishes to avoid overlap.
  useEffect(() => {
    let disposed = false;
    let timer;
    async function poll() {
      await Promise.all([loadStatus(), loadHistory()]);
      if (!disposed) timer = setTimeout(poll, 5000);
    }
    loadData().catch(() => {}).finally(() => { if (!disposed) setLoading(false); });
    poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);

  function reportError(key, message) {
    setErrors((previous) => ({ ...previous, [key]: message }));
  }

  async function loadData() {
    const revision = ++reads.current.config;
    try {
      const config = await api.getConfig();
      if (revision !== reads.current.config) return;
      setChannels(config.channels || []);
      setKeywords(config.keywords || []);
      setIgnoreKeywords(config.ignoreKeywords || []);
      setDateFormat(config.dateFormat || 'YYYY-MM-DD');
      reportError("config", "");
    } catch (err) {
      if (revision !== reads.current.config) return;
      reportError("config", err.message);
      throw err;
    }
  }

  async function loadStatus() {
    const revision = ++reads.current.status;
    try {
      const statusData = await api.getStatus();
      if (revision !== reads.current.status) return;
      setStatus(statusData);
      reportError("status", "");
    } catch (err) {
      if (revision !== reads.current.status) return;
      reportError("status", err.message);
    }
  }

  async function loadHistory() {
    const revision = ++reads.current.history;
    try {
      const historyData = await api.getHistory();
      if (revision !== reads.current.history) return;
      setHistory(historyData || []);
      reportError("history", "");
    } catch (err) {
      if (revision !== reads.current.history) return;
      reportError("history", err.message);
    }
  }

  async function changeConfig(action) {
    await action();
    await loadData();
  }
  const handleAddChannel = (link) => changeConfig(() => api.addChannel(link));
  const handleDeleteChannel = (id) => changeConfig(() => api.deleteChannel(id));
  const handleAddKeyword = (keyword) => changeConfig(() => api.addKeyword(keyword));
  const handleDeleteKeyword = (keyword) => changeConfig(() => api.deleteKeyword(keyword));
  const handleAddIgnoreKeyword = (keyword) => changeConfig(() => api.addIgnoreKeyword(keyword));
  const handleDeleteIgnoreKeyword = (keyword) => changeConfig(() => api.deleteIgnoreKeyword(keyword));
  async function handleRefresh() {
    await api.refresh();
    await Promise.all([loadData(), loadStatus(), loadHistory()]);
  }
  async function handleDateFormatChange(newFormat) {
    await api.updateDateFormat(newFormat);
    await loadData();
  }
  async function handleCancelDownload(id) {
    await api.cancelDownload(id);
    await Promise.all([loadStatus(), loadData()]);
  }
  async function handleRemoveScheduledStream(id) {
    await api.removeScheduledStream(id);
    await Promise.all([loadStatus(), loadData()]);
  }
  async function handleClearHistory() {
    if (!window.confirm("Clear download history? Saved videos will be kept.")) return false;
    await api.clearHistory();
    await loadHistory();
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-[#1f1f1f]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <div className="text-xl text-gray-600 dark:text-gray-400">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-[#1f1f1f]">
      {/* Wide Header */}
      <Header
        darkMode={darkMode}
        toggleDarkMode={() => setDarkMode(!darkMode)}
        dateFormat={dateFormat}
        onDateFormatChange={handleDateFormatChange}
      />

      {/* Main Content with New Layout */}
      <main className="max-w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        {Object.entries(errors).filter(([, message]) => message).map(([key, message]) => (
          <div key={key} role="alert" className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200">
            Could not update {key}: {message}. Displayed data may be out of date. Use Refresh Now to retry.
          </div>
        ))}
        {/* Three Column Layout: Left Sidebar (Keywords) | Center (Status) | Right Sidebar (Channels) */}
        <div className="grid grid-cols-1 min-[1600px]:grid-cols-[380px_minmax(0,1fr)_480px] gap-4 sm:gap-6">

          {/* Center - Download Status and History (shown first on mobile) */}
          <div className="space-y-4 sm:space-y-6 min-w-0 order-first min-[1600px]:order-2">
            <StatusDisplay
              status={status}
              onRefresh={handleRefresh}
              onCancelDownload={handleCancelDownload}
              onRemoveScheduledStream={handleRemoveScheduledStream}
            />
            <DownloadHistory history={history} onClearHistory={handleClearHistory} />
          </div>

          {/* Left Sidebar - Keywords */}
          <div className="space-y-4 sm:space-y-6 order-2 min-[1600px]:order-1">
            <KeywordList
              keywords={keywords}
              onAddKeyword={handleAddKeyword}
              onDeleteKeyword={handleDeleteKeyword}
            />
            <IgnoreKeywordList
              keywords={ignoreKeywords}
              onAddKeyword={handleAddIgnoreKeyword}
              onDeleteKeyword={handleDeleteIgnoreKeyword}
            />
            {/* <CookieSettings /> */}{/* TODO: Re-enable when cookie feature is complete */}
            <YtdlpFlagsSettings />
          </div>

          {/* Right Sidebar - Channels */}
          <div className="space-y-4 sm:space-y-6 order-3">
            <ChannelList
              channels={channels}
              onAddChannel={handleAddChannel}
              onDeleteChannel={handleDeleteChannel}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
