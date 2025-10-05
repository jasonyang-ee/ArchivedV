import React from "react";
import { formatDate } from "../utils";

function StatusDisplay({ status, onRefresh }) {
  const isDownloading = !!status.current;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Status
        </h2>
        <button
          onClick={onRefresh}
          disabled={isDownloading}
          className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <svg
            className={`w-4 h-4 ${isDownloading ? "animate-spin" : ""}`}
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
          {isDownloading ? "Downloading..." : "Refresh Now"}
        </button>
      </div>

      <div className="space-y-4">
        {/* Last Run */}
        <div className="flex justify-between items-start p-3 bg-gray-50 dark:bg-[#333333] rounded-lg">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Last Run:
          </span>
          <span className="text-sm text-gray-600 dark:text-gray-400 text-right">
            {status.lastRun ? formatDate(status.lastRun) : "Never"}
          </span>
        </div>

        {/* Currently Downloading */}
        <div className="flex justify-between items-start p-3 bg-gray-50 dark:bg-[#333333] rounded-lg">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Currently Downloading:
          </span>
          <span className="text-sm text-gray-600 dark:text-gray-400 text-right max-w-xs truncate">
            {status.current || "None"}
          </span>
        </div>

        {/* Last Completed */}
        <div className="flex justify-between items-start p-3 bg-gray-50 dark:bg-[#333333] rounded-lg">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Last Completed:
          </span>
          <span className="text-sm text-gray-600 dark:text-gray-400 text-right max-w-xs truncate">
            {status.lastCompleted || "None"}
          </span>
        </div>

        {/* Total Downloaded */}
        <div className="flex justify-between items-start p-3 bg-primary-50 dark:bg-primary-900/20 rounded-lg border border-primary-200 dark:border-primary-800">
          <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
            Total Downloaded:
          </span>
          <span className="text-sm font-bold text-primary-600 dark:text-primary-400">
            {status.downloadedCount || 0} videos
          </span>
        </div>
      </div>

      {/* Info Banner */}
      <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <div className="flex items-start gap-2">
          <svg
            className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5"
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
    </div>
  );
}

export default StatusDisplay;
