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
