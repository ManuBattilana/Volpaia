const WhatsappIcon = `<svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.198.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12.001 2C6.478 2 2 6.478 2 12c0 1.89.525 3.66 1.438 5.166L2 22l4.958-1.404A9.953 9.953 0 0012.001 22C17.523 22 22 17.523 22 12S17.523 2 12.001 2zm0 18.062c-1.69 0-3.29-.457-4.66-1.256l-.334-.198-3.11.88.84-3.04-.217-.34A8.006 8.006 0 014 12c0-4.411 3.589-8 8.001-8 4.412 0 8 3.589 8 8s-3.588 8.062-8 8.062z"/></svg>`;

const State = { clients: [], search: '', favoriteOnly: false };

async function loadClients() {
  const params = new URLSearchParams();
  if (State.search) params.set('q', State.search);
  if (State.favoriteOnly) params.set('favorite', '1');
  State.clients = await Api.get('/api/clients?' + params.toString());
}

function clientCard(c) {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '(Sin nombre)';
  const location = [c.locality, c.province].filter(Boolean).join(', ');
  const phoneDigits = (c.phone || '').replace(/[^0-9]/g, '');
  return `
    <div class="client-card" data-id="${c.id}">
      <button class="star-btn ${c.favorite ? 'active' : ''}" data-fav="${c.id}" title="Favorito">${c.favorite ? '★' : '☆'}</button>
      <div class="client-info">
        <div><span class="client-num">#${c.client_number}</span><span class="client-name">${escapeHtml(name)}${c.business_name ? ' — <span class="client-business">' + escapeHtml(c.business_name) + '</span>' : ''}</span></div>
        <div class="client-location">${escapeHtml(location)}</div>
      </div>
      ${phoneDigits ? `<a class="whatsapp-circle" data-stop="1" href="https://wa.me/${phoneDigits}" target="_blank" title="WhatsApp">${WhatsappIcon}</a>` : '<span style="width:40px;display:inline-block;"></span>'}
    </div>
  `;
}

async function renderClientesList(container, onOpen) {
  container.innerHTML = `
    <div class="page-header">
      <h2>Clientes</h2>
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-new-client">+ Nuevo cliente</button>
      </div>
    </div>
    <div class="search-bar">
      <input type="text" id="client-search" placeholder="Buscar por nombre, emprendimiento, localidad...">
      <button class="filter-chip" id="fav-filter">★ Solo favoritos</button>
    </div>
    <div id="clients-container" class="list-view"><div class="empty-state">Cargando...</div></div>
  `;

  const searchInput = document.getElementById('client-search');
  searchInput.value = State.search;
  const favBtn = document.getElementById('fav-filter');
  if (State.favoriteOnly) favBtn.classList.add('active');

  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      State.search = searchInput.value.trim();
      await refreshList();
    }, 250);
  });

  favBtn.addEventListener('click', async () => {
    State.favoriteOnly = !State.favoriteOnly;
    favBtn.classList.toggle('active', State.favoriteOnly);
    await refreshList();
  });

  document.getElementById('btn-new-client').addEventListener('click', () => onOpen(null));

  async function refreshList() {
    const listEl = document.getElementById('clients-container');
    await loadClients();
    if (State.clients.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No se encontraron clientes.</div>`;
      return;
    }
    listEl.innerHTML = State.clients.map(clientCard).join('');
    listEl.querySelectorAll('.client-card').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-stop]') || e.target.closest('[data-fav]')) return;
        onOpen(Number(el.dataset.id));
      });
    });
    listEl.querySelectorAll('[data-fav]').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = Number(el.dataset.fav);
        await Api.patch(`/api/clients/${id}/favorite`);
        await refreshList();
      });
    });
  }

  await refreshList();
}

const CLIENT_SECTIONS = [
  {
    title: 'Datos de contacto',
    fields: [
      { key: 'first_name', label: 'Nombre' },
      { key: 'last_name', label: 'Apellido' },
      { key: 'business_name', label: 'Local / Emprendimiento' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Celular' },
    ]
  },
  {
    title: 'Datos fiscales',
    fields: [
      { key: 'fiscal_name', label: 'Razón social' },
      { key: 'fiscal_id', label: 'CUIL / DNI' },
    ]
  },
  {
    title: 'Ubicación',
    fields: [
      { key: 'address', label: 'Dirección' },
      { key: 'locality', label: 'Localidad' },
      { key: 'postal_code', label: 'Código postal' },
      { key: 'province', label: 'Provincia' },
    ]
  },
  {
    title: 'Envío',
    fields: [
      { key: 'shipping_type', label: 'Tipo de envío', type: 'select', options: ['', 'Domicilio', 'Sucursal'] },
      { key: 'shipping_carrier', label: 'Transporte habitual' },
      { key: 'shipping_address', label: 'Dirección de envío (si es distinta)', full: true },
    ]
  },
  {
    title: 'Redes sociales',
    fields: [
      { key: 'website', label: 'Sitio web' },
      { key: 'facebook', label: 'Facebook' },
      { key: 'instagram', label: 'Instagram' },
      { key: 'tiktok', label: 'TikTok' },
    ]
  },
];

function normalizeUrl(u) {
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) return 'https://' + u;
  return u;
}

function renderFieldView(field, client) {
  const val = client[field.key];
  const isSocial = ['website', 'facebook', 'instagram', 'tiktok'].includes(field.key);
  let inner;
  if (isSocial && val) {
    inner = `<a class="social-link" href="${escapeHtml(normalizeUrl(val))}" target="_blank">Ver perfil ↗</a>`;
  } else if (val) {
    inner = escapeHtml(val);
  } else {
    inner = '<span class="value empty">Sin datos</span>';
  }
  return `<div class="field ${field.full ? 'full' : ''}"><label>${field.label}</label><div class="value">${inner}</div></div>`;
}

function renderFieldEdit(field, client) {
  const val = client[field.key] || '';
  if (field.type === 'select') {
    const opts = field.options.map(o => `<option value="${escapeHtml(o)}" ${o === val ? 'selected' : ''}>${o || '—'}</option>`).join('');
    return `<div class="field ${field.full ? 'full' : ''}"><label>${field.label}</label><select data-field="${field.key}">${opts}</select></div>`;
  }
  return `<div class="field ${field.full ? 'full' : ''}"><label>${field.label}</label><input type="${field.type || 'text'}" data-field="${field.key}" value="${escapeHtml(val)}"></div>`;
}

async function renderClientDetail(container, clientId, onBack, onDeleted, onNewQuote) {
  let client = clientId ? await Api.get(`/api/clients/${clientId}`) : {
    client_number: null, first_name: '', last_name: '', business_name: '', favorite: 0
  };
  let editing = !clientId;

  function draw() {
    const name = [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Nuevo cliente';
    const title = client.client_number ? `CLIENTE #${client.client_number}` : 'NUEVO CLIENTE';
    const subtitle = client.business_name ? `${name} — ${client.business_name}` : name;
    const phoneDigits = (client.phone || '').replace(/[^0-9]/g, '');

    container.innerHTML = `
      <button class="btn btn-secondary" id="btn-back" style="margin-bottom:16px;">← Volver</button>
      <div class="detail-header">
        <div class="detail-title">
          <div class="eyebrow">${title}</div>
          <h1>${escapeHtml(subtitle)}</h1>
        </div>
        <div class="detail-actions">
          ${phoneDigits ? `<a class="whatsapp-btn-large" href="https://wa.me/${phoneDigits}" target="_blank">${WhatsappIcon} WhatsApp</a>` : ''}
          ${!editing ? `
            ${clientId && onNewQuote ? '<button class="btn btn-secondary" id="btn-new-quote">+ Nuevo presupuesto</button>' : ''}
            <button class="btn btn-secondary" id="btn-edit">Editar</button>
            ${clientId ? '<button class="btn btn-danger" id="btn-delete">Eliminar</button>' : ''}
          ` : `
            <button class="btn btn-primary" id="btn-save">Guardar</button>
            <button class="btn btn-ghost" id="btn-cancel">Cancelar</button>
          `}
        </div>
      </div>
      <div id="sections"></div>
    `;

    const sectionsEl = document.getElementById('sections');
    sectionsEl.innerHTML = CLIENT_SECTIONS.map(sec => `
      <div class="detail-section">
        <h3>${sec.title}</h3>
        <div class="field-grid">
          ${sec.fields.map(f => editing ? renderFieldEdit(f, client) : renderFieldView(f, client)).join('')}
        </div>
      </div>
    `).join('') + `
      <div class="detail-section">
        <h3>Notas / Cuenta corriente</h3>
        ${editing
          ? `<textarea data-field="notes" rows="4" style="width:100%;padding:10px;border-radius:7px;border:1px solid var(--border);background:var(--pink-light);font-family:inherit;">${escapeHtml(client.notes || '')}</textarea>`
          : `<div class="value ${client.notes ? '' : 'empty'}">${client.notes ? escapeHtml(client.notes).replace(/\n/g, '<br>') : 'Sin notas'}</div>`}
      </div>
    `;

    document.getElementById('btn-back').addEventListener('click', onBack);

    if (!editing) {
      const newQuoteBtn = document.getElementById('btn-new-quote');
      if (newQuoteBtn) newQuoteBtn.addEventListener('click', () => onNewQuote(client));
      const editBtn = document.getElementById('btn-edit');
      if (editBtn) editBtn.addEventListener('click', () => { editing = true; draw(); });
      const delBtn = document.getElementById('btn-delete');
      if (delBtn) delBtn.addEventListener('click', () => {
        confirmModal({
          title: 'Eliminar cliente',
          message: `¿Seguro que querés eliminar a "${name}"? Esta acción no se puede deshacer.`,
          onConfirm: async () => {
            await Api.del(`/api/clients/${clientId}`);
            onDeleted();
          }
        });
      });
    } else {
      document.getElementById('btn-save').addEventListener('click', async () => {
        const inputs = container.querySelectorAll('[data-field]');
        const payload = {};
        inputs.forEach(el => { payload[el.dataset.field] = el.value; });
        try {
          if (clientId) {
            client = await Api.put(`/api/clients/${clientId}`, payload);
          } else {
            client = await Api.post('/api/clients', payload);
            clientId = client.id;
          }
          editing = false;
          draw();
        } catch (err) {
          alert(err.message);
        }
      });
      document.getElementById('btn-cancel').addEventListener('click', () => {
        if (!clientId) { onBack(); return; }
        editing = false;
        draw();
      });
    }
  }

  draw();
}
