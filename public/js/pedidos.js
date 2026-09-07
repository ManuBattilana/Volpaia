const ORDER_STATUSES = [
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
const FINALIZADO_INDEX = 7;
const LAST_INDEX = ORDER_STATUSES.length - 1;

const PRESENTATIONS = [
  { key: 'Docena', enabledField: 'sale_dozen', priceField: 'price_dozen' },
  { key: 'Pack x3', enabledField: 'sale_pack3', priceField: 'price_pack3' },
  { key: 'Unidad', enabledField: 'sale_unit', priceField: 'price_unit' },
];

function allowedPresentations(product) {
  return PRESENTATIONS.filter(p => !!product[p.enabledField]);
}

const PdfFileIcon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
const ImageFileIcon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;

function isPdfUrl(url) { return /\.pdf(\?|$)/i.test(url || ''); }

// Junta en un solo lugar todos los comprobantes que se van adjuntando a lo
// largo del flujo del pedido (Presupuesto, Factura X, pago, envío), para
// que se puedan ver siempre desde la sección "Archivos" sin depender de en
// qué paso está el pedido ahora mismo. El PDF de preparación se suma a esta
// lista recién cuando el pedido avanza más allá del primer paso — mientras
// está en "Pedido confirmado" tiene su propio bloque bien visible, porque
// es el que Darío necesita usar de entrada.
function orderAttachments(order) {
  const list = [
    { label: 'Presupuesto', hint: 'Con precios — para mandarle a Damián por WhatsApp', url: order.order_pdf_path },
    { label: 'Factura X', hint: 'La que te mandó Damián', url: order.invoice_attachment_url },
    { label: 'Comprobante de pago', hint: 'El que mandó el cliente', url: order.payment_attachment_url },
    { label: 'Comprobante de envío', hint: '', url: order.shipping_proof_photo },
  ];
  if (order.status_index > 0) {
    list.push({ label: 'PDF de preparación', hint: 'Sin precios — para armar el pedido', url: order.preparation_pdf_path });
  }
  return list.filter(a => a.url).map(a => ({ ...a, isPdf: isPdfUrl(a.url) }));
}

function openAttachment(url, label) {
  if (isPdfUrl(url)) openPdfPreview(url, `${label}.pdf`);
  else window.open(url, '_blank');
}

const OrdersState = { statusFilter: '', search: '' };

async function renderPedidosList(container, onOpen, onNew, presetStatusFilter) {
  if (presetStatusFilter !== undefined && presetStatusFilter !== null) {
    OrdersState.statusFilter = presetStatusFilter;
  }
  container.innerHTML = `
    <div class="page-header">
      <h2>Pedidos</h2>
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-new-quote">+ Nuevo presupuesto</button>
      </div>
    </div>
    <div class="search-bar">
      <input type="text" id="order-search" class="text-input" placeholder="Buscar por cliente o número de pedido...">
      <select id="order-status-filter" style="padding:11px 14px;border-radius:8px;border:1px solid var(--border);background:var(--white);">
        <option value="">Todos los estados</option>
        ${ORDER_STATUSES.map((s, i) => `<option value="${i}">${s}</option>`).join('')}
        <option value="cancelled">Cancelados</option>
      </select>
    </div>
    <div id="orders-container"><div class="empty-state">Cargando...</div></div>
  `;

  document.getElementById('btn-new-quote').addEventListener('click', onNew);

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
    const canRevert = order.status_index > 0;

    container.innerHTML = `
      <button class="btn btn-secondary" id="btn-back" style="margin-bottom:16px;">← Volver</button>
      <div class="detail-header">
        <div class="detail-title">
          <div class="eyebrow">PEDIDO #${order.order_number} · ${escapeHtml(order.status_label)}${order.modified ? ' · MODIFICADO' : ''}</div>
          <h1>${escapeHtml(clientName)}${order.client && order.client.business_name ? ' — ' + escapeHtml(order.client.business_name) : ''}</h1>
        </div>
        <div class="detail-actions">
          ${phoneDigits ? `<a class="whatsapp-btn-large" href="https://wa.me/${phoneDigits}" target="_blank">${WhatsappIcon} WhatsApp cliente</a>` : ''}
          ${order.status_index === 0 ? '<button class="btn btn-ghost" id="btn-edit-items" title="Editar pedido">✎ Editar</button>' : ''}
          ${canRevert ? '<button class="btn btn-ghost" id="btn-revert">← Retroceder</button>' : ''}
          <button class="btn btn-danger" id="btn-cancel-order">Cancelar pedido</button>
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

      ${orderAttachments(order).length || order.cbu ? `
        <div class="detail-section">
          <h3>Archivos</h3>
          <div class="attachments-grid attachments-grid-cards">
            ${orderAttachments(order).map(a => `
              <button class="attachment-card" data-url="${a.url}" data-label="${escapeHtml(a.label)}">
                <span class="attachment-card-icon">${a.isPdf ? PdfFileIcon : ImageFileIcon}</span>
                <span class="attachment-card-text">
                  <strong>${escapeHtml(a.label)}</strong>
                  ${a.hint ? `<span class="attachment-card-hint">${escapeHtml(a.hint)}</span>` : ''}
                </span>
              </button>
            `).join('')}
          </div>
          ${order.cbu ? `<div class="detail-section" style="margin-top:14px;background:var(--pink-light);"><strong>Datos para transferir</strong><div style="white-space:pre-wrap;margin-top:6px;font-size:13.5px;">${escapeHtml(order.cbu)}</div></div>` : ''}
        </div>
      ` : ''}

      ${order.status_index === 0 && order.preparation_pdf_path ? `
        <div class="detail-section prep-callout">
          <h3>📋 PDF para preparación</h3>
          <p>Descargalo (o abrilo en el celular) para armar el pedido: tiene los productos y las cantidades, sin precios.</p>
          <button class="btn btn-primary" id="btn-view-prep-pdf">Descargar PDF para preparación</button>
        </div>
      ` : ''}

      <div class="detail-section">
        <h3>Productos</h3>
        <table style="width:100%;border-collapse:collapse;" class="items-table-responsive">
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
                <td style="padding:8px 4px;" data-label="Producto">${escapeHtml(it.product_code || '')} — ${escapeHtml(it.product_description || '')}</td>
                <td style="padding:8px 4px;" data-label="Presentación">${escapeHtml(it.presentation)}</td>
                <td style="padding:8px 4px;" data-label="Cantidad">${it.quantity}</td>
                <td style="padding:8px 4px;" data-label="Precio unit.">${formatMoney(it.unit_price)}</td>
                <td style="padding:8px 4px;font-weight:600;" data-label="Subtotal">${formatMoney(it.unit_price * it.quantity)}</td>
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

    container.querySelectorAll('.attachment-card').forEach(btn => {
      btn.addEventListener('click', () => openAttachment(btn.dataset.url, btn.dataset.label));
    });

    const viewPrepPdfBtn = document.getElementById('btn-view-prep-pdf');
    if (viewPrepPdfBtn) viewPrepPdfBtn.addEventListener('click', () => openPdfPreview(order.preparation_pdf_path, `preparacion-${order.order_number}.pdf`));

    const editBtn = document.getElementById('btn-edit-items');
    if (editBtn) editBtn.addEventListener('click', startEditing);

    document.getElementById('btn-cancel-order').addEventListener('click', () => {
      confirmModal({
        title: 'Cancelar pedido',
        message: `¿Seguro que querés cancelar el pedido #${order.order_number}? Queda fijo, sin poder avanzar más.`,
        confirmLabel: 'Cancelar pedido',
        onConfirm: async () => {
          try { order = await Api.post(`/api/orders/${order.id}/cancel`); draw(); } catch (err) { alert(err.message); }
        }
      });
    });

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
        <input type="text" id="product-search" class="text-input" placeholder="Buscar producto por código o descripción...">
        <div id="product-results" style="margin-top:8px;"></div>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;" class="items-table-responsive">
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
            editState.items.push({ product: p, presentation: allowed[0].key, quantity: 0, unitPrice: p[allowed[0].priceField] });
            drawEditRows();
            resultsEl.innerHTML = '';
            productSearch.value = '';
          });
        });
      }, 250);
    });

    function updateEditTotals() {
      const body = document.getElementById('items-body');
      editState.items.forEach((it, idx) => {
        const row = body.querySelector(`tr[data-idx="${idx}"]`);
        if (!row) return;
        const subtotal = (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
        row.querySelector('[data-label="Subtotal"]').textContent = formatMoney(subtotal);
      });
      const total = editState.items.reduce((sum, it) => sum + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0), 0);
      document.getElementById('items-total').textContent = 'Total: ' + formatMoney(total);
    }

    function drawEditRows() {
      const body = document.getElementById('items-body');
      body.innerHTML = editState.items.map((it, idx) => {
        const allowed = it.product.code !== undefined && it.product.sale_dozen === undefined
          ? PRESENTATIONS // producto ya existente en el pedido, sin flags de habilitación disponibles: dejamos elegir cualquiera
          : allowedPresentations(it.product);
        const subtotal = it.unitPrice * it.quantity;
        return `
          <tr data-idx="${idx}" style="border-bottom:1px solid var(--border);">
            <td style="padding:8px 4px;" data-label="Producto">${escapeHtml(it.product.code || '')}</td>
            <td style="padding:8px 4px;" data-label="Presentación">
              <select data-role="presentation" style="padding:6px;border-radius:6px;border:1px solid var(--border);">
                ${allowed.map(p => `<option value="${p.key}" ${p.key === it.presentation ? 'selected' : ''}>${p.key}</option>`).join('')}
              </select>
            </td>
            <td style="padding:8px 4px;" data-label="Cantidad"><input type="number" min="0" step="1" data-role="quantity" value="${it.quantity}" style="width:70px;padding:6px;border-radius:6px;border:1px solid var(--border);"></td>
            <td style="padding:8px 4px;" data-label="Precio unit."><input type="number" min="0" step="0.01" data-role="price" value="${it.unitPrice}" style="width:100px;padding:6px;border-radius:6px;border:1px solid var(--border);"></td>
            <td style="padding:8px 4px;font-weight:600;" data-label="Subtotal">${formatMoney(subtotal)}</td>
            <td style="padding:8px 4px;"><button class="btn btn-danger" data-role="remove" style="padding:4px 10px;font-size:12px;">Quitar</button></td>
          </tr>
        `;
      }).join('');

      body.querySelectorAll('tr').forEach(row => {
        const idx = Number(row.dataset.idx);
        row.querySelector('[data-role="presentation"]').addEventListener('change', (e) => { editState.items[idx].presentation = e.target.value; drawEditRows(); });
        row.querySelector('[data-role="quantity"]').addEventListener('input', (e) => {
          editState.items[idx].quantity = e.target.value === '' ? '' : Number(e.target.value);
          updateEditTotals();
        });
        row.querySelector('[data-role="quantity"]').addEventListener('blur', (e) => {
          if (!editState.items[idx].quantity || editState.items[idx].quantity <= 0) { editState.items[idx].quantity = 1; e.target.value = 1; updateEditTotals(); }
        });
        row.querySelector('[data-role="price"]').addEventListener('input', (e) => {
          editState.items[idx].unitPrice = e.target.value === '' ? '' : Number(e.target.value);
          updateEditTotals();
        });
        row.querySelector('[data-role="price"]').addEventListener('blur', (e) => {
          if (editState.items[idx].unitPrice === '' || editState.items[idx].unitPrice === null || isNaN(editState.items[idx].unitPrice)) { editState.items[idx].unitPrice = 0; e.target.value = 0; updateEditTotals(); }
        });
        row.querySelector('[data-role="remove"]').addEventListener('click', () => { editState.items.splice(idx, 1); drawEditRows(); });
      });

      updateEditTotals();
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

  // Si el monto que se está por cargar no coincide con el monto calculado
  // del pedido, para y pregunta antes de mandarlo — así un error de tipeo
  // no queda guardado sin darse cuenta (antes solo se veía un cartel de
  // aviso arriba, pero dejaba seguir igual).
  function proceedWithAmountCheck(amount, proceedFn) {
    if (amount === '' || amount === undefined || amount === null) { proceedFn(); return; }
    const entered = Math.round(Number(amount) * 100);
    const calculated = Math.round(Number(order.calculated_amount) * 100);
    if (isNaN(entered) || entered === calculated) { proceedFn(); return; }
    confirmModal({
      title: 'Los montos no coinciden',
      message: `Ingresaste ${formatMoney(amount)}, pero el monto calculado del pedido es ${formatMoney(order.calculated_amount)}. ¿Confirmás que está bien así (por ejemplo, un pago parcial) o preferís cancelar y corregirlo?`,
      confirmLabel: 'Confirmar igual',
      onConfirm: proceedFn,
    });
  }

  function drawStepSection(nextIndex) {
    const el = document.getElementById('step-section');

    if (order.status_index === 0) {
      // Pedido confirmado: el cliente ya aceptó el presupuesto, acá solo
      // falta mandarlo a facturación.
      el.innerHTML = `
        <h3>Pedido confirmado</h3>
        <p style="font-size:13px;color:var(--text-muted);">
          Descargá el <strong>Presupuesto</strong> (arriba, en Archivos) y mandáselo a Damián por WhatsApp para que genere la Factura X.
          Descargá también el <strong>PDF para preparación</strong> para ir armando el pedido.
          Cuando esté todo en orden, mandalo a facturación.
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-secondary" id="btn-whatsapp-damian">WhatsApp a Damián</button>
          <button class="btn btn-primary" id="btn-advance">Enviar a facturación</button>
        </div>
      `;
      document.getElementById('btn-whatsapp-damian').addEventListener('click', async () => {
        const settings = await Api.get('/api/settings');
        if (!settings.damian_phone) { alert('Cargá el teléfono de Damián en Configuración.'); return; }
        const digits = settings.damian_phone.replace(/[^0-9]/g, '');
        const text = encodeURIComponent(`Pedido #${order.order_number} adjunto (recordá adjuntar el PDF de presupuesto descargado).`);
        window.open(`https://wa.me/${digits}?text=${text}`, '_blank');
      });
      document.getElementById('btn-advance').addEventListener('click', () => {
        confirmModal({
          title: 'Enviar a facturación',
          message: `¿Enviás el pedido #${order.order_number} a facturación?`,
          confirmLabel: 'Enviar a facturación',
          onConfirm: async () => {
            try { order = await Api.post(`/api/orders/${order.id}/advance`, {}); draw(); } catch (err) { alert(err.message); }
          }
        });
      });
      return;
    }

    if (order.status_index === 1) {
      el.innerHTML = `
        <h3>Enviar a facturación</h3>
        <p style="font-size:13px;color:var(--text-muted);">Adjuntá la Factura X, los datos para transferir y el monto de la factura.</p>
        <div class="field-grid">
          <div class="field"><label>Factura X (foto o PDF)</label><input type="file" id="field-invoice" accept="image/*,application/pdf"></div>
          <div class="field"><label>Monto de la Factura X</label><input type="number" step="0.01" id="field-amount-invoice"></div>
          <div class="field full">
            <label>Datos para transferir</label>
            <textarea id="field-cbu" rows="3" class="text-input" style="width:100%;font-family:inherit;" placeholder="Alias, CBU y nombre del titular"></textarea>
          </div>
        </div>
        <button class="btn btn-primary" id="btn-advance" style="margin-top:14px;">Guardar y continuar</button>
      `;
      document.getElementById('btn-advance').addEventListener('click', async () => {
        try {
          const invoiceUrl = await uploadField('field-invoice');
          const cbu = document.getElementById('field-cbu').value.trim();
          if (!invoiceUrl || !cbu) { alert('Faltan la Factura X y/o los datos para transferir'); return; }
          const amount = document.getElementById('field-amount-invoice').value;
          proceedWithAmountCheck(amount, async () => {
            try {
              const body = { invoice_attachment_url: invoiceUrl, cbu };
              if (amount) body.amount_invoice = amount;
              order = await Api.post(`/api/orders/${order.id}/advance`, body);
              draw();
            } catch (err) { alert(err.message); }
          });
        } catch (err) { alert(err.message); }
      });
      return;
    }

    if (order.status_index === 2) {
      const phoneDigits = (order.client && order.client.phone || '').replace(/[^0-9]/g, '');
      el.innerHTML = `
        <h3>Facturado</h3>
        <p style="font-size:13px;color:var(--text-muted);">Mandale por WhatsApp la Factura X y el CBU al cliente (los tenés arriba, en "Archivos").</p>
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
          : `<p style="font-size:13px;color:var(--text-muted);">Subí el comprobante que te mandó el cliente y el monto pagado.</p>
            <div class="field-grid">
              <div class="field"><label>Comprobante de pago (foto o PDF)</label><input type="file" id="field-payment" accept="image/*,application/pdf"></div>
              <div class="field"><label>Monto del comprobante</label><input type="number" step="0.01" id="field-amount-payment"></div>
            </div>
            <button class="btn btn-secondary" id="btn-attach-payment" style="margin-top:10px;">Adjuntar comprobante</button>`
        }
        <p style="font-size:13px;color:var(--text-muted);margin-top:14px;">Cuando esté todo bien, confirmá el pago para pasar a preparación.</p>
        <button class="btn btn-primary" id="btn-confirm-payment" ${!order.payment_attachment_url ? 'disabled' : ''}>Confirmar pago</button>
      `;
      const attachBtn = document.getElementById('btn-attach-payment');
      if (attachBtn) {
        attachBtn.addEventListener('click', async () => {
          try {
            const url = await uploadField('field-payment');
            if (!url) { alert('Falta el comprobante'); return; }
            const amount = document.getElementById('field-amount-payment').value;
            proceedWithAmountCheck(amount, async () => {
              try {
                const body = { attachment_url: url };
                if (amount) body.amount_payment = amount;
                order = await Api.post(`/api/orders/${order.id}/attach-payment`, body);
                draw();
              } catch (err) { alert(err.message); }
            });
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
        <h3>En preparación</h3>
        <p style="font-size:13px;color:var(--text-muted);">Cuando termines de armar el pedido físico, marcá que terminaste para pasar a Despachar.</p>
        <button class="btn btn-primary" id="btn-advance">Terminé de preparar</button>
      `;
      document.getElementById('btn-advance').addEventListener('click', async () => {
        try { order = await Api.post(`/api/orders/${order.id}/advance`, {}); draw(); } catch (err) { alert(err.message); }
      });
      return;
    }

    if (order.status_index === 5) {
      el.innerHTML = `
        <h3>Despachar</h3>
        <p style="font-size:12px;color:var(--text-muted);">Estos datos son opcionales: si todavía no hay número de guía o comprobante, se puede marcar como despachado igual.</p>
        <div class="field-grid">
          <div class="field"><label>Fecha de despacho</label><input type="date" id="field-shipping-date" value="${new Date().toISOString().slice(0,10)}"></div>
          <div class="field"><label>Número de guía</label><input type="text" id="field-tracking" class="text-input"></div>
          <div class="field full"><label>Comprobante de envío (foto o PDF)</label><input type="file" id="field-shipping-proof" accept="image/*,application/pdf"></div>
        </div>
        <button class="btn btn-primary" id="btn-advance" style="margin-top:14px;">Marcar como despachado</button>
      `;
      document.getElementById('btn-advance').addEventListener('click', async () => {
        try {
          const url = await uploadField('field-shipping-proof');
          const tracking = document.getElementById('field-tracking').value.trim();
          const date = document.getElementById('field-shipping-date').value;
          const body = {};
          if (date) body.shipping_date = date;
          if (tracking) body.tracking_number = tracking;
          if (url) body.attachment_url = url;
          order = await Api.post(`/api/orders/${order.id}/advance`, body);
          draw();
        } catch (err) { alert(err.message); }
      });
      return;
    }

    if (order.status_index === 6) {
      el.innerHTML = `
        <h3>Despachado</h3>
        <p style="font-size:13px;color:var(--text-muted);">Cuando el pedido ya salió, marcalo como finalizado para calcular la comisión de la venta.</p>
        <button class="btn btn-primary" id="btn-advance">Marcar como finalizado</button>
      `;
      document.getElementById('btn-advance').addEventListener('click', () => {
        confirmModal({
          title: 'Finalizar pedido',
          message: `¿Confirmás que el pedido #${order.order_number} está finalizado?`,
          confirmLabel: 'Finalizar',
          onConfirm: async () => {
            try { order = await Api.post(`/api/orders/${order.id}/advance`, {}); draw(); } catch (err) { alert(err.message); }
          }
        });
      });
      return;
    }

    if (order.status_index === FINALIZADO_INDEX) {
      el.innerHTML = `
        <h3>Finalizado</h3>
        ${order.commission ? `<p>Comisión de esta venta: <strong>${formatMoney(order.commission.amount)}</strong></p>` : ''}
        <p style="font-size:13px;color:var(--text-muted);">Continuá con el seguimiento posventa para acordarte de consultarle al cliente más adelante.</p>
        <button class="btn btn-primary" id="btn-advance">Continuar seguimiento posventa</button>
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
    el.innerHTML = `
      <h3>Seguimiento posventa</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${phoneDigits && order.shipping_proof_photo ? `<a class="btn btn-secondary" href="https://wa.me/${phoneDigits}" target="_blank">WhatsApp comprobante de envío al cliente</a>` : ''}
      </div>
      <p style="font-size:13px;color:var(--text-muted);margin-top:10px;">Los recordatorios de seguimiento se generan solos según lo configurado en Configuración.</p>
    `;
  }

  draw();
}
