const express = require('express');

const CONTACT_FIELDS = [
  'first_name', 'last_name', 'business_name',
  'locality', 'province', 'phone', 'notes',
  'website', 'facebook', 'instagram', 'tiktok',
  'status', 'source',
];

module.exports = function contactsRouterFactory(db) {
const router = express.Router();

function nextClientNumber() {
  const tx = db.transaction(() => {
    db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'client_number'").run();
    return db.prepare("SELECT value FROM counters WHERE name = 'client_number'").get().value;
  });
  return tx();
}

router.get('/', (req, res) => {
  const { q, status } = req.query;
  let sql = 'SELECT * FROM contacts WHERE 1=1';
  const params = [];
  if (q) {
    sql += ` AND (
      first_name LIKE ? OR last_name LIKE ? OR business_name LIKE ? OR
      phone LIKE ? OR locality LIKE ? OR province LIKE ?
    )`;
    const like = `%${q}%`;
    for (let i = 0; i < 6; i++) params.push(like);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Contacto no encontrado' });
  res.json(row);
});

function logStatusChange(contactId, fromStatus, toStatus, changedBy) {
  if (fromStatus === toStatus) return;
  db.prepare('INSERT INTO contact_status_history (contact_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?)')
    .run(contactId, fromStatus || null, toStatus, changedBy || null);
}

router.post('/', (req, res) => {
  const body = req.body || {};
  const cols = CONTACT_FIELDS;
  const status = body.status || 'Activo';
  const values = cols.map(f => body[f] ?? (f === 'status' ? status : null));
  const placeholders = cols.map(() => '?').join(',');
  const info = db.prepare(`INSERT INTO contacts (${cols.join(',')}) VALUES (${placeholders})`).run(...values);
  logStatusChange(info.lastInsertRowid, null, status, req.currentUser.id);
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Contacto no encontrado' });
  const body = req.body || {};
  const sets = CONTACT_FIELDS.map(f => `${f} = ?`);
  const values = CONTACT_FIELDS.map(f => body[f] ?? existing[f]);
  db.prepare(`UPDATE contacts SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...values, req.params.id);
  if (body.status !== undefined) logStatusChange(existing.id, existing.status, body.status, req.currentUser.id);
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  res.json(row);
});

router.get('/:id/history', (req, res) => {
  const rows = db.prepare(`
    SELECT h.*, u.name AS changed_by_name, u.username AS changed_by_username
    FROM contact_status_history h LEFT JOIN users u ON u.id = h.changed_by
    WHERE h.contact_id = ? ORDER BY h.changed_at ASC, h.id ASC
  `).all(req.params.id);
  res.json(rows);
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Contacto no encontrado' });
  db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

function appendHistory(existing, label) {
  const today = new Date().toISOString().slice(0, 10);
  const line = `${today} - ${label}`;
  return existing ? existing + '\n' + line : line;
}

router.post('/:id/mark-catalog-sent', (req, res) => {
  const existing = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Contacto no encontrado' });
  const history = appendHistory(existing.catalog_sent_history, 'Catálogo enviado');
  db.prepare("UPDATE contacts SET catalog_sent_history = ?, updated_at = datetime('now') WHERE id = ?").run(history, existing.id);
  res.json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(existing.id));
});

router.post('/:id/mark-pricelist-sent', (req, res) => {
  const existing = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Contacto no encontrado' });
  const history = appendHistory(existing.pricelist_sent_history, 'Lista de precios enviada');
  db.prepare("UPDATE contacts SET pricelist_sent_history = ?, updated_at = datetime('now') WHERE id = ?").run(history, existing.id);
  res.json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(existing.id));
});

router.post('/:id/convert', (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contacto no encontrado' });
  if (contact.converted_client_id) {
    return res.status(400).json({ error: 'Este contacto ya fue convertido a cliente' });
  }
  const body = req.body || {};
  // Solo estos campos adicionales (no presentes en Contacto) se pueden mandar
  // desde el formulario de conversión — nunca nombres de columna arbitrarios.
  const ALLOWED_EXTRA_FIELDS = [
    'email', 'fiscal_name', 'fiscal_id', 'address', 'postal_code',
    'shipping_type', 'shipping_carrier', 'shipping_address',
  ];

  const clientNumber = nextClientNumber();
  const clientFields = {
    first_name: contact.first_name,
    last_name: contact.last_name,
    business_name: contact.business_name,
    locality: contact.locality,
    province: contact.province,
    phone: contact.phone,
    notes: contact.notes,
    website: contact.website,
    facebook: contact.facebook,
    instagram: contact.instagram,
    tiktok: contact.tiktok,
  };
  ALLOWED_EXTRA_FIELDS.forEach(f => {
    if (body[f] !== undefined) clientFields[f] = body[f];
  });
  const cols = ['client_number', ...Object.keys(clientFields)];
  const values = [clientNumber, ...Object.values(clientFields).map(v => v ?? null)];
  const placeholders = cols.map(() => '?').join(',');

  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO clients (${cols.join(',')}) VALUES (${placeholders})`).run(...values);
    const clientId = info.lastInsertRowid;
    db.prepare("UPDATE contacts SET status = 'Convertido', converted_client_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(clientId, contact.id);
    logStatusChange(contact.id, contact.status, 'Convertido', req.currentUser.id);
    return clientId;
  });
  const clientId = tx();

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  const updatedContact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id);
  res.status(201).json({ client, contact: updatedContact });
});

return router;
};
