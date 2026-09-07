// Stock: libreta de movimientos por producto (entradas, salidas, ajustes).
// El stock actual nunca se edita directo — sale de sumar todos los
// movimientos. Ver server/lib/stock.js para la conversión de unidades.
const STOCK_REASON_LABELS = {
  fabricacion: 'Fabricación propia',
  venta_externa: 'Venta externa (Damián)',
  ajuste: 'Ajuste por conteo físico',
  uso_pedido: 'Usado en un pedido',
  sobrante_pedido: 'Sobrante de fabricación de un pedido',
  otro: 'Otro',
};

function stockPresentationsLabel(presentations) {
  const parts = Object.keys(presentations || {}).map(key => `${presentations[key]} ${key}`);
  return parts.length ? parts.join(' · ') : 'Sin presentaciones habilitadas';
}

async function renderStockList(container, onOpenProduct) {
  container.innerHTML = `
    <div class="page-header"><h2>Stock</h2></div>
    <div class="search-bar">
      <input type="text" id="stock-search" placeholder="Buscar producto por código o descripción...">
    </div>
    <div id="stock-list-container"><div class="empty-state">Cargando...</div></div>
  `;

  async function load(q) {
    const rows = await Api.get('/api/stock' + (q ? '?q=' + encodeURIComponent(q) : ''));
    const listEl = document.getElementById('stock-list-container');
    if (rows.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No hay productos cargados todavía.</div>';
      return;
    }
    listEl.innerHTML = `<div class="list-view">${rows.map(p => `
      <div class="client-card stock-row" data-id="${p.id}" style="cursor:pointer;">
        <div class="client-info">
          <div><span class="client-num">${escapeHtml(p.code || '')}</span><span class="client-name">${escapeHtml(p.description || '')}</span></div>
          <div class="client-location">${escapeHtml(stockPresentationsLabel(p.presentations))}</div>
        </div>
      </div>
    `).join('')}</div>`;
    listEl.querySelectorAll('.stock-row').forEach(el => {
      el.addEventListener('click', () => onOpenProduct(Number(el.dataset.id)));
    });
  }

  let timer;
  document.getElementById('stock-search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => load(e.target.value.trim()), 300);
  });

  await load('');
}

function stockMovementDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function renderStockDetail(container, productId, onBack) {
  container.innerHTML = `<div class="empty-state">Cargando...</div>`;

  async function load() {
    const [stock, movements] = await Promise.all([
      Api.get(`/api/stock/${productId}`),
      Api.get(`/api/stock/${productId}/movements`),
    ]);
    draw(stock, movements);
  }

  function presentationOptions(product) {
    const opts = [];
    if (product.sale_dozen) opts.push('Docena');
    if (product.sale_pack3) opts.push('Pack x3');
    if (product.sale_unit) opts.push('Unidad');
    return opts;
  }

  function draw(stock, movements) {
    const product = stock.product;
    const presOpts = presentationOptions(product);

    container.innerHTML = `
      <button class="btn btn-secondary" id="btn-back" style="margin-bottom:16px;">← Volver a Stock</button>
      <div class="page-header">
        <h2>${escapeHtml(product.code || '')} — ${escapeHtml(product.description || '')}</h2>
      </div>

      <div class="detail-section">
        <h3>Stock disponible</h3>
        <div style="font-size:20px;font-weight:700;color:var(--pink-dark);">${escapeHtml(stockPresentationsLabel(stock.presentations))}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">
          <button class="btn btn-primary" id="btn-add-entrada">+ Cargar entrada</button>
          <button class="btn btn-secondary" id="btn-add-salida">− Cargar salida</button>
          <button class="btn btn-ghost" id="btn-adjust">Ajustar por conteo físico</button>
        </div>

        <div id="stock-form-wrap" hidden style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px;">
          <div class="field-grid" id="stock-form-fields"></div>
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button class="btn btn-primary" id="btn-save-movement">Guardar</button>
            <button class="btn btn-ghost" id="btn-cancel-movement">Cancelar</button>
          </div>
          <div id="stock-form-msg" style="margin-top:8px;font-size:12.5px;color:var(--danger);"></div>
        </div>
      </div>

      <div class="detail-section">
        <h3>Historial de movimientos</h3>
        ${movements.length === 0
          ? '<p style="color:var(--text-muted);">Todavía no hay movimientos cargados.</p>'
          : `<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
              ${movements.map(m => {
                const qty = Math.abs(m.quantity_units);
                const sign = m.quantity_units >= 0 ? '+' : '−';
                const color = m.quantity_units >= 0 ? '#2e7d32' : 'var(--danger)';
                return `
                  <div style="border-bottom:1px solid var(--border);padding-bottom:8px;display:flex;justify-content:space-between;gap:10px;">
                    <div>
                      <div style="font-weight:600;">${escapeHtml(STOCK_REASON_LABELS[m.reason] || m.reason || '')}${m.order_number ? ' — Pedido #' + m.order_number : ''}</div>
                      ${m.note ? `<div style="font-size:12.5px;color:var(--text-muted);">${escapeHtml(m.note)}</div>` : ''}
                      <div style="font-size:12px;color:var(--text-muted);">${stockMovementDate(m.created_at)}${m.created_by_name ? ' · ' + escapeHtml(m.created_by_name) : ''}</div>
                    </div>
                    <div style="font-weight:700;color:${color};white-space:nowrap;">${sign}${qty} unid.</div>
                  </div>
                `;
              }).join('')}
            </div>`
        }
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', onBack);

    const formWrap = document.getElementById('stock-form-wrap');
    const formFields = document.getElementById('stock-form-fields');
    const formMsg = document.getElementById('stock-form-msg');
    let currentMode = null;

    function openForm(mode) {
      currentMode = mode;
      formMsg.textContent = '';
      if (mode === 'ajuste') {
        formFields.innerHTML = `
          <div class="field">
            <label>Presentación</label>
            <select id="mv-presentation">${presOpts.map(p => `<option value="${p}">${p}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label>Cantidad real que hay (contada a mano)</label>
            <input type="number" min="0" step="0.01" id="mv-quantity">
          </div>
          <div class="field full">
            <label>Nota (opcional)</label>
            <input type="text" id="mv-note" placeholder="Ej: conteo físico en el depósito">
          </div>
        `;
      } else {
        formFields.innerHTML = `
          <div class="field">
            <label>Presentación</label>
            <select id="mv-presentation">${presOpts.map(p => `<option value="${p}">${p}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label>Cantidad</label>
            <input type="number" min="0" step="0.01" id="mv-quantity">
          </div>
          <div class="field">
            <label>Motivo</label>
            <select id="mv-reason">
              ${mode === 'entrada'
                ? `<option value="fabricacion">Fabricación propia</option><option value="otro">Otro</option>`
                : `<option value="venta_externa">Venta externa (Damián)</option><option value="otro">Otro</option>`}
            </select>
          </div>
          <div class="field full">
            <label>Nota (opcional — colores, talles, lo que sea)</label>
            <input type="text" id="mv-note" placeholder="Ej: surtido negro/blanco/gris + fucsia/azul">
          </div>
        `;
      }
      formWrap.hidden = false;
    }

    document.getElementById('btn-add-entrada').addEventListener('click', () => openForm('entrada'));
    document.getElementById('btn-add-salida').addEventListener('click', () => openForm('salida'));
    document.getElementById('btn-adjust').addEventListener('click', () => openForm('ajuste'));
    document.getElementById('btn-cancel-movement').addEventListener('click', () => { formWrap.hidden = true; });

    document.getElementById('btn-save-movement').addEventListener('click', async () => {
      const presentation = document.getElementById('mv-presentation').value;
      const quantity = document.getElementById('mv-quantity').value;
      const note = document.getElementById('mv-note').value.trim();
      if (!quantity || Number(quantity) < 0) { formMsg.textContent = 'Falta la cantidad'; return; }
      try {
        if (currentMode === 'ajuste') {
          await Api.post(`/api/stock/${productId}/adjust`, { presentation, real_quantity: quantity, note });
        } else {
          const reason = document.getElementById('mv-reason').value;
          await Api.post(`/api/stock/${productId}/movements`, { type: currentMode, presentation, quantity, reason, note });
        }
        formWrap.hidden = true;
        await load();
      } catch (err) {
        formMsg.textContent = err.message;
      }
    });
  }

  await load();
}
