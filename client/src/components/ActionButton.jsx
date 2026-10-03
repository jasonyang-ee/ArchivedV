import { useRef, useState } from "react";

export default function ActionButton({ onClick, children, pendingText = "Saving...", successText = "", disabled, ...props }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  async function handleClick() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await onClick();
      if (result !== false) setSuccess(successText);
    } catch (error) {
      setError(error.message || "Request failed. Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex flex-col items-start gap-1 max-w-full">
      <button type="button" {...props} onClick={handleClick} disabled={disabled || busy} aria-busy={busy}>
        {busy ? pendingText : children}
      </button>
      {error && <span role="alert" className="text-sm text-red-700 dark:text-red-300 wrap-anywhere">{error}</span>}
      {success && <span role="status" className="text-sm text-green-700 dark:text-green-300">{success}</span>}
    </span>
  );
}
