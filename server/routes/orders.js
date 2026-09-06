const express = require('express');
const router = express.Router();
const db = require('../db');

const STATUSES = [
  'Pedido recibido',
  'Datos completos',
  'Enviado a fábrica',
  'Factura X recibida',
  'Factura X confirmada por cliente',
  'Esperando pago',
  'Pago recibido',
  'En preparación',
  'Listo para despacho',
  'Despachado',
  'Seguimiento posventa',
];

const EDITABLE_UNTIL_INDEX = 1; // se puede editar mientras está en "Pedido recibido" o "Datos completos"
const SHIPPED_INDEX = 9;

const PRESENTATION_FIELD = {
  Docena: { enabled: 'sale_dozen', price: 'price_dozen' },
  'Pack x3': { enabled: 'sale_pack3', price: 'price_pack3' },
  Unidad: { enabled: 'sale_unit', price: 'price_unit' },
};

function getSettings() {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get();
}

function nextOrderNumber() {
  const tx = db.transaction(() => {
    db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'order_number'").run();
    return db.prepare("SELECT value FROM counters WHERE name = 'order_number'").get().value;
  });
  return tx();
}

function calcOrderAmount(orderId) {
  const row = db.prepare('SELECT COALESCE(SUM(quantity * unit_price), 0) AS total FROM order_items WHERE order_id = ?').get(orderId);
  return row.total;
}

function otherUserId(currentUserId) {
  const row = db.prepare('SELECT id FROM users WHERE id != ?').get(currentUserId);
  return row ? row.id : null;
}

function notify(userId, type, orderId, message) {
  db.prepare('INSERT INTO notifications (user_id, type, order_id, message) VALUES (?, ?, ?, ?)')
    .run(userId, type, orderId, message);
}

function serializeOrder(order) {
  const items = db.prepare(`
    SELECT oi.*, p.code AS product_code, p.description AS product_description
    FROM order_items oi JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ?
    ORDER BY oi.id ASC
  `).all(order.id);
  const history = db.prepare(`
    SELECT h.*, u.name AS changed_by_name, u.username AS changed_by_username
    FROM order_status_history h LEFT JOIN users u ON u.id = h.changed_by
    WHERE h.order_id = ? ORDER BY h.changed_at ASC, h.id ASC
  `).all(order.id);
  const commission = db.prepare('SELECT * FROM commissions WHERE order_id = ?').get(order.id);
  const client = db.prepare('SELECT id, first_name, last_name, business_name, client_number, phone FROM clients WHERE id = ?').get(order.client_id);
  const calculated_amount = calcOrderAmount(order.id);
  return {
    ...order,
    status_label: STATUSES[order.status_index],
    editable: order.status_index <= EDITABLE_UNTIL_INDEX,
    items,
    history,
    commission: commission || null,
    client,
    calculated_amount,
  };
}

function validateItems(items) {
  const prepared = [];
  for (const item of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
    if (!product) throw new Error(`Producto ${item.product_id} no encontrado`);
    const pres = PRESENTATION_FIELD[item.presentation];
    if (!pres) throw new Error('Presentación inválida');
    if (!product[pres.enabled]) throw new Error(`El producto ${product.code} no tiene habilitada la presentación ${item.presentation}`);
    const price = product[pres.price];
    if (price === null || price === undefined || price === '') {
      throw new Error(`El producto ${product.code} no tiene precio definido para ${item.presentation}`);
    }
    const quantity = Number(item.quantity);
    if (!quantity || quantity <= 0) throw new Error('Cantidad inválida');
    prepared.push({ product_id: product.id, quantity, presentation: item.presentation, unit_price: price });
  }
  return prepared;
}

router.get('/statuses', (req, res) => res.json(STATUSES));

router.get('/', (req, res) => {
  const { status, q } = req.query;
  let sql = `
    SELECT o.*, c.first_name, c.last_name, c.business_name, c.client_number
    FROM orders o JOIN clients c ON c.id = o.client_id
    WHERE 1=1
  `;
  const params = [];
  if (status !== undefined && status !== '') {
    sql += ' AND o.status_index = ?';
    params.push(Number(status));
  }
  if (q) {
    sql += ` AND (c.first_name LIKE ? OR c.last_name LIKE ? OR c.business_name LIKE ? OR CAST(o.order_number AS TEXT) LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY o.created_at DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(r => ({ ...r, status_label: STATUSES[r.status_index], calculated_amount: calcOrderAmount(r.id) })));
});

router.get('/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json(serializeOrder(order));
});

router.post('/', (req, res) => {
  const { client_id, notes, items, reminder_days_1, reminder_days_2 } = req.body || {};
  if (!client_id) return res.status(400).json({ error: 'Falta el cliente' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'El pedido necesita al menos un producto' });
  }
  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(client_id);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

  let preparedItems;
  try {
    preparedItems = validateItems(items);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const orderNumber = nextOrderNumber();
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO orders (order_number, client_id, status_index, notes, reminder_days_1, reminder_days_2, created_by)
      VALUES (?, ?, 0, ?, ?, ?, ?)
    `).run(orderNumber, client_id, notes || null, reminder_days_1 || null, reminder_days_2 || null, req.currentUser.id);
    const orderId = info.lastInsertRowid;
    const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, quantity, presentation, unit_price) VALUES (?, ?, ?, ?, ?)');
    preparedItems.forEach(it => insertItem.run(orderId, it.product_id, it.quantity, it.presentation, it.unit_price));
    db.prepare('INSERT INTO order_status_history (order_id, from_status, to_status, changed_by) VALUES (?, NULL, 0, ?)')
      .run(orderId, req.currentUser.id);
    return orderId;
  });

  const orderId = tx();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  res.status(201).json(serializeOrder(order));
});

router.put('/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.status_index > EDITABLE_UNTIL_INDEX) {
    return res.status(400).json({ error: 'El pedido ya no se puede editar (pasó de "Datos completos")' });
  }
  const { notes, reminder_days_1, reminder_days_2, items } = req.body || {};

  let preparedItems = null;
  if (Array.isArray(items)) {
    try {
      preparedItems = validateItems(items);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE orders SET notes = ?, reminder_days_1 = ?, reminder_days_2 = ?, updated_at = datetime('now') WHERE id = ?
    `).run(
      notes !== undefined ? notes : order.notes,
      reminder_days_1 !== undefined ? reminder_days_1 : order.reminder_days_1,
      reminder_days_2 !== undefined ? reminder_days_2 : order.reminder_days_2,
      order.id
    );

    if (preparedItems) {
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(order.id);
      const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, quantity, presentation, unit_price) VALUES (?, ?, ?, ?, ?)');
      preparedItems.forEach(it => insertItem.run(order.id, it.product_id, it.quantity, it.presentation, it.unit_price));
    }
  });
  tx();

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  res.json(serializeOrder(updated));
});

router.post('/:id/advance', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  const currentIndex = order.status_index;
  if (currentIndex >= STATUSES.length - 1) {
    return res.status(400).json({ error: 'El pedido ya está en el último estado' });
  }
  const nextIndex = currentIndex + 1;
  const body = req.body || {};
  const updates = { status_index: nextIndex };
  let attachmentUrl = null;

  if (nextIndex === 3) {
    if (!body.attachment_url) return res.status(400).json({ error: 'Falta adjuntar la Factura X' });
    attachmentUrl = body.attachment_url;
    if (body.amount_invoice !== undefined && body.amount_invoice !== '') updates.amount_invoice = Number(body.amount_invoice);
  } else if (nextIndex === 6) {
    if (!body.attachment_url) return res.status(400).json({ error: 'Falta adjuntar el comprobante de pago' });
    attachmentUrl = body.attachment_url;
    if (body.amount_payment !== undefined && body.amount_payment !== '') updates.amount_payment = Number(body.amount_payment);
  } else if (nextIndex === SHIPPED_INDEX) {
    if (!body.shipping_date || !body.tracking_number || !body.attachment_url) {
      return res.status(400).json({ error: 'Faltan datos de despacho (fecha, número de guía y comprobante)' });
    }
    updates.shipping_date = body.shipping_date;
    updates.tracking_number = body.tracking_number;
    updates.shipping_proof_photo = body.attachment_url;
    attachmentUrl = body.attachment_url;
  }

  const tx = db.transaction(() => {
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    db.prepare(`UPDATE orders SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`).run(...values, order.id);

    db.prepare(`
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, attachment_url)
      VALUES (?, ?, ?, ?, ?)
    `).run(order.id, currentIndex, nextIndex, req.currentUser.id, attachmentUrl);

    if (nextIndex === SHIPPED_INDEX) {
      const baseAmount = calcOrderAmount(order.id);
      const settings = getSettings();
      const amount = Math.round(baseAmount * settings.commission_percentage) / 100;
      db.prepare(`
        INSERT INTO commissions (order_id, base_amount, percentage, amount) VALUES (?, ?, ?, ?)
        ON CONFLICT(order_id) DO UPDATE SET base_amount = excluded.base_amount, percentage = excluded.percentage, amount = excluded.amount
      `).run(order.id, baseAmount, settings.commission_percentage, amount);
    }

    const otherId = otherUserId(req.currentUser.id);
    if (otherId) {
      notify(otherId, 'status_change', order.id,
        `${req.currentUser.name || req.currentUser.username} movió el pedido #${order.order_number} a "${STATUSES[nextIndex]}"`);
    }
  });
  tx();

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  res.json(serializeOrder(updated));
});

router.post('/:id/revert', (req, res) => {
  if (req.currentUser.role !== 'owner') {
    return res.status(403).json({ error: 'Solo Melany puede retroceder un pedido' });
  }
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.status_index === 0) return res.status(400).json({ error: 'No se puede retroceder desde el primer estado' });

  const prevIndex = order.status_index - 1;
  const wasShipped = order.status_index === SHIPPED_INDEX;

  const tx = db.transaction(() => {
    db.prepare("UPDATE orders SET status_index = ?, updated_at = datetime('now') WHERE id = ?").run(prevIndex, order.id);
    db.prepare(`
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, is_correction)
      VALUES (?, ?, ?, ?, 1)
    `).run(order.id, order.status_index, prevIndex, req.currentUser.id);

    if (wasShipped) {
      db.prepare('DELETE FROM commissions WHERE order_id = ?').run(order.id);
    }

    const otherId = otherUserId(req.currentUser.id);
    if (otherId) {
      notify(otherId, 'status_change', order.id,
        `${req.currentUser.name || req.currentUser.username} corrigió el pedido #${order.order_number}: volvió a "${STATUSES[prevIndex]}"`);
    }
  });
  tx();

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  res.json(serializeOrder(updated));
});

module.exports = router;
module.exports.STATUSES = STATUSES;
