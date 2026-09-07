// Presupuestos: paso previo a todo pedido. Se arma con los mismos datos
// "de cliente" que hoy tiene un Cliente (completando lo que falte si el
// origen es un Contacto), más los productos con precios. El PDF que se
// genera acá es el que se le manda a Damián, y es el mismo PDF que
// después queda colgado del Pedido cuando el presupuesto se confirma.

const QUOTE_PERSON_FIELDS = [
  'first_name', 'last_name', 'business_name',
  'fiscal_name', 'fiscal_id', 'email', 'phone',
  'address', 'locality', 'postal_code', 'province',
  'shipping_type', 'shipping_carrier', 'shipping_address',
];

const QuotesState = { search: '', status: '' };

// Grilla de ítems reutilizable entre el formulario de creación y la edición
// de un presupuesto Pendiente: dibuja las filas, calcula subtotales/total en
// vivo y deja agregar/quitar productos. `items` es el array que se muta en
// el lugar; `draw()` se llama después de agregar/quitar un producto.
function setupItemsGrid(bodyEl, totalEl, items) {
  function updateTotals() {
    items.forEach((it, idx) => {
      const row = bodyEl.querySelector(`tr[data-idx="${idx}"]`);
      if (!row) return;
      const subtotal = (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
      row.querySelector('[data-label="Subtotal"]').textContent = formatMoney(subtotal);
    });
    const total = items.reduce((sum, it) => sum + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0), 0);
    if (totalEl) totalEl.textContent = 'Total: ' + formatMoney(total);
  }

  function draw() {
    bodyEl.innerHTML = items.map((it, idx) => {
      const allowed = allowedPresentations(it.product);
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

    bodyEl.querySelectorAll('tr').forEach(row => {
      const idx = Number(row.dataset.idx);
      row.querySelector('[data-role="presentation"]').addEventListener('change', (e) => {
        const pres = PRESENTATIONS.find(p => p.key === e.target.value);
        items[idx].presentation = e.target.value;
        items[idx].unitPrice = items[idx].product[pres.priceField];
        draw();
      });
      row.querySelector('[data-role="quantity"]').addEventListener('input', (e) => {
        items[idx].quantity = e.target.value === '' ? '' : Number(e.target.value);
        updateTotals();
      });
      row.querySelector('[data-role="quantity"]').addEventListener('blur', (e) => {
        if (!items[idx].quantity || items[idx].quantity <= 0) { items[idx].quantity = 1; e.target.value = 1; updateTotals(); }
      });
      row.querySelector('[data-role="price"]').addEventListener('input', (e) => {
        items[idx].unitPrice = e.target.value === '' ? '' : Number(e.target.value);
        updateTotals();
      });
      row.querySelector('[data-role="price"]').addEventListener('blur', (e) => {
        if (items[idx].unitPrice === '' || items[idx].unitPrice === null || isNaN(items[idx].unitPrice)) { items[idx].unitPrice = 0; e.target.value = 0; updateTotals(); }
      });
      row.querySelector('[data-role="remove"]').addEventListener('click', () => { items.splice(idx, 1); draw(); });
    });

    updateTotals();
  }

  draw();
  return { draw };
}

// Buscador de productos reutilizable: agrega a `items` y vuelve a dibujar
// la grilla con `grid.draw()`.
function setupProductSearch(inputEl, resultsEl, items, grid) {
  let timer;
  inputEl.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = inputEl.value.trim();
      if (!q) { resultsEl.innerHTML = ''; return; }
      const results = await Api.get('/api/products?q=' + encodeURIComponent(q));
      resultsEl.innerHTML = results.slice(0, 8).map(p => `
        <div class="product-list-row" data-product-id="${p.id}" style="padding:8px 12px;margin-bottom:4px;">
          <div class="info"><strong>${escapeHtml(p.code || 'Sin código')}</strong> — ${escapeHtml(p.description || '')}</div>
        </div>
      `).join('') || '<div class="empty-state" style="padding:12px;">Sin resultados</div>';
      resultsEl.querySelectorAll('[data-product-id]').forEach(el => {
        el.addEventListener('click', () => {
          const p = results.find(r => r.id === Number(el.dataset.productId));
          const allowed = allowedPresentations(p);
          if (allowed.length === 0) { alert(`El producto ${p.code} no tiene ninguna presentación de venta habilitada.`); return; }
          items.push({ product: p, presentation: allowed[0].key, quantity: 0, unitPrice: p[allowed[0].priceField] });
          grid.draw();
          resultsEl.innerHTML = '';
          inputEl.value = '';
        });
      });
    }, 250);
  });
}

async function renderPresupuestosList(container, onOpen, onNew) {
  container.innerHTML = `
    <div class="page-header">
      <h2>Presupuestos</h2>
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-new-quote">+ Nuevo presupuesto</button>
      </div>
    </div>
    <div class="search-bar">
      <input type="text" id="quote-search" class="text-input" placeholder="Buscar por nombre, emprendimiento o número...">
      <select id="quote-status-filter" style="padding:11px 14px;border-radius:8px;border:1px solid var(--border);background:var(--white);">
        <option value="">Todos los estados</option>
        <option value="Pendiente">Pendiente</option>
        <option value="Confirmado">Confirmado</option>
        <option value="Rechazado">Rechazado</option>
      </select>
    </div>
    <div id="quotes-container"><div class="empty-state">Cargando...</div></div>
  `;

  document.getElementById('btn-new-quote').addEventListener('click', () => onNew());

  const searchInput = document.getElementById('quote-search');
  const statusSelect = document.getElementById('quote-status-filter');
  searchInput.value = QuotesState.search;
  statusSelect.value = QuotesState.status;

  let timer;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { QuotesState.search = searchInput.value.trim(); refresh(); }, 250);
  });
  statusSelect.addEventListener('change', () => { QuotesState.status = statusSelect.value; refresh(); });

  async function refresh() {
    const params = new URLSearchParams();
    if (QuotesState.search) params.set('q', QuotesState.search);
    if (QuotesState.status) params.set('status', QuotesState.status);
    const quotes = await Api.get('/api/quotes?' + params.toString());
    const listEl = document.getElementById('quotes-container');
    if (quotes.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No se encontraron presupuestos.</div>`;
      return;
    }
    listEl.innerHTML = `<div class="list-view">${quotes.map(quoteRow).join('')}</div>`;
    listEl.querySelectorAll('.quote-row').forEach(el => {
      el.addEventListener('click', () => onOpen(Number(el.dataset.id)));
    });
  }

  await refresh();
}

function quoteRow(q) {
  const name = [q.first_name, q.last_name].filter(Boolean).join(' ') || '(Sin nombre)';
  const label = q.business_name ? `${name} — ${q.business_name}` : name;
  const badgeColors = {
    Pendiente: { bg: '#fff3e0', color: '#ef6c00' },
    Confirmado: { bg: '#e6f7e8', color: '#2e7d32' },
    Rechazado: { bg: '#fde2e2', color: 'var(--danger)' },
  };
  const colors = badgeColors[q.status] || badgeColors.Pendiente;
  return `
    <div class="client-card quote-row" data-id="${q.id}" style="cursor:pointer;">
      <div class="client-info">
        <div><span class="client-num">#${q.quote_number}</span><span class="client-name">${escapeHtml(label)}</span></div>
        <div class="client-location">${escapeHtml(q.created_at.slice(0, 10))} · ${formatMoney(q.calculated_amount)}</div>
      </div>
      <span class="stock-badge" style="background:${colors.bg};color:${colors.color};">${escapeHtml(q.status)}</span>
    </div>
  `;
}

function personFieldsGrid(person, idPrefix) {
  return `
    <div class="field-grid">
      <div class="field"><label>Nombre</label><input type="text" id="${idPrefix}first_name" class="text-input" value="${escapeHtml(person.first_name || '')}"></div>
      <div class="field"><label>Apellido</label><input type="text" id="${idPrefix}last_name" class="text-input" value="${escapeHtml(person.last_name || '')}"></div>
      <div class="field"><label>Emprendimiento</label><input type="text" id="${idPrefix}business_name" class="text-input" value="${escapeHtml(person.business_name || '')}"></div>
      <div class="field"><label>Razón social</label><input type="text" id="${idPrefix}fiscal_name" class="text-input" value="${escapeHtml(person.fiscal_name || '')}"></div>
      <div class="field"><label>DNI/CUIT</label><input type="text" id="${idPrefix}fiscal_id" class="text-input" value="${escapeHtml(person.fiscal_id || '')}"></div>
      <div class="field"><label>Teléfono</label><input type="text" id="${idPrefix}phone" class="text-input" value="${escapeHtml(person.phone || '')}"></div>
      <div class="field"><label>Email</label><input type="email" id="${idPrefix}email" class="text-input" value="${escapeHtml(person.email || '')}"></div>
      <div class="field"><label>Dirección</label><input type="text" id="${idPrefix}address" class="text-input" value="${escapeHtml(person.address || '')}"></div>
      <div class="field"><label>Localidad</label><input type="text" id="${idPrefix}locality" class="text-input" value="${escapeHtml(person.locality || '')}"></div>
      <div class="field"><label>Código postal</label><input type="text" id="${idPrefix}postal_code" class="text-input" value="${escapeHtml(person.postal_code || '')}"></div>
      <div class="field"><label>Provincia</label><input type="text" id="${idPrefix}province" class="text-input" value="${escapeHtml(person.province || '')}"></div>
      <div class="field">
        <label>Tipo de envío</label>
        <select id="${idPrefix}shipping_type">
          <option value="">—</option>
          <option value="Domicilio" ${person.shipping_type === 'Domicilio' ? 'selected' : ''}>Domicilio</option>
          <option value="Sucursal" ${person.shipping_type === 'Sucursal' ? 'selected' : ''}>Sucursal</option>
        </select>
      </div>
      <div class="field"><label>Transporte habitual</label><input type="text" id="${idPrefix}shipping_carrier" class="text-input" value="${escapeHtml(person.shipping_carrier || '')}"></div>
      <div class="field full"><label>Dirección de envío</label><input type="text" id="${idPrefix}shipping_address" class="text-input" value="${escapeHtml(person.shipping_address || '')}"></div>
    </div>
  `;
}

// `preset` opcional: { type: 'contact'|'client', record } cuando se llega
// desde el botón "Nuevo presupuesto" de un Contacto o Cliente puntual —
// en ese caso se salta el buscador y arranca directo con esos datos.
async function renderPresupuestoForm(container, onBack, onCreated, preset) {
  let source = preset ? preset.type : null;
  let sourceRecord = preset ? preset.record : null;
  const items = [];
  let grid = null;

  function personFieldsFromSource() {
    if (!sourceRecord) return {};
    if (source === 'contact') {
      return {
        first_name: sourceRecord.first_name, last_name: sourceRecord.last_name,
        business_name: sourceRecord.business_name, phone: sourceRecord.phone,
        locality: sourceRecord.locality, province: sourceRecord.province,
      };
    }
    const fields = {};
    QUOTE_PERSON_FIELDS.forEach(f => { fields[f] = sourceRecord[f]; });
    return fields;
  }

  function renderBody() {
    const person = personFieldsFromSource();
    container.innerHTML = `
      <button class="btn btn-secondary" id="btn-back" style="margin-bottom:16px;">← Volver</button>
      <div class="page-header"><h2>Nuevo presupuesto</h2></div>

      ${!sourceRecord ? `
        <div class="detail-section">
          <h3>Origen</h3>
          <div style="display:flex;gap:10px;margin-bottom:14px;">
            <button class="btn ${source === 'contact' ? 'btn-primary' : 'btn-secondary'}" id="btn-source-contact">Contacto</button>
            <button class="btn ${source === 'client' ? 'btn-primary' : 'btn-secondary'}" id="btn-source-client">Cliente existente</button>
          </div>
          ${source ? `
            <input type="text" id="source-search" class="text-input" placeholder="Buscar ${source === 'contact' ? 'contacto' : 'cliente'} por nombre o emprendimiento...">
            <div id="source-results" style="margin-top:8px;"></div>
          ` : ''}
        </div>
      ` : `
        <div class="detail-section">
          <strong>${source === 'contact' ? 'Contacto' : 'Cliente'} seleccionado:</strong>
          ${escapeHtml([sourceRecord.first_name, sourceRecord.last_name].filter(Boolean).join(' '))}${sourceRecord.business_name ? ' — ' + escapeHtml(sourceRecord.business_name) : ''}
          ${!preset ? `<button class="btn btn-ghost" id="btn-change-source" style="margin-left:10px;">Cambiar</button>` : ''}
        </div>
      `}

      ${sourceRecord ? `
        <div class="detail-section">
          <h3>Datos del cliente</h3>
          ${personFieldsGrid(person, 'pf-')}
        </div>

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
          <textarea id="quote-notes" rows="3" style="width:100%;padding:10px;border-radius:7px;border:1px solid var(--border);background:var(--pink-light);font-family:inherit;"></textarea>
        </div>

        <button class="btn btn-primary" id="btn-save-quote">Generar presupuesto</button>
      ` : ''}
    `;

    document.getElementById('btn-back').addEventListener('click', onBack);

    const changeBtn = document.getElementById('btn-change-source');
    if (changeBtn) changeBtn.addEventListener('click', () => { source = null; sourceRecord = null; renderBody(); });

    const btnContact = document.getElementById('btn-source-contact');
    const btnClient = document.getElementById('btn-source-client');
    if (btnContact) btnContact.addEventListener('click', () => { source = 'contact'; renderBody(); });
    if (btnClient) btnClient.addEventListener('click', () => { source = 'client'; renderBody(); });

    const sourceSearch = document.getElementById('source-search');
    if (sourceSearch) {
      let srcTimer;
      sourceSearch.addEventListener('input', () => {
        clearTimeout(srcTimer);
        srcTimer = setTimeout(async () => {
          const q = sourceSearch.value.trim();
          const resultsEl = document.getElementById('source-results');
          if (!q) { resultsEl.innerHTML = ''; return; }
          const endpoint = source === 'contact' ? '/api/contacts?q=' : '/api/clients?q=';
          const results = await Api.get(endpoint + encodeURIComponent(q));
          resultsEl.innerHTML = results.slice(0, 8).map(r => {
            const name = [r.first_name, r.last_name].filter(Boolean).join(' ');
            const numLabel = source === 'client' ? `#${r.client_number} ` : '';
            return `<div class="product-list-row" data-record-id="${r.id}" style="padding:8px 12px;margin-bottom:4px;">
              <div class="info"><strong>${numLabel}${escapeHtml(name)}</strong>${r.business_name ? ' — ' + escapeHtml(r.business_name) : ''}</div>
            </div>`;
          }).join('') || '<div class="empty-state" style="padding:12px;">Sin resultados</div>';
          resultsEl.querySelectorAll('[data-record-id]').forEach(el => {
            el.addEventListener('click', () => {
              sourceRecord = results.find(r => r.id === Number(el.dataset.recordId));
              renderBody();
            });
          });
        }, 250);
      });
    }

    if (!sourceRecord) return;

    grid = setupItemsGrid(document.getElementById('items-body'), document.getElementById('items-total'), items);
    setupProductSearch(document.getElementById('product-search'), document.getElementById('product-results'), items, grid);

    document.getElementById('btn-save-quote').addEventListener('click', async () => {
      if (items.length === 0) { alert('Agregá al menos un producto'); return; }
      const payload = { source, notes: document.getElementById('quote-notes').value, items: items.map(it => ({ product_id: it.product.id, presentation: it.presentation, quantity: it.quantity, unit_price: it.unitPrice })) };
      if (source === 'contact') payload.contact_id = sourceRecord.id;
      else payload.client_id = sourceRecord.id;
      QUOTE_PERSON_FIELDS.forEach(f => { payload[f] = document.getElementById(`pf-${f}`).value; });
      try {
        const quote = await Api.post('/api/quotes', payload);
        onCreated(quote.id);
      } catch (err) {
        alert(err.message);
      }
    });
  }

  renderBody();
}

async function renderPresupuestoDetail(container, quoteId, onBack, onConfirmed) {
  let quote = await Api.get(`/api/quotes/${quoteId}`);
  let items = [];

  function draw() {
    if (quote.status === 'Pendiente') return drawEditable();
    return drawReadOnly();
  }

  function drawReadOnly() {
    const name = [quote.first_name, quote.last_name].filter(Boolean).join(' ');
    const badgeColors = { Pendiente: '#ef6c00', Confirmado: '#2e7d32', Rechazado: 'var(--danger)' };

    container.innerHTML = `
      <button class="btn btn-secondary" id="btn-back" style="margin-bottom:16px;">← Volver</button>
      <div class="detail-header">
        <div class="detail-title">
          <div class="eyebrow" style="color:${badgeColors[quote.status] || 'var(--pink-dark)'};">PRESUPUESTO #${quote.quote_number} · ${escapeHtml(quote.status).toUpperCase()}</div>
          <h1>${escapeHtml(name)}${quote.business_name ? ' — ' + escapeHtml(quote.business_name) : ''}</h1>
        </div>
        <div class="detail-actions">
          ${quote.pdf_path ? `<button class="btn btn-secondary" id="btn-view-pdf">Ver PDF</button>` : ''}
        </div>
      </div>

      <div class="detail-section">
        <h3>Datos</h3>
        <div style="font-size:14px;line-height:1.8;">
          ${quote.fiscal_name ? `<div><strong>Razón social:</strong> ${escapeHtml(quote.fiscal_name)}</div>` : ''}
          ${quote.fiscal_id ? `<div><strong>DNI/CUIT:</strong> ${escapeHtml(quote.fiscal_id)}</div>` : ''}
          ${quote.phone ? `<div><strong>Tel:</strong> ${escapeHtml(quote.phone)}</div>` : ''}
          ${quote.email ? `<div><strong>Email:</strong> ${escapeHtml(quote.email)}</div>` : ''}
          ${quote.address ? `<div><strong>Dirección:</strong> ${escapeHtml([quote.address, quote.locality, quote.postal_code, quote.province].filter(Boolean).join(', '))}</div>` : ''}
          ${quote.shipping_type || quote.shipping_carrier ? `<div><strong>Envío:</strong> ${escapeHtml([quote.shipping_type, quote.shipping_carrier].filter(Boolean).join(' · '))}</div>` : ''}
        </div>
      </div>

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
            ${quote.items.map(it => `
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
          Total: ${formatMoney(quote.calculated_amount)}
        </div>
        ${quote.notes ? `<div style="margin-top:14px;"><label style="font-size:12px;color:var(--text-muted);font-weight:600;">Notas</label><div>${escapeHtml(quote.notes).replace(/\n/g, '<br>')}</div></div>` : ''}
      </div>

      ${quote.status === 'Confirmado' && quote.converted_order_id ? `
        <div class="detail-section" style="border:2px solid #2e7d32;background:#e6f7e8;">
          Este presupuesto se confirmó y generó el pedido #${quote.converted_order_id}.
          <button class="btn btn-secondary" id="btn-go-order" style="margin-left:10px;">Ver pedido</button>
        </div>
      ` : ''}
    `;

    document.getElementById('btn-back').addEventListener('click', onBack);

    const viewPdfBtn = document.getElementById('btn-view-pdf');
    if (viewPdfBtn) viewPdfBtn.addEventListener('click', () => openPdfPreview(quote.pdf_path, `presupuesto-${quote.quote_number}.pdf`));

    const goOrderBtn = document.getElementById('btn-go-order');
    if (goOrderBtn) goOrderBtn.addEventListener('click', () => onConfirmed(quote.converted_order_id));
  }

  function drawEditable() {
    items = quote.items.map(it => ({
      product: { id: it.product_id, code: it.product_code, description: it.product_description },
      presentation: it.presentation,
      quantity: it.quantity,
      unitPrice: it.unit_price,
    }));
    const phoneDigits = (quote.phone || '').replace(/[^0-9]/g, '');
    const name = [quote.first_name, quote.last_name].filter(Boolean).join(' ');

    container.innerHTML = `
      <button class="btn btn-secondary" id="btn-back" style="margin-bottom:16px;">← Volver</button>
      <div class="detail-header">
        <div class="detail-title">
          <div class="eyebrow" style="color:#ef6c00;">PRESUPUESTO #${quote.quote_number} · PENDIENTE</div>
          <h1>${escapeHtml(name)}${quote.business_name ? ' — ' + escapeHtml(quote.business_name) : ''}</h1>
        </div>
        <div class="detail-actions">
          ${phoneDigits ? `<a class="whatsapp-btn-large" href="https://wa.me/${phoneDigits}" target="_blank">${WhatsappIcon} WhatsApp</a>` : ''}
          ${quote.pdf_path ? `<button class="btn btn-secondary" id="btn-view-pdf">Ver PDF</button>` : ''}
        </div>
      </div>

      <div class="detail-section">
        <h3>Datos del cliente</h3>
        ${personFieldsGrid(quote, 'qf-')}
      </div>

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
        <textarea id="quote-notes" rows="3" style="width:100%;padding:10px;border-radius:7px;border:1px solid var(--border);background:var(--pink-light);font-family:inherit;">${escapeHtml(quote.notes || '')}</textarea>
      </div>

      <button class="btn btn-secondary" id="btn-save-quote">Guardar cambios</button>

      <div class="detail-section" style="margin-top:20px;">
        <h3>¿El cliente aceptó?</h3>
        <p style="font-size:13px;color:var(--text-muted);">Al confirmar se crea el cliente (si hace falta) y nace el pedido, ya listo para mandar a facturación.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-primary" id="btn-confirm-quote">Confirmar presupuesto</button>
          <button class="btn btn-danger" id="btn-reject-quote">Rechazar</button>
        </div>
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', onBack);

    const viewPdfBtn = document.getElementById('btn-view-pdf');
    if (viewPdfBtn) viewPdfBtn.addEventListener('click', () => openPdfPreview(quote.pdf_path, `presupuesto-${quote.quote_number}.pdf`));

    const grid = setupItemsGrid(document.getElementById('items-body'), document.getElementById('items-total'), items);
    setupProductSearch(document.getElementById('product-search'), document.getElementById('product-results'), items, grid);

    document.getElementById('btn-save-quote').addEventListener('click', async () => {
      if (items.length === 0) { alert('El presupuesto necesita al menos un producto'); return; }
      const payload = { notes: document.getElementById('quote-notes').value, items: items.map(it => ({ product_id: it.product.id, presentation: it.presentation, quantity: it.quantity, unit_price: it.unitPrice })) };
      QUOTE_PERSON_FIELDS.forEach(f => { payload[f] = document.getElementById(`qf-${f}`).value; });
      try {
        quote = await Api.put(`/api/quotes/${quote.id}`, payload);
        draw();
      } catch (err) {
        alert(err.message);
      }
    });

    document.getElementById('btn-confirm-quote').addEventListener('click', () => {
      confirmModal({
        title: 'Confirmar presupuesto',
        message: `¿El cliente aceptó el presupuesto #${quote.quote_number}? Se va a crear el pedido.`,
        confirmLabel: 'Confirmar',
        onConfirm: async () => {
          try {
            const result = await Api.post(`/api/quotes/${quote.id}/confirm`);
            onConfirmed(result.order_id);
          } catch (err) {
            alert(err.message);
          }
        }
      });
    });

    document.getElementById('btn-reject-quote').addEventListener('click', () => {
      confirmModal({
        title: 'Rechazar presupuesto',
        message: `¿Seguro que el cliente no aceptó el presupuesto #${quote.quote_number}?`,
        confirmLabel: 'Rechazar',
        onConfirm: async () => {
          quote = await Api.post(`/api/quotes/${quote.id}/reject`);
          draw();
        }
      });
    });
  }

  draw();
}
