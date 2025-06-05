const fs = require("fs");
const path = require("path");

// persist state under a bind-mounted data folder in the app directory
const dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "db.json");
// initial in-memory store
let store = { channels: [], keywords: [], history: [], currentDownload: null };
// create initial db.json if not exists
if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, JSON.stringify(store, null, 2));
}

const db = {
  data: store,
  async read() {
    if (!fs.existsSync(dbPath)) {
      store = { channels: [], keywords: [], history: [], currentDownload: null };
      fs.writeFileSync(dbPath, JSON.stringify(store, null, 2));
    } else {
      try {
        const file = fs.readFileSync(dbPath, "utf-8");
        store = JSON.parse(file);
        // ensure all required properties exist
        let updated = false;
        if (!Array.isArray(store.channels)) { store.channels = []; updated = true; }
        if (!Array.isArray(store.keywords)) { store.keywords = []; updated = true; }
        if (!Array.isArray(store.history))  { store.history  = []; updated = true; }
        if (!('currentDownload' in store))   { store.currentDownload = null; updated = true; }
        // remove any legacy or unused properties
        const allowed = ['channels','keywords','history','currentDownload'];
        Object.keys(store).forEach(key => {
          if (!allowed.includes(key)) {
            delete store[key];
            updated = true;
          }
        });
        if (updated) {
          fs.writeFileSync(dbPath, JSON.stringify(store, null, 2));
        }
      } catch {
        store = { channels: [], keywords: [], history: [], currentDownload: null };
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
