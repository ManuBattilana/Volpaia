const express = require('express');

module.exports = function settingsRouterFactory(db) {
const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM settings WHERE id = 1').get());
});

router.put('/', (req, res) => {
  const { reminder_days_1, reminder_days_2, commission_percentage, damian_phone } = req.body || {};
  const days1 = Number(reminder_days_1);
  const days2 = Number(reminder_days_2);
  const pct = Number(commission_percentage);
  if (!days1 || days1 <= 0 || !days2 || days2 <= 0 || pct < 0) {
    return res.status(400).json({ error: 'Valores inválidos' });
  }
  db.prepare('UPDATE settings SET reminder_days_1 = ?, reminder_days_2 = ?, commission_percentage = ?, damian_phone = ? WHERE id = 1')
    .run(days1, days2, pct, damian_phone || null);
  res.json(db.prepare('SELECT * FROM settings WHERE id = 1').get());
});

return router;
};
