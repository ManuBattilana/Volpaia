const express = require('express');
const path = require('path');
const { generateOrderPdf, generatePreparationPdf } = require('../lib/pdf');

const STATUSES = [
  'Pedido creado',
  'Pedido confirmado',
  'Datos enviados al cliente',
  'Esperando comprobante',
  'Pago confirmado',
  'En preparación',
  'Listo para despachar',
  'Despachado',
  'Seguimiento posventa',
];

const DESPACHADO_INDEX = 7;
const LAST_INDEX = STATUSES.length - 1; // 8, Seguimiento posventa

const PRESENTATION_FIELD = {
  Docena: { enabled: 'sale_dozen', price: 'price_dozen' },
  'Pack x3': { enabled: 'sale_pack3', price: 'price_pack3' },
  Unidad: { enabled: 'sale_unit', price: 'price_unit' },
};

function ordersRouterFactory(db, uploadDir) {
const router = express.Router();

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

function getItems(orderId) {
  return db.prepare(`
    SELECT oi.*, p.code AS product_code, p.description AS product_description
    FROM order_items oi JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ?
    ORDER BY oi.id ASC
  `).all(orderId);
}

function getClient(clientId) {
  return db.prepare(`
    SELECT id, first_name, last_name, business_name, client_number, phone,
           address, locality, province, shipping_type, shipping_carrier, shipping_address
    FROM clients WHERE id = ?
  `).get(clientId);
}

function getSellerName(userId) {
  const u = db.prepare('SELECT name, username FROM users WHERE id = ?').get(userId);
  return u ? (u.name || u.username) : '';
}

function serializeOrder(order) {
  const items = getItems(order.id);
  const history = db.prepare(`
    SELECT h.*, u.name AS changed_by_name, u.username AS changed_by_username
    FROM order_status_history h LEFT JOIN users u ON u.id = h.changed_by
    WHERE h.order_id = ? ORDER BY h.changed_at ASC, h.id ASC
  `).all(order.id);
  const commission = db.prepare('SELECT * FROM commissions WHERE order_id = ?').get(order.id);
  const client = getClient(order.client_id);
  const calculated_amount = calcOrderAmount(order.id);
  return {
    ...order,
    status_label: order.cancelled ? 'Cancelado' : STATUSES[order.status_index],
    editable: order.status_index === 0 && !order.cancelled,
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
    const listPrice = product[pres.price];
    if (listPrice === null || listPrice === undefined || listPrice === '') {
      throw new Error(`El producto ${product.code} no tiene precio definido para ${item.presentation}`);
    }
    const quantity = Number(item.quantity);
    if (!quantity || quantity <= 0) throw new Error('Cantidad inválida');
    // El precio unitario se puede pisar manualmente (descuentos, muestrario a $0);
    // si no se manda, se usa el precio de lista vigente del producto.
    const unitPrice = item.unit_price !== undefined && item.unit_price !== null && item.unit_price !== ''
      ? Number(item.unit_price)
      : listPrice;
    prepared.push({ product_id: product.id, quantity, presentation: item.presentation, unit_price: unitPrice });
  }
  return prepared;
}

function regenerateOrderPdf(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const items = getItems(orderId);
  const client = getClient(order.client_id);
  const seller = getSellerName(order.created_by);
  const filename = `pedido-${order.order_number}.pdf`;
  const filePath = path.join(uploadDir, filename);
  return generateOrderPdf(filePath, { order, items, client, seller }).then(() => {
    db.prepare('UPDATE orders SET order_pdf_path = ? WHERE id = ?').run(`/uploads/${filename}`, orderId);
  });
}

function generatePrepPdf(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const items = getItems(orderId);
  const client = getClient(order.client_id);
  const seller = getSellerName(order.created_by);
  const filename = `preparacion-${order.order_number}.pdf`;
  const filePath = path.join(uploadDir, filename);
  return generatePreparationPdf(filePath, { order, items, client, seller }).then(() => {
    db.prepare('UPDATE orders SET preparation_pdf_path = ? WHERE id = ?').run(`/uploads/${filename}`, orderId);
  });
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
    sql += ' AND o.status_index = ? AND o.cancelled = 0';
    params.push(Number(status));
  }
  if (q) {
    sql += ` AND (c.first_name LIKE ? OR c.last_name LIKE ? OR c.business_name LIKE ? OR CAST(o.order_number AS TEXT) LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY o.created_at DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(r => ({
    ...r,
    status_label: r.cancelled ? 'Cancelado' : STATUSES[r.status_index],
    calculated_amount: calcOrderAmount(r.id),
  })));
});

router.get('/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json(serializeOrder(order));
});

router.post('/', async (req, res) => {
  const { client_id, notes, items } = req.body || {};
  if (!client_id) return res.status(400).json({ error: 'Falta el cliente' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'El pedido necesita al menos un producto' });
  }
  const client = getClient(client_id);
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
      INSERT INTO orders (order_number, client_id, status_index, notes, created_by)
      VALUES (?, ?, 0, ?, ?)
    `).run(orderNumber, client_id, notes || null, req.currentUser.id);
    const orderId = info.lastInsertRowid;
    const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, quantity, presentation, unit_price) VALUES (?, ?, ?, ?, ?)');
    preparedItems.forEach(it => insertItem.run(orderId, it.product_id, it.quantity, it.presentation, it.unit_price));
    db.prepare('INSERT INTO order_status_history (order_id, from_status, to_status, changed_by) VALUES (?, NULL, 0, ?)')
      .run(orderId, req.currentUser.id);
    return orderId;
  });

  const orderId = tx();
  try {
    await regenerateOrderPdf(orderId);
  } catch (err) {
    console.error('Error generando PDF del pedido', err);
  }
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  res.status(201).json(serializeOrder(order));
});

router.put('/:id', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.cancelled) return res.status(400).json({ error: 'El pedido está cancelado' });
  if (order.status_index !== 0) {
    return res.status(400).json({ error: 'El pedido ya no se puede editar (ya fue confirmado)' });
  }
  const { notes, items } = req.body || {};

  let preparedItems = null;
  if (Array.isArray(items)) {
    try {
      preparedItems = validateItems(items);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const tx = db.transaction(() => {
    db.prepare(`UPDATE orders SET notes = ?, modified = 1, updated_at = datetime('now') WHERE id = ?`)
      .run(notes !== undefined ? notes : order.notes, order.id);

    if (preparedItems) {
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(order.id);
      const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, quantity, presentation, unit_price) VALUES (?, ?, ?, ?, ?)');
      preparedItems.forEach(it => insertItem.run(order.id, it.product_id, it.quantity, it.presentation, it.unit_price));
    }
  });
  tx();

  try {
    await regenerateOrderPdf(order.id);
  } catch (err) {
    console.error('Error regenerando PDF del pedido', err);
  }

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  res.json(serializeOrder(updated));
});

router.post('/:id/cancel', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.status_index !== 0) return res.status(400).json({ error: 'Solo se puede cancelar en "Pedido creado"' });
  if (order.cancelled) return res.status(400).json({ error: 'El pedido ya está cancelado' });

  db.prepare("UPDATE orders SET cancelled = 1, updated_at = datetime('now') WHERE id = ?").run(order.id);
  const otherId = otherUserId(req.currentUser.id);
  if (otherId) notify(otherId, 'status_change', order.id, `${req.currentUser.name || req.currentUser.username} canceló el pedido #${order.order_number}`);

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  res.json(serializeOrder(updated));
});

// Mientras el pedido está en "Esperando comprobante" (índice 3), Melany adjunta
// el comprobante de pago SIN que eso avance el estado; Darío confirma el pago
// aparte con /advance una vez que lo revisó.
router.post('/:id/attach-payment', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.cancelled || order.finalized) return res.status(400).json({ error: 'El pedido no admite cambios' });
  if (order.status_index !== 3) return res.status(400).json({ error: 'Solo se puede adjuntar el comprobante en "Esperando comprobante"' });
  const { attachment_url, amount_payment } = req.body || {};
  if (!attachment_url) return res.status(400).json({ error: 'Falta el comprobante de pago' });

  db.prepare(`
    UPDATE orders SET payment_attachment_url = ?, amount_payment = ?, updated_at = datetime('now') WHERE id = ?
  `).run(attachment_url, amount_payment !== undefined && amount_payment !== '' ? Number(amount_payment) : order.amount_payment, order.id);

  const otherId = otherUserId(req.currentUser.id);
  if (otherId) notify(otherId, 'status_change', order.id, `${req.currentUser.name || req.currentUser.username} adjuntó el comprobante de pago del pedido #${order.order_number}`);

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  res.json(serializeOrder(updated));
});

router.post('/:id/advance', async (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.cancelled) return res.status(400).json({ error: 'El pedido está cancelado' });
  if (order.finalized) return res.status(400).json({ error: 'El pedido ya está finalizado' });
  const currentIndex = order.status_index;
  if (currentIndex >= LAST_INDEX) {
    return res.status(400).json({ error: 'El pedido ya está en el último estado' });
  }
  const nextIndex = currentIndex + 1;
  const body = req.body || {};
  const updates = {};
  let attachmentUrl = null;
  let notifyMessage = null;

  if (nextIndex === 1) {
    // Pedido creado -> Pedido confirmado
    notifyMessage = `${req.currentUser.name || req.currentUser.username} confirmó el pedido #${order.order_number}`;
  } else if (nextIndex === 2) {
    // Pedido confirmado -> Datos enviados al cliente (Factura X + datos de transferencia)
    if (!body.invoice_attachment_url || !body.transfer_attachment_url) {
      return res.status(400).json({ error: 'Faltan adjuntar la Factura X y los datos de transferencia' });
    }
    updates.invoice_attachment_url = body.invoice_attachment_url;
    updates.transfer_attachment_url = body.transfer_attachment_url;
    if (body.amount_invoice !== undefined && body.amount_invoice !== '') updates.amount_invoice = Number(body.amount_invoice);
    attachmentUrl = body.invoice_attachment_url;
    notifyMessage = `${req.currentUser.name || req.currentUser.username} cargó la Factura X y los datos de transferencia del pedido #${order.order_number}`;
  } else if (nextIndex === 3) {
    // Datos enviados al cliente -> Esperando comprobante (Melany ya le mandó los datos por WhatsApp)
    notifyMessage = null;
  } else if (nextIndex === 4) {
    // Esperando comprobante -> Pago confirmado
    if (!order.payment_attachment_url) {
      return res.status(400).json({ error: 'Todavía no se adjuntó el comprobante de pago' });
    }
    notifyMessage = `${req.currentUser.name || req.currentUser.username} confirmó el pago del pedido #${order.order_number}`;
  } else if (nextIndex === 5) {
    // Pago confirmado -> En preparación (genera el PDF de preparación)
    notifyMessage = null;
  } else if (nextIndex === 6) {
    // En preparación -> Listo para despachar
    notifyMessage = `${req.currentUser.name || req.currentUser.username} terminó de preparar el pedido #${order.order_number}`;
  } else if (nextIndex === DESPACHADO_INDEX) {
    // Listo para despachar -> Despachado
    if (!body.shipping_date || !body.tracking_number || !body.attachment_url) {
      return res.status(400).json({ error: 'Faltan datos de despacho (fecha, número de guía y comprobante)' });
    }
    updates.shipping_date = body.shipping_date;
    updates.tracking_number = body.tracking_number;
    updates.shipping_proof_photo = body.attachment_url;
    attachmentUrl = body.attachment_url;
    notifyMessage = `${req.currentUser.name || req.currentUser.username} despachó el pedido #${order.order_number}`;
  } else if (nextIndex === LAST_INDEX) {
    // Despachado -> Seguimiento posventa
    notifyMessage = null;
  }

  updates.status_index = nextIndex;

  const tx = db.transaction(() => {
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    db.prepare(`UPDATE orders SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`).run(...values, order.id);

    db.prepare(`
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, attachment_url)
      VALUES (?, ?, ?, ?, ?)
    `).run(order.id, currentIndex, nextIndex, req.currentUser.id, attachmentUrl);

    if (nextIndex === DESPACHADO_INDEX) {
      const baseAmount = calcOrderAmount(order.id);
      const settings = getSettings();
      const amount = Math.round(baseAmount * settings.commission_percentage) / 100;
      db.prepare(`
        INSERT INTO commissions (order_id, base_amount, percentage, amount) VALUES (?, ?, ?, ?)
        ON CONFLICT(order_id) DO UPDATE SET base_amount = excluded.base_amount, percentage = excluded.percentage, amount = excluded.amount
      `).run(order.id, baseAmount, settings.commission_percentage, amount);
    }

    if (nextIndex === LAST_INDEX) {
      const settings = getSettings();
      // Los días de recordatorio quedan fijados a los de Configuración vigentes
      // en el momento de llegar a este paso (o el override puntual del pedido).
      db.prepare(`
        UPDATE orders SET
          reminder_days_1 = COALESCE(reminder_days_1, ?),
          reminder_days_2 = COALESCE(reminder_days_2, ?)
        WHERE id = ?
      `).run(settings.reminder_days_1, settings.reminder_days_2, order.id);
    }

    if (notifyMessage) {
      const otherId = otherUserId(req.currentUser.id);
      if (otherId) notify(otherId, 'status_change', order.id, notifyMessage);
    }
  });
  tx();

  if (nextIndex === 5) {
    try {
      await generatePrepPdf(order.id);
    } catch (err) {
      console.error('Error generando PDF de preparación', err);
    }
  }

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  res.json(serializeOrder(updated));
});

router.post('/:id/finalize', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.status_index !== LAST_INDEX) return res.status(400).json({ error: 'Solo se puede finalizar en "Seguimiento posventa"' });
  if (order.finalized) return res.status(400).json({ error: 'El pedido ya está finalizado' });

  db.prepare("UPDATE orders SET finalized = 1, updated_at = datetime('now') WHERE id = ?").run(order.id);
  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  res.json(serializeOrder(updated));
});

router.post('/:id/revert', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.cancelled) return res.status(400).json({ error: 'El pedido está cancelado' });
  if (order.finalized) return res.status(400).json({ error: 'El pedido ya está finalizado' });
  if (order.status_index === 0) return res.status(400).json({ error: 'No se puede retroceder desde el primer estado' });

  const prevIndex = order.status_index - 1;
  const wasDespachado = order.status_index === DESPACHADO_INDEX || order.status_index === LAST_INDEX;

  const tx = db.transaction(() => {
    db.prepare("UPDATE orders SET status_index = ?, updated_at = datetime('now') WHERE id = ?").run(prevIndex, order.id);
    db.prepare(`
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, is_correction)
      VALUES (?, ?, ?, ?, 1)
    `).run(order.id, order.status_index, prevIndex, req.currentUser.id);

    if (wasDespachado && prevIndex < DESPACHADO_INDEX) {
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

return router;
}

module.exports = ordersRouterFactory;
module.exports.STATUSES = STATUSES;
