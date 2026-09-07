// Fábrica: todo lo pendiente de fabricar, de todos los pedidos juntos,
// agrupado por artículo — para que Darío vea de una cuánto tiene que
// fabricar en total en vez de ir pedido por pedido.
async function renderFabrica(container, onOpenOrder) {
  container.innerHTML = `
    <div class="page-header">
      <h2>Fábrica</h2>
      <button class="btn btn-primary" id="btn-generate-pdf">Generar PDF de lo seleccionado</button>
    </div>
    <div id="fabrica-container"><div class="empty-state">Cargando...</div></div>
  `;

  const rows = await Api.get('/api/manufacturing');
  const listEl = document.getElementById('fabrica-container');

  if (rows.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No hay nada pendiente de fabricar por ahora.</div>';
    document.getElementById('btn-generate-pdf').hidden = true;
    return;
  }

  const groups = {};
  rows.forEach(r => {
    const key = r.product_id;
    if (!groups[key]) groups[key] = { label: `${r.product_code || ''} — ${r.product_description || ''}`, items: [] };
    groups[key].items.push(r);
  });

  listEl.innerHTML = Object.values(groups).map(group => {
    const totals = {};
    group.items.forEach(r => { totals[r.presentation] = (totals[r.presentation] || 0) + r.quantity_missing; });
    const totalsLabel = Object.keys(totals).map(p => `${totals[p]} ${p}`).join(' · ');
    return `
      <div class="detail-section">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <h3 style="margin:0;">${escapeHtml(group.label)}</h3>
          <span class="stock-badge" style="background:#fff3e0;color:#ef6c00;font-weight:700;">Total: ${escapeHtml(totalsLabel)}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px;">
          ${group.items.map(r => `
            <label style="display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);padding-bottom:8px;cursor:pointer;">
              <input type="checkbox" class="fabrica-check" data-id="${r.id}" checked>
              <span style="flex:1;">Pedido <a href="#" data-open-order="${r.order_id}" style="font-weight:600;">#${r.order_number}</a> — ${escapeHtml(r.client_label)}</span>
              <strong style="color:var(--pink-dark);">${r.quantity_missing} ${escapeHtml(r.presentation)}</strong>
            </label>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('[data-open-order]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      onOpenOrder(Number(a.dataset.openOrder));
    });
  });

  document.getElementById('btn-generate-pdf').addEventListener('click', async () => {
    const ids = Array.from(container.querySelectorAll('.fabrica-check:checked')).map(el => Number(el.dataset.id));
    if (ids.length === 0) { alert('Elegí al menos un ítem para incluir en el PDF'); return; }
    try {
      const res = await fetch('/api/manufacturing/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo generar el PDF');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      alert(err.message);
    }
  });
}
