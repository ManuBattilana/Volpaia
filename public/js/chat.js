// Chat interno simple entre los dos usuarios de Volpaia. Es independiente de
// la campanita de notificaciones: acá solo viven los mensajes que se
// escriben entre Melany y Darío.
//
// "Visto" se marca en un único momento bien concreto: cuando la persona
// entra a esta pantalla navegando de verdad (tocar "Chat" en el menú, la
// campanita de mensajes, o abrir la notificación push). No se usa
// document.visibilityState/hasFocus para esto — esa API del navegador es
// poco confiable en las PWA instaladas en iOS (puede seguir diciendo
// "visible" con la app en segundo plano), y terminaba marcando como leído
// un mensaje que la otra persona nunca llegó a abrir. El polling de acá en
// adelante solo refresca la lista de mensajes, nunca marca como leído.
let chatPollInterval = null;

function renderChat(container, currentUser) {
  container.innerHTML = `
    <div class="page-header"><h2>Chat interno</h2></div>
    <div class="chat-box">
      <div class="chat-messages" id="chat-messages"><div class="empty-state">Cargando mensajes...</div></div>
      <form class="chat-input-row" id="chat-form">
        <input type="text" id="chat-input" class="text-input" placeholder="Escribí un mensaje..." autocomplete="off">
        <button type="submit" class="btn btn-primary">Enviar</button>
      </form>
    </div>
  `;

  async function loadMessages(scrollToEnd) {
    const list = document.getElementById('chat-messages');
    if (!list) return;
    let messages;
    try {
      messages = await Api.get('/api/messages');
    } catch (e) {
      return;
    }
    if (!document.getElementById('chat-messages')) return;
    if (messages.length === 0) {
      list.innerHTML = '<div class="empty-state">Todavía no hay mensajes. ¡Escribí el primero!</div>';
    } else {
      list.innerHTML = messages.map(m => {
        const mine = m.sender_id === currentUser.id;
        return `
          <div class="chat-bubble-row ${mine ? 'mine' : ''}">
            <div class="chat-bubble ${mine ? 'mine' : ''}">
              ${!mine ? `<div class="chat-sender">${escapeHtml(m.sender_name)}</div>` : ''}
              <div class="chat-text">${escapeHtml(m.body)}</div>
              <div class="chat-time">${formatChatTime(m.created_at)}${mine ? (m.read ? ' · Visto' : ' · Enviado') : ''}</div>
            </div>
          </div>
        `;
      }).join('');
    }
    if (scrollToEnd) list.scrollTop = list.scrollHeight;
  }

  document.getElementById('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    try {
      await Api.post('/api/messages', { body });
      await loadMessages(true);
    } catch (err) {
      alert(err.message);
    }
  });

  // Entrar a esta pantalla ES el gesto de "leer el chat": se carga el
  // historial y se marca todo como visto en el mismo momento, una sola vez.
  loadMessages(true);
  Api.post('/api/messages/read-all').then(() => { if (typeof refreshChatBadge === 'function') refreshChatBadge(); }).catch(() => {});

  if (chatPollInterval) clearInterval(chatPollInterval);
  chatPollInterval = setInterval(() => loadMessages(false), 5000);
}

function formatChatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
