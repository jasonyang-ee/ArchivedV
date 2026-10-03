const API_BASE = "/api";

// One response contract for every caller, including failed mutations and proxy errors.
export async function request(path, method = "GET", body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  let data;
  try { data = await res.json(); } catch {
    throw new Error(`Server returned an invalid response (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}

export const api = {
  getConfig: () => request("/config"),
  addChannel: (link) => request("/channels", "POST", { link }),
  deleteChannel: (id) => request(`/channels/${encodeURIComponent(id)}`, "DELETE"),
  addKeyword: (keyword) => request("/keywords", "POST", { keyword }),
  deleteKeyword: (keyword) => request(`/keywords/${encodeURIComponent(keyword)}`, "DELETE"),
  addIgnoreKeyword: (keyword) => request("/ignore-keywords", "POST", { keyword }),
  deleteIgnoreKeyword: (keyword) => request(`/ignore-keywords/${encodeURIComponent(keyword)}`, "DELETE"),
  updateDateFormat: (dateFormat) => request("/date-format", "POST", { dateFormat }),
  getStatus: () => request("/status"),
  refresh: () => request("/refresh", "POST"),
  cancelDownload: (id) => request(`/downloads/${encodeURIComponent(id)}`, "DELETE"),
  removeScheduledStream: (id) => request(`/scheduled-streams/${encodeURIComponent(id)}`, "DELETE"),
  getHistory: () => request("/history"),
  clearHistory: () => request("/history", "DELETE"),
  getAuthStatus: () => request("/auth"),
  setUseCookies: (useCookies) => request("/auth", "POST", { useCookies }),
  uploadCookies: (cookiesText) => request("/auth/cookies", "PUT", { cookiesText }),
  clearCookies: () => request("/auth/cookies", "DELETE"),
  getYtdlpFlags: () => request("/ytdlp-flags"),
  setYtdlpFlags: (ytdlpFlags) => request("/ytdlp-flags", "POST", { ytdlpFlags }),
};

export default api;
