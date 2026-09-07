const express = require('express');
const PDFDocument = require('pdfkit');
const { unitsToPresentations } = require('../lib/stock');
const { generateManufacturingPdf } = require('../lib/pdf');

// Todo lo pendiente de fabricar, de todos los pedidos juntos — para que
// Darío vea de una "tengo que fabricar en total 90 docenas del artículo
// 1032" en vez de ir pedido por pedido.
module.exports = function manufacturingRouterFactory(db) {
  const router = express.Router();

  function pendingRows() {
    const rows = db.prepare(`
      SELECT mp.*, p.code AS product_code, p.description AS product_description,
             p.sale_dozen, p.sale_pack3, p.sale_unit,
             o.order_number, c.first_name, c.last_name, c.business_name
      FROM manufacturing_pending mp
      JOIN products p ON p.id = mp.product_id
      JOIN orders o ON o.id = mp.order_id
      JOIN clients c ON c.id = o.client_id
      WHERE mp.status != 'completo'
      ORDER BY p.code ASC, mp.id ASC
    `).all();
    return rows.map(r => {
      const missingUnits = r.quantity_needed_units - r.quantity_received_units;
      const product = { sale_dozen: r.sale_dozen, sale_pack3: r.sale_pack3, sale_unit: r.sale_unit };
      const presentations = unitsToPresentations(product, missingUnits);
      const [presentation, quantity_missing] = Object.entries(presentations)[0] || [r.presentation, missingUnits];
      const clientLabel = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.business_name || '';
      return {
        id: r.id,
        order_id: r.order_id,
        order_number: r.order_number,
        client_label: clientLabel,
        product_id: r.product_id,
        product_code: r.product_code,
        product_description: r.product_description,
        presentation,
        quantity_missing,
      };
    });
  }

  router.get('/', (req, res) => res.json(pendingRows()));

  // Arma un solo PDF con lo que se haya elegido (o con todo, si no se
  // manda ninguna selección), agrupado por artículo.
  router.post('/pdf', (req, res) => {
    const { ids } = req.body || {};
    let rows = pendingRows();
    if (Array.isArray(ids) && ids.length > 0) {
      const idSet = new Set(ids.map(Number));
      rows = rows.filter(r => idSet.has(r.id));
    }
    if (rows.length === 0) return res.status(400).json({ error: 'No hay nada pendiente para incluir en el PDF' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="fabricacion-pendiente.pdf"');
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);
    generateManufacturingPdf(doc, {
      title: 'Fabricación pendiente',
      subtitle: `${rows.length} ítem(s)`,
      rows,
      groupByProduct: true,
    });
  });

  return router;
};
