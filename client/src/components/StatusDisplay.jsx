import React from "react";
import { formatDate } from "../utils/utils";

function StatusDisplay({ status, onRefresh, onCancelDownload }) {
  const currentDownloads = status.currentDownloads || [];
  const isDownloading = currentDownloads.length > 0;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Status
        </h2>
        <button
          onClick={onRefresh}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Refresh Now
        </button>
      </div>

      {/* Info Banner */}
      <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <div className="flex items-start gap-2">
          <svg
            className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="text-xs text-blue-700 dark:text-blue-300">
            <p className="font-medium mb-1">Automatic checking every 10 minutes</p>
            <p>Videos are downloaded to the download folder organized by channel.</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Last Run */}
        <div className="grid grid-cols-[140px_1fr] gap-4 items-start p-3 bg-gray-50 dark:bg-[#333333] rounded-lg">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Last Run:
          </span>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {status.lastRun ? formatDate(status.lastRun) : "Never"}
          </span>
        </div>

        {/* Last Completed */}
        <div className="grid grid-cols-[140px_1fr] gap-4 items-start p-3 bg-gray-50 dark:bg-[#333333] rounded-lg">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Last Completed:
          </span>
          <span className="text-sm text-gray-600 dark:text-gray-400 wrap-break-word">
            {status.lastCompleted || "None"}
          </span>
        </div>

        {/* Currently Downloading */}
        <div className="p-3 bg-gray-50 dark:bg-[#333333] rounded-lg">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Currently Downloading:
            {isDownloading && (
              <span className="text-xs text-amber-600 dark:text-amber-500 font-semibold ml-2">
                ({currentDownloads.length})
              </span>
            )}
          </div>
          {currentDownloads.length === 0 ? (
            <div className="text-sm text-gray-600 dark:text-gray-400">None</div>
          ) : (
            <div className="space-y-2">
              {currentDownloads.map((download) => (
                <div
                  key={download.id}
                  className="p-2 bg-white dark:bg-[#2a2a2a] rounded border border-gray-200 dark:border-[#444444] flex items-start gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 dark:text-gray-100 font-medium wrap-break-word">
                      {download.title}
					  <a
                        href={download.videoLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
                      >
                        View →
                      </a>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Channel: {download.channelName || download.username} • Started: {formatDate(download.startTime)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <svg
                      className="w-5 h-5 animate-spin text-amber-600 dark:text-amber-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    <button
                      onClick={() => {
                        if (window.confirm(`Cancel download: ${download.title}?`)) {
                          onCancelDownload(download.id);
                        }
                      }}
                      className="px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 rounded-lg transition-colors border border-red-200 dark:border-red-800"
                      title="Cancel download"
                    >
                      Abort Download
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default StatusDisplay;
