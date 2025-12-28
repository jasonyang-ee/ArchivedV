const API_BASE = import.meta.env.PROD ? "/api" : "http://localhost:3000/api";

export const api = {
  // Config
  async getConfig() {
    const res = await fetch(`${API_BASE}/config`);
    return res.json();
  },

  // Channels
  async addChannel(link) {
    const res = await fetch(`${API_BASE}/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link }),
    });
    return res.json();
  },

  async deleteChannel(id) {
    const res = await fetch(`${API_BASE}/channels/${id}`, {
      method: "DELETE",
    });
    return res.json();
  },

  // Keywords
  async addKeyword(keyword) {
    const res = await fetch(`${API_BASE}/keywords`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword }),
    });
    return res.json();
  },

  async deleteKeyword(keyword) {
    const res = await fetch(`${API_BASE}/keywords/${encodeURIComponent(keyword)}`, {
      method: "DELETE",
    });
    return res.json();
  },

  // Ignore Keywords
  async addIgnoreKeyword(keyword) {
    const res = await fetch(`${API_BASE}/ignore-keywords`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword }),
    });
    return res.json();
  },

  async deleteIgnoreKeyword(keyword) {
    const res = await fetch(`${API_BASE}/ignore-keywords/${encodeURIComponent(keyword)}`, {
      method: "DELETE",
    });
    return res.json();
  },

  // Date Format
  async updateDateFormat(dateFormat) {
    const res = await fetch(`${API_BASE}/date-format`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dateFormat }),
    });
    return res.json();
  },

  // Status
  async getStatus() {
    const res = await fetch(`${API_BASE}/status`);
    return res.json();
  },

  async refresh() {
    const res = await fetch(`${API_BASE}/refresh`, {
      method: "POST",
    });
    return res.json();
  },

  // Downloads
  async cancelDownload(downloadId) {
    const res = await fetch(`${API_BASE}/downloads/${encodeURIComponent(downloadId)}`, {
      method: "DELETE",
    });
    return res.json();
  },

  // History
  async getHistory() {
    const res = await fetch(`${API_BASE}/history`);
    return res.json();
  },

  async clearHistory() {
    const res = await fetch(`${API_BASE}/history`, {
      method: "DELETE",
    });
    return res.json();
  },

  // Auth / Cookies (members-only videos)
  async getAuthStatus() {
    const res = await fetch(`${API_BASE}/auth`);
    return res.json();
  },

  async setUseCookies(useCookies) {
    const res = await fetch(`${API_BASE}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ useCookies }),
    });
    return res.json();
  },

  async uploadCookies(cookiesText) {
    const res = await fetch(`${API_BASE}/auth/cookies`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookiesText }),
    });
    return res.json();
  },

  async clearCookies() {
    const res = await fetch(`${API_BASE}/auth/cookies`, {
      method: "DELETE",
    });
    return res.json();
  },
};

export default api;