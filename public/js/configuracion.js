async function renderConfiguracion(container, currentUser) {
  const [settings, users] = await Promise.all([
    Api.get('/api/settings'),
    Api.get('/api/users'),
  ]);

  container.innerHTML = `
    <div class="page-header"><h2>Configuración</h2></div>

    <div class="detail-section">
      <h3>Seguimiento posventa y comisiones</h3>
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
      </div>
      <button class="btn btn-primary" id="btn-save-settings" style="margin-top:16px;">Guardar cambios</button>
      <div id="settings-msg" style="margin-top:10px;font-size:13px;"></div>
    </div>

    <div class="detail-section">
      <h3>Usuarios</h3>
      <div style="display:flex;flex-direction:column;gap:20px;">
        ${users.map(u => userForm(u)).join('')}
      </div>
    </div>
  `;

  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const msg = document.getElementById('settings-msg');
    try {
      await Api.put('/api/settings', {
        reminder_days_1: document.getElementById('cfg-days1').value,
        reminder_days_2: document.getElementById('cfg-days2').value,
        commission_percentage: document.getElementById('cfg-commission').value,
      });
      msg.style.color = '#2e7d32';
      msg.textContent = 'Guardado correctamente.';
    } catch (err) {
      msg.style.color = 'var(--danger)';
      msg.textContent = err.message;
    }
  });

  users.forEach(u => {
    const form = document.getElementById(`user-form-${u.id}`);
    form.querySelector('.btn-save-user').addEventListener('click', async () => {
      const msgEl = form.querySelector('.user-msg');
      const payload = {
        username: form.querySelector('[data-field="username"]').value,
        name: form.querySelector('[data-field="name"]').value,
      };
      const password = form.querySelector('[data-field="password"]').value;
      if (password) payload.password = password;
      try {
        await Api.put(`/api/users/${u.id}`, payload);
        msgEl.style.color = '#2e7d32';
        msgEl.textContent = 'Usuario actualizado.';
        form.querySelector('[data-field="password"]').value = '';
      } catch (err) {
        msgEl.style.color = 'var(--danger)';
        msgEl.textContent = err.message;
      }
    });
  });
}

function userForm(u) {
  return `
    <div id="user-form-${u.id}" style="border:1px solid var(--border);border-radius:10px;padding:16px;">
      <div style="font-weight:700;color:var(--pink-dark);margin-bottom:10px;">${escapeHtml(u.name || u.username)} ${u.role === 'owner' ? '(dueña)' : ''}</div>
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
