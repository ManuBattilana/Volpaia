const MENU_ITEMS = [
  { key: 'inicio', label: 'Inicio', enabled: true },
  { key: 'contactos', label: 'Contactos', enabled: false },
  { key: 'clientes', label: 'Clientes', enabled: true },
  { key: 'productos', label: 'Productos', enabled: true },
  { key: 'pedidos', label: 'Pedidos', enabled: false },
  { key: 'comisiones', label: 'Comisiones', enabled: false },
];

function renderLayout(user, activeKey, onNavigate, onLogout) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="logo-wrap"><span class="brand">VOLPAIA</span></div>
        <nav id="sidebar-nav"></nav>
        <div class="sidebar-footer">
          <div class="user-name">Hola, ${escapeHtml(user.name || user.username)}</div>
          <button class="logout-btn" id="logout-btn">Cerrar sesión</button>
        </div>
      </aside>
      <main class="content" id="content"></main>
    </div>
  `;

  const nav = document.getElementById('sidebar-nav');
  MENU_ITEMS.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'nav-item' + (item.key === activeKey ? ' active' : '') + (!item.enabled ? ' disabled' : '');
    btn.textContent = item.label;
    if (item.enabled) {
      btn.addEventListener('click', () => onNavigate(item.key));
    } else {
      btn.title = 'Próximamente';
    }
    nav.appendChild(btn);
  });

  document.getElementById('logout-btn').addEventListener('click', onLogout);

  return document.getElementById('content');
}

function confirmModal({ title, message, confirmLabel = 'Eliminar', onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="modal-cancel">Cancelar</button>
        <button class="btn btn-danger" id="modal-confirm">${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#modal-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#modal-confirm').addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });
}
