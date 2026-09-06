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

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  reminder_days_1 INTEGER NOT NULL DEFAULT 4,
  reminder_days_2 INTEGER NOT NULL DEFAULT 15,
  commission_percentage REAL NOT NULL DEFAULT 5
);
INSERT OR IGNORE INTO settings (id, reminder_days_1, reminder_days_2, commission_percentage) VALUES (1, 4, 15, 5);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number INTEGER UNIQUE NOT NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  status_index INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  amount_invoice REAL,
  amount_payment REAL,
  shipping_date TEXT,
  tracking_number TEXT,
  shipping_proof_photo TEXT,
  reminder_days_1 INTEGER,
  reminder_days_2 INTEGER,
  reminder_1_done INTEGER DEFAULT 0,
  reminder_2_done INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO counters (name, value) VALUES ('order_number', 0);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL,
  presentation TEXT NOT NULL,
  unit_price REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status INTEGER,
  to_status INTEGER NOT NULL,
  changed_by INTEGER,
  is_correction INTEGER DEFAULT 0,
  attachment_url TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  base_amount REAL NOT NULL,
  percentage REAL NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  type TEXT NOT NULL,
  order_id INTEGER,
  message TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// ---------- Migrations for columns added after the initial release ----------
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('users', 'role', "TEXT NOT NULL DEFAULT 'staff'");

// Seed default user (Melany, owner role) if none exists
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const defaultPassword = process.env.VOLPAIA_ADMIN_PASSWORD || 'volpaia2026';
  const hash = bcrypt.hashSync(defaultPassword, 10);
  db.prepare('INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)')
    .run('admin', hash, 'Melany', 'owner');
  console.log(`[seed] Usuario admin creado. Contraseña inicial: ${defaultPassword}`);
} else {
  db.prepare("UPDATE users SET role = 'owner' WHERE username = 'admin' AND role != 'owner'").run();
}

// Seed second user (Darío) if not present yet
const dario = db.prepare('SELECT id FROM users WHERE username = ?').get('dario');
if (!dario) {
  const defaultPassword = process.env.VOLPAIA_DARIO_PASSWORD || 'volpaia2026';
  const hash = bcrypt.hashSync(defaultPassword, 10);
  db.prepare('INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)')
    .run('dario', hash, 'Darío', 'staff');
  console.log(`[seed] Usuario dario creado. Contraseña inicial: ${defaultPassword}`);
}

module.exports = db;
