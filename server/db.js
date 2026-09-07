const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');

// VOLPAIA_DATA_DIR permite apuntar la base de datos a una carpeta persistente
// fuera del checkout del repo (algunos hostings, Hostinger incluido, vuelven
// a clonar el código en cada deploy, así que cualquier dato guardado dentro
// de esa carpeta se pierde salvo que viva en otro lado). Sin esa variable,
// usa la carpeta local de siempre (útil para desarrollo).
const DATA_DIR = process.env.VOLPAIA_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'volpaia.sqlite');

// sql.js is a pure JavaScript/WebAssembly build of SQLite: it needs no native
// compilation step, unlike better-sqlite3 (which requires node-gyp + a
// matching glibc/Python toolchain that many shared hosts, like Hostinger's
// shared Node hosting, do not provide). Because it keeps the database
// entirely in memory, every write is followed by exporting the whole file
// back to disk — perfectly fine at this app's scale (a small wholesale
// business), and it keeps the exact same synchronous prepare/run/get/all
// API surface the rest of the codebase already relies on.
async function createDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const SQL = await initSqlJs();
  const fileBuffer = fs.existsSync(DB_FILE) ? fs.readFileSync(DB_FILE) : undefined;
  const raw = new SQL.Database(fileBuffer);

  let inTransaction = false;
  function persist() {
    if (inTransaction) return;
    fs.writeFileSync(DB_FILE, Buffer.from(raw.export()));
  }

  const db = {
    exec(sql) {
      raw.exec(sql);
      persist();
    },
    pragma(str) {
      raw.run('PRAGMA ' + str);
    },
    prepare(sql) {
      return {
        run(...params) {
          raw.run(sql, params);
          const changes = raw.getRowsModified();
          let lastInsertRowid;
          const res = raw.exec('SELECT last_insert_rowid() AS id');
          if (res[0]) lastInsertRowid = res[0].values[0][0];
          persist();
          return { changes, lastInsertRowid };
        },
        get(...params) {
          const stmt = raw.prepare(sql);
          stmt.bind(params);
          let row;
          if (stmt.step()) row = stmt.getAsObject();
          stmt.free();
          return row;
        },
        all(...params) {
          const stmt = raw.prepare(sql);
          stmt.bind(params);
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          stmt.free();
          return rows;
        },
      };
    },
    transaction(fn) {
      return (...args) => {
        inTransaction = true;
        raw.run('BEGIN');
        try {
          const result = fn(...args);
          raw.run('COMMIT');
          inTransaction = false;
          persist();
          return result;
        } catch (err) {
          raw.run('ROLLBACK');
          inTransaction = false;
          throw err;
        }
      };
    },
  };

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
  commission_percentage REAL NOT NULL DEFAULT 5,
  damian_phone TEXT
);
INSERT OR IGNORE INTO settings (id, reminder_days_1, reminder_days_2, commission_percentage) VALUES (1, 4, 15, 5);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT,
  last_name TEXT,
  business_name TEXT,
  locality TEXT,
  province TEXT,
  phone TEXT,
  notes TEXT,
  website TEXT,
  facebook TEXT,
  instagram TEXT,
  tiktok TEXT,
  first_contact_date TEXT DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'Activo',
  source TEXT,
  catalog_sent_history TEXT DEFAULT '',
  pricelist_sent_history TEXT DEFAULT '',
  converted_client_id INTEGER REFERENCES clients(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contact_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by INTEGER,
  changed_at TEXT DEFAULT (datetime('now'))
);

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

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_number INTEGER UNIQUE NOT NULL,
  contact_id INTEGER REFERENCES contacts(id),
  client_id INTEGER REFERENCES clients(id),
  status TEXT NOT NULL DEFAULT 'Pendiente',
  first_name TEXT,
  last_name TEXT,
  business_name TEXT,
  fiscal_name TEXT,
  fiscal_id TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  locality TEXT,
  postal_code TEXT,
  province TEXT,
  shipping_type TEXT,
  shipping_carrier TEXT,
  shipping_address TEXT,
  notes TEXT,
  pdf_path TEXT,
  converted_client_id INTEGER REFERENCES clients(id),
  converted_order_id INTEGER REFERENCES orders(id),
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO counters (name, value) VALUES ('quote_number', 0);

CREATE TABLE IF NOT EXISTS quote_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL,
  presentation TEXT NOT NULL,
  unit_price REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  recipient_id INTEGER REFERENCES users(id),
  body TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
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
  ensureColumn('settings', 'damian_phone', 'TEXT');

  // Columnas del flujo de pedidos de 9 pasos (reemplaza el flujo anterior de 11)
  ensureColumn('orders', 'cancelled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'finalized', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'modified', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'order_pdf_path', 'TEXT');
  ensureColumn('orders', 'preparation_pdf_path', 'TEXT');
  ensureColumn('orders', 'invoice_attachment_url', 'TEXT');
  ensureColumn('orders', 'transfer_attachment_url', 'TEXT');
  ensureColumn('orders', 'payment_attachment_url', 'TEXT');
  ensureColumn('commissions', 'paid', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('commissions', 'paid_at', 'TEXT');
  // Método de envío del pedido: se completa con el del cliente al crear el
  // pedido, pero se puede corregir puntualmente para ese pedido en particular.
  ensureColumn('orders', 'shipping_type', 'TEXT');
  ensureColumn('orders', 'shipping_carrier', 'TEXT');
  // Claves VAPID para notificaciones push: se generan una sola vez (ver
  // server/lib/push.js) y quedan guardadas para no invalidar las
  // suscripciones ya hechas por los navegadores en cada reinicio.
  ensureColumn('settings', 'vapid_public_key', 'TEXT');
  ensureColumn('settings', 'vapid_private_key', 'TEXT');

  // Flujo nuevo: todo pedido nace de un Presupuesto ya confirmado (ver
  // server/routes/quotes.js), así que llega directo a "Pedido confirmado"
  // con un link al presupuesto de origen (para reusar su PDF con precios).
  // El CBU reemplaza al viejo adjunto de "datos de transferencia".
  ensureColumn('orders', 'quote_id', 'INTEGER');
  ensureColumn('orders', 'cbu', 'TEXT');
  // Cualquier pedido que haya quedado del flujo viejo de 11 pasos (todos de
  // prueba) se lleva al principio del flujo nuevo para no dejarlo en un
  // índice de estado que ya no existe.
  db.prepare('UPDATE orders SET status_index = 0 WHERE status_index > 8').run();

  // Registro de cuándo se hizo cada contacto de posventa (para poder
  // mostrarlo en la pantalla de Posventa) y de cuándo se marcó que el
  // cliente quiere reponer.
  ensureColumn('orders', 'reminder_1_done_at', 'TEXT');
  ensureColumn('orders', 'reminder_2_done_at', 'TEXT');
  ensureColumn('orders', 'reponer_clicked_at', 'TEXT');
  // Mensajes de WhatsApp precargados para los botones de Posventa,
  // editables desde Configuración. {nombre} se reemplaza por el nombre del
  // cliente al armar el link de WhatsApp.
  ensureColumn('settings', 'posventa_msg_1', 'TEXT');
  ensureColumn('settings', 'posventa_msg_2', 'TEXT');
  db.prepare(`
    UPDATE settings SET
      posventa_msg_1 = COALESCE(posventa_msg_1, ?),
      posventa_msg_2 = COALESCE(posventa_msg_2, ?)
    WHERE id = 1
  `).run(
    '¡Hola {nombre}! Te escribimos de Volpaia para saber si te llegó bien tu pedido 😊',
    '¡Hola {nombre}! ¿Te gustaría hacer un nuevo pedido? Contanos qué te gustaría llevar esta vez.'
  );

  // Damián numera a cada cliente en su propio sistema al facturar — este
  // número tiene que coincidir con el nuestro para no confundirnos.
  ensureColumn('clients', 'damian_client_number', 'TEXT');

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

  return db;
}

module.exports = createDb;
