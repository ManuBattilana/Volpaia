// Panel de notificaciones agrupadas por tipo, para no tener que revisar una
// lista mezclada de pedidos, recordatorios de posventa, etc.
const NOTIF_GROUP_LABELS = {
  status_change: 'Pedidos',
  reminder: 'Posventa',
};

function notifGroupLabel(type) {
  return NOTIF_GROUP_LABELS[type] || 'Otras';
}

async function renderNotificaciones(container, onOpenOrder) {
  container.innerHTML = `
    <div class="page-header">
      <h2>Notificaciones</h2>
      <button class="btn btn-secondary" id="btn-notif-read-all">Marcar todas leídas</button>
    </div>
    <div id="notif-groups-container"><div class="empty-state">Cargando...</div></div>
  `;

  async function load() {
    const notifs = await Api.get('/api/notifications');
    const groupsEl = document.getElementById('notif-groups-container');
    if (notifs.length === 0) {
      groupsEl.innerHTML = '<div class="empty-state">No tenés notificaciones sin ver.</div>';
      return;
    }
    const groups = {};
    notifs.forEach(n => {
      const label = notifGroupLabel(n.type);
      if (!groups[label]) groups[label] = [];
      groups[label].push(n);
    });
    groupsEl.innerHTML = Object.keys(groups).map(label => `
      <div class="detail-section">
        <h3>${escapeHtml(label)}</h3>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
          ${groups[label].map(n => `
            <div class="notif-item" data-id="${n.id}" data-order-id="${n.order_id || ''}" style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;${n.order_id ? 'cursor:pointer;' : ''}">
              <div>${escapeHtml(n.message)}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:3px;">${escapeHtml(n.created_at)}${n.order_id ? ' · Ver pedido →' : ''}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    groupsEl.querySelectorAll('.notif-item').forEach(el => {
      el.addEventListener('click', async () => {
        await Api.post(`/api/notifications/${el.dataset.id}/read`);
        if (typeof refreshNotifBadge === 'function') refreshNotifBadge();
        const orderId = el.dataset.orderId;
        if (orderId) { onOpenOrder(Number(orderId)); return; }
        await load();
      });
    });
  }

  document.getElementById('btn-notif-read-all').addEventListener('click', async () => {
    await Api.post('/api/notifications/read-all');
    if (typeof refreshNotifBadge === 'function') refreshNotifBadge();
    await load();
  });

  await load();
}
