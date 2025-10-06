import React, { useState, useEffect } from "react";
import { api } from "./api";
import Header from "./components/Header";
import ChannelList from "./components/ChannelList";
import KeywordList from "./components/KeywordList";
import IgnoreKeywordList from "./components/IgnoreKeywordList";
import StatusDisplay from "./components/StatusDisplay";
import DownloadHistory from "./components/DownloadHistory";

function App() {
  const [channels, setChannels] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [ignoreKeywords, setIgnoreKeywords] = useState([]);
  const [status, setStatus] = useState({
    lastRun: null,
    downloadedCount: 0,
    current: null,
    lastCompleted: null,
  });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(() => {
    // Initialize from localStorage or default to true
    const saved = localStorage.getItem('darkMode');
    return saved !== null ? JSON.parse(saved) : true;
  });

  // Apply dark mode class to document
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
  }, [darkMode]);

  // Load initial data
  useEffect(() => {
    loadData();
    loadHistory();
  }, []);

  // Poll status every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadStatus();
      loadHistory();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    try {
      const config = await api.getConfig();
      setChannels(config.channels || []);
      setKeywords(config.keywords || []);
      setIgnoreKeywords(config.ignoreKeywords || []);
      await loadStatus();
    } catch (err) {
      console.error("Failed to load config:", err);
    } finally {
      setLoading(false);
    }
  }

  async function loadStatus() {
    try {
      const statusData = await api.getStatus();
      setStatus(statusData);
    } catch (err) {
      console.error("Failed to load status:", err);
    }
  }

  async function loadHistory() {
    try {
      const historyData = await api.getHistory();
      setHistory(historyData || []);
    } catch (err) {
      console.error("Failed to load history:", err);
    }
  }

  async function handleAddChannel(link) {
    try {
      await api.addChannel(link);
      await loadData();
    } catch (err) {
      throw err;
    }
  }

  async function handleDeleteChannel(id) {
    try {
      await api.deleteChannel(id);
      await loadData();
    } catch (err) {
      console.error("Failed to delete channel:", err);
    }
  }

  async function handleAddKeyword(keyword) {
    try {
      await api.addKeyword(keyword);
      await loadData();
    } catch (err) {
      console.error("Failed to add keyword:", err);
    }
  }

  async function handleDeleteKeyword(keyword) {
    try {
      await api.deleteKeyword(keyword);
      await loadData();
    } catch (err) {
      console.error("Failed to delete keyword:", err);
    }
  }

  async function handleAddIgnoreKeyword(keyword) {
    try {
      await api.addIgnoreKeyword(keyword);
      await loadData();
    } catch (err) {
      console.error("Failed to add ignore keyword:", err);
    }
  }

  async function handleDeleteIgnoreKeyword(keyword) {
    try {
      await api.deleteIgnoreKeyword(keyword);
      await loadData();
    } catch (err) {
      console.error("Failed to delete ignore keyword:", err);
    }
  }

  async function handleRefresh() {
    try {
      const statusData = await api.refresh();
      setStatus(statusData);
    } catch (err) {
      console.error("Failed to refresh:", err);
    }
  }

  async function handleClearHistory() {
    if (!window.confirm("Are you sure you want to clear the download history?")) {
      return;
    }
    try {
      await api.clearHistory();
      await loadHistory();
    } catch (err) {
      console.error("Failed to clear history:", err);
    }
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
      <Header darkMode={darkMode} toggleDarkMode={() => setDarkMode(!darkMode)} />

      {/* Main Content with New Layout */}
      <main className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Three Column Layout: Left Sidebar (Keywords) | Center (Status) | Right Sidebar (Channels) */}
        <div className="grid grid-cols-1 min-[1420px]:grid-cols-[380px_minmax(600px,1fr)_480px] gap-6">
          
          {/* Left Sidebar - Keywords */}
          <div className="space-y-6">
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
          </div>

          {/* Center - Download Status and History */}
          <div className="space-y-6 min-w-0">
            <StatusDisplay status={status} onRefresh={handleRefresh} />
            <DownloadHistory history={history} onClearHistory={handleClearHistory} />
          </div>

          {/* Right Sidebar - Channels */}
          <div className="space-y-6">
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
