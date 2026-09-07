// Posventa: pedidos que ya llegaron a "Seguimiento posventa". Acá se hace
// el contacto post-venta (¿llegó bien? / ¿querés reponer?) sin tener que
// ir pedido por pedido desde la lista general.
function fillTemplate(template, client) {
  const name = [client.first_name, client.last_name].filter(Boolean).join(' ') || client.business_name || '';
  return (template || '').replace(/\{nombre\}/g, name);
}

async function renderPosventa(container, onOpenOrder, onNewQuoteForClient) {
  container.innerHTML = `
    <div class="page-header"><h2>Posventa</h2></div>
    <div id="posventa-container"><div class="empty-state">Cargando...</div></div>
  `;

  const [orders, settings] = await Promise.all([
    Api.get('/api/orders?status=8'),
    Api.get('/api/settings'),
  ]);

  const listEl = document.getElementById('posventa-container');
  if (orders.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No hay pedidos en seguimiento posventa todavía.</div>';
    return;
  }

  function daysSince(dateStr) {
    if (!dateStr) return null;
    const shipped = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((today - shipped) / (1000 * 60 * 60 * 24));
  }

  function doneLabel(doneAt) {
    return doneAt ? `hecho el ${doneAt.slice(0, 10)}` : '';
  }

  listEl.innerHTML = `<div class="list-view">${orders.map(o => {
    const name = [o.first_name, o.last_name].filter(Boolean).join(' ') || '(Sin nombre)';
    const label = o.business_name ? `${name} — ${o.business_name}` : name;
    const days = daysSince(o.shipping_date);
    const days1 = o.reminder_days_1 ?? settings.reminder_days_1;
    const days2 = o.reminder_days_2 ?? settings.reminder_days_2;
    const step1Due = days !== null && days >= days1 && !o.reminder_1_done;
    const step2Due = days !== null && days >= days2 && !o.reminder_2_done;
    const phoneDigits = (o.phone || '').replace(/[^0-9]/g, '');
    return `
      <div class="client-card posventa-row" data-order-id="${o.id}">
        <div class="posventa-main" data-open-order="1">
          <div><span class="client-num">#${o.order_number}</span><span class="client-name">${escapeHtml(label)}</span></div>
          <div class="client-location">${days !== null ? `Despachado hace ${days} día${days === 1 ? '' : 's'}` : 'Sin fecha de despacho'}</div>
        </div>
        ${phoneDigits ? `<a class="whatsapp-circle" data-stop="1" href="https://wa.me/${phoneDigits}" target="_blank" title="WhatsApp">${WhatsappIcon}</a>` : '<span style="width:40px;display:inline-block;"></span>'}
        <div class="posventa-actions">
          ${o.reminder_1_done
            ? `<span class="stock-badge" style="background:#e6f7e8;color:#2e7d32;" title="${escapeHtml(doneLabel(o.reminder_1_done_at))}">✓ ¿Llegó bien?</span>`
            : `<button class="btn ${step1Due ? 'btn-primary' : 'btn-ghost'}" data-mark="1" data-id="${o.id}" data-client-id="${o.client_id}" data-phone="${phoneDigits}">${WhatsappIcon} ¿Llegó bien?</button>`}
          ${o.reminder_2_done
            ? `<span class="stock-badge" style="background:#e6f7e8;color:#2e7d32;" title="${escapeHtml(doneLabel(o.reminder_2_done_at))}">✓ ¿Reponer?</span>`
            : `<button class="btn ${step2Due ? 'btn-primary' : 'btn-ghost'}" data-mark="2" data-id="${o.id}" data-client-id="${o.client_id}" data-phone="${phoneDigits}">${WhatsappIcon} ¿Reponer?</button>`}
          <button class="btn btn-secondary" data-reponer="${o.id}" data-client-id="${o.client_id}">Quiere reponer${o.reponer_clicked_at ? ' ✓' : ''}</button>
        </div>
      </div>
    `;
  }).join('')}</div>`;

  listEl.querySelectorAll('[data-open-order]').forEach(el => {
    el.addEventListener('click', () => onOpenOrder(Number(el.closest('.posventa-row').dataset.orderId)));
  });
  listEl.querySelectorAll('[data-mark]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const which = Number(btn.dataset.mark);
      if (btn.dataset.phone) {
        const client = await Api.get(`/api/clients/${btn.dataset.clientId}`);
        const template = which === 1 ? settings.posventa_msg_1 : settings.posventa_msg_2;
        const text = encodeURIComponent(fillTemplate(template, client));
        window.open(`https://wa.me/${btn.dataset.phone}?text=${text}`, '_blank');
      }
      await Api.post(`/api/orders/${btn.dataset.id}/mark-followup`, { which });
      renderPosventa(container, onOpenOrder, onNewQuoteForClient);
    });
  });
  listEl.querySelectorAll('[data-reponer]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await Api.post(`/api/orders/${btn.dataset.reponer}/mark-reponer`);
      const client = await Api.get(`/api/clients/${btn.dataset.clientId}`);
      onNewQuoteForClient(client);
    });
  });
}
