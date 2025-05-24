const fs = require("fs");
const path = require("path");

// persist state under a bind-mounted data folder in the app directory
const dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "db.json");
// initial in-memory store
let store = { channels: [], keywords: [], history: [] };
// create initial db.json if not exists
if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, JSON.stringify(store, null, 2));
}

const db = {
  data: store,
  async read() {
    if (!fs.existsSync(dbPath)) {
      store = { channels: [], keywords: [], history: [] };
      fs.writeFileSync(dbPath, JSON.stringify(store, null, 2));
    } else {
      try {
        const file = fs.readFileSync(dbPath, "utf-8");
        store = JSON.parse(file);
        // ensure history exists
        if (!store.history) store.history = [];
      } catch {
        store = { channels: [], keywords: [], history: [] };
        fs.writeFileSync(dbPath, JSON.stringify(store, null, 2));
      }
    }
    this.data = store;
  },
  async write() {
    // persist channels, keywords, and history
    fs.writeFileSync(dbPath, JSON.stringify(this.data, null, 2));
  },
};

module.exports = { db };
