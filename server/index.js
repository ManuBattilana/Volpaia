const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./db');
const ordersRouter = require('./routes/orders');
const notificationsRouter = require('./routes/notifications');
const settingsRouter = require('./routes/settings');
const usersRouter = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'volpaia-dev-secret-change-me';

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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

// ---------- Orders / Notifications / Settings / Users API ----------
app.use('/api/orders', requireAuth, ordersRouter);
app.use('/api/notifications', requireAuth, notificationsRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/users', requireAuth, usersRouter);

// ---------- Static frontend ----------
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Volpaia gestión escuchando en http://localhost:${PORT}`);
});
