const { toUnits, getProductStockUnits } = require('./stock');

// Al confirmar un pedido, por cada ítem se usa lo que haya de stock
// disponible (se descuenta con un movimiento de salida bien identificado
// como "usado en este pedido") y lo que falte queda como fabricación
// pendiente — nunca fue stock, nace y muere siendo de ese pedido, así que
// no toca la libreta de stock hasta que sobre algo al recibirlo.
function applyStockOnOrderConfirm(db, orderId) {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  for (const item of items) {
    const neededUnits = toUnits(item.presentation, item.quantity);
    const availableUnits = getProductStockUnits(db, item.product_id);
    const takenFromStock = Math.max(0, Math.min(neededUnits, availableUnits));
    const pendingUnits = neededUnits - takenFromStock;

    if (takenFromStock > 0) {
      db.prepare(`
        INSERT INTO stock_movements (product_id, type, quantity_units, reason, note, related_order_id)
        VALUES (?, 'salida', ?, 'uso_pedido', 'Usado para cubrir el pedido al confirmarlo', ?)
      `).run(item.product_id, -takenFromStock, orderId);
    }
    if (pendingUnits > 0) {
      db.prepare(`
        INSERT INTO manufacturing_pending (order_id, product_id, presentation, quantity_needed_units)
        VALUES (?, ?, ?, ?)
      `).run(orderId, item.product_id, item.presentation, pendingUnits);
    }
  }
}

function serializeManufacturingRow(db, row) {
  const product = db.prepare('SELECT id, code, description, sale_dozen, sale_pack3, sale_unit FROM products WHERE id = ?').get(row.product_id);
  const order = db.prepare(`
    SELECT o.id, o.order_number, c.first_name, c.last_name, c.business_name
    FROM orders o JOIN clients c ON c.id = o.client_id WHERE o.id = ?
  `).get(row.order_id);
  return { ...row, product, order };
}

// Carga una recepción real (lo que volvió bueno del taller). Cubre lo que
// le falta a este pedido puntual y, si sobra, ese sobrante nace como stock
// nuevo del producto — automático, sin que Darío tenga que cargarlo dos
// veces.
function addManufacturingReceipt(db, pendingId, quantityUnits, note, userId) {
  const pending = db.prepare('SELECT * FROM manufacturing_pending WHERE id = ?').get(pendingId);
  if (!pending) throw new Error('No se encontró ese pendiente de fabricación');
  if (pending.status === 'completo') throw new Error('Este pendiente ya está completo');

  db.prepare(`
    INSERT INTO manufacturing_receipts (manufacturing_pending_id, quantity_units, note, created_by)
    VALUES (?, ?, ?, ?)
  `).run(pendingId, quantityUnits, note || null, userId);

  const stillMissing = pending.quantity_needed_units - pending.quantity_received_units;
  const appliedToOrder = Math.max(0, Math.min(quantityUnits, stillMissing));
  const surplus = quantityUnits - appliedToOrder;
  const newReceived = pending.quantity_received_units + appliedToOrder;
  const completed = newReceived >= pending.quantity_needed_units;

  db.prepare(`
    UPDATE manufacturing_pending SET quantity_received_units = ?, status = ?, completed_at = ?
    WHERE id = ?
  `).run(newReceived, completed ? 'completo' : 'pendiente', completed ? db.prepare("SELECT datetime('now') AS n").get().n : null, pendingId);

  if (surplus > 0) {
    db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity_units, reason, note, related_order_id)
      VALUES (?, 'entrada', ?, 'sobrante_pedido', 'Sobrante de fabricación de este pedido', ?)
    `).run(pending.product_id, surplus, pending.order_id);
  }

  return { completed, pending: db.prepare('SELECT * FROM manufacturing_pending WHERE id = ?').get(pendingId) };
}

// Un pedido está "completo de fabricación" cuando no le queda ningún
// pendiente sin cubrir — se usa para saber si hay que avisarle a Melany
// que ya se puede facturar/despachar.
function isOrderManufacturingComplete(db, orderId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM manufacturing_pending WHERE order_id = ? AND status != 'completo'
  `).get(orderId);
  return row.c === 0;
}

module.exports = {
  applyStockOnOrderConfirm,
  addManufacturingReceipt,
  serializeManufacturingRow,
  isOrderManufacturingComplete,
};
