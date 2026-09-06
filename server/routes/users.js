const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT id, username, name, role FROM users ORDER BY id ASC').all());
});

router.put('/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (Number(req.params.id) !== req.currentUser.id) {
    return res.status(403).json({ error: 'Solo podés cambiar tu propio usuario y contraseña' });
  }
  const { username, name, password } = req.body || {};

  let newUsername = user.username;
  if (username && username.trim()) {
    newUsername = username.trim().toLowerCase();
    if (newUsername !== user.username) {
      const clash = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(newUsername, user.id);
      if (clash) return res.status(400).json({ error: 'Ese nombre de usuario ya está en uso' });
    }
  }
  const newName = name !== undefined && name !== '' ? name : user.name;
  const newHash = password ? bcrypt.hashSync(password, 10) : user.password_hash;

  db.prepare('UPDATE users SET username = ?, name = ?, password_hash = ? WHERE id = ?')
    .run(newUsername, newName, newHash, user.id);

  res.json({ id: user.id, username: newUsername, name: newName, role: user.role });
});

module.exports = router;
