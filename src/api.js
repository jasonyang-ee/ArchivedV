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
};
