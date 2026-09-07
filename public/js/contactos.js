const ContactsState = { search: '' };

const CONTACT_STATUSES = ['Activo', 'Frío', 'Convertido', 'Descartado'];

function contactCard(c) {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '(Sin nombre)';
  const location = [c.locality, c.province].filter(Boolean).join(', ');
  const phoneDigits = (c.phone || '').replace(/[^0-9]/g, '');
  return `
    <div class="client-card" data-id="${c.id}">
      <div class="client-info">
        <div>
          <span class="client-name">${escapeHtml(name)}${c.business_name ? ' — <span class="client-business">' + escapeHtml(c.business_name) + '</span>' : ''}</span>
          <span class="stock-badge" style="margin-left:8px;background:#f0d3de;color:var(--pink-dark);">${escapeHtml(c.status)}</span>
        </div>
        <div class="client-location">${escapeHtml(location)}</div>
      </div>
      ${phoneDigits ? `<a class="whatsapp-circle" data-stop="1" href="https://wa.me/${phoneDigits}" target="_blank" title="WhatsApp">${WhatsappIcon}</a>` : '<span style="width:40px;display:inline-block;"></span>'}
    </div>
  `;
}

async function renderContactosList(container, onOpen) {
  container.innerHTML = `
    <div class="page-header">
      <h2>Contactos</h2>
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-new-contact">+ Nuevo contacto</button>
      </div>
    </div>
    <div class="search-bar">
      <input type="text" id="contact-search" placeholder="Buscar por nombre, emprendimiento, localidad...">
    </div>
    <div id="contacts-container" class="list-view"><div class="empty-state">Cargando...</div></div>
  `;

  const searchInput = document.getElementById('contact-search');
  searchInput.value = ContactsState.search;
  document.getElementById('btn-new-contact').addEventListener('click', () => onOpen(null));

  let timer;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { ContactsState.search = searchInput.value.trim(); refresh(); }, 250);
  });

  async function refresh() {
    const listEl = document.getElementById('contacts-container');
    const params = new URLSearchParams();
    if (ContactsState.search) params.set('q', ContactsState.search);
    const contacts = await Api.get('/api/contacts?' + params.toString());
    if (contacts.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No se encontraron contactos.</div>`;
      return;
    }
    listEl.innerHTML = contacts.map(contactCard).join('');
    listEl.querySelectorAll('.client-card').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-stop]')) return;
        onOpen(Number(el.dataset.id));
      });
    });
  }

  await refresh();
}

const CONTACT_SECTIONS = [
  {
    title: 'Datos de contacto',
    fields: [
      { key: 'first_name', label: 'Nombre' },
      { key: 'last_name', label: 'Apellido' },
      { key: 'business_name', label: 'Emprendimiento / local' },
      { key: 'phone', label: 'Teléfono' },
      { key: 'locality', label: 'Localidad' },
      { key: 'province', label: 'Provincia' },
      { key: 'source', label: 'Origen (cómo llegó)' },
      { key: 'status', label: 'Estado', type: 'select', options: CONTACT_STATUSES },
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

async function renderContactDetail(container, contactId, onBack, onDeleted, onConverted, onNewQuote) {
  let contact = contactId ? await Api.get(`/api/contacts/${contactId}`) : {
    first_name: '', last_name: '', business_name: '', status: 'Activo',
    catalog_sent_history: '', pricelist_sent_history: '', converted_client_id: null
  };
  let editing = !contactId;

  function draw() {
    const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Nuevo contacto';
    const title = contactId ? 'CONTACTO' : 'NUEVO CONTACTO';
    const subtitle = contact.business_name ? `${name} — ${contact.business_name}` : name;
    const phoneDigits = (contact.phone || '').replace(/[^0-9]/g, '');
    const alreadyConverted = !!contact.converted_client_id;

    container.innerHTML = `
      <button class="btn btn-secondary" id="btn-back" style="margin-bottom:16px;">← Volver</button>
      <div class="detail-header">
        <div class="detail-title">
          <div class="eyebrow">${title}${contact.first_contact_date ? ' · desde ' + escapeHtml(contact.first_contact_date.slice(0,10)) : ''}</div>
          <h1>${escapeHtml(subtitle)}</h1>
        </div>
        <div class="detail-actions">
          ${phoneDigits ? `<a class="whatsapp-btn-large" href="https://wa.me/${phoneDigits}" target="_blank">${WhatsappIcon} WhatsApp</a>` : ''}
          ${!editing ? `
            ${contactId && !alreadyConverted ? '<button class="btn btn-primary" id="btn-new-quote">+ Nuevo presupuesto</button>' : ''}
            <button class="btn btn-secondary" id="btn-edit">Editar</button>
            ${contactId ? '<button class="btn btn-danger" id="btn-delete">Eliminar</button>' : ''}
          ` : `
            <button class="btn btn-primary" id="btn-save">Guardar</button>
            <button class="btn btn-ghost" id="btn-cancel">Cancelar</button>
          `}
        </div>
      </div>

      ${alreadyConverted ? `<div class="detail-section" style="border:2px solid #2e7d32;background:#e6f7e8;">
        <strong style="color:#2e7d32;">Convertido a cliente</strong> — <a href="#" id="link-to-client" style="color:#2e7d32;text-decoration:underline;">Ver cliente</a>
      </div>` : ''}

      <div id="sections"></div>

      <div class="detail-section">
        <h3>Seguimiento de envíos</h3>
        <div class="field-grid">
          <div class="field">
            <label>Catálogo</label>
            <button class="btn btn-secondary" id="btn-send-catalog" style="margin-bottom:8px;">Marcar catálogo enviado</button>
            <div class="history-box">${contact.catalog_sent_history ? escapeHtml(contact.catalog_sent_history).replace(/\n/g, '<br>') : 'Sin registros todavía.'}</div>
          </div>
          <div class="field">
            <label>Lista de precios</label>
            <button class="btn btn-secondary" id="btn-send-pricelist" style="margin-bottom:8px;">Marcar lista enviada</button>
            <div class="history-box">${contact.pricelist_sent_history ? escapeHtml(contact.pricelist_sent_history).replace(/\n/g, '<br>') : 'Sin registros todavía.'}</div>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h3>Notas</h3>
        ${editing
          ? `<textarea data-field="notes" rows="4" style="width:100%;padding:10px;border-radius:7px;border:1px solid var(--border);background:var(--pink-light);font-family:inherit;">${escapeHtml(contact.notes || '')}</textarea>`
          : `<div class="value ${contact.notes ? '' : 'empty'}">${contact.notes ? escapeHtml(contact.notes).replace(/\n/g, '<br>') : 'Sin notas'}</div>`}
      </div>
    `;

    const sectionsEl = document.getElementById('sections');
    sectionsEl.innerHTML = CONTACT_SECTIONS.map(sec => `
      <div class="detail-section">
        <h3>${sec.title}</h3>
        <div class="field-grid">
          ${sec.fields.map(f => editing ? renderContactFieldEdit(f, contact) : renderContactFieldView(f, contact)).join('')}
        </div>
      </div>
    `).join('');

    document.getElementById('btn-back').addEventListener('click', onBack);

    if (alreadyConverted) {
      document.getElementById('link-to-client').addEventListener('click', (e) => {
        e.preventDefault();
        onConverted(contact.converted_client_id);
      });
    }

    document.getElementById('btn-send-catalog').addEventListener('click', async () => {
      contact = await Api.post(`/api/contacts/${contactId}/mark-catalog-sent`);
      draw();
    });
    document.getElementById('btn-send-pricelist').addEventListener('click', async () => {
      contact = await Api.post(`/api/contacts/${contactId}/mark-pricelist-sent`);
      draw();
    });

    if (!editing) {
      const editBtn = document.getElementById('btn-edit');
      if (editBtn) editBtn.addEventListener('click', () => { editing = true; draw(); });
      const delBtn = document.getElementById('btn-delete');
      if (delBtn) delBtn.addEventListener('click', () => {
        confirmModal({
          title: 'Eliminar contacto',
          message: `¿Seguro que querés eliminar a "${name}"? Esta acción no se puede deshacer.`,
          onConfirm: async () => {
            await Api.del(`/api/contacts/${contactId}`);
            onDeleted();
          }
        });
      });
      const newQuoteBtn = document.getElementById('btn-new-quote');
      if (newQuoteBtn) newQuoteBtn.addEventListener('click', () => onNewQuote(contact));
    } else {
      document.getElementById('btn-save').addEventListener('click', async () => {
        const payload = {};
        container.querySelectorAll('[data-field]').forEach(el => { payload[el.dataset.field] = el.value; });
        try {
          if (contactId) {
            contact = await Api.put(`/api/contacts/${contactId}`, payload);
          } else {
            contact = await Api.post('/api/contacts', payload);
            contactId = contact.id;
          }
          editing = false;
          draw();
        } catch (err) {
          alert(err.message);
        }
      });
      document.getElementById('btn-cancel').addEventListener('click', () => {
        if (!contactId) { onBack(); return; }
        editing = false;
        draw();
      });
    }
  }

  draw();
}

function renderContactFieldView(field, contact) {
  const val = contact[field.key];
  const isSocial = ['website', 'facebook', 'instagram', 'tiktok'].includes(field.key);
  let inner;
  if (isSocial && val) {
    inner = `<a class="social-link" href="${escapeHtml(normalizeUrl(val))}" target="_blank">Ver perfil ↗</a>`;
  } else if (val) {
    inner = escapeHtml(val);
  } else {
    inner = '<span class="value empty">Sin datos</span>';
  }
  return `<div class="field"><label>${field.label}</label><div class="value">${inner}</div></div>`;
}

function renderContactFieldEdit(field, contact) {
  const val = contact[field.key] || '';
  if (field.type === 'select') {
    const opts = field.options.map(o => `<option value="${escapeHtml(o)}" ${o === val ? 'selected' : ''}>${o}</option>`).join('');
    return `<div class="field"><label>${field.label}</label><select data-field="${field.key}">${opts}</select></div>`;
  }
  return `<div class="field"><label>${field.label}</label><input type="text" data-field="${field.key}" value="${escapeHtml(val)}"></div>`;
}
