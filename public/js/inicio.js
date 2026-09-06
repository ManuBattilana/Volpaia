async function renderInicio(container, user, onNavigate) {
  container.innerHTML = `
    <div class="greeting">Hola 👋 ${escapeHtml(user.name || user.username)}</div>
    <div class="greeting-sub">Este es tu resumen de hoy.</div>
    <div id="dashboard-widgets" class="dashboard-grid" style="margin-top:12px;">
      <div class="empty-state">Cargando...</div>
    </div>
  `;

  let stats;
  try {
    stats = await Api.get('/api/dashboard');
  } catch (err) {
    document.getElementById('dashboard-widgets').innerHTML = `<div class="empty-state">No se pudo cargar el resumen.</div>`;
    return;
  }

  const widgetsEl = document.getElementById('dashboard-widgets');
  widgetsEl.innerHTML = `
    <div class="dash-card" style="cursor:default;">
      <h3>Pedidos pendientes</h3>
      ${stats.pendingByStatus.length === 0
        ? '<p>No hay pedidos en curso.</p>'
        : `<div style="display:flex;flex-direction:column;gap:6px;margin-top:6px;">
            ${stats.pendingByStatus.map(s => `
              <button class="widget-row" data-status="${s.status_index}">
                <span>${escapeHtml(s.label)}</span>
                <span class="stock-badge" style="background:#f0d3de;color:var(--pink-dark);">${s.count}</span>
              </button>
            `).join('')}
          </div>`
      }
    </div>

    <div class="dash-card" style="cursor:default;">
      <h3>Comisiones</h3>
      <p style="font-size:22px;font-weight:700;color:var(--pink-dark);margin:6px 0 2px;">${formatMoney(stats.commissionMonth.total)}</p>
      <p style="margin:0;">generadas este mes (${stats.commissionMonth.count})</p>
      ${stats.commissionUnpaid.count > 0 ? `<p style="margin-top:8px;color:#ef6c00;font-weight:600;">${formatMoney(stats.commissionUnpaid.total)} sin cobrar (${stats.commissionUnpaid.count})</p>` : ''}
      <button class="btn btn-ghost" id="btn-go-commissions" style="margin-top:10px;">Ver comisiones</button>
    </div>

    <div class="dash-card" style="cursor:default;">
      <h3>Productos más vendidos</h3>
      <p style="font-size:12px;color:var(--text-muted);margin-top:-4px;">Últimos 30 días</p>
      ${stats.topProducts.length === 0
        ? '<p>Todavía no hay ventas en este período.</p>'
        : `<ol style="margin:6px 0 0;padding-left:18px;">
            ${stats.topProducts.map(p => `<li style="margin-bottom:4px;">${escapeHtml(p.code || '')} — ${escapeHtml(p.description || '')} <strong>(${p.total_quantity})</strong></li>`).join('')}
          </ol>`
      }
    </div>

    <div class="dash-card" style="cursor:default;">
      <h3>Recordatorios</h3>
      <p style="font-size:22px;font-weight:700;color:${stats.remindersPending > 0 ? '#ef6c00' : 'var(--pink-dark)'};margin:6px 0 2px;">${stats.remindersPending}</p>
      <p style="margin:0;">seguimiento${stats.remindersPending === 1 ? '' : 's'} posventa pendiente${stats.remindersPending === 1 ? '' : 's'}</p>
    </div>
  `;

  widgetsEl.querySelectorAll('[data-status]').forEach(btn => {
    btn.addEventListener('click', () => onNavigate('pedidos', { statusFilter: btn.dataset.status }));
  });
  const goCommissions = document.getElementById('btn-go-commissions');
  if (goCommissions) goCommissions.addEventListener('click', () => onNavigate('comisiones'));
}
