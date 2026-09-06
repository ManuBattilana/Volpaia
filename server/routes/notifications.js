const express = require('express');
const { checkReminders } = require('../lib/reminders');

module.exports = function notificationsRouterFactory(db) {
const router = express.Router();

router.get('/', (req, res) => {
  checkReminders(db);
  const rows = db.prepare(`
    SELECT * FROM notifications
    WHERE (user_id = ? OR user_id IS NULL) AND read = 0
    ORDER BY created_at DESC
    LIMIT 50
  `).all(req.currentUser.id);
  res.json(rows);
});

router.post('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? OR user_id IS NULL').run(req.currentUser.id);
  res.json({ ok: true });
});

return router;
};
