const express = require('express');
const path = require('path');
const { generateQuotePdf } = require('../lib/pdf');
const { validateItems } = require('../lib/orderItems');
const { sendPush } = require('../lib/push');
const { applyStockOnOrderConfirm } = require('../lib/manufacturing');

// Campos "de cliente" que vive en el Presupuesto — se completan a mano
// cuando el origen es un Contacto (le faltan datos fiscales/de envío), o
// se precargan ya completos cuando el origen es un Cliente existente.
const PERSON_FIELDS = [
  'first_name', 'last_name', 'business_name',
  'fiscal_name', 'fiscal_id', 'email', 'phone',
  'address', 'locality', 'postal_code', 'province',
  'shipping_type', 'shipping_carrier', 'shipping_address',
];

module.exports = function quotesRouterFactory(db, uploadDir, orderHelpers) {
  const router = express.Router();
  const { assertValidPdf, getSellerName, generatePrepPdf, nextOrderNumber, otherUserId, notify } = orderHelpers;

  function nextQuoteNumber() {
    const tx = db.transaction(() => {
      db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'quote_number'").run();
      return db.prepare("SELECT value FROM counters WHERE name = 'quote_number'").get().value;
    });
    return tx();
  }

  function nextClientNumber() {
    const tx = db.transaction(() => {
      db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'client_number'").run();
      return db.prepare("SELECT value FROM counters WHERE name = 'client_number'").get().value;
    });
    return tx();
  }

  function getQuoteItems(quoteId) {
    return db.prepare(`
      SELECT qi.*, p.code AS product_code, p.description AS product_description
      FROM quote_items qi JOIN products p ON p.id = qi.product_id
      WHERE qi.quote_id = ?
      ORDER BY qi.id ASC
    `).all(quoteId);
  }

  function calcQuoteAmount(quoteId) {
    const row = db.prepare('SELECT COALESCE(SUM(quantity * unit_price), 0) AS total FROM quote_items WHERE quote_id = ?').get(quoteId);
    return row.total;
  }

  function serializeQuote(quote) {
    return {
      ...quote,
      items: getQuoteItems(quote.id),
      calculated_amount: calcQuoteAmount(quote.id),
    };
  }

  function regenerateQuotePdf(quoteId) {
    const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId);
    const items = getQuoteItems(quoteId);
    const seller = getSellerName(quote.created_by);
    const filename = `presupuesto-${quote.quote_number}.pdf`;
    const filePath = path.join(uploadDir, filename);
    return generateQuotePdf(filePath, { quote, items, seller }).then(() => {
      assertValidPdf(filePath);
      db.prepare('UPDATE quotes SET pdf_path = ? WHERE id = ?').run(`/uploads/${filename}`, quoteId);
    });
  }

  router.get('/', (req, res) => {
    const { status, q, client_id, contact_id } = req.query;
    let sql = 'SELECT * FROM quotes WHERE 1=1';
    const params = [];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (client_id) { sql += ' AND client_id = ?'; params.push(Number(client_id)); }
    if (contact_id) { sql += ' AND contact_id = ?'; params.push(Number(contact_id)); }
    if (q) {
      sql += ` AND (first_name LIKE ? OR last_name LIKE ? OR business_name LIKE ? OR CAST(quote_number AS TEXT) LIKE ?)`;
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    sql += ' ORDER BY created_at DESC';
    const rows = db.prepare(sql).all(...params);
    res.json(rows.map(r => ({ ...r, calculated_amount: calcQuoteAmount(r.id) })));
  });

  router.get('/:id', (req, res) => {
    const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    res.json(serializeQuote(quote));
  });

  router.post('/', async (req, res) => {
    const body = req.body || {};
    const { source, contact_id, client_id, items, notes } = body;
    if (source !== 'contact' && source !== 'client') {
      return res.status(400).json({ error: 'Falta indicar el origen del presupuesto (contacto o cliente)' });
    }
    if (source === 'contact' && !contact_id) return res.status(400).json({ error: 'Falta el contacto' });
    if (source === 'client' && !client_id) return res.status(400).json({ error: 'Falta el cliente' });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'El presupuesto necesita al menos un producto' });
    }

    let preparedItems;
    try {
      preparedItems = validateItems(db, items);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const quoteNumber = nextQuoteNumber();
    const personValues = PERSON_FIELDS.map(f => body[f] ?? null);

    const tx = db.transaction(() => {
      const cols = ['quote_number', 'contact_id', 'client_id', 'notes', 'created_by', ...PERSON_FIELDS];
      const values = [quoteNumber, source === 'contact' ? contact_id : null, source === 'client' ? client_id : null, notes || null, req.currentUser.id, ...personValues];
      const placeholders = cols.map(() => '?').join(',');
      const info = db.prepare(`INSERT INTO quotes (${cols.join(',')}) VALUES (${placeholders})`).run(...values);
      const quoteId = info.lastInsertRowid;
      const insertItem = db.prepare('INSERT INTO quote_items (quote_id, product_id, quantity, presentation, unit_price) VALUES (?, ?, ?, ?, ?)');
      preparedItems.forEach(it => insertItem.run(quoteId, it.product_id, it.quantity, it.presentation, it.unit_price));
      return quoteId;
    });
    const quoteId = tx();

    try {
      await regenerateQuotePdf(quoteId);
    } catch (err) {
      console.error('Error generando PDF del presupuesto', err);
    }

    const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId);
    res.status(201).json(serializeQuote(quote));
  });

  router.put('/:id', async (req, res) => {
    const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    if (quote.status !== 'Pendiente') return res.status(400).json({ error: 'Este presupuesto ya no se puede editar' });

    const body = req.body || {};
    const { items, notes } = body;

    let preparedItems = null;
    if (Array.isArray(items)) {
      try {
        preparedItems = validateItems(db, items);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    const tx = db.transaction(() => {
      const sets = [...PERSON_FIELDS.map(f => `${f} = ?`), 'notes = ?', "updated_at = datetime('now')"];
      const values = [...PERSON_FIELDS.map(f => (body[f] !== undefined ? body[f] : quote[f])), notes !== undefined ? notes : quote.notes];
      db.prepare(`UPDATE quotes SET ${sets.join(', ')} WHERE id = ?`).run(...values, quote.id);

      if (preparedItems) {
        db.prepare('DELETE FROM quote_items WHERE quote_id = ?').run(quote.id);
        const insertItem = db.prepare('INSERT INTO quote_items (quote_id, product_id, quantity, presentation, unit_price) VALUES (?, ?, ?, ?, ?)');
        preparedItems.forEach(it => insertItem.run(quote.id, it.product_id, it.quantity, it.presentation, it.unit_price));
      }
    });
    tx();

    try {
      await regenerateQuotePdf(quote.id);
    } catch (err) {
      console.error('Error regenerando PDF del presupuesto', err);
    }

    const updated = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quote.id);
    res.json(serializeQuote(updated));
  });

  router.post('/:id/reject', (req, res) => {
    const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    if (quote.status !== 'Pendiente') return res.status(400).json({ error: 'Este presupuesto ya no está pendiente' });
    db.prepare("UPDATE quotes SET status = 'Rechazado', updated_at = datetime('now') WHERE id = ?").run(quote.id);
    res.json(serializeQuote(db.prepare('SELECT * FROM quotes WHERE id = ?').get(quote.id)));
  });

  // El cliente aceptó el presupuesto: si venía de un Contacto se crea el
  // Cliente (con su numeración correlativa) y se marca el contacto como
  // convertido; si ya era un Cliente existente, se actualizan sus datos
  // con lo que se haya corregido en el presupuesto. En los dos casos nace
  // el Pedido, ya en "Pedido confirmado", reusando el PDF del presupuesto.
  router.post('/:id/confirm', async (req, res) => {
    const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    if (quote.status !== 'Pendiente') return res.status(400).json({ error: 'Este presupuesto ya fue confirmado o rechazado' });

    const items = getQuoteItems(quote.id);
    if (items.length === 0) return res.status(400).json({ error: 'El presupuesto no tiene productos' });

    // nextClientNumber()/nextOrderNumber() abren su propia transacción cada
    // una (ver server/db.js), así que hay que resolverlas ANTES de entrar a
    // la transacción de abajo — sql.js no admite transacciones anidadas.
    const orderNumber = nextOrderNumber();
    const clientNumber = quote.client_id ? null : nextClientNumber();
    const contact = quote.contact_id ? db.prepare('SELECT status FROM contacts WHERE id = ?').get(quote.contact_id) : null;

    const tx = db.transaction(() => {
      let clientId = quote.client_id;
      if (!clientId) {
        const cols = ['client_number', ...PERSON_FIELDS];
        const values = [clientNumber, ...PERSON_FIELDS.map(f => quote[f])];
        const placeholders = cols.map(() => '?').join(',');
        const info = db.prepare(`INSERT INTO clients (${cols.join(',')}) VALUES (${placeholders})`).run(...values);
        clientId = info.lastInsertRowid;
        if (quote.contact_id) {
          db.prepare("UPDATE contacts SET status = 'Convertido', converted_client_id = ?, updated_at = datetime('now') WHERE id = ?")
            .run(clientId, quote.contact_id);
          db.prepare('INSERT INTO contact_status_history (contact_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?)')
            .run(quote.contact_id, contact ? contact.status : null, 'Convertido', req.currentUser.id);
        }
      } else {
        const sets = PERSON_FIELDS.map(f => `${f} = ?`).join(', ');
        const values = PERSON_FIELDS.map(f => quote[f]);
        db.prepare(`UPDATE clients SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...values, clientId);
      }

      const orderInfo = db.prepare(`
        INSERT INTO orders (order_number, client_id, status_index, notes, created_by, shipping_type, shipping_carrier, quote_id, order_pdf_path)
        VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)
      `).run(orderNumber, clientId, quote.notes, req.currentUser.id, quote.shipping_type, quote.shipping_carrier, quote.id, quote.pdf_path);
      const orderId = orderInfo.lastInsertRowid;
      const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, quantity, presentation, unit_price) VALUES (?, ?, ?, ?, ?)');
      items.forEach(it => insertItem.run(orderId, it.product_id, it.quantity, it.presentation, it.unit_price));
      db.prepare('INSERT INTO order_status_history (order_id, from_status, to_status, changed_by) VALUES (?, NULL, 0, ?)')
        .run(orderId, req.currentUser.id);

      db.prepare(`
        UPDATE quotes SET status = 'Confirmado', client_id = ?, converted_client_id = ?, converted_order_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(clientId, clientId, orderId, quote.id);

      return orderId;
    });

    const orderId = tx();

    // Recién acá, con el pedido ya creado (sql.js no admite transacciones
    // anidadas, por eso esto va fuera de la de arriba): se usa el stock
    // disponible para cubrir lo que se pueda de cada ítem, y lo que falte
    // queda como fabricación pendiente para que Darío lo vea.
    try {
      applyStockOnOrderConfirm(db, orderId);
    } catch (err) {
      console.error('Error aplicando stock al confirmar el pedido:', err);
    }

    try {
      await generatePrepPdf(orderId);
    } catch (err) {
      console.error('Error generando PDF de preparación', err);
    }

    const otherId = otherUserId(req.currentUser.id);
    if (otherId) {
      const clientLabel = [quote.first_name, quote.last_name].filter(Boolean).join(' ') || quote.business_name || `presupuesto #${quote.quote_number}`;
      const message = `Hay un pedido nuevo #${orderNumber} (${clientLabel})`;
      notify(otherId, 'status_change', orderId, message);
      sendPush(db, [otherId], { title: 'Volpaia', body: message, url: '/?open=pedido&id=' + orderId });
    }

    const updatedQuote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quote.id);
    res.status(201).json({ quote: serializeQuote(updatedQuote), order_id: orderId });
  });

  return router;
};
