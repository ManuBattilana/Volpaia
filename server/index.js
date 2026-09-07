const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const createDb = require('./db');
const ordersRouterFactory = require('./routes/orders');
const notificationsRouterFactory = require('./routes/notifications');
const settingsRouterFactory = require('./routes/settings');
const usersRouterFactory = require('./routes/users');
const contactsRouterFactory = require('./routes/contacts');
const commissionsRouterFactory = require('./routes/commissions');
const dashboardRouterFactory = require('./routes/dashboard');
const messagesRouterFactory = require('./routes/messages');
const pushRouterFactory = require('./routes/push');
const quotesRouterFactory = require('./routes/quotes');
const searchRouterFactory = require('./routes/search');
const { checkReminders } = require('./lib/reminders');
const { ensureVapidKeys } = require('./lib/push');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'volpaia-dev-secret-change-me';

// VOLPAIA_UPLOAD_DIR: mismo motivo que VOLPAIA_DATA_DIR en server/db.js —
// permite guardar las fotos fuera del checkout del repo, en una carpeta que
// sobreviva a los redeploys.
const UPLOAD_DIR = process.env.VOLPAIA_UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

async function start() {
  const db = await createDb();
  ensureVapidKeys(db);
  const app = express();

  app.use(express.json({ limit: '10mb' }));
  app.use(cookieSession({
    name: 'volpaia_session',
    secret: SESSION_SECRET,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  }));

  // ---------- Auth middleware ----------
  function requireAuth(req, res, next) {
    if (req.session && req.session.userId) return next();
    return res.status(401).json({ error: 'No autenticado' });
  }

  app.use((req, res, next) => {
    if (req.session && req.session.userId) {
      req.currentUser = db.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(req.session.userId);
    }
    next();
  });

  // ---------- Auth routes ----------
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Faltan credenciales' });
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    req.session.userId = user.id;
    res.json({ ok: true, user: { id: user.id, username: user.username, name: user.name } });
  });

  app.post('/api/logout', (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    if (!req.session || !req.session.userId) return res.status(401).json({ error: 'No autenticado' });
    const user = db.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(req.session.userId);
    if (!user) return res.status(401).json({ error: 'No autenticado' });
    res.json({ user });
  });

  // ---------- File uploads ----------
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const allowedExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf'];
      const safeExt = allowedExt.includes(ext) ? ext : '.jpg';
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
    }
  });
  const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype) || file.mimetype === 'application/pdf') cb(null, true);
      else cb(new Error('Formato de archivo no soportado'));
    }
  });

  app.post('/api/upload', requireAuth, upload.single('photo'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    res.json({ url: `/uploads/${req.file.filename}` });
  });

  app.use('/uploads', requireAuth, express.static(UPLOAD_DIR));

  // ---------- Clients API ----------
  app.use('/api/clients', requireAuth);

  app.get('/api/clients', (req, res) => {
    const { q, favorite } = req.query;
    let sql = 'SELECT * FROM clients WHERE 1=1';
    const params = [];
    if (favorite === '1') sql += ' AND favorite = 1';
    if (q) {
      sql += ` AND (
        first_name LIKE ? OR last_name LIKE ? OR business_name LIKE ? OR
        email LIKE ? OR phone LIKE ? OR locality LIKE ? OR province LIKE ?
      )`;
      const like = `%${q}%`;
      for (let i = 0; i < 7; i++) params.push(like);
    }
    sql += ' ORDER BY client_number ASC';
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  });

  app.get('/api/clients/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(row);
  });

  function nextClientNumber() {
    const tx = db.transaction(() => {
      db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'client_number'").run();
      return db.prepare("SELECT value FROM counters WHERE name = 'client_number'").get().value;
    });
    return tx();
  }

  const CLIENT_FIELDS = [
    'first_name', 'last_name', 'business_name', 'email', 'phone',
    'fiscal_name', 'fiscal_id',
    'address', 'locality', 'postal_code', 'province',
    'shipping_type', 'shipping_carrier', 'shipping_address',
    'website', 'facebook', 'instagram', 'tiktok',
    'notes'
  ];

  app.post('/api/clients', (req, res) => {
    const body = req.body || {};
    const number = nextClientNumber();
    const cols = ['client_number', ...CLIENT_FIELDS];
    const values = [number, ...CLIENT_FIELDS.map(f => body[f] ?? null)];
    const placeholders = cols.map(() => '?').join(',');
    const info = db.prepare(`INSERT INTO clients (${cols.join(',')}) VALUES (${placeholders})`).run(...values);
    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  });

  app.put('/api/clients/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Cliente no encontrado' });
    const body = req.body || {};
    const sets = CLIENT_FIELDS.map(f => `${f} = ?`);
    const values = CLIENT_FIELDS.map(f => body[f] ?? null);
    db.prepare(`UPDATE clients SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...values, req.params.id);
    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    res.json(row);
  });

  app.patch('/api/clients/:id/favorite', (req, res) => {
    const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Cliente no encontrado' });
    const newVal = existing.favorite ? 0 : 1;
    db.prepare('UPDATE clients SET favorite = ? WHERE id = ?').run(newVal, req.params.id);
    res.json({ id: Number(req.params.id), favorite: newVal });
  });

  app.delete('/api/clients/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Cliente no encontrado' });
    db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---------- Products API ----------
  app.use('/api/products', requireAuth);

  app.get('/api/products', (req, res) => {
    const { q, category } = req.query;
    let sql = 'SELECT * FROM products WHERE 1=1';
    const params = [];
    if (category && category !== 'Todas') {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (q) {
      sql += ' AND (code LIKE ? OR description LIKE ? OR colors LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    sql += ' ORDER BY updated_at DESC';
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  });

  app.get('/api/products/categories/summary', (req, res) => {
    const rows = db.prepare('SELECT category, COUNT(*) as count FROM products GROUP BY category').all();
    const total = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
    res.json({ categories: rows, total });
  });

  // Exportar el catálogo como CSV (se abre y edita en Excel) — declarado
  // ANTES de "/api/products/:id" para que Express no confunda "export" con
  // un id de producto y lo mande al handler equivocado.
  const PRODUCTS_CSV_COLUMNS = [
    'id', 'code', 'description', 'category', 'size', 'size_curve', 'colors',
    'sale_dozen', 'sale_pack3', 'sale_unit',
    'price_dozen', 'price_pack3', 'price_unit',
    'stock_immediate', 'stock_order',
  ];

  function csvEscape(value) {
    const str = value === null || value === undefined ? '' : String(value);
    if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  app.get('/api/products/export', (req, res) => {
    const rows = db.prepare('SELECT * FROM products ORDER BY code ASC').all();
    const lines = [PRODUCTS_CSV_COLUMNS.join(',')];
    rows.forEach(p => {
      lines.push(PRODUCTS_CSV_COLUMNS.map(col => csvEscape(p[col])).join(','));
    });
    const csv = '﻿' + lines.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="productos.csv"');
    res.send(csv);
  });

  app.get('/api/products/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(row);
  });

  const PRODUCT_FIELDS = [
    'code', 'description', 'category', 'size', 'size_curve', 'colors',
    'sale_dozen', 'sale_pack3', 'sale_unit',
    'price_dozen', 'price_pack3', 'price_unit',
    'stock_immediate', 'stock_order',
    'photo1', 'photo2', 'photo3'
  ];

  function buildPriceHistoryAppend(existingHistory, body, prevPrices) {
    const today = new Date().toISOString().slice(0, 10);
    const lines = [];
    const labels = { price_dozen: 'Docena', price_pack3: 'Pack x3', price_unit: 'Unidad' };
    for (const key of Object.keys(labels)) {
      const newVal = body[key];
      if (newVal === undefined || newVal === null || newVal === '') continue;
      const prevVal = prevPrices ? prevPrices[key] : undefined;
      if (Number(newVal) !== Number(prevVal)) {
        lines.push(`${today} - ${labels[key]}: $${Number(newVal).toLocaleString('es-AR')}`);
      }
    }
    if (lines.length === 0) return existingHistory || '';
    const base = existingHistory ? existingHistory + '\n' : '';
    return base + lines.join('\n');
  }

  app.post('/api/products', (req, res) => {
    const body = req.body || {};
    const history = buildPriceHistoryAppend('', body, null);
    const cols = [...PRODUCT_FIELDS, 'price_history'];
    const values = [...PRODUCT_FIELDS.map(f => body[f] ?? null), history];
    const placeholders = cols.map(() => '?').join(',');
    const info = db.prepare(`INSERT INTO products (${cols.join(',')}) VALUES (${placeholders})`).run(...values);
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  });

  app.put('/api/products/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });
    const body = req.body || {};
    const history = buildPriceHistoryAppend(existing.price_history, body, existing);
    const sets = [...PRODUCT_FIELDS.map(f => `${f} = ?`), 'price_history = ?'];
    const values = [...PRODUCT_FIELDS.map(f => body[f] ?? null), history];
    db.prepare(`UPDATE products SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...values, req.params.id);
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    res.json(row);
  });

  app.delete('/api/products/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });
    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // Importar productos desde CSV (Excel): actualiza por id si viene en la
  // fila, o crea uno nuevo si no. Pensado para el flujo exportar -> editar
  // en Excel -> volver a importar.
  const PRODUCT_NUMERIC_FIELDS = ['sale_dozen', 'sale_pack3', 'sale_unit', 'price_dozen', 'price_pack3', 'price_unit', 'stock_immediate', 'stock_order'];

  app.post('/api/products/import', (req, res) => {
    const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
    if (!rows) return res.status(400).json({ error: 'Faltan las filas a importar' });

    let created = 0;
    let updated = 0;
    const tx = db.transaction(() => {
      for (const raw of rows) {
        const body = {};
        PRODUCT_FIELDS.forEach(f => {
          if (raw[f] === undefined || raw[f] === '') { body[f] = null; return; }
          body[f] = PRODUCT_NUMERIC_FIELDS.includes(f) ? Number(raw[f]) : raw[f];
        });
        const id = raw.id ? Number(raw.id) : null;
        const existing = id ? db.prepare('SELECT * FROM products WHERE id = ?').get(id) : null;
        if (existing) {
          const history = buildPriceHistoryAppend(existing.price_history, body, existing);
          const sets = [...PRODUCT_FIELDS.map(f => `${f} = ?`), 'price_history = ?'];
          const values = [...PRODUCT_FIELDS.map(f => body[f] ?? null), history];
          db.prepare(`UPDATE products SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
            .run(...values, existing.id);
          updated++;
        } else {
          const history = buildPriceHistoryAppend('', body, null);
          const cols = [...PRODUCT_FIELDS, 'price_history'];
          const values = [...PRODUCT_FIELDS.map(f => body[f] ?? null), history];
          const placeholders = cols.map(() => '?').join(',');
          db.prepare(`INSERT INTO products (${cols.join(',')}) VALUES (${placeholders})`).run(...values);
          created++;
        }
      }
    });
    tx();
    res.json({ ok: true, created, updated });
  });

  // ---------- Orders / Quotes / Notifications / Settings / Users / Contacts API ----------
  const orderHelpers = ordersRouterFactory.createOrderHelpers(db, UPLOAD_DIR);
  app.use('/api/orders', requireAuth, ordersRouterFactory(db, UPLOAD_DIR, orderHelpers));
  app.use('/api/quotes', requireAuth, quotesRouterFactory(db, UPLOAD_DIR, orderHelpers));
  app.use('/api/notifications', requireAuth, notificationsRouterFactory(db));
  app.use('/api/settings', requireAuth, settingsRouterFactory(db));
  app.use('/api/users', requireAuth, usersRouterFactory(db));
  app.use('/api/contacts', requireAuth, contactsRouterFactory(db));
  app.use('/api/commissions', requireAuth, commissionsRouterFactory(db));
  app.use('/api/dashboard', requireAuth, dashboardRouterFactory(db));
  app.use('/api/messages', requireAuth, messagesRouterFactory(db));
  app.use('/api/push', requireAuth, pushRouterFactory(db));
  app.use('/api/search', requireAuth, searchRouterFactory(db));

  // ---------- Static frontend ----------
  // ASSET_VERSION cambia en cada arranque del servidor (cada deploy reinicia
  // el proceso), y se inyecta como ?v=... en cada <script>/<link> de
  // index.html. Así, si Hostinger (u otro hosting) tiene una caché o CDN
  // delante de los archivos estáticos, el cambio de URL la invalida sola —
  // sin depender de que el usuario borre caché a mano en su navegador.
  const ASSET_VERSION = String(Date.now());
  const publicDir = path.join(__dirname, '..', 'public');
  const indexPath = path.join(publicDir, 'index.html');

  function sendIndexHtml(req, res) {
    fs.readFile(indexPath, 'utf8', (err, html) => {
      if (err) return res.status(500).send('Error interno');
      res.set('Cache-Control', 'no-cache');
      res.send(html.replaceAll('__ASSET_VERSION__', ASSET_VERSION));
    });
  }

  app.use(express.static(publicDir, { index: false }));
  app.get('/', sendIndexHtml);
  app.get('*', sendIndexHtml);

  app.listen(PORT, () => {
    console.log(`Volpaia gestión escuchando en http://localhost:${PORT}`);
  });

  // Antes, los recordatorios solo se generaban cuando alguien abría la app
  // (al pedir /api/notifications). Para que la notificación push llegue al
  // celular/PC incluso con la app cerrada, hay que revisarlos también en
  // segundo plano cada cierto tiempo.
  setInterval(() => {
    try { checkReminders(db); } catch (err) { console.error('Error chequeando recordatorios:', err); }
  }, 5 * 60 * 1000);
}

start().catch(err => {
  console.error('Error al iniciar el servidor:', err);
  process.exit(1);
});
