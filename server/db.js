const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'volpaia.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_number INTEGER UNIQUE NOT NULL,
  first_name TEXT,
  last_name TEXT,
  business_name TEXT,
  email TEXT,
  phone TEXT,
  fiscal_name TEXT,
  fiscal_id TEXT,
  address TEXT,
  locality TEXT,
  postal_code TEXT,
  province TEXT,
  shipping_type TEXT,
  shipping_carrier TEXT,
  shipping_address TEXT,
  website TEXT,
  facebook TEXT,
  instagram TEXT,
  tiktok TEXT,
  notes TEXT,
  favorite INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO counters (name, value) VALUES ('client_number', 0);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  description TEXT,
  category TEXT,
  size TEXT,
  size_curve TEXT,
  colors TEXT,
  sale_dozen INTEGER DEFAULT 0,
  sale_pack3 INTEGER DEFAULT 0,
  sale_unit INTEGER DEFAULT 0,
  price_dozen REAL,
  price_pack3 REAL,
  price_unit REAL,
  stock_immediate INTEGER DEFAULT 0,
  stock_order INTEGER DEFAULT 0,
  price_history TEXT DEFAULT '',
  photo1 TEXT,
  photo2 TEXT,
  photo3 TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`);

// Seed default user if none exists
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const defaultPassword = process.env.VOLPAIA_ADMIN_PASSWORD || 'volpaia2026';
  const hash = bcrypt.hashSync(defaultPassword, 10);
  db.prepare('INSERT INTO users (username, password_hash, name) VALUES (?, ?, ?)')
    .run('admin', hash, 'Melany');
  console.log(`[seed] Usuario admin creado. Contraseña inicial: ${defaultPassword}`);
}

module.exports = db;
