const MENU_ITEMS = [
  { key: 'inicio', label: 'Inicio', enabled: true },
  { key: 'contactos', label: 'Contactos', enabled: true },
  { key: 'clientes', label: 'Clientes', enabled: true },
  { key: 'productos', label: 'Productos', enabled: true },
  { key: 'presupuestos', label: 'Presupuestos', enabled: true },
  { key: 'pedidos', label: 'Pedidos', enabled: true },
  { key: 'comisiones', label: 'Comisiones', enabled: true },
  { key: 'chat', label: 'Chat', enabled: true },
  { key: 'configuracion', label: 'Configuración', enabled: true },
];

const BellIcon = `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>`;
const LogoutIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;

let notifPollInterval = null;
let currentOnNavigate = null;

function renderLayout(user, activeKey, onNavigate, onLogout) {
  if (notifPollInterval) { clearInterval(notifPollInterval); notifPollInterval = null; }
  if (typeof chatPollInterval !== 'undefined' && chatPollInterval) { clearInterval(chatPollInterval); chatPollInterval = null; }
  currentOnNavigate = onNavigate;

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="layout">
      <div class="sidebar-backdrop" id="sidebar-backdrop" hidden></div>
      <aside class="sidebar" id="sidebar">
        <div class="logo-wrap"><span class="brand">VOLPAIA</span></div>
        <nav id="sidebar-nav"></nav>
      </aside>
      <div class="main-column">
        <header class="topbar">
          <button class="hamburger-btn" id="hamburger-btn" aria-label="Abrir menú">
            <span></span><span></span><span></span>
          </button>
          <div class="topbar-spacer"></div>
          <div class="topbar-right">
            <div class="notif-bell-wrap">
              <button class="notif-bell" id="notif-bell" title="Notificaciones">${BellIcon}<span class="notif-badge" id="notif-badge" hidden>0</span></button>
              <div class="notif-dropdown" id="notif-dropdown" hidden></div>
            </div>
            <span class="topbar-username">Hola, ${escapeHtml(user.name || user.username)}</span>
            <button class="logout-btn" id="logout-btn" title="Cerrar sesión">${LogoutIcon}</button>
          </div>
        </header>
        <main class="content" id="content">
          <div id="page-content"></div>
        </main>
      </div>
    </div>
  `;

  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');

  function closeDrawer() {
    sidebar.classList.remove('open');
    backdrop.hidden = true;
  }
  function openDrawer() {
    sidebar.classList.add('open');
    backdrop.hidden = false;
  }

  document.getElementById('hamburger-btn').addEventListener('click', () => {
    if (sidebar.classList.contains('open')) closeDrawer(); else openDrawer();
  });
  backdrop.addEventListener('click', closeDrawer);

  const nav = document.getElementById('sidebar-nav');
  MENU_ITEMS.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'nav-item' + (item.key === activeKey ? ' active' : '') + (!item.enabled ? ' disabled' : '');
    btn.innerHTML = escapeHtml(item.label) + (item.key === 'chat' ? '<span class="nav-badge" id="chat-nav-badge" hidden>0</span>' : '');
    if (item.enabled) {
      btn.addEventListener('click', () => { closeDrawer(); onNavigate(item.key); });
    } else {
      btn.title = 'Próximamente';
    }
    nav.appendChild(btn);
  });

  document.getElementById('logout-btn').addEventListener('click', onLogout);

  setupNotificationBell();
  refreshChatBadge();
  notifPollInterval = setInterval(() => { refreshNotifBadge(); refreshChatBadge(); }, 45000);

  // El banner de "Activar notificaciones" se sacó a propósito: el sistema de
  // notificaciones push se va a rediseñar de nuevo (a qué pasos avisan, a
  // quién, push vs. botón manual), así que por ahora no se pide el permiso
  // ni se muestra ningún aviso al respecto.

  return document.getElementById('page-content');
}

// Insignia de mensajes sin leer en el ítem "Chat" del menú — es un contador
// aparte del de la campanita, ninguno de los dos alimenta al otro.
async function refreshChatBadge() {
  const badge = document.getElementById('chat-nav-badge');
  if (!badge) return;
  try {
    const { count } = await Api.get('/api/messages/unread-count');
    if (count > 0) {
      badge.hidden = false;
      badge.textContent = count > 9 ? '9+' : String(count);
    } else {
      badge.hidden = true;
    }
  } catch (e) { /* sesión pudo haber expirado */ }
}

async function setupNotificationBell() {
  const bellBtn = document.getElementById('notif-bell');
  const dropdown = document.getElementById('notif-dropdown');

  bellBtn.addEventListener('click', async () => {
    const isOpen = !dropdown.hidden;
    if (isOpen) { dropdown.hidden = true; return; }
    await drawNotifDropdown();
    dropdown.hidden = false;
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.hidden && !e.target.closest('.notif-bell-wrap')) dropdown.hidden = true;
  });

  await refreshNotifBadge();
}

async function refreshNotifBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  try {
    const notifs = await Api.get('/api/notifications');
    if (notifs.length > 0) {
      badge.hidden = false;
      badge.textContent = notifs.length > 9 ? '9+' : String(notifs.length);
    } else {
      badge.hidden = true;
    }
  } catch (e) { /* sesión pudo haber expirado, se maneja en próxima navegación */ }
}

async function drawNotifDropdown() {
  const dropdown = document.getElementById('notif-dropdown');
  const notifs = await Api.get('/api/notifications');
  if (notifs.length === 0) {
    dropdown.innerHTML = `<div class="empty-state" style="padding:20px;">No tenés notificaciones nuevas.</div>`;
    return;
  }
  dropdown.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border);">
      <strong style="font-size:13px;color:var(--pink-dark);">Notificaciones</strong>
      <button id="notif-read-all" style="background:none;border:none;color:var(--cyan);font-size:12px;font-weight:600;">Marcar todas leídas</button>
    </div>
    <div style="max-height:320px;overflow-y:auto;">
      ${notifs.map(n => `
        <div class="notif-item" data-id="${n.id}" data-order-id="${n.order_id || ''}" ${n.order_id ? 'style="cursor:pointer;"' : ''}>
          <div>${escapeHtml(n.message)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:3px;">${escapeHtml(n.created_at)}${n.order_id ? ' · Ver pedido →' : ''}</div>
        </div>
      `).join('')}
    </div>
  `;
  dropdown.querySelector('#notif-read-all').addEventListener('click', async () => {
    await Api.post('/api/notifications/read-all');
    await refreshNotifBadge();
    dropdown.hidden = true;
  });
  dropdown.querySelectorAll('.notif-item').forEach(el => {
    el.addEventListener('click', async () => {
      await Api.post(`/api/notifications/${el.dataset.id}/read`);
      const orderId = el.dataset.orderId;
      dropdown.hidden = true;
      await refreshNotifBadge();
      if (orderId && typeof currentOnNavigate === 'function') {
        currentOnNavigate('pedido-detalle', { id: Number(orderId) });
      } else {
        el.remove();
      }
    });
  });
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

if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
}

// Renderiza el PDF con PDF.js sobre un <canvas> en vez de dejar que cada
// navegador lo muestre a su manera (en iOS el visor nativo de Chrome llegó
// a mostrar en blanco algunos PDF generados con pdfkit, y el atributo
// "download" en un <a> no se respeta de forma confiable en iOS). Así el
// resultado es el mismo en cualquier navegador, y la descarga real se hace
// con fetch + blob, que sí funciona de forma consistente en iOS.
async function openPdfPreview(url, downloadName) {
  const overlay = document.createElement('div');
  overlay.className = 'pdf-preview-overlay';
  overlay.innerHTML = `
    <div class="pdf-preview-box">
      <div class="pdf-preview-toolbar">
        <button class="btn btn-secondary" id="pdf-preview-download">Descargar</button>
        <button class="btn btn-ghost" id="pdf-preview-close">Cerrar ×</button>
      </div>
      <div class="pdf-preview-pages" id="pdf-preview-pages">
        <div class="empty-state">Cargando PDF...</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#pdf-preview-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  let pdfBlob;
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('No se pudo descargar el archivo');
    pdfBlob = await res.blob();
  } catch (err) {
    document.getElementById('pdf-preview-pages').innerHTML = '<div class="empty-state">No se pudo cargar el PDF.</div>';
    return;
  }

  overlay.querySelector('#pdf-preview-download').addEventListener('click', () => {
    const blobUrl = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = downloadName || 'documento.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  });

  const pagesEl = document.getElementById('pdf-preview-pages');
  try {
    const arrayBuffer = await pdfBlob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    pagesEl.innerHTML = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: Math.min(1.5, (pagesEl.clientWidth || 700) / page.getViewport({ scale: 1 }).width) });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.className = 'pdf-preview-canvas';
      pagesEl.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
  } catch (err) {
    pagesEl.innerHTML = '<div class="empty-state">No se pudo mostrar la vista previa. Probá descargarlo.</div>';
  }
}
