// SQLite storage (Node's built-in node:sqlite, no extra packages). One file: data/nero.db
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const CFG = require("./config");

const DB_FILE = process.env.NERO_DB || path.join(__dirname, "data", "nero.db");
const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS menu_categories (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL REFERENCES menu_categories(key),
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  note TEXT NOT NULL DEFAULT '',
  veg INTEGER,                         -- 1 veg, 0 non-veg, NULL not marked
  available INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reservations (
  ref TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  date TEXT NOT NULL,                  -- YYYY-MM-DD
  time TEXT NOT NULL,                  -- HH:MM
  guests INTEGER NOT NULL,
  occasion TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confirmed',  -- confirmed, seated, completed, no_show, cancelled
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_res_date ON reservations(date, time);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  pickup_date TEXT NOT NULL,
  pickup_time TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',  -- new, preparing, ready, collected, cancelled
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INTEGER,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, pickup_date, pickup_time);
`);

function tx(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function getSetting(key, fallback) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : String(fallback);
}
function setSetting(key, value) {
  db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    String(value)
  );
}

// ---- First run: load the menu and any bookings from the old flat-file store ----
function seed() {
  const hasMenu = db.prepare("SELECT COUNT(*) AS n FROM menu_categories").get().n > 0;
  if (!hasMenu) {
    const MENU = require("./data/menu");
    const insCat = db.prepare("INSERT INTO menu_categories(key, label, sort) VALUES(?, ?, ?)");
    const insItem = db.prepare(
      "INSERT INTO menu_items(category, name, price, note, veg, available, sort) VALUES(?, ?, ?, ?, ?, 1, ?)"
    );
    tx(() => {
      Object.keys(MENU).forEach((key, ci) => {
        insCat.run(key, MENU[key].label, ci);
        MENU[key].items.forEach((it, ii) => {
          insItem.run(key, it.name, it.price, it.note || "", typeof it.veg === "boolean" ? (it.veg ? 1 : 0) : null, ii);
        });
      });
    });
  }

  const legacy = path.join(__dirname, "data", "reservations.json");
  const resCount = db.prepare("SELECT COUNT(*) AS n FROM reservations").get().n;
  if (resCount === 0 && fs.existsSync(legacy)) {
    let rows = [];
    try {
      rows = JSON.parse(fs.readFileSync(legacy, "utf8"));
    } catch {}
    const ins = db.prepare(
      `INSERT OR IGNORE INTO reservations(ref, name, phone, date, time, guests, occasion, note, status, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`
    );
    tx(() =>
      rows.forEach((r) =>
        ins.run(r.ref, r.name, r.phone, r.date, r.time, Number(r.guests), r.occasion || "", r.note || "", r.createdAt || new Date().toISOString())
      )
    );
  }

  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'seats'").get()) setSetting("seats", CFG.DEFAULT_SEATS);
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'dwell_min'").get()) setSetting("dwell_min", CFG.DEFAULT_DWELL_MIN);
}
seed();

module.exports = { db, tx, getSetting, setSetting };
