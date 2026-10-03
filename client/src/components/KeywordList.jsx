import { useState } from "react";
import ActionButton from "./ActionButton";

export default function KeywordList({ keywords, onAddKeyword, onDeleteKeyword, ignored = false }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = ignored ? "Ignore keyword" : "Keyword";
  async function handleAdd(event) {
    event.preventDefault();
    if (busy || !input.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onAddKeyword(input.trim());
      setInput("");
    } catch (error) {
      setError(error.message || "Could not add keyword");
    } finally { setBusy(false); }
  }
  const sorted = [...keywords].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return (
    <section className="card">
      <h2 className="text-xl font-semibold mb-2">{ignored ? "Ignore Keywords" : "Keywords"}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        {ignored ? "Matching titles are excluded from downloads." : "Titles matching any keyword are downloaded. With no keywords, all videos match."}
      </p>
      <div className={`space-y-1.5 mb-4 overflow-y-auto ${ignored ? "max-h-100" : "max-h-200"}`}>
        {sorted.length === 0 ? <p className="text-center py-8 text-gray-500 dark:text-gray-400">{ignored ? "No ignore keywords set" : "No keywords set; all videos match"}</p> : sorted.map((keyword) => (
          <div key={keyword} className="flex items-start gap-2 p-2 bg-gray-50 dark:bg-[#333333] rounded-lg border border-gray-200 dark:border-[#444444]">
            <span className="text-sm flex-1 min-w-0 wrap-anywhere">{keyword}</span>
            <ActionButton onClick={() => onDeleteKeyword(keyword)} className="text-sm text-red-700 dark:text-red-300" aria-label={`Delete ${label.toLowerCase()}: ${keyword}`} pendingText="Deleting...">Delete</ActionButton>
          </div>
        ))}
      </div>
      <form onSubmit={handleAdd}>
        <label className="label" htmlFor={ignored ? "ignore-keyword" : "keyword"}>{label}</label>
        <div className="flex gap-2">
          <input id={ignored ? "ignore-keyword" : "keyword"} value={input} onChange={(event) => setInput(event.target.value)} disabled={busy} className="input flex-1 min-w-0" />
          <button type="submit" disabled={busy || !input.trim()} className="btn btn-primary">{busy ? "Adding..." : "Add"}</button>
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      </form>
    </section>
  );
}
