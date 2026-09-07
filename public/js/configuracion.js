async function renderConfiguracion(container, currentUser) {
  const [settings, users] = await Promise.all([
    Api.get('/api/settings'),
    Api.get('/api/users'),
  ]);

  container.innerHTML = `
    <div class="page-header"><h2>Configuración</h2></div>

    <div class="detail-section">
      <h3>Marca</h3>
      <p style="font-size:13px;color:var(--text-muted);margin-top:-6px;">El logo se usa en la barra lateral y en el encabezado de los presupuestos y pedidos en PDF.</p>
      <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-top:12px;">
        <div id="logo-preview-wrap" style="width:160px;height:80px;border:1px dashed var(--border);border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--pink-light);overflow:hidden;">
          ${settings.logo_url ? `<img src="${escapeHtml(settings.logo_url)}" alt="Logo" style="max-width:100%;max-height:100%;">` : '<span style="font-size:12px;color:var(--text-muted);">Sin logo</span>'}
        </div>
        <div>
          <input type="file" id="logo-file" accept="image/png,image/jpeg,image/webp" hidden>
          <button class="btn btn-secondary" id="btn-upload-logo">Subir logo</button>
          <div id="logo-msg" style="margin-top:8px;font-size:12.5px;"></div>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Recordatorios y comisión</h3>
      <div class="field-grid">
        <div class="field">
          <label>Días para el 1er recordatorio (¿le llegó el paquete?)</label>
          <input type="number" min="1" id="cfg-days1" value="${settings.reminder_days_1}">
        </div>
        <div class="field">
          <label>Días para el 2do recordatorio (¿otro pedido?)</label>
          <input type="number" min="1" id="cfg-days2" value="${settings.reminder_days_2}">
        </div>
        <div class="field">
          <label>Porcentaje de comisión</label>
          <input type="number" min="0" step="0.1" id="cfg-commission" value="${settings.commission_percentage}">
        </div>
        <div class="field">
          <label>Teléfono de Damián (WhatsApp)</label>
          <input type="text" id="cfg-damian-phone" placeholder="Ej: 549351..." value="${escapeHtml(settings.damian_phone || '')}">
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Mensajes de WhatsApp de posventa</h3>
      <p style="font-size:12px;color:var(--text-muted);margin-top:-6px;">Podés usar <code>{nombre}</code> y se reemplaza por el nombre del cliente.</p>
      <div class="field-grid" style="margin-top:12px;">
        <div class="field full">
          <label>Mensaje — "¿Llegó bien?"</label>
          <textarea id="cfg-posventa-msg1" rows="2" class="text-input" style="width:100%;font-family:inherit;">${escapeHtml(settings.posventa_msg_1 || '')}</textarea>
        </div>
        <div class="field full">
          <label>Mensaje — "¿Querés reponer?"</label>
          <textarea id="cfg-posventa-msg2" rows="2" class="text-input" style="width:100%;font-family:inherit;">${escapeHtml(settings.posventa_msg_2 || '')}</textarea>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <button class="btn btn-primary" id="btn-save-settings">Guardar cambios</button>
      <div id="settings-msg" style="margin-top:10px;font-size:13px;"></div>
    </div>

    <div class="detail-section">
      <h3>Catálogo de productos (Excel)</h3>
      <p style="font-size:13px;color:var(--text-muted);">Exportá todo el catálogo a un archivo Excel, editalo ahí (precios, stock, lo que sea) y volvé a importarlo — se actualiza por ID, así que no hace falta cargar todo de nuevo.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
        <button class="btn btn-secondary" id="btn-export-products">Exportar a Excel</button>
        <button class="btn btn-secondary" id="btn-import-products">Importar desde Excel</button>
        <input type="file" id="import-products-file" accept=".xlsx" hidden>
      </div>
      <div id="import-products-msg" style="margin-top:10px;font-size:13px;"></div>
      <div id="import-log-list" style="margin-top:16px;"></div>
    </div>

    <div class="detail-section">
      <h3>Notificaciones en este dispositivo</h3>
      <p style="font-size:13px;color:var(--text-muted);">Activalas para recibir avisos de pedidos y mensajes de chat como notificación del celular/PC, aunque no tengas la app abierta.</p>
      <div id="push-status"></div>
    </div>

    <div class="detail-section">
      <h3>Usuarios</h3>
      <div style="display:flex;flex-direction:column;gap:20px;">
        ${users.map(u => u.id === currentUser.id ? userForm(u) : userReadOnly(u)).join('')}
      </div>
    </div>
  `;

  drawPushStatus();
  loadImportLog();

  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const msg = document.getElementById('settings-msg');
    try {
      await Api.put('/api/settings', {
        reminder_days_1: document.getElementById('cfg-days1').value,
        reminder_days_2: document.getElementById('cfg-days2').value,
        commission_percentage: document.getElementById('cfg-commission').value,
        damian_phone: document.getElementById('cfg-damian-phone').value,
        posventa_msg_1: document.getElementById('cfg-posventa-msg1').value,
        posventa_msg_2: document.getElementById('cfg-posventa-msg2').value,
      });
      msg.style.color = '#2e7d32';
      msg.textContent = 'Guardado correctamente.';
    } catch (err) {
      msg.style.color = 'var(--danger)';
      msg.textContent = err.message;
    }
  });

  const logoInput = document.getElementById('logo-file');
  document.getElementById('btn-upload-logo').addEventListener('click', () => logoInput.click());
  logoInput.addEventListener('change', async () => {
    const file = logoInput.files[0];
    if (!file) return;
    const msg = document.getElementById('logo-msg');
    msg.style.color = 'var(--text-muted)';
    msg.textContent = 'Subiendo...';
    try {
      const uploaded = await Api.upload('/api/upload', file);
      await Api.put('/api/settings/logo', { logo_url: uploaded.url });
      msg.style.color = '#2e7d32';
      msg.textContent = 'Logo actualizado.';
      document.getElementById('logo-preview-wrap').innerHTML = `<img src="${escapeHtml(uploaded.url)}" alt="Logo" style="max-width:100%;max-height:100%;">`;
    } catch (err) {
      msg.style.color = 'var(--danger)';
      msg.textContent = err.message || 'No se pudo subir el logo.';
    }
    logoInput.value = '';
  });

  document.getElementById('btn-export-products').addEventListener('click', () => {
    window.open('/api/products/export', '_blank');
  });
  const importInput = document.getElementById('import-products-file');
  document.getElementById('btn-import-products').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    if (!file) return;
    const msg = document.getElementById('import-products-msg');
    msg.style.color = 'var(--text-muted)';
    msg.textContent = 'Importando...';
    try {
      const fd = new FormData();
      fd.append('file', file);
      const result = await Api.request('POST', '/api/products/import', fd, true);
      msg.style.color = '#2e7d32';
      msg.textContent = `Importación lista: ${result.created} nuevo(s), ${result.updated} actualizado(s).`;
      await loadImportLog();
    } catch (err) {
      msg.style.color = 'var(--danger)';
      msg.textContent = err.message || 'No se pudo importar el archivo.';
    }
    importInput.value = '';
  });

  const ownForm = document.getElementById(`user-form-${currentUser.id}`);
  if (ownForm) {
    ownForm.querySelector('.btn-save-user').addEventListener('click', async () => {
      const msgEl = ownForm.querySelector('.user-msg');
      const payload = {
        username: ownForm.querySelector('[data-field="username"]').value,
        name: ownForm.querySelector('[data-field="name"]').value,
      };
      const password = ownForm.querySelector('[data-field="password"]').value;
      if (password) payload.password = password;
      try {
        await Api.put(`/api/users/${currentUser.id}`, payload);
        msgEl.style.color = '#2e7d32';
        msgEl.textContent = 'Usuario actualizado.';
        ownForm.querySelector('[data-field="password"]').value = '';
      } catch (err) {
        msgEl.style.color = 'var(--danger)';
        msgEl.textContent = err.message;
      }
    });
  }
}

function importLogDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function loadImportLog() {
  const el = document.getElementById('import-log-list');
  if (!el) return;
  const logs = await Api.get('/api/products/import-log');
  if (logs.length === 0) {
    el.innerHTML = '<p style="font-size:12.5px;color:var(--text-muted);">Todavía no se importó ningún archivo.</p>';
    return;
  }
  el.innerHTML = `
    <div style="font-size:12px;font-weight:700;color:var(--pink-dark);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Historial de importaciones</div>
    <div style="display:flex;flex-direction:column;gap:10px;max-height:260px;overflow-y:auto;">
      ${logs.map(l => `
        <details style="border:1px solid var(--border);border-radius:8px;padding:8px 12px;">
          <summary style="cursor:pointer;font-size:13px;"><strong>${escapeHtml(l.summary)}</strong> — ${importLogDate(l.created_at)}${l.created_by_name ? ' · ' + escapeHtml(l.created_by_name) : ''}</summary>
          ${l.details ? `<div style="font-size:12px;color:var(--text-muted);margin-top:8px;white-space:pre-line;">${escapeHtml(l.details)}</div>` : '<div style="font-size:12px;color:var(--text-muted);margin-top:8px;">Sin cambios de campos detectados.</div>'}
        </details>
      `).join('')}
    </div>
  `;
}

function drawPushStatus() {
  const el = document.getElementById('push-status');
  if (!el) return;
  if (typeof pushSupported !== 'function' || !pushSupported()) {
    el.innerHTML = '<span style="color:var(--text-muted);font-size:13px;">Este navegador no soporta notificaciones push.</span>';
    return;
  }
  if (Notification.permission === 'granted') {
    el.innerHTML = '<span style="color:#2e7d32;font-weight:600;">✓ Activadas en este dispositivo</span>';
    if (typeof setupPushNotifications === 'function') setupPushNotifications();
    return;
  }
  if (Notification.permission === 'denied') {
    el.innerHTML = '<span style="color:var(--danger);font-size:13px;">Bloqueadas — habilitalas desde la configuración de notificaciones del navegador/sistema para esta app.</span>';
    return;
  }
  el.innerHTML = '<button class="btn btn-primary" id="btn-activate-push">Activar notificaciones</button>';
  document.getElementById('btn-activate-push').addEventListener('click', async () => {
    const result = await requestAndSubscribePush();
    if (result.ok) {
      drawPushStatus();
    } else if (result.reason === 'denied') {
      drawPushStatus();
    } else {
      alert('No se pudo activar la notificación push. Probá de nuevo en unos segundos.');
    }
  });
}

function userForm(u) {
  return `
    <div id="user-form-${u.id}" style="border:1px solid var(--border);border-radius:10px;padding:16px;">
      <div style="font-weight:700;color:var(--pink-dark);margin-bottom:10px;">${escapeHtml(u.name || u.username)} ${u.role === 'owner' ? '(dueña)' : ''} <span style="color:var(--text-muted);font-weight:400;font-size:12px;">— vos</span></div>
      <div class="field-grid">
        <div class="field">
          <label>Nombre</label>
          <input type="text" data-field="name" value="${escapeHtml(u.name || '')}">
        </div>
        <div class="field">
          <label>Usuario</label>
          <input type="text" data-field="username" value="${escapeHtml(u.username)}">
        </div>
        <div class="field">
          <label>Nueva contraseña (opcional)</label>
          <input type="password" data-field="password" placeholder="Dejar en blanco para no cambiar">
        </div>
      </div>
      <button class="btn btn-secondary btn-save-user" style="margin-top:12px;">Guardar</button>
      <div class="user-msg" style="margin-top:8px;font-size:13px;"></div>
    </div>
  `;
}

function userReadOnly(u) {
  return `
    <div style="border:1px solid var(--border);border-radius:10px;padding:16px;opacity:0.75;">
      <div style="font-weight:700;color:var(--pink-dark);margin-bottom:10px;">${escapeHtml(u.name || u.username)} ${u.role === 'owner' ? '(dueña)' : ''}</div>
      <div class="field-grid">
        <div class="field"><label>Nombre</label><div class="value">${escapeHtml(u.name || '')}</div></div>
        <div class="field"><label>Usuario</label><div class="value">${escapeHtml(u.username)}</div></div>
      </div>
      <div style="margin-top:10px;font-size:12.5px;color:var(--text-muted);font-style:italic;">Solo ${escapeHtml(u.name || u.username)} puede cambiar su propio usuario y contraseña.</div>
    </div>
  `;
}
