// Posventa: pedidos que ya llegaron a "Seguimiento posventa". La lista solo
// muestra el pedido y un botón para entrar al detalle — todo el contacto
// con el cliente (WhatsApp, marcar hecho, historial) vive en esa pantalla
// aparte, no acá.
function fillTemplate(template, client) {
  const name = [client.first_name, client.last_name].filter(Boolean).join(' ') || client.business_name || '';
  return (template || '').replace(/\{nombre\}/g, name);
}

function posventaDaysSince(dateStr) {
  if (!dateStr) return null;
  const shipped = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today - shipped) / (1000 * 60 * 60 * 24));
}

async function renderPosventa(container, onOpenDetail) {
  container.innerHTML = `
    <div class="page-header"><h2>Posventa</h2></div>
    <div id="posventa-container"><div class="empty-state">Cargando...</div></div>
  `;

  const orders = await Api.get('/api/orders?status=8');

  const listEl = document.getElementById('posventa-container');
  if (orders.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No hay pedidos en seguimiento posventa todavía.</div>';
    return;
  }

  listEl.innerHTML = `<div class="list-view">${orders.map(o => {
    const name = [o.first_name, o.last_name].filter(Boolean).join(' ') || '(Sin nombre)';
    const label = o.business_name ? `${name} — ${o.business_name}` : name;
    const days = posventaDaysSince(o.shipping_date);
    const pending = !o.reminder_1_done || !o.reminder_2_done;
    return `
      <div class="client-card posventa-row" data-order-id="${o.id}">
        <div class="posventa-main">
          <div><span class="client-num">#${o.order_number}</span><span class="client-name">${escapeHtml(label)}</span></div>
          <div class="client-location">${days !== null ? `Despachado hace ${days} día${days === 1 ? '' : 's'}` : 'Sin fecha de despacho'}${pending ? ' · Seguimiento pendiente' : ' · Seguimiento completo'}</div>
        </div>
        <button class="btn btn-primary" data-open-detail="${o.id}">Ver detalle</button>
      </div>
    `;
  }).join('')}</div>`;

  listEl.querySelectorAll('[data-open-detail]').forEach(btn => {
    btn.addEventListener('click', () => onOpenDetail(Number(btn.dataset.openDetail)));
  });
}

const POSVENTA_ACTION_LABELS = {
  llego_bien: '¿Llegó bien?',
  reponer_recordatorio: '¿Querés reponer?',
  quiere_reponer: 'Cliente quiere otro pedido',
  client_number_updated: 'N° de cliente actualizado',
};

function posventaHistoryDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Pantalla dedicada de seguimiento posventa de UN pedido: acá se hace todo
// el contacto con el cliente (WhatsApp + marcar hecho) sin mezclarlo con la
// pantalla del pedido en sí, y queda abajo el historial de cada acción.
async function renderPosventaDetail(container, orderId, onBack, onOpenOrder, onNewQuoteForClient) {
  container.innerHTML = `<div class="empty-state">Cargando...</div>`;

  const [order, settings, history] = await Promise.all([
    Api.get(`/api/orders/${orderId}`),
    Api.get('/api/settings'),
    Api.get(`/api/orders/${orderId}/posventa-history`),
  ]);

  async function redraw() {
    const [freshOrder, freshHistory] = await Promise.all([
      Api.get(`/api/orders/${orderId}`),
      Api.get(`/api/orders/${orderId}/posventa-history`),
    ]);
    draw(freshOrder, freshHistory);
  }

  function draw(order, history) {
    const client = order.client || {};
    const name = [client.first_name, client.last_name].filter(Boolean).join(' ') || '(Sin nombre)';
    const label = client.business_name ? `${name} — ${client.business_name}` : name;
    const days = posventaDaysSince(order.shipping_date);
    const phoneDigits = (client.phone || '').replace(/[^0-9]/g, '');

    container.innerHTML = `
      <button class="btn btn-secondary" id="btn-back" style="margin-bottom:16px;">← Volver a Posventa</button>
      <div class="page-header">
        <h2>Seguimiento posventa — Pedido #${order.order_number}</h2>
      </div>
      <div class="detail-section">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">
          <div>
            <div style="font-weight:700;color:var(--pink-dark);font-size:17px;">${escapeHtml(label)}</div>
            <div style="font-size:12.5px;color:var(--text-muted);margin-top:2px;">N° de cliente: #${escapeHtml(String(client.client_number ?? '?'))}</div>
            <div style="font-size:13px;color:var(--text-muted);margin-top:6px;">${days !== null ? `Despachado hace ${days} día${days === 1 ? '' : 's'}` : 'Sin fecha de despacho'}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${phoneDigits ? `<a class="whatsapp-btn-large" href="https://wa.me/${phoneDigits}" target="_blank">${WhatsappIcon} WhatsApp cliente</a>` : ''}
            <button class="btn btn-ghost" id="btn-ver-pedido">Ver pedido completo</button>
          </div>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px;">
          <button class="btn btn-primary" id="btn-mark-1" ${(!phoneDigits || order.reminder_1_done) ? 'disabled' : ''}>${WhatsappIcon} ¿Llegó bien?${order.reminder_1_done ? ' ✓' : ''}</button>
          <button class="btn btn-primary" id="btn-mark-2" ${(!phoneDigits || order.reminder_2_done) ? 'disabled' : ''}>${WhatsappIcon} ¿Querés reponer?${order.reminder_2_done ? ' ✓' : ''}</button>
          <button class="btn btn-warm" id="btn-reponer" ${order.reponer_clicked_at ? 'disabled' : ''}>Cliente quiere otro pedido${order.reponer_clicked_at ? ' ✓' : ''}</button>
        </div>
        ${!phoneDigits ? '<p style="font-size:12.5px;color:var(--danger);margin-top:8px;">Este cliente no tiene teléfono cargado, así que no se puede mandar el WhatsApp automático.</p>' : ''}
      </div>

      <div class="detail-section">
        <h3>Historial de seguimiento</h3>
        ${history.length === 0
          ? '<p style="color:var(--text-muted);">Todavía no se registró ninguna acción.</p>'
          : `<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
              ${history.map(h => `
                <div style="border-bottom:1px solid var(--border);padding-bottom:8px;">
                  <div style="font-weight:600;">${escapeHtml(h.detail || POSVENTA_ACTION_LABELS[h.action] || h.action)}</div>
                  <div style="font-size:12px;color:var(--text-muted);">${posventaHistoryDate(h.created_at)}${h.changed_by_name ? ' · ' + escapeHtml(h.changed_by_name) : ''}</div>
                </div>
              `).join('')}
            </div>`
        }
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', onBack);
    document.getElementById('btn-ver-pedido').addEventListener('click', () => onOpenOrder(order.id));

    if (!order.reminder_1_done) {
      document.getElementById('btn-mark-1').addEventListener('click', async () => {
        if (phoneDigits) {
          const text = encodeURIComponent(fillTemplate(settings.posventa_msg_1, client));
          window.open(`https://wa.me/${phoneDigits}?text=${text}`, '_blank');
        }
        await Api.post(`/api/orders/${order.id}/mark-followup`, { which: 1 });
        await redraw();
      });
    }
    if (!order.reminder_2_done) {
      document.getElementById('btn-mark-2').addEventListener('click', async () => {
        if (phoneDigits) {
          const text = encodeURIComponent(fillTemplate(settings.posventa_msg_2, client));
          window.open(`https://wa.me/${phoneDigits}?text=${text}`, '_blank');
        }
        await Api.post(`/api/orders/${order.id}/mark-followup`, { which: 2 });
        await redraw();
      });
    }
    if (!order.reponer_clicked_at) {
      document.getElementById('btn-reponer').addEventListener('click', async () => {
        await Api.post(`/api/orders/${order.id}/mark-reponer`);
        await redraw();
        onNewQuoteForClient(client);
      });
    }
  }

  draw(order, history);
}
