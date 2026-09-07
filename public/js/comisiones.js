const CommissionsState = { from: '', to: '', paid: '' };

async function renderComisiones(container, onOpenOrder) {
  container.innerHTML = `
    <div class="page-header">
      <h2>Comisiones</h2>
      <div class="page-actions">
        <a class="btn btn-secondary" id="cm-export" href="/api/commissions/export.csv">Exportar CSV</a>
      </div>
    </div>
    <div class="search-bar">
      <div class="field" style="min-width:160px;">
        <label>Desde</label>
        <input type="date" id="cm-from">
      </div>
      <div class="field" style="min-width:160px;">
        <label>Hasta</label>
        <input type="date" id="cm-to">
      </div>
      <select id="cm-paid" style="padding:11px 14px;border-radius:8px;border:1px solid var(--border);background:var(--white);">
        <option value="">Todas</option>
        <option value="0">Sin cobrar</option>
        <option value="1">Cobradas</option>
      </select>
    </div>
    <div id="cm-total" style="font-size:18px;font-weight:700;color:var(--pink-dark);margin-bottom:16px;"></div>
    <div id="cm-container"><div class="empty-state">Cargando...</div></div>
  `;

  const fromInput = document.getElementById('cm-from');
  const toInput = document.getElementById('cm-to');
  const paidSelect = document.getElementById('cm-paid');
  fromInput.value = CommissionsState.from;
  toInput.value = CommissionsState.to;
  paidSelect.value = CommissionsState.paid;

  fromInput.addEventListener('change', () => { CommissionsState.from = fromInput.value; refresh(); });
  toInput.addEventListener('change', () => { CommissionsState.to = toInput.value; refresh(); });
  paidSelect.addEventListener('change', () => { CommissionsState.paid = paidSelect.value; refresh(); });

  async function refresh() {
    const params = new URLSearchParams();
    if (CommissionsState.from) params.set('from', CommissionsState.from);
    if (CommissionsState.to) params.set('to', CommissionsState.to);
    if (CommissionsState.paid !== '') params.set('paid', CommissionsState.paid);
    document.getElementById('cm-export').href = '/api/commissions/export.csv?' + params.toString();
    const data = await Api.get('/api/commissions?' + params.toString());
    document.getElementById('cm-total').textContent = `Total: ${formatMoney(data.total)} (${data.commissions.length} ${data.commissions.length === 1 ? 'comisión' : 'comisiones'})`;
    const listEl = document.getElementById('cm-container');
    if (data.commissions.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No se encontraron comisiones.</div>`;
      return;
    }
    listEl.innerHTML = `<div class="list-view">${data.commissions.map(commissionRow).join('')}</div>`;
    listEl.querySelectorAll('.client-card[data-order-id]').forEach(card => {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        if (typeof onOpenOrder === 'function') onOpenOrder(Number(card.dataset.orderId));
      });
    });
    listEl.querySelectorAll('[data-mark-paid]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await Api.post(`/api/commissions/${btn.dataset.markPaid}/mark-paid`);
        refresh();
      });
    });
    listEl.querySelectorAll('[data-unmark-paid]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        confirmModal({
          title: 'Deshacer cobro',
          message: '¿Marcar esta comisión como no cobrada de nuevo?',
          confirmLabel: 'Deshacer',
          onConfirm: async () => {
            await Api.post(`/api/commissions/${btn.dataset.unmarkPaid}/unmark-paid`);
            refresh();
          }
        });
      });
    });
  }

  await refresh();
}

function commissionRow(c) {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '(Sin nombre)';
  const clientLabel = c.business_name ? `${name} — ${c.business_name}` : name;
  return `
    <div class="client-card" data-order-id="${c.order_id}">
      <div class="client-info">
        <div><span class="client-num">Pedido #${c.order_number}</span><span class="client-name">${escapeHtml(clientLabel)}</span></div>
        <div class="client-location">${escapeHtml(c.created_at.slice(0, 10))} · Base ${formatMoney(c.base_amount)} · ${c.percentage}% = <strong>${formatMoney(c.amount)}</strong></div>
      </div>
      ${c.paid
        ? `<div style="text-align:right;">
            <span class="stock-badge" style="background:#e6f7e8;color:#2e7d32;">Cobrada ${escapeHtml((c.paid_at || '').slice(0, 10))}</span><br>
            <button data-unmark-paid="${c.id}" style="background:none;border:none;color:var(--cyan);font-size:12px;margin-top:4px;">Deshacer</button>
          </div>`
        : `<button class="btn btn-secondary" data-mark-paid="${c.id}">Marcar cobrada</button>`
      }
    </div>
  `;
}
