import React from "react";
import { formatDate } from "../utils/utils";

function DownloadHistory({ history, onClearHistory }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Download History
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

      <div className="space-y-1.5 max-h-125 overflow-y-auto">
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
          [...history].reverse().map((item, index) => {
            const channelLabel = item.channelName || (item.username ? `@${item.username}` : null);

            return (
              <div
                key={`${item.time}-${index}`}
                className="p-2 bg-gray-50 dark:bg-[#333333] rounded-lg border border-gray-200 dark:border-[#444444] hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 wrap-break-word">
                      {item.title}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-8 gap-y-1 text-xs">
                      <span className="text-gray-500 dark:text-gray-400">
                        {formatDate(item.time)}
                      </span>
                      {channelLabel &&
                        (item.channelUrl ? (
                          <a
                            href={item.channelUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary-400 hover:text-primary-500 dark:text-primary-300 dark:hover:text-primary-200 hover:underline underline-offset-2 transition-colors"
                          >
                            {channelLabel}
                          </a>
                        ) : (
                          <span className="font-medium text-primary-400 dark:text-primary-300">
                            {channelLabel}
                          </span>
                        ))}
                    </div>
                    {item.status === "skipped" && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                        Skipped: {item.reason || ""}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default DownloadHistory;
