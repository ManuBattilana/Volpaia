const ORDER_STATUSES = [
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
const LAST_INDEX = ORDER_STATUSES.length - 1;

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
        <option value="cancelled">Cancelados</option>
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
    if (OrdersState.statusFilter !== '' && OrdersState.statusFilter !== 'cancelled') params.set('status', OrdersState.statusFilter);
    let orders = await Api.get('/api/orders?' + params.toString());
    if (OrdersState.statusFilter === 'cancelled') orders = orders.filter(o => o.cancelled);
    else orders = orders.filter(o => !o.cancelled);
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
  const label = o.cancelled ? 'Cancelado' : o.status_label;
  return `
    <div class="client-card order-row" data-id="${o.id}" style="cursor:pointer;">
      <div class="client-info">
        <div><span class="client-num">#${o.order_number}</span><span class="client-name">${escapeHtml(clientLabel)}</span>${o.modified && !o.cancelled ? ' <span class="stock-badge order">Modificado</span>' : ''}</div>
        <div class="client-location">${escapeHtml(label)} · ${formatMoney(o.calculated_amount)}</div>
      </div>
      <span class="stock-badge" style="background:${o.cancelled ? '#fde2e2' : '#f0d3de'};color:${o.cancelled ? 'var(--danger)' : 'var(--pink-dark)'};">${escapeHtml(label)}</span>
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
      <p style="font-size:12px;color:var(--text-muted);margin-top:6px;">El precio unitario se puede editar para aplicar descuentos o agregar muestras sin cargo.</p>
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
          items.push({ product: p, presentation: allowed[0].key, quantity: 1, unitPrice: p[allowed[0].priceField] });
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
      const subtotal = it.unitPrice * it.quantity;
      return `
        <tr data-idx="${idx}" style="border-bottom:1px solid var(--border);">
          <td style="padding:8px 4px;">${escapeHtml(it.product.code || '')}</td>
          <td style="padding:8px 4px;">
            <select data-role="presentation" style="padding:6px;border-radius:6px;border:1px solid var(--border);">
              ${allowed.map(p => `<option value="${p.key}" ${p.key === it.presentation ? 'selected' : ''}>${p.key}</option>`).join('')}
            </select>
          </td>
          <td style="padding:8px 4px;"><input type="number" min="1" step="1" data-role="quantity" value="${it.quantity}" style="width:70px;padding:6px;border-radius:6px;border:1px solid var(--border);"></td>
          <td style="padding:8px 4px;"><input type="number" min="0" step="0.01" data-role="price" value="${it.unitPrice}" style="width:100px;padding:6px;border-radius:6px;border:1px solid var(--border);"></td>
          <td style="padding:8px 4px;font-weight:600;">${formatMoney(subtotal)}</td>
          <td style="padding:8px 4px;"><button class="btn btn-danger" data-role="remove" style="padding:4px 10px;font-size:12px;">×</button></td>
        </tr>
      `;
    }).join('');

    body.querySelectorAll('tr').forEach(row => {
      const idx = Number(row.dataset.idx);
      row.querySelector('[data-role="presentation"]').addEventListener('change', (e) => {
        const pres = PRESENTATIONS.find(p => p.key === e.target.value);
        items[idx].presentation = e.target.value;
        items[idx].unitPrice = items[idx].product[pres.priceField];
        drawItems();
      });
      row.querySelector('[data-role="quantity"]').addEventListener('input', (e) => {
        items[idx].quantity = Number(e.target.value) || 1;
        drawItems();
      });
      row.querySelector('[data-role="price"]').addEventListener('input', (e) => {
        items[idx].unitPrice = Number(e.target.value) || 0;
        drawItems();
      });
      row.querySelector('[data-role="remove"]').addEventListener('click', () => {
        items.splice(idx, 1);
        drawItems();
      });
    });

    const total = items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
    document.getElementById('items-total').textContent = 'Total: ' + formatMoney(total);
  }

  document.getElementById('btn-save-order').addEventListener('click', async () => {
    if (!selectedClient) { alert('Elegí un cliente para el pedido'); return; }
    if (items.length === 0) { alert('Agregá al menos un producto'); return; }
    const payload = {
      client_id: selectedClient.id,
      notes: document.getElementById('order-notes').value,
      items: items.map(it => ({ product_id: it.product.id, presentation: it.presentation, quantity: it.quantity, unit_price: it.unitPrice }))
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
  let editingItems = false;
  const editState = { items: [], notes: '' };

  function startEditing() {
    editState.items = order.items.map(it => ({
      product: { id: it.product_id, code: it.product_code, description: it.product_description },
      presentation: it.presentation,
      quantity: it.quantity,
      unitPrice: it.unit_price,
    }));
    editState.notes = order.notes || '';
    editingItems = true;
    draw();
  }

  function draw() {
    if (order.cancelled) return drawCancelled();
    if (editingItems) return drawEditItems();

    const nextIndex = order.status_index + 1;
    const isFinal = order.status_index >= LAST_INDEX;
    const clientName = order.client ? [order.client.first_name, order.client.last_name].filter(Boolean).join(' ') : '';
    const phoneDigits = (order.client && order.client.phone || '').replace(/[^0-9]/g, '');
    const canRevert = order.status_index > 0 && !order.finalized;

    container.innerHTML = `
      <button class="btn btn-secondary" id="btn-back" style="margin-bottom:16px;">← Volver</button>
      <div class="detail-header">
        <div class="detail-title">
          <div class="eyebrow">PEDIDO #${order.order_number} · ${escapeHtml(order.status_label)}${order.finalized ? ' · FINALIZADO' : ''}${order.modified ? ' · MODIFICADO' : ''}</div>
          <h1>${escapeHtml(clientName)}${order.client && order.client.business_name ? ' — ' + escapeHtml(order.client.business_name) : ''}</h1>
        </div>
        <div class="detail-actions">
          ${phoneDigits ? `<a class="whatsapp-btn-large" href="https://wa.me/${phoneDigits}" target="_blank">${WhatsappIcon} WhatsApp cliente</a>` : ''}
          ${order.order_pdf_path ? `<a class="btn btn-secondary" href="${order.order_pdf_path}" target="_blank">Descargar PDF</a>` : ''}
          ${order.status_index === 0 ? '<button class="btn btn-ghost" id="btn-edit-items" title="Editar pedido">✎ Editar</button>' : ''}
          ${canRevert ? '<button class="btn btn-ghost" id="btn-revert">← Retroceder</button>' : ''}
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

      ${order.preparation_pdf_path ? `
        <div class="detail-section">
          <h3>Preparación</h3>
          <a class="btn btn-secondary" href="${order.preparation_pdf_path}" target="_blank">Ver / descargar lista de preparación</a>
        </div>
      ` : ''}

      ${order.commission ? `
        <div class="detail-section">
          <h3>Comisión</h3>
          <div>Base: ${formatMoney(order.commission.base_amount)} · ${order.commission.percentage}% = <strong>${formatMoney(order.commission.amount)}</strong></div>
        </div>
      ` : ''}

      <div class="detail-section" id="step-section"></div>

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

    const editBtn = document.getElementById('btn-edit-items');
    if (editBtn) editBtn.addEventListener('click', startEditing);

    const revertBtn = document.getElementById('btn-revert');
    if (revertBtn) {
      revertBtn.addEventListener('click', () => {
        confirmModal({
          title: 'Retroceder pedido',
          message: `¿Retroceder el pedido #${order.order_number} de "${order.status_label}" a "${ORDER_STATUSES[order.status_index - 1]}"? Queda registrado como corrección.`,
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

    if (!isFinal) drawStepSection(nextIndex);
    else drawFinalStepSection();
  }

  function drawCancelled() {
    const clientName = order.client ? [order.client.first_name, order.client.last_name].filter(Boolean).join(' ') : '';
    container.innerHTML = `
      <button class="btn btn-secondary" id="btn-back" style="margin-bottom:16px;">← Volver</button>
      <div class="detail-header">
        <div class="detail-title">
          <div class="eyebrow">PEDIDO #${order.order_number} · CANCELADO</div>
          <h1>${escapeHtml(clientName)}</h1>
        </div>
      </div>
      <div class="detail-section" style="border:2px solid var(--danger);background:#fde2e2;">
        Este pedido fue cancelado y no admite más cambios.
      </div>
    `;
    document.getElementById('btn-back').addEventListener('click', onBack);
  }

  function drawEditItems() {
    container.innerHTML = `
      <button class="btn btn-secondary" id="btn-back-edit" style="margin-bottom:16px;">← Cancelar edición</button>
      <div class="page-header"><h2>Editar pedido #${order.order_number}</h2></div>
      <div class="detail-section">
        <h3>Productos</h3>
        <input type="text" id="product-search" placeholder="Buscar producto por código o descripción...">
        <div id="product-results" style="margin-top:8px;"></div>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;">
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
        <textarea id="order-notes" rows="3" style="width:100%;padding:10px;border-radius:7px;border:1px solid var(--border);background:var(--pink-light);font-family:inherit;">${escapeHtml(editState.notes)}</textarea>
      </div>
      <button class="btn btn-primary" id="btn-save-edit">Guardar cambios</button>
    `;

    document.getElementById('btn-back-edit').addEventListener('click', () => { editingItems = false; draw(); });

    const productSearch = document.getElementById('product-search');
    let timer;
    productSearch.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
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
            if (allowed.length === 0) { alert(`El producto ${p.code} no tiene presentaciones habilitadas.`); return; }
            editState.items.push({ product: p, presentation: allowed[0].key, quantity: 1, unitPrice: p[allowed[0].priceField] });
            drawEditRows();
            resultsEl.innerHTML = '';
            productSearch.value = '';
          });
        });
      }, 250);
    });

    function drawEditRows() {
      const body = document.getElementById('items-body');
      body.innerHTML = editState.items.map((it, idx) => {
        const allowed = it.product.code !== undefined && it.product.sale_dozen === undefined
          ? PRESENTATIONS // producto ya existente en el pedido, sin flags de habilitación disponibles: dejamos elegir cualquiera
          : allowedPresentations(it.product);
        const subtotal = it.unitPrice * it.quantity;
        return `
          <tr data-idx="${idx}" style="border-bottom:1px solid var(--border);">
            <td style="padding:8px 4px;">${escapeHtml(it.product.code || '')}</td>
            <td style="padding:8px 4px;">
              <select data-role="presentation" style="padding:6px;border-radius:6px;border:1px solid var(--border);">
                ${allowed.map(p => `<option value="${p.key}" ${p.key === it.presentation ? 'selected' : ''}>${p.key}</option>`).join('')}
              </select>
            </td>
            <td style="padding:8px 4px;"><input type="number" min="1" step="1" data-role="quantity" value="${it.quantity}" style="width:70px;padding:6px;border-radius:6px;border:1px solid var(--border);"></td>
            <td style="padding:8px 4px;"><input type="number" min="0" step="0.01" data-role="price" value="${it.unitPrice}" style="width:100px;padding:6px;border-radius:6px;border:1px solid var(--border);"></td>
            <td style="padding:8px 4px;font-weight:600;">${formatMoney(subtotal)}</td>
            <td style="padding:8px 4px;"><button class="btn btn-danger" data-role="remove" style="padding:4px 10px;font-size:12px;">×</button></td>
          </tr>
        `;
      }).join('');

      body.querySelectorAll('tr').forEach(row => {
        const idx = Number(row.dataset.idx);
        row.querySelector('[data-role="presentation"]').addEventListener('change', (e) => { editState.items[idx].presentation = e.target.value; drawEditRows(); });
        row.querySelector('[data-role="quantity"]').addEventListener('input', (e) => { editState.items[idx].quantity = Number(e.target.value) || 1; drawEditRows(); });
        row.querySelector('[data-role="price"]').addEventListener('input', (e) => { editState.items[idx].unitPrice = Number(e.target.value) || 0; drawEditRows(); });
        row.querySelector('[data-role="remove"]').addEventListener('click', () => { editState.items.splice(idx, 1); drawEditRows(); });
      });

      const total = editState.items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
      document.getElementById('items-total').textContent = 'Total: ' + formatMoney(total);
    }
    drawEditRows();

    document.getElementById('btn-save-edit').addEventListener('click', async () => {
      if (editState.items.length === 0) { alert('El pedido necesita al menos un producto'); return; }
      try {
        order = await Api.put(`/api/orders/${order.id}`, {
          notes: document.getElementById('order-notes').value,
          items: editState.items.map(it => ({ product_id: it.product.id, presentation: it.presentation, quantity: it.quantity, unit_price: it.unitPrice }))
        });
        editingItems = false;
        draw();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  async function uploadField(inputId) {
    const file = document.getElementById(inputId).files[0];
    if (!file) return null;
    const res = await Api.upload('/api/upload', file);
    return res.url;
  }

  function drawStepSection(nextIndex) {
    const el = document.getElementById('step-section');

    if (order.status_index === 0) {
      el.innerHTML = `
        <h3>Confirmar o cancelar</h3>
        <p style="font-size:13px;color:var(--text-muted);">Enviale el PDF por WhatsApp a Damián para que genere la Factura X, y confirmá el pedido cuando esté todo en orden.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-secondary" id="btn-whatsapp-damian">WhatsApp a Damián</button>
          <button class="btn btn-primary" id="btn-confirm">Confirmar pedido</button>
          <button class="btn btn-danger" id="btn-cancel-order">Cancelar pedido</button>
        </div>
      `;
      document.getElementById('btn-whatsapp-damian').addEventListener('click', async () => {
        const settings = await Api.get('/api/settings');
        if (!settings.damian_phone) { alert('Cargá el teléfono de Damián en Configuración.'); return; }
        const digits = settings.damian_phone.replace(/[^0-9]/g, '');
        const text = encodeURIComponent(`Pedido #${order.order_number} adjunto (recordá adjuntar el PDF descargado).`);
        window.open(`https://wa.me/${digits}?text=${text}`, '_blank');
      });
      document.getElementById('btn-confirm').addEventListener('click', async () => {
        try { order = await Api.post(`/api/orders/${order.id}/advance`, {}); draw(); } catch (err) { alert(err.message); }
      });
      document.getElementById('btn-cancel-order').addEventListener('click', () => {
        confirmModal({
          title: 'Cancelar pedido',
          message: `¿Seguro que querés cancelar el pedido #${order.order_number}? Queda fijo, sin poder avanzar más.`,
          confirmLabel: 'Cancelar pedido',
          onConfirm: async () => {
            order = await Api.post(`/api/orders/${order.id}/cancel`);
            draw();
          }
        });
      });
      return;
    }

    if (order.status_index === 1) {
      el.innerHTML = `
        <h3>Cargar Factura X y datos de transferencia</h3>
        <div class="field-grid">
          <div class="field"><label>Factura X (foto o PDF)</label><input type="file" id="field-invoice" accept="image/*,application/pdf"></div>
          <div class="field"><label>Datos de transferencia (foto o PDF)</label><input type="file" id="field-transfer" accept="image/*,application/pdf"></div>
          <div class="field"><label>Monto de la Factura X</label><input type="number" step="0.01" id="field-amount-invoice"></div>
        </div>
        <button class="btn btn-primary" id="btn-advance" style="margin-top:14px;">Guardar y continuar</button>
      `;
      document.getElementById('btn-advance').addEventListener('click', async () => {
        try {
          const invoiceUrl = await uploadField('field-invoice');
          const transferUrl = await uploadField('field-transfer');
          if (!invoiceUrl || !transferUrl) { alert('Faltan la Factura X y/o los datos de transferencia'); return; }
          const amount = document.getElementById('field-amount-invoice').value;
          const body = { invoice_attachment_url: invoiceUrl, transfer_attachment_url: transferUrl };
          if (amount) body.amount_invoice = amount;
          order = await Api.post(`/api/orders/${order.id}/advance`, body);
          draw();
        } catch (err) { alert(err.message); }
      });
      return;
    }

    if (order.status_index === 2) {
      const phoneDigits = (order.client && order.client.phone || '').replace(/[^0-9]/g, '');
      el.innerHTML = `
        <h3>Enviar datos al cliente</h3>
        <p style="font-size:13px;color:var(--text-muted);">Mandale por WhatsApp la Factura X y los datos de transferencia (descargalos de los links del historial más abajo y adjuntalos manualmente).</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          ${phoneDigits ? `<a class="btn btn-secondary" href="https://wa.me/${phoneDigits}" target="_blank">WhatsApp al cliente</a>` : ''}
          <button class="btn btn-primary" id="btn-advance">Ya se los envié</button>
        </div>
      `;
      document.getElementById('btn-advance').addEventListener('click', async () => {
        try { order = await Api.post(`/api/orders/${order.id}/advance`, {}); draw(); } catch (err) { alert(err.message); }
      });
      return;
    }

    if (order.status_index === 3) {
      el.innerHTML = `
        <h3>Comprobante de pago</h3>
        ${order.payment_attachment_url
          ? `<p>Comprobante cargado: <a href="${order.payment_attachment_url}" target="_blank">Ver</a></p>`
          : `<div class="field-grid">
              <div class="field"><label>Comprobante de pago (foto o PDF)</label><input type="file" id="field-payment" accept="image/*,application/pdf"></div>
              <div class="field"><label>Monto del comprobante</label><input type="number" step="0.01" id="field-amount-payment"></div>
            </div>
            <button class="btn btn-secondary" id="btn-attach-payment" style="margin-top:10px;">Adjuntar comprobante</button>`
        }
        <div style="margin-top:14px;">
          <button class="btn btn-primary" id="btn-confirm-payment" ${!order.payment_attachment_url ? 'disabled' : ''}>Confirmar pago</button>
        </div>
      `;
      const attachBtn = document.getElementById('btn-attach-payment');
      if (attachBtn) {
        attachBtn.addEventListener('click', async () => {
          try {
            const url = await uploadField('field-payment');
            if (!url) { alert('Falta el comprobante'); return; }
            const amount = document.getElementById('field-amount-payment').value;
            const body = { attachment_url: url };
            if (amount) body.amount_payment = amount;
            order = await Api.post(`/api/orders/${order.id}/attach-payment`, body);
            draw();
          } catch (err) { alert(err.message); }
        });
      }
      document.getElementById('btn-confirm-payment').addEventListener('click', async () => {
        try { order = await Api.post(`/api/orders/${order.id}/advance`, {}); draw(); } catch (err) { alert(err.message); }
      });
      return;
    }

    if (order.status_index === 4) {
      el.innerHTML = `
        <h3>Continuar</h3>
        <button class="btn btn-primary" id="btn-advance">Pasar a preparación</button>
      `;
      document.getElementById('btn-advance').addEventListener('click', async () => {
        try { order = await Api.post(`/api/orders/${order.id}/advance`, {}); draw(); } catch (err) { alert(err.message); }
      });
      return;
    }

    if (order.status_index === 5) {
      el.innerHTML = `
        <h3>En preparación</h3>
        <button class="btn btn-primary" id="btn-advance">Terminé de preparar</button>
      `;
      document.getElementById('btn-advance').addEventListener('click', async () => {
        try { order = await Api.post(`/api/orders/${order.id}/advance`, {}); draw(); } catch (err) { alert(err.message); }
      });
      return;
    }

    if (order.status_index === 6) {
      el.innerHTML = `
        <h3>Despachar</h3>
        <div class="field-grid">
          <div class="field"><label>Fecha de despacho</label><input type="date" id="field-shipping-date" value="${new Date().toISOString().slice(0,10)}"></div>
          <div class="field"><label>Número de guía</label><input type="text" id="field-tracking"></div>
          <div class="field full"><label>Comprobante de envío (foto o PDF)</label><input type="file" id="field-shipping-proof" accept="image/*,application/pdf"></div>
        </div>
        <button class="btn btn-primary" id="btn-advance" style="margin-top:14px;">Marcar despachado</button>
      `;
      document.getElementById('btn-advance').addEventListener('click', async () => {
        try {
          const url = await uploadField('field-shipping-proof');
          const tracking = document.getElementById('field-tracking').value.trim();
          const date = document.getElementById('field-shipping-date').value;
          if (!url || !tracking || !date) { alert('Completá fecha, número de guía y comprobante'); return; }
          order = await Api.post(`/api/orders/${order.id}/advance`, { shipping_date: date, tracking_number: tracking, attachment_url: url });
          draw();
        } catch (err) { alert(err.message); }
      });
      return;
    }

    if (order.status_index === DESPACHADO_INDEX) {
      el.innerHTML = `
        <h3>Continuar</h3>
        <button class="btn btn-primary" id="btn-advance">Iniciar seguimiento posventa</button>
      `;
      document.getElementById('btn-advance').addEventListener('click', async () => {
        try { order = await Api.post(`/api/orders/${order.id}/advance`, {}); draw(); } catch (err) { alert(err.message); }
      });
      return;
    }
  }

  function drawFinalStepSection() {
    const el = document.getElementById('step-section');
    const phoneDigits = (order.client && order.client.phone || '').replace(/[^0-9]/g, '');
    if (order.finalized) {
      el.innerHTML = `<h3>Seguimiento posventa</h3><p style="color:#2e7d32;font-weight:600;">Pedido finalizado.</p>`;
      return;
    }
    el.innerHTML = `
      <h3>Seguimiento posventa</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
        ${phoneDigits && order.shipping_proof_photo ? `<a class="btn btn-secondary" href="https://wa.me/${phoneDigits}" target="_blank">WhatsApp comprobante de envío al cliente</a>` : ''}
      </div>
      <p style="font-size:13px;color:var(--text-muted);">Cuando el cliente confirme que llegó todo bien, marcá el pedido como finalizado.</p>
      <button class="btn btn-primary" id="btn-finalize">Marcar pedido finalizado</button>
    `;
    document.getElementById('btn-finalize').addEventListener('click', () => {
      confirmModal({
        title: 'Finalizar pedido',
        message: `¿Confirmás que el pedido #${order.order_number} está finalizado?`,
        confirmLabel: 'Finalizar',
        onConfirm: async () => {
          order = await Api.post(`/api/orders/${order.id}/finalize`);
          draw();
        }
      });
    });
  }

  draw();
}
