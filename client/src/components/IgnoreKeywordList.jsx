import React, { useState } from "react";

function IgnoreKeywordList({ keywords, onAddKeyword, onDeleteKeyword }) {
  const [keywordInput, setKeywordInput] = useState("");

  const handleAdd = () => {
    if (keywordInput.trim()) {
      onAddKeyword(keywordInput.trim());
      setKeywordInput("");
    }
  };

  // Sort keywords alphabetically (case-insensitive)
  const sortedKeywords = [...keywords].sort((a, b) => 
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  return (
    <div className="card">
      <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">
        Ignore Keywords
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Videos matching any of these keywords will be excluded from downloads
      </p>

      {/* Keyword List */}
      <div className="space-y-1.5 mb-4 max-h-[400px] overflow-y-auto">
        {sortedKeywords.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <p className="text-sm">No ignore keywords set</p>
          </div>
        ) : (
          sortedKeywords.map((keyword) => (
            <div
              key={keyword}
              className="flex items-start gap-2 p-2 bg-gray-50 dark:bg-[#333333] rounded-lg border border-gray-200 dark:border-[#444444] hover:shadow-md transition-shadow"
            >
              <span className="text-sm text-gray-900 dark:text-gray-100 flex-1 break-words">{keyword}</span>
              <button
                onClick={() => onDeleteKeyword(keyword)}
                className="p-1 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors flex-shrink-0"
                title="Delete keyword"
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
          ))
        )}
      </div>

      {/* Add Keyword Form */}
      <div className="flex gap-2">
        <input
          type="text"
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onKeyPress={(e) => e.key === "Enter" && handleAdd()}
          placeholder="Enter ignore keyword"
          className="input flex-1"
        />
        <button
          onClick={handleAdd}
          disabled={!keywordInput.trim()}
          className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export default IgnoreKeywordList;
