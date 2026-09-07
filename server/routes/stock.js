const express = require('express');
const { toUnits, unitsToPresentations, getProductStockUnits } = require('../lib/stock');

const REASON_LABELS = {
  fabricacion: 'Fabricación propia',
  venta_externa: 'Venta externa (Damián)',
  ajuste: 'Ajuste por conteo físico',
  uso_pedido: 'Usado en un pedido',
  sobrante_pedido: 'Sobrante de fabricación de un pedido',
  otro: 'Otro',
};

module.exports = function stockRouterFactory(db) {
  const router = express.Router();

  // Catálogo con el stock actual de cada producto, convertido a las
  // presentaciones que tenga habilitadas — para ver todo de un vistazo.
  router.get('/', (req, res) => {
    const { q } = req.query;
    let sql = 'SELECT * FROM products WHERE 1=1';
    const params = [];
    if (q) {
      sql += ' AND (code LIKE ? OR description LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += ' ORDER BY code ASC';
    const products = db.prepare(sql).all(...params);
    const rows = products.map(p => {
      const totalUnits = getProductStockUnits(db, p.id);
      return {
        id: p.id,
        code: p.code,
        description: p.description,
        sale_dozen: p.sale_dozen,
        sale_pack3: p.sale_pack3,
        sale_unit: p.sale_unit,
        total_units: totalUnits,
        presentations: unitsToPresentations(p, totalUnits),
      };
    });
    res.json(rows);
  });

  router.get('/:productId', (req, res) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.productId);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    const totalUnits = getProductStockUnits(db, product.id);
    res.json({
      product,
      total_units: totalUnits,
      presentations: unitsToPresentations(product, totalUnits),
    });
  });

  router.get('/:productId/movements', (req, res) => {
    const rows = db.prepare(`
      SELECT m.*, u.name AS created_by_name, u.username AS created_by_username, o.order_number
      FROM stock_movements m
      LEFT JOIN users u ON u.id = m.created_by
      LEFT JOIN orders o ON o.id = m.related_order_id
      WHERE m.product_id = ?
      ORDER BY m.created_at DESC, m.id DESC
    `).all(req.params.productId);
    res.json(rows);
  });

  // Entrada o salida "suelta": fabricación propia que sobró, venta externa
  // de Damián, o cualquier otro motivo que no viene de un pedido nuestro.
  router.post('/:productId/movements', (req, res) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.productId);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    const { type, presentation, quantity, reason, note } = req.body || {};
    if (type !== 'entrada' && type !== 'salida') {
      return res.status(400).json({ error: 'El tipo tiene que ser "entrada" o "salida"' });
    }
    if (!presentation || !quantity || Number(quantity) <= 0) {
      return res.status(400).json({ error: 'Faltan la presentación y/o la cantidad' });
    }
    let units;
    try {
      units = toUnits(presentation, quantity);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (type === 'salida') units = -units;

    const info = db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity_units, reason, note, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(product.id, type, units, reason || 'otro', note || null, req.currentUser.id);

    const totalUnits = getProductStockUnits(db, product.id);
    res.status(201).json({
      movement: db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(info.lastInsertRowid),
      total_units: totalUnits,
      presentations: unitsToPresentations(product, totalUnits),
    });
  });

  // Ajuste por conteo físico: Darío dice cuánto hay REALMENTE (en una
  // presentación) y el sistema calcula solo la diferencia contra lo que
  // decía el sistema, sin que nadie tenga que restar a mano.
  router.post('/:productId/adjust', (req, res) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.productId);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    const { presentation, real_quantity, note } = req.body || {};
    if (!presentation || real_quantity === undefined || real_quantity === null || Number(real_quantity) < 0) {
      return res.status(400).json({ error: 'Faltan la presentación y/o la cantidad real' });
    }
    let realUnits;
    try {
      realUnits = toUnits(presentation, real_quantity);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const currentUnits = getProductStockUnits(db, product.id);
    const delta = realUnits - currentUnits;

    if (delta !== 0) {
      db.prepare(`
        INSERT INTO stock_movements (product_id, type, quantity_units, reason, note, created_by)
        VALUES (?, 'ajuste', ?, 'ajuste', ?, ?)
      `).run(product.id, delta, note || `Ajuste por conteo físico: ahora hay ${real_quantity} ${presentation}`, req.currentUser.id);
    }

    const totalUnits = getProductStockUnits(db, product.id);
    res.json({
      total_units: totalUnits,
      presentations: unitsToPresentations(product, totalUnits),
    });
  });

  router.put('/movements/:id', (req, res) => {
    const movement = db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(req.params.id);
    if (!movement) return res.status(404).json({ error: 'Movimiento no encontrado' });
    const { presentation, quantity, note } = req.body || {};
    let units = movement.quantity_units;
    if (presentation && quantity !== undefined) {
      try {
        units = toUnits(presentation, quantity);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      if (movement.type === 'salida') units = -units;
    }
    db.prepare('UPDATE stock_movements SET quantity_units = ?, note = ? WHERE id = ?')
      .run(units, note !== undefined ? note : movement.note, movement.id);
    res.json(db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(movement.id));
  });

  router.delete('/movements/:id', (req, res) => {
    const movement = db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(req.params.id);
    if (!movement) return res.status(404).json({ error: 'Movimiento no encontrado' });
    db.prepare('DELETE FROM stock_movements WHERE id = ?').run(movement.id);
    res.json({ ok: true });
  });

  router.get('/meta/reasons', (req, res) => res.json(REASON_LABELS));

  return router;
};
