// Service worker mínimo: solo existe para poder recibir notificaciones push
// del sistema operativo y reaccionar a que el usuario las toque. No cachea
// nada de la app (no hace falta funcionamiento offline).

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'Volpaia', body: 'Tenés una notificación nueva.', url: '/' };
  if (event.data) {
    try { data = { ...data, ...event.data.json() }; } catch (e) { data.body = event.data.text(); }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Volpaia', {
      body: data.body,
      icon: '/img/icon-192.png',
      badge: '/img/icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) {
          // Antes solo se enfocaba la pestaña ya abierta sin navegarla, así
          // que si la notificación era de un mensaje de chat, la app se
          // quedaba mostrando Inicio en vez de llevar al Chat. Si el
          // navegador soporta client.navigate() se usa para ir directo a la
          // URL pedida; si no, se manda un mensaje a la página para que
          // navegue ella misma (ver window.addEventListener('message') en
          // public/js/app.js).
          if ('navigate' in client) {
            try { await client.navigate(url); } catch (e) { /* algunos navegadores no dejan navegar cross-origin ni cambiar de tab en background */ }
          } else {
            client.postMessage({ type: 'navigate', url });
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
