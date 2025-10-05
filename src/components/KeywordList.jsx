import React, { useState } from "react";

function KeywordList({ keywords, onAddKeyword, onDeleteKeyword }) {
  const [keywordInput, setKeywordInput] = useState("");

  const handleAdd = async () => {
    if (!keywordInput.trim()) return;
    await onAddKeyword(keywordInput);
    setKeywordInput("");
  };

  return (
    <div className="card">
      <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
        Keywords
      </h2>

      {/* Keyword List */}
      <div className="space-y-1.5 mb-4 max-h-[800px] overflow-y-auto">
        {keywords.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <p>No keywords added yet</p>
            <p className="text-sm mt-2">Add keywords to filter streams</p>
          </div>
        ) : (
          keywords.map((keyword) => (
            <div
              key={keyword}
              className="flex items-center justify-between p-2 bg-gray-50 dark:bg-[#333333] rounded-lg border border-gray-200 dark:border-[#444444] hover:shadow-md transition-shadow"
            >
              <span className="text-sm text-gray-900 dark:text-gray-100 font-medium">
                {keyword}
              </span>
              <button
                onClick={() => onDeleteKeyword(keyword)}
                className="p-1.5 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                title="Delete keyword"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
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
          placeholder="Enter Keyword"
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

export default KeywordList;
