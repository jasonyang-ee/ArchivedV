import React from "react";
import { formatDate } from "../utils";

function DownloadHistory({ history, onClearHistory }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Download History ({history.length})
        </h2>
        {history.length > 0 && (
          <button
            onClick={onClearHistory}
            className="btn btn-danger text-sm"
          >
            Clear History
          </button>
        )}
      </div>

      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {history.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <svg
              className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <p className="text-lg font-medium">No downloads yet</p>
            <p className="text-sm mt-2">Downloaded videos will appear here</p>
          </div>
        ) : (
          [...history].reverse().map((item, index) => (
            <div
              key={`${item.time}-${index}`}
              className="p-4 bg-gray-50 dark:bg-[#333333] rounded-lg border border-gray-200 dark:border-[#444444] hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1 break-words">
                    {item.title}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatDate(item.time)}
                  </p>
                </div>
                <svg
                  className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default DownloadHistory;
