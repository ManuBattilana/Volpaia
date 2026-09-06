const ORDER_STATUSES = [
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

const PRESENTATIONS = [
  { key: 'Docena', enabledField: 'sale_dozen', priceField: 'price_dozen' },
  { key: 'Pack x3', enabledField: 'sale_pack3', priceField: 'price_pack3' },
  { key: 'Unidad', enabledField: 'sale_unit', priceField: 'price_unit' },
];

function allowedPresentations(product) {
  return PRESENTATIONS.filter(p => !!product[p.enabledField]);
}

const OrdersState = { statusFilter: '', search: '' };

async function renderPedidosList(container, onOpen, onNew) {
  container.innerHTML = `
    <div class="page-header">
      <h2>Pedidos</h2>
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-new-order">+ Nuevo pedido</button>
      </div>
    </div>
    <div class="search-bar">
      <input type="text" id="order-search" placeholder="Buscar por cliente o número de pedido...">
      <select id="order-status-filter" style="padding:11px 14px;border-radius:8px;border:1px solid var(--border);background:var(--white);">
        <option value="">Todos los estados</option>
        ${ORDER_STATUSES.map((s, i) => `<option value="${i}">${s}</option>`).join('')}
      </select>
    </div>
    <div id="orders-container"><div class="empty-state">Cargando...</div></div>
  `;

  document.getElementById('btn-new-order').addEventListener('click', onNew);

  const searchInput = document.getElementById('order-search');
  const statusSelect = document.getElementById('order-status-filter');
  searchInput.value = OrdersState.search;
  statusSelect.value = OrdersState.statusFilter;

  let timer;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { OrdersState.search = searchInput.value.trim(); refresh(); }, 250);
  });
  statusSelect.addEventListener('change', () => { OrdersState.statusFilter = statusSelect.value; refresh(); });

  async function refresh() {
    const params = new URLSearchParams();
    if (OrdersState.search) params.set('q', OrdersState.search);
    if (OrdersState.statusFilter !== '') params.set('status', OrdersState.statusFilter);
    const orders = await Api.get('/api/orders?' + params.toString());
    const listEl = document.getElementById('orders-container');
    if (orders.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No se encontraron pedidos.</div>`;
      return;
    }
    listEl.innerHTML = `<div class="list-view">${orders.map(orderRow).join('')}</div>`;
    listEl.querySelectorAll('.order-row').forEach(el => {
      el.addEventListener('click', () => onOpen(Number(el.dataset.id)));
    });
  }

  await refresh();
}

function orderRow(o) {
  const name = [o.first_name, o.last_name].filter(Boolean).join(' ') || '(Sin nombre)';
  const clientLabel = o.business_name ? `${name} — ${o.business_name}` : name;
  return `
    <div class="client-card order-row" data-id="${o.id}" style="cursor:pointer;">
      <div class="client-info">
        <div><span class="client-num">#${o.order_number}</span><span class="client-name">${escapeHtml(clientLabel)}</span></div>
        <div class="client-location">${escapeHtml(o.status_label)} · ${formatMoney(o.calculated_amount)}</div>
      </div>
      <span class="stock-badge" style="background:#f0d3de;color:var(--pink-dark);">${escapeHtml(o.status_label)}</span>
    </div>
  `;
}

async function renderPedidoForm(container, onBack, onCreated) {
  let selectedClient = null;
  const items = [];

  container.innerHTML = `
    <button class="btn btn-secondary" id="btn-back" style="margin-bottom:16px;">← Volver</button>
    <div class="page-header"><h2>Nuevo pedido</h2></div>

    <div class="detail-section">
      <h3>Cliente</h3>
      <div id="client-picker">
        <input type="text" id="client-search" placeholder="Buscar cliente por nombre o emprendimiento...">
        <div id="client-results" style="margin-top:8px;"></div>
      </div>
      <div id="client-selected" style="display:none;margin-top:10px;font-weight:600;color:var(--pink-dark);"></div>
    </div>

    <div class="detail-section">
      <h3>Productos</h3>
      <input type="text" id="product-search" placeholder="Buscar producto por código o descripción...">
      <div id="product-results" style="margin-top:8px;"></div>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;" id="items-table">
        <thead>
          <tr style="text-align:left;border-bottom:2px solid var(--border);">
            <th style="padding:8px 4px;">Producto</th>
            <th style="padding:8px 4px;">Presentación</th>
            <th style="padding:8px 4px;">Cantidad</th>
            <th style="padding:8px 4px;">Precio unit.</th>
            <th style="padding:8px 4px;">Subtotal</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="items-body"></tbody>
      </table>
      <div style="text-align:right;font-weight:700;color:var(--pink-dark);margin-top:10px;font-size:16px;" id="items-total"></div>
    </div>

    <div class="detail-section">
      <h3>Notas</h3>
      <textarea id="order-notes" rows="3" style="width:100%;padding:10px;border-radius:7px;border:1px solid var(--border);background:var(--pink-light);font-family:inherit;"></textarea>
    </div>

    <button class="btn btn-primary" id="btn-save-order">Crear pedido</button>
  `;

  document.getElementById('btn-back').addEventListener('click', onBack);

  const clientSearch = document.getElementById('client-search');
  let clientTimer;
  clientSearch.addEventListener('input', () => {
    clearTimeout(clientTimer);
    clientTimer = setTimeout(async () => {
      const q = clientSearch.value.trim();
      if (!q) { document.getElementById('client-results').innerHTML = ''; return; }
      const results = await Api.get('/api/clients?q=' + encodeURIComponent(q));
      const resultsEl = document.getElementById('client-results');
      resultsEl.innerHTML = results.slice(0, 8).map(c => {
        const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
        return `<div class="product-list-row" data-client-id="${c.id}" style="padding:8px 12px;margin-bottom:4px;">
          <div class="info"><strong>#${c.client_number} ${escapeHtml(name)}</strong>${c.business_name ? ' — ' + escapeHtml(c.business_name) : ''}</div>
        </div>`;
      }).join('') || '<div class="empty-state" style="padding:12px;">Sin resultados</div>';
      resultsEl.querySelectorAll('[data-client-id]').forEach(el => {
        el.addEventListener('click', () => {
          const c = results.find(r => r.id === Number(el.dataset.clientId));
          selectedClient = c;
          const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
          document.getElementById('client-selected').style.display = 'block';
          document.getElementById('client-selected').textContent = `Cliente seleccionado: #${c.client_number} ${name}${c.business_name ? ' — ' + c.business_name : ''}`;
          resultsEl.innerHTML = '';
          clientSearch.value = '';
        });
      });
    }, 250);
  });

  const productSearch = document.getElementById('product-search');
  let productTimer;
  productSearch.addEventListener('input', () => {
    clearTimeout(productTimer);
    productTimer = setTimeout(async () => {
      const q = productSearch.value.trim();
      if (!q) { document.getElementById('product-results').innerHTML = ''; return; }
      const results = await Api.get('/api/products?q=' + encodeURIComponent(q));
      const resultsEl = document.getElementById('product-results');
      resultsEl.innerHTML = results.slice(0, 8).map(p => `
        <div class="product-list-row" data-product-id="${p.id}" style="padding:8px 12px;margin-bottom:4px;">
          <div class="info"><strong>${escapeHtml(p.code || 'Sin código')}</strong> — ${escapeHtml(p.description || '')}</div>
        </div>
      `).join('') || '<div class="empty-state" style="padding:12px;">Sin resultados</div>';
      resultsEl.querySelectorAll('[data-product-id]').forEach(el => {
        el.addEventListener('click', () => {
          const p = results.find(r => r.id === Number(el.dataset.productId));
          const allowed = allowedPresentations(p);
          if (allowed.length === 0) {
            alert(`El producto ${p.code} no tiene ninguna presentación de venta habilitada.`);
            return;
          }
          items.push({ product: p, presentation: allowed[0].key, quantity: 1 });
          drawItems();
          resultsEl.innerHTML = '';
          productSearch.value = '';
        });
      });
    }, 250);
  });

  function drawItems() {
    const body = document.getElementById('items-body');
    body.innerHTML = items.map((it, idx) => {
      const allowed = allowedPresentations(it.product);
      const priceField = PRESENTATIONS.find(p => p.key === it.presentation).priceField;
      const unitPrice = it.product[priceField];
      const subtotal = unitPrice * it.quantity;
      return `
        <tr data-idx="${idx}" style="border-bottom:1px solid var(--border);">
          <td style="padding:8px 4px;">${escapeHtml(it.product.code || '')}</td>
          <td style="padding:8px 4px;">
            <select data-role="presentation" style="padding:6px;border-radius:6px;border:1px solid var(--border);">
              ${allowed.map(p => `<option value="${p.key}" ${p.key === it.presentation ? 'selected' : ''}>${p.key}</option>`).join('')}
            </select>
          </td>
          <td style="padding:8px 4px;"><input type="number" min="1" step="1" data-role="quantity" value="${it.quantity}" style="width:70px;padding:6px;border-radius:6px;border:1px solid var(--border);"></td>
          <td style="padding:8px 4px;">${formatMoney(unitPrice)}</td>
          <td style="padding:8px 4px;font-weight:600;">${formatMoney(subtotal)}</td>
          <td style="padding:8px 4px;"><button class="btn btn-danger" data-role="remove" style="padding:4px 10px;font-size:12px;">×</button></td>
        </tr>
      `;
    }).join('');

    body.querySelectorAll('tr').forEach(row => {
      const idx = Number(row.dataset.idx);
      row.querySelector('[data-role="presentation"]').addEventListener('change', (e) => {
        items[idx].presentation = e.target.value;
        drawItems();
      });
      row.querySelector('[data-role="quantity"]').addEventListener('input', (e) => {
        items[idx].quantity = Number(e.target.value) || 1;
        drawItems();
      });
      row.querySelector('[data-role="remove"]').addEventListener('click', () => {
        items.splice(idx, 1);
        drawItems();
      });
    });

    const total = items.reduce((sum, it) => {
      const priceField = PRESENTATIONS.find(p => p.key === it.presentation).priceField;
      return sum + it.product[priceField] * it.quantity;
    }, 0);
    document.getElementById('items-total').textContent = 'Total: ' + formatMoney(total);
  }

  document.getElementById('btn-save-order').addEventListener('click', async () => {
    if (!selectedClient) { alert('Elegí un cliente para el pedido'); return; }
    if (items.length === 0) { alert('Agregá al menos un producto'); return; }
    const payload = {
      client_id: selectedClient.id,
      notes: document.getElementById('order-notes').value,
      items: items.map(it => ({ product_id: it.product.id, presentation: it.presentation, quantity: it.quantity }))
    };
    try {
      const order = await Api.post('/api/orders', payload);
      onCreated(order.id);
    } catch (err) {
      alert(err.message);
    }
  });
}

function amountsMismatch(order) {
  const values = [order.calculated_amount, order.amount_invoice, order.amount_payment].filter(v => v !== null && v !== undefined && v !== '');
  if (values.length < 2) return false;
  const rounded = values.map(v => Math.round(Number(v) * 100));
  return !rounded.every(v => v === rounded[0]);
}

async function renderPedidoDetail(container, orderId, currentUser, onBack) {
  let order = await Api.get(`/api/orders/${orderId}`);

  function draw() {
    const nextIndex = order.status_index + 1;
    const isFinal = order.status_index >= ORDER_STATUSES.length - 1;
    const canRevert = currentUser.role === 'owner' && order.status_index > 0;
    const clientName = order.client ? [order.client.first_name, order.client.last_name].filter(Boolean).join(' ') : '';
    const phoneDigits = (order.client && order.client.phone || '').replace(/[^0-9]/g, '');

    container.innerHTML = `
      <button class="btn btn-secondary" id="btn-back" style="margin-bottom:16px;">← Volver</button>
      <div class="detail-header">
        <div class="detail-title">
          <div class="eyebrow">PEDIDO #${order.order_number} · ${escapeHtml(order.status_label)}</div>
          <h1>${escapeHtml(clientName)}${order.client && order.client.business_name ? ' — ' + escapeHtml(order.client.business_name) : ''}</h1>
        </div>
        <div class="detail-actions">
          ${phoneDigits ? `<a class="whatsapp-btn-large" href="https://wa.me/${phoneDigits}" target="_blank">${WhatsappIcon} WhatsApp</a>` : ''}
          ${canRevert ? '<button class="btn btn-ghost" id="btn-revert">← Corregir (retroceder)</button>' : ''}
        </div>
      </div>

      ${amountsMismatch(order) ? `
        <div class="detail-section" style="border:2px solid #ef6c00;background:#fff3e0;">
          <strong style="color:#ef6c00;">⚠ Los montos no coinciden</strong>
          <div style="margin-top:6px;font-size:14px;">
            Calculado: ${formatMoney(order.calculated_amount)}
            ${order.amount_invoice !== null ? ' · Factura: ' + formatMoney(order.amount_invoice) : ''}
            ${order.amount_payment !== null ? ' · Pago: ' + formatMoney(order.amount_payment) : ''}
          </div>
        </div>
      ` : ''}

      <div class="detail-section">
        <h3>Productos</h3>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="text-align:left;border-bottom:2px solid var(--border);">
              <th style="padding:8px 4px;">Producto</th>
              <th style="padding:8px 4px;">Presentación</th>
              <th style="padding:8px 4px;">Cantidad</th>
              <th style="padding:8px 4px;">Precio unit.</th>
              <th style="padding:8px 4px;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${order.items.map(it => `
              <tr style="border-bottom:1px solid var(--border);">
                <td style="padding:8px 4px;">${escapeHtml(it.product_code || '')} — ${escapeHtml(it.product_description || '')}</td>
                <td style="padding:8px 4px;">${escapeHtml(it.presentation)}</td>
                <td style="padding:8px 4px;">${it.quantity}</td>
                <td style="padding:8px 4px;">${formatMoney(it.unit_price)}</td>
                <td style="padding:8px 4px;font-weight:600;">${formatMoney(it.unit_price * it.quantity)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div style="text-align:right;font-weight:700;color:var(--pink-dark);margin-top:10px;font-size:16px;">
          Monto calculado: ${formatMoney(order.calculated_amount)}
        </div>
        ${order.notes ? `<div style="margin-top:14px;"><label style="font-size:12px;color:var(--text-muted);font-weight:600;">Notas</label><div>${escapeHtml(order.notes).replace(/\n/g, '<br>')}</div></div>` : ''}
      </div>

      ${order.commission ? `
        <div class="detail-section">
          <h3>Comisión</h3>
          <div>Base: ${formatMoney(order.commission.base_amount)} · ${order.commission.percentage}% = <strong>${formatMoney(order.commission.amount)}</strong></div>
        </div>
      ` : ''}

      ${!isFinal ? `
        <div class="detail-section" id="advance-section">
          <h3>Avanzar a: ${escapeHtml(ORDER_STATUSES[nextIndex])}</h3>
          <div id="advance-fields"></div>
          <button class="btn btn-primary" id="btn-advance" style="margin-top:14px;">Confirmar avance</button>
        </div>
      ` : `
        <div class="detail-section"><strong>Pedido en seguimiento posventa.</strong></div>
      `}

      <div class="detail-section">
        <h3>Historial</h3>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${order.history.map(h => `
            <div style="border-left:3px solid var(--pink-dark);padding-left:12px;">
              <div style="font-size:13.5px;">
                ${h.is_correction ? '<strong style="color:#ef6c00;">Corrección:</strong> ' : ''}
                ${h.from_status !== null ? escapeHtml(ORDER_STATUSES[h.from_status]) + ' → ' : ''}<strong>${escapeHtml(ORDER_STATUSES[h.to_status])}</strong>
              </div>
              <div style="font-size:12px;color:var(--text-muted);">
                ${escapeHtml(h.changed_by_name || h.changed_by_username || '')} · ${escapeHtml(h.changed_at)}
                ${h.attachment_url ? ` · <a href="${h.attachment_url}" target="_blank">Ver adjunto</a>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', onBack);

    const revertBtn = document.getElementById('btn-revert');
    if (revertBtn) {
      revertBtn.addEventListener('click', () => {
        confirmModal({
          title: 'Corregir estado',
          message: `¿Retroceder el pedido #${order.order_number} de "${order.status_label}" a "${ORDER_STATUSES[order.status_index - 1]}"?`,
          confirmLabel: 'Retroceder',
          onConfirm: async () => {
            try {
              order = await Api.post(`/api/orders/${order.id}/revert`);
              draw();
            } catch (err) {
              alert(err.message);
            }
          }
        });
      });
    }

    if (!isFinal) drawAdvanceFields(nextIndex);
  }

  function drawAdvanceFields(nextIndex) {
    const fieldsEl = document.getElementById('advance-fields');
    let html = '';
    let needsAttachment = false;
    let attachmentLabel = '';

    if (nextIndex === 3) {
      needsAttachment = true;
      attachmentLabel = 'Factura X (foto o PDF)';
      html += `<div class="field"><label>Monto de la Factura X</label><input type="number" step="0.01" id="field-amount-invoice"></div>`;
    } else if (nextIndex === 6) {
      needsAttachment = true;
      attachmentLabel = 'Comprobante de pago';
      html += `<div class="field"><label>Monto del comprobante de pago</label><input type="number" step="0.01" id="field-amount-payment"></div>`;
    } else if (nextIndex === 9) {
      needsAttachment = true;
      attachmentLabel = 'Comprobante de envío';
      html += `
        <div class="field"><label>Fecha de despacho</label><input type="date" id="field-shipping-date" value="${new Date().toISOString().slice(0,10)}"></div>
        <div class="field"><label>Número de guía</label><input type="text" id="field-tracking"></div>
      `;
    }

    if (needsAttachment) {
      html += `<div class="field full"><label>${attachmentLabel}</label><input type="file" id="field-attachment" accept="image/*,application/pdf"></div>`;
    }

    fieldsEl.innerHTML = html || '<p style="color:var(--text-muted);font-size:14px;">No se requieren datos adicionales para este paso.</p>';

    document.getElementById('btn-advance').addEventListener('click', async () => {
      const body = {};
      const fileInput = document.getElementById('field-attachment');
      if (needsAttachment) {
        const file = fileInput && fileInput.files[0];
        if (!file) { alert(`Falta adjuntar: ${attachmentLabel}`); return; }
        try {
          const uploaded = await Api.upload('/api/upload', file);
          body.attachment_url = uploaded.url;
        } catch (err) {
          alert(err.message);
          return;
        }
      }
      const amountInvoiceEl = document.getElementById('field-amount-invoice');
      if (amountInvoiceEl && amountInvoiceEl.value) body.amount_invoice = amountInvoiceEl.value;
      const amountPaymentEl = document.getElementById('field-amount-payment');
      if (amountPaymentEl && amountPaymentEl.value) body.amount_payment = amountPaymentEl.value;
      const shippingDateEl = document.getElementById('field-shipping-date');
      if (shippingDateEl) body.shipping_date = shippingDateEl.value;
      const trackingEl = document.getElementById('field-tracking');
      if (trackingEl) {
        if (!trackingEl.value.trim()) { alert('Falta el número de guía'); return; }
        body.tracking_number = trackingEl.value.trim();
      }

      try {
        order = await Api.post(`/api/orders/${order.id}/advance`, body);
        draw();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  draw();
}
