const express = require('express');

// Buscador global de la barra superior: junta resultados de clientes,
// contactos, pedidos y presupuestos en una sola consulta, para no tener
// que saber de antemano en qué sección buscar.
module.exports = function searchRouterFactory(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ clients: [], contacts: [], orders: [], quotes: [] });
    const like = `%${q}%`;

    const clients = db.prepare(`
      SELECT id, client_number, first_name, last_name, business_name
      FROM clients
      WHERE first_name LIKE ? OR last_name LIKE ? OR business_name LIKE ? OR CAST(client_number AS TEXT) LIKE ?
      ORDER BY client_number DESC LIMIT 5
    `).all(like, like, like, like);

    const contacts = db.prepare(`
      SELECT id, first_name, last_name, business_name
      FROM contacts
      WHERE first_name LIKE ? OR last_name LIKE ? OR business_name LIKE ?
      ORDER BY created_at DESC LIMIT 5
    `).all(like, like, like);

    const orders = db.prepare(`
      SELECT o.id, o.order_number, o.status_index, o.cancelled, c.first_name, c.last_name, c.business_name
      FROM orders o JOIN clients c ON c.id = o.client_id
      WHERE c.first_name LIKE ? OR c.last_name LIKE ? OR c.business_name LIKE ? OR CAST(o.order_number AS TEXT) LIKE ?
      ORDER BY o.created_at DESC LIMIT 5
    `).all(like, like, like, like);

    const quotes = db.prepare(`
      SELECT id, quote_number, status, first_name, last_name, business_name
      FROM quotes
      WHERE first_name LIKE ? OR last_name LIKE ? OR business_name LIKE ? OR CAST(quote_number AS TEXT) LIKE ?
      ORDER BY created_at DESC LIMIT 5
    `).all(like, like, like, like);

    res.json({ clients, contacts, orders, quotes });
  });

  return router;
};
