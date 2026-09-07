const express = require('express');
const path = require('path');
const fs = require('fs');
const { generatePreparationPdf, generateQuotePdf, generateManufacturingPdf } = require('../lib/pdf');
const { validateItems } = require('../lib/orderItems');
const { sendPush } = require('../lib/push');
const { addManufacturingReceipt, isOrderManufacturingComplete } = require('../lib/manufacturing');
const { unitsToPresentations, toUnits } = require('../lib/stock');
const PDFDocument = require('pdfkit');

// Verificación mínima de que el archivo generado es un PDF de verdad
// (encabezado %PDF- y algo de contenido) antes de darlo por válido —
// si algo falla en el generador, mejor un error claro en los logs que
// un archivo "listo" que en realidad está roto o vacío.
function assertValidPdf(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 100 || buffer.slice(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error(`El PDF generado en ${filePath} no es válido (tamaño: ${buffer.length} bytes)`);
  }
}

// Flujo nuevo (reemplaza al de 9 pasos anterior): todo pedido nace ya
// confirmado porque viene de un Presupuesto que el cliente aceptó — ya no
// hay paso de "Pedido creado" con confirmar/cancelar a nivel pedido.
const STATUSES = [
  'Pedido confirmado',
  'Enviar a facturación',
  'Facturado',
  'Esperando comprobante',
  'En preparación',
  'Listo para despachar',
  'Despachado',
  'Finalizado',
  'Seguimiento posventa',
];

const FINALIZADO_INDEX = 7; // acá se genera la comisión
const LAST_INDEX = STATUSES.length - 1; // 8, Seguimiento posventa

function createOrderHelpers(db, uploadDir) {
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
      SELECT id, first_name, last_name, business_name, client_number, phone, email,
             fiscal_name, fiscal_id,
             address, locality, postal_code, province,
             shipping_type, shipping_carrier, shipping_address
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
    const quote = order.quote_id ? db.prepare('SELECT id, quote_number, pdf_path FROM quotes WHERE id = ?').get(order.quote_id) : null;
    const calculated_amount = calcOrderAmount(order.id);
    return {
      ...order,
      status_label: order.cancelled ? 'Cancelado' : STATUSES[order.status_index],
      editable: order.status_index === 0 && !order.cancelled,
      items,
      history,
      commission: commission || null,
      client,
      quote,
      calculated_amount,
    };
  }

  function generatePrepPdf(orderId) {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const items = getItems(orderId);
    const client = getClient(order.client_id);
    const seller = getSellerName(order.created_by);
    const filename = `preparacion-${order.order_number}.pdf`;
    const filePath = path.join(uploadDir, filename);
    return generatePreparationPdf(filePath, { order, items, client, seller }).then(() => {
      assertValidPdf(filePath);
      db.prepare('UPDATE orders SET preparation_pdf_path = ? WHERE id = ?').run(`/uploads/${filename}`, orderId);
    });
  }

  // Si cambia el envío de un pedido ya en curso, hay que regenerar tanto el
  // PDF de preparación (usa order.shipping_type/carrier como override) como
  // el PDF del presupuesto/pedido (que arrastra su propia copia de esos
  // campos desde el momento en que se creó, y hay que actualizarla para que
  // no quede desactualizada respecto al pedido real).
  function regenerateOrderPdfs(orderId) {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const tasks = [generatePrepPdf(orderId)];
    if (order.quote_id) {
      const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(order.quote_id);
      if (quote) {
        db.prepare('UPDATE quotes SET shipping_type = ?, shipping_carrier = ?, shipping_address = ? WHERE id = ?')
          .run(order.shipping_type, order.shipping_carrier, order.shipping_address, quote.id);
        const updatedQuote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quote.id);
        const items = getItems(orderId);
        const seller = getSellerName(order.created_by);
        const filename = `presupuesto-${quote.quote_number}.pdf`;
        const filePath = path.join(uploadDir, filename);
        tasks.push(generateQuotePdf(filePath, { quote: updatedQuote, items, seller }).then(() => assertValidPdf(filePath)));
      }
    }
    return Promise.all(tasks);
  }

  return {
    STATUSES, FINALIZADO_INDEX, LAST_INDEX,
    getSettings, nextOrderNumber, calcOrderAmount, otherUserId, notify,
    getItems, getClient, getSellerName, serializeOrder, generatePrepPdf,
    regenerateOrderPdfs, assertValidPdf,
  };
}

function ordersRouterFactory(db, uploadDir, sharedHelpers) {
  const router = express.Router();
  const helpers = sharedHelpers || createOrderHelpers(db, uploadDir);
  const {
    getClient, serializeOrder, generatePrepPdf, calcOrderAmount,
    otherUserId, notify, getSettings, regenerateOrderPdfs,
  } = helpers;

  router.get('/statuses', (req, res) => res.json(STATUSES));

  router.get('/', (req, res) => {
    const { status, q, client_id } = req.query;
    let sql = `
      SELECT o.*, c.first_name, c.last_name, c.business_name, c.client_number, c.phone
      FROM orders o JOIN clients c ON c.id = o.client_id
      WHERE 1=1
    `;
    const params = [];
    if (status !== undefined && status !== '') {
      sql += ' AND o.status_index = ? AND o.cancelled = 0';
      params.push(Number(status));
    }
    if (client_id) {
      sql += ' AND o.client_id = ?';
      params.push(Number(client_id));
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

  // Los ítems del pedido se pueden seguir ajustando mientras está en el
  // primer paso ("Pedido confirmado"), por si hace falta un último cambio
  // que no se hizo a tiempo en el presupuesto.
  router.put('/:id', async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (order.cancelled) return res.status(400).json({ error: 'El pedido está cancelado' });
    if (order.status_index !== 0) {
      return res.status(400).json({ error: 'El pedido ya no se puede editar' });
    }
    const { notes, items, shipping_type, shipping_carrier } = req.body || {};

    let preparedItems = null;
    if (Array.isArray(items)) {
      try {
        preparedItems = validateItems(db, items);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE orders SET notes = ?, shipping_type = ?, shipping_carrier = ?, modified = 1, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        notes !== undefined ? notes : order.notes,
        shipping_type !== undefined ? shipping_type : order.shipping_type,
        shipping_carrier !== undefined ? shipping_carrier : order.shipping_carrier,
        order.id
      );

      if (preparedItems) {
        db.prepare('DELETE FROM order_items WHERE order_id = ?').run(order.id);
        const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, quantity, presentation, unit_price) VALUES (?, ?, ?, ?, ?)');
        preparedItems.forEach(it => insertItem.run(order.id, it.product_id, it.quantity, it.presentation, it.unit_price));
      }
    });
    tx();

    if (preparedItems) {
      try {
        await generatePrepPdf(order.id);
      } catch (err) {
        console.error('Error regenerando PDF de preparación', err);
      }
    }

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    res.json(serializeOrder(updated));
  });

  // El método de envío se puede corregir mientras el pedido está "En
  // preparación" o "Listo para despachar" — por si el cliente lo cambia de
  // último momento, antes de que salga físicamente. Una vez despachado ya
  // no tiene sentido (el paquete ya salió con esos datos).
  router.post('/:id/update-shipping', async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (order.cancelled) return res.status(400).json({ error: 'El pedido está cancelado' });
    if (order.status_index < 4 || order.status_index > 5) {
      return res.status(400).json({ error: 'El método de envío solo se puede modificar mientras el pedido está en preparación o listo para despachar' });
    }
    const { shipping_type, shipping_carrier, shipping_address } = req.body || {};
    if (!shipping_type) return res.status(400).json({ error: 'Falta el tipo de envío' });

    const changed = shipping_type !== order.shipping_type
      || (shipping_carrier || null) !== (order.shipping_carrier || null)
      || (shipping_address || null) !== (order.shipping_address || null);

    if (changed) {
      db.prepare(`
        UPDATE orders SET shipping_type = ?, shipping_carrier = ?, shipping_address = ?, modified = 1, updated_at = datetime('now')
        WHERE id = ?
      `).run(shipping_type, shipping_carrier || null, shipping_address || null, order.id);

      let note = `Método de envío actualizado: ${order.shipping_type || '(sin definir)'}${order.shipping_carrier ? ' (' + order.shipping_carrier + ')' : ''} → ${shipping_type}${shipping_carrier ? ' (' + shipping_carrier + ')' : ''}`;
      db.prepare(`
        INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
        VALUES (?, ?, ?, ?, ?)
      `).run(order.id, order.status_index, order.status_index, req.currentUser.id, note);

      try {
        await regenerateOrderPdfs(order.id);
      } catch (err) {
        console.error('Error regenerando PDFs tras cambiar el envío:', err);
      }
    }

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    res.json(serializeOrder(updated));
  });

  // Se puede cancelar un pedido en cualquier momento de su recorrido
  // (mientras no esté ya cancelado).
  router.post('/:id/cancel', (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (order.cancelled) return res.status(400).json({ error: 'El pedido ya está cancelado' });

    db.prepare("UPDATE orders SET cancelled = 1, updated_at = datetime('now') WHERE id = ?").run(order.id);
    const otherId = otherUserId(req.currentUser.id);
    if (otherId) {
      const message = `${req.currentUser.name || req.currentUser.username} canceló el pedido #${order.order_number}`;
      notify(otherId, 'status_change', order.id, message);
      sendPush(db, [otherId], { title: 'Volpaia', body: message, url: '/?open=pedido&id=' + order.id });
    }

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    res.json(serializeOrder(updated));
  });

  // Mientras el pedido está en "Esperando comprobante", Melany adjunta el
  // comprobante de pago; el botón "Confirmar pago" del frontend llama a
  // este endpoint y después a /advance en la misma acción.
  router.post('/:id/attach-payment', (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (order.cancelled) return res.status(400).json({ error: 'El pedido no admite cambios' });
    if (order.status_index !== 3) return res.status(400).json({ error: 'Solo se puede adjuntar el comprobante en "Esperando comprobante"' });
    const { attachment_url, amount_payment } = req.body || {};
    if (!attachment_url) return res.status(400).json({ error: 'Falta el comprobante de pago' });

    db.prepare(`
      UPDATE orders SET payment_attachment_url = ?, amount_payment = ?, updated_at = datetime('now') WHERE id = ?
    `).run(attachment_url, amount_payment !== undefined && amount_payment !== '' ? Number(amount_payment) : order.amount_payment, order.id);

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    res.json(serializeOrder(updated));
  });

  router.post('/:id/advance', async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (order.cancelled) return res.status(400).json({ error: 'El pedido está cancelado' });
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
      // Pedido confirmado -> Enviar a facturación
      notifyMessage = null;
    } else if (nextIndex === 2) {
      // Enviar a facturación -> Facturado (Factura X + CBU + monto). Acá
      // también se actualiza el número de cliente de nuestro sistema para
      // que sea el mismo que le asignó Damián al facturar (los dos sistemas
      // tienen que quedar con el mismo número para ese cliente).
      if (!body.invoice_attachment_url || !body.cbu) {
        return res.status(400).json({ error: 'Faltan la Factura X y/o el CBU' });
      }
      if (!body.damian_client_number || !String(body.damian_client_number).trim()) {
        return res.status(400).json({ error: 'Falta el número de cliente que puso Damián al facturar' });
      }
      const newClientNumber = Number(String(body.damian_client_number).trim());
      if (!Number.isInteger(newClientNumber) || newClientNumber <= 0) {
        return res.status(400).json({ error: 'El número de cliente de Damián tiene que ser un número entero positivo' });
      }
      const clash = db.prepare('SELECT id FROM clients WHERE client_number = ? AND id != ?').get(newClientNumber, order.client_id);
      if (clash) {
        return res.status(400).json({ error: `El número de cliente ${newClientNumber} ya está usado por otro cliente en nuestro sistema. Revisá cuál es el correcto antes de continuar.` });
      }
      updates.invoice_attachment_url = body.invoice_attachment_url;
      updates.cbu = body.cbu;
      if (body.amount_invoice !== undefined && body.amount_invoice !== '') updates.amount_invoice = Number(body.amount_invoice);
      attachmentUrl = body.invoice_attachment_url;
      notifyMessage = `${req.currentUser.name || req.currentUser.username} cargó la Factura X del pedido #${order.order_number}`;
    } else if (nextIndex === 3) {
      // Facturado -> Esperando comprobante (ya se le mandaron los datos al cliente)
      notifyMessage = null;
    } else if (nextIndex === 4) {
      // Esperando comprobante -> En preparación
      if (!order.payment_attachment_url) {
        return res.status(400).json({ error: 'Todavía no se adjuntó el comprobante de pago' });
      }
      notifyMessage = `${req.currentUser.name || req.currentUser.username} confirmó el pago del pedido #${order.order_number}`;
    } else if (nextIndex === 5) {
      // En preparación -> Listo para despachar
      notifyMessage = `${req.currentUser.name || req.currentUser.username} terminó de preparar el pedido #${order.order_number}`;
    } else if (nextIndex === 6) {
      // Listo para despachar -> Despachado (datos de envío opcionales: a
      // veces no hay número de guía ni comprobante para cargar)
      if (body.shipping_date) updates.shipping_date = body.shipping_date;
      if (body.tracking_number) updates.tracking_number = body.tracking_number;
      if (body.attachment_url) { updates.shipping_proof_photo = body.attachment_url; attachmentUrl = body.attachment_url; }
      notifyMessage = `${req.currentUser.name || req.currentUser.username} despachó el pedido #${order.order_number}`;
    } else if (nextIndex === FINALIZADO_INDEX) {
      // Despachado -> Finalizado (acá se genera la comisión)
      notifyMessage = `${req.currentUser.name || req.currentUser.username} marcó como finalizado el pedido #${order.order_number}`;
    } else if (nextIndex === LAST_INDEX) {
      // Finalizado -> Seguimiento posventa
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

      if (nextIndex === 2 && body.damian_client_number) {
        const newClientNumber = Number(String(body.damian_client_number).trim());
        db.prepare("UPDATE clients SET client_number = ?, updated_at = datetime('now') WHERE id = ?")
          .run(newClientNumber, order.client_id);
        const counter = db.prepare("SELECT value FROM counters WHERE name = 'client_number'").get();
        if (counter && newClientNumber > counter.value) {
          db.prepare("UPDATE counters SET value = ? WHERE name = 'client_number'").run(newClientNumber);
        }
        db.prepare(`
          INSERT INTO order_posventa_history (order_id, action, detail, changed_by)
          VALUES (?, 'client_number_updated', ?, ?)
        `).run(order.id, `Número de cliente actualizado a #${newClientNumber} (dato de Damián)`, req.currentUser.id);
      }

      if (nextIndex === FINALIZADO_INDEX) {
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
        if (otherId) {
          notify(otherId, 'status_change', order.id, notifyMessage);
          sendPush(db, [otherId], { title: 'Volpaia', body: notifyMessage, url: '/?open=pedido&id=' + order.id });
        }
      }
    });
    tx();

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    res.json(serializeOrder(updated));
  });

  router.post('/:id/revert', (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (order.cancelled) return res.status(400).json({ error: 'El pedido está cancelado' });
    if (order.status_index === 0) return res.status(400).json({ error: 'No se puede retroceder desde el primer estado' });

    const prevIndex = order.status_index - 1;
    const wasAtOrAfterFinalizado = order.status_index >= FINALIZADO_INDEX;

    const tx = db.transaction(() => {
      db.prepare("UPDATE orders SET status_index = ?, updated_at = datetime('now') WHERE id = ?").run(prevIndex, order.id);
      db.prepare(`
        INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, is_correction)
        VALUES (?, ?, ?, ?, 1)
      `).run(order.id, order.status_index, prevIndex, req.currentUser.id);

      if (wasAtOrAfterFinalizado && prevIndex < FINALIZADO_INDEX) {
        db.prepare('DELETE FROM commissions WHERE order_id = ?').run(order.id);
      }

      const otherId = otherUserId(req.currentUser.id);
      if (otherId) {
        const message = `${req.currentUser.name || req.currentUser.username} corrigió el pedido #${order.order_number}: volvió a "${STATUSES[prevIndex]}"`;
        notify(otherId, 'status_change', order.id, message);
        sendPush(db, [otherId], { title: 'Volpaia', body: message, url: '/?open=pedido&id=' + order.id });
      }
    });
    tx();

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    res.json(serializeOrder(updated));
  });

  // Pantalla de Posventa: marcar a mano que ya se hizo el contacto de
  // seguimiento 1 (¿llegó bien?) o 2 (¿querés reponer?), por si se hace
  // antes de que dispare el recordatorio automático.
  router.post('/:id/mark-followup', (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    const { which } = req.body || {};
    if (which !== 1 && which !== 2) return res.status(400).json({ error: 'Falta indicar qué seguimiento (1 o 2)' });
    const column = which === 1 ? 'reminder_1_done' : 'reminder_2_done';
    const columnAt = which === 1 ? 'reminder_1_done_at' : 'reminder_2_done_at';
    db.prepare(`UPDATE orders SET ${column} = 1, ${columnAt} = datetime('now') WHERE id = ?`).run(order.id);
    const action = which === 1 ? 'llego_bien' : 'reponer_recordatorio';
    const label = which === 1 ? '¿Llegó bien? — marcado hecho' : '¿Querés reponer? — marcado hecho';
    db.prepare(`
      INSERT INTO order_posventa_history (order_id, action, detail, changed_by) VALUES (?, ?, ?, ?)
    `).run(order.id, action, label, req.currentUser.id);
    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    res.json(serializeOrder(updated));
  });

  // Queda registrado el momento en que el cliente dijo que quiere reponer,
  // por si hace falta consultarlo después.
  router.post('/:id/mark-reponer', (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    db.prepare("UPDATE orders SET reponer_clicked_at = datetime('now') WHERE id = ?").run(order.id);
    db.prepare(`
      INSERT INTO order_posventa_history (order_id, action, detail, changed_by) VALUES (?, 'quiere_reponer', 'Cliente quiere reponer', ?)
    `).run(order.id, req.currentUser.id);
    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    res.json(serializeOrder(updated));
  });

  router.get('/:id/posventa-history', (req, res) => {
    const rows = db.prepare(`
      SELECT h.*, u.name AS changed_by_name, u.username AS changed_by_username
      FROM order_posventa_history h LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.order_id = ? ORDER BY h.created_at DESC, h.id DESC
    `).all(req.params.id);
    res.json(rows);
  });

  // Fabricación pendiente de este pedido puntual (lo que no alcanzó a
  // cubrir el stock al confirmarlo).
  router.get('/:id/manufacturing', (req, res) => {
    const rows = db.prepare(`
      SELECT * FROM manufacturing_pending WHERE order_id = ? ORDER BY id ASC
    `).all(req.params.id);
    const withProducts = rows.map(r => {
      const product = db.prepare('SELECT id, code, description, sale_dozen, sale_pack3, sale_unit FROM products WHERE id = ?').get(r.product_id);
      const receipts = db.prepare(`
        SELECT rc.*, u.name AS created_by_name FROM manufacturing_receipts rc
        LEFT JOIN users u ON u.id = rc.created_by
        WHERE rc.manufacturing_pending_id = ? ORDER BY rc.created_at ASC
      `).all(r.id);
      return { ...r, product, receipts };
    });
    res.json(withProducts);
  });

  router.post('/manufacturing/:pendingId/receipt', (req, res) => {
    const pending = db.prepare('SELECT * FROM manufacturing_pending WHERE id = ?').get(req.params.pendingId);
    if (!pending) return res.status(404).json({ error: 'No se encontró ese pendiente de fabricación' });
    const { presentation, quantity, note } = req.body || {};
    if (!presentation || !quantity || Number(quantity) <= 0) {
      return res.status(400).json({ error: 'Faltan la presentación y/o la cantidad' });
    }
    let units;
    try {
      units = toUnits(presentation, quantity);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    let result;
    try {
      result = addManufacturingReceipt(db, pending.id, units, note, req.currentUser.id);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    if (result.completed) {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(pending.order_id);
      const product = db.prepare('SELECT code, description FROM products WHERE id = ?').get(pending.product_id);
      const allDone = isOrderManufacturingComplete(db, pending.order_id);
      const message = allDone
        ? `Darío marcó como lista la fabricación del pedido #${order.order_number} — ya se puede avisar al cliente`
        : `Darío completó la fabricación de ${product.code || ''} - ${product.description || ''} del pedido #${order.order_number}`;
      const otherId = otherUserId(req.currentUser.id);
      if (otherId) {
        notify(otherId, 'status_change', order.id, message);
        sendPush(db, [otherId], { title: 'Volpaia', body: message, url: '/?open=pedido&id=' + order.id });
      }
    }

    res.json(result.pending);
  });

  // PDF de fabricación pendiente de este pedido, para que Darío lo
  // imprima — se genera al vuelo, no se guarda en el servidor.
  router.get('/:id/manufacturing-pdf', (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    const client = getClient(order.client_id);
    const pending = db.prepare(`
      SELECT * FROM manufacturing_pending WHERE order_id = ? AND status != 'completo' ORDER BY id ASC
    `).all(order.id);
    const rows = pending.map(p => {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(p.product_id);
      const missingUnits = p.quantity_needed_units - p.quantity_received_units;
      const presentations = unitsToPresentations(product, missingUnits);
      const [presentation, quantity_missing] = Object.entries(presentations)[0] || [p.presentation, missingUnits];
      return { product_id: product.id, product_code: product.code, product_description: product.description, presentation, quantity_missing };
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="fabricacion-pedido-${order.order_number}.pdf"`);
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);
    generateManufacturingPdf(doc, {
      title: 'Fabricación pendiente',
      subtitle: `Pedido #${order.order_number} — ${[client.first_name, client.last_name].filter(Boolean).join(' ')}`,
      rows,
      groupByProduct: false,
    });
  });

  return router;
}

module.exports = ordersRouterFactory;
module.exports.STATUSES = STATUSES;
module.exports.FINALIZADO_INDEX = FINALIZADO_INDEX;
module.exports.LAST_INDEX = LAST_INDEX;
module.exports.createOrderHelpers = createOrderHelpers;
