const express = require('express');
const { ensureVapidKeys } = require('../lib/push');

module.exports = function pushRouterFactory(db) {
  const router = express.Router();

  router.get('/vapid-public-key', (req, res) => {
    res.json({ publicKey: ensureVapidKeys(db) });
  });

  router.post('/subscribe', (req, res) => {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ error: 'Suscripción inválida' });
    }
    db.prepare(`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
    `).run(req.currentUser.id, endpoint, keys.p256dh, keys.auth);
    res.json({ ok: true });
  });

  router.post('/unsubscribe', (req, res) => {
    const { endpoint } = req.body || {};
    if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    res.json({ ok: true });
  });

  return router;
};
