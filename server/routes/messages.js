const express = require('express');
const { sendPush } = require('../lib/push');

// Chat interno simple entre los usuarios de Volpaia (hoy Melany y Darío).
// Es una sola conversación compartida, sin relación con las notificaciones
// de la campanita: un mensaje nuevo no genera una notificación de sistema
// dentro de la app, solo la notificación push al dispositivo del otro
// usuario (si la tiene habilitada).
module.exports = function messagesRouterFactory(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const rows = db.prepare(`
      SELECT m.*, u.name AS sender_name
      FROM messages m JOIN users u ON u.id = m.sender_id
      ORDER BY m.created_at ASC, m.id ASC
      LIMIT 200
    `).all();
    res.json(rows);
  });

  router.get('/unread-count', (req, res) => {
    const row = db.prepare(`
      SELECT COUNT(*) AS c FROM messages WHERE recipient_id = ? AND read = 0
    `).get(req.currentUser.id);
    res.json({ count: row.c });
  });

  router.post('/read-all', (req, res) => {
    db.prepare('UPDATE messages SET read = 1 WHERE recipient_id = ?').run(req.currentUser.id);
    res.json({ ok: true });
  });

  router.post('/', (req, res) => {
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    const other = db.prepare('SELECT id, name FROM users WHERE id != ?').get(req.currentUser.id);
    const info = db.prepare(`
      INSERT INTO messages (sender_id, recipient_id, body) VALUES (?, ?, ?)
    `).run(req.currentUser.id, other ? other.id : null, body.trim());
    const row = db.prepare(`
      SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
    `).get(info.lastInsertRowid);

    if (other) {
      sendPush(db, [other.id], {
        title: `Mensaje de ${req.currentUser.name}`,
        body: body.trim().slice(0, 140),
        url: '/',
      });
    }

    res.status(201).json(row);
  });

  return router;
};
