const express = require('express');

module.exports = function settingsRouterFactory(db) {
const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM settings WHERE id = 1').get());
});

router.put('/', (req, res) => {
  const { reminder_days_1, reminder_days_2, commission_percentage, damian_phone, posventa_msg_1, posventa_msg_2 } = req.body || {};
  const days1 = Number(reminder_days_1);
  const days2 = Number(reminder_days_2);
  const pct = Number(commission_percentage);
  if (!days1 || days1 <= 0 || !days2 || days2 <= 0 || pct < 0) {
    return res.status(400).json({ error: 'Valores inválidos' });
  }
  db.prepare(`
    UPDATE settings SET reminder_days_1 = ?, reminder_days_2 = ?, commission_percentage = ?, damian_phone = ?,
      posventa_msg_1 = ?, posventa_msg_2 = ?
    WHERE id = 1
  `).run(days1, days2, pct, damian_phone || null, posventa_msg_1 || null, posventa_msg_2 || null);
  res.json(db.prepare('SELECT * FROM settings WHERE id = 1').get());
});

// Aparte del resto (que se guarda todo junto desde el formulario grande de
// Configuración), el logo se sube solo, así que tiene su propio endpoint
// para no tener que mandar también los demás campos numéricos.
router.put('/logo', (req, res) => {
  const { logo_url } = req.body || {};
  if (!logo_url) return res.status(400).json({ error: 'Falta la URL del logo' });
  db.prepare('UPDATE settings SET logo_url = ? WHERE id = 1').run(logo_url);
  res.json(db.prepare('SELECT * FROM settings WHERE id = 1').get());
});

return router;
};
