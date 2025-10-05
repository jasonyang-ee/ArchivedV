import React, { useState } from "react";

function ChannelList({ channels, onAddChannel, onDeleteChannel }) {
  const [channelInput, setChannelInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState("");

  const handleAdd = async () => {
    if (!channelInput.trim()) return;
    
    setIsAdding(true);
    setError("");
    
    try {
      await onAddChannel(channelInput);
      setChannelInput("");
    } catch (err) {
      setError(err.message || "Failed to add channel");
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="card">
      <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
        Channels
      </h2>

      {/* Channel List */}
      <div className="space-y-1.5 mb-4 max-h-[1000px] overflow-y-auto">
        {channels.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <p>No channels added yet</p>
            <p className="text-sm mt-2">Add your first YouTube channel below</p>
          </div>
        ) : (
          channels.map((channel) => (
            <div
              key={channel.id}
              className="p-2 bg-gray-50 dark:bg-[#333333] rounded-lg border border-gray-200 dark:border-[#444444] hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {channel.channelName || channel.username}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      @{channel.username}
                    </p>
                    <a
                      href={`https://www.youtube.com/@${channel.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      View →
                    </a>
                  </div>
                </div>
                <button
                  onClick={() => onDeleteChannel(channel.id)}
                  className="ml-2 p-1 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                  title="Delete channel"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Channel Form */}
      <div className="space-y-2">
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={channelInput}
            onChange={(e) => setChannelInput(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleAdd()}
            placeholder="@username or YouTube URL"
            className="input flex-1"
            disabled={isAdding}
          />
          <button
            onClick={handleAdd}
            disabled={isAdding || !channelInput.trim()}
            className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAdding ? "Adding..." : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChannelList;
