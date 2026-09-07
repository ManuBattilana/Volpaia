const express = require('express');

module.exports = function commissionsRouterFactory(db) {
const router = express.Router();

router.get('/', (req, res) => {
  const { from, to, paid } = req.query;
  let sql = `
    SELECT c.*, o.order_number, cl.first_name, cl.last_name, cl.business_name, cl.client_number
    FROM commissions c
    JOIN orders o ON o.id = c.order_id
    JOIN clients cl ON cl.id = o.client_id
    WHERE 1=1
  `;
  const params = [];
  if (from) { sql += ' AND date(c.created_at) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(c.created_at) <= date(?)'; params.push(to); }
  if (paid === '1') sql += ' AND c.paid = 1';
  if (paid === '0') sql += ' AND c.paid = 0';
  sql += ' ORDER BY c.created_at DESC';
  const rows = db.prepare(sql).all(...params);
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  res.json({ commissions: rows, total });
});

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get('/export.csv', (req, res) => {
  const { from, to, paid } = req.query;
  let sql = `
    SELECT c.*, o.order_number, cl.first_name, cl.last_name, cl.business_name, cl.client_number
    FROM commissions c
    JOIN orders o ON o.id = c.order_id
    JOIN clients cl ON cl.id = o.client_id
    WHERE 1=1
  `;
  const params = [];
  if (from) { sql += ' AND date(c.created_at) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(c.created_at) <= date(?)'; params.push(to); }
  if (paid === '1') sql += ' AND c.paid = 1';
  if (paid === '0') sql += ' AND c.paid = 0';
  sql += ' ORDER BY c.created_at DESC';
  const rows = db.prepare(sql).all(...params);

  const header = ['Pedido', 'Cliente', 'Fecha', 'Base', 'Porcentaje', 'Comisión', 'Cobrada', 'Fecha de cobro'];
  const lines = [header.join(',')];
  rows.forEach(r => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ');
    const clientLabel = r.business_name ? `${name} — ${r.business_name}` : name;
    lines.push([
      r.order_number, csvEscape(clientLabel), r.created_at.slice(0, 10),
      r.base_amount, r.percentage, r.amount,
      r.paid ? 'Sí' : 'No', r.paid_at ? r.paid_at.slice(0, 10) : '',
    ].join(','));
  });

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="comisiones.csv"');
  res.send('﻿' + lines.join('\n'));
});

router.post('/:id/mark-paid', (req, res) => {
  const commission = db.prepare('SELECT * FROM commissions WHERE id = ?').get(req.params.id);
  if (!commission) return res.status(404).json({ error: 'Comisión no encontrada' });
  db.prepare("UPDATE commissions SET paid = 1, paid_at = datetime('now') WHERE id = ?").run(commission.id);
  res.json(db.prepare('SELECT * FROM commissions WHERE id = ?').get(commission.id));
});

router.post('/:id/unmark-paid', (req, res) => {
  const commission = db.prepare('SELECT * FROM commissions WHERE id = ?').get(req.params.id);
  if (!commission) return res.status(404).json({ error: 'Comisión no encontrada' });
  db.prepare("UPDATE commissions SET paid = 0, paid_at = NULL WHERE id = ?").run(commission.id);
  res.json(db.prepare('SELECT * FROM commissions WHERE id = ?').get(commission.id));
});

return router;
};
