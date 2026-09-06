// Notificaciones push al dispositivo (celular o PC), separadas de la
// campanita: esto solo se encarga de que el sistema operativo muestre una
// notificación nativa cuando llega un recordatorio o un mensaje de chat,
// aunque la app esté cerrada o en segundo plano.
//
// En iPhone (Safari/Chrome, que usan el motor de Apple), esto solo funciona
// si la app se agregó a la pantalla de inicio (Compartir → "Agregar a
// pantalla de inicio") en iOS 16.4 o superior — es una restricción de Apple,
// no del código. En PC/Mac con Chrome/Edge/Firefox funciona directo desde
// el navegador, sin pasos extra.

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
}

// Se separa en dos pasos porque varios navegadores (Chrome incluido) ignoran
// o bloquean en silencio un Notification.requestPermission() que no venga
// disparado directamente por un click del usuario. Por eso:
// - subscribeIfAlreadyGranted() se puede llamar sola (sin gesto) al entrar
//   a la app, para renovar la suscripción si el permiso ya estaba dado.
// - requestAndSubscribe() se llama desde el click del botón "Activar
//   notificaciones" cuando el permiso todavía no se pidió.
async function subscribeToPush(reg) {
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    const { publicKey } = await Api.get('/api/push/vapid-public-key');
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  await Api.post('/api/push/subscribe', subscription.toJSON());
}

async function setupPushNotifications() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    if (Notification.permission === 'granted') {
      await subscribeToPush(reg);
    }
  } catch (err) {
    console.warn('No se pudo verificar la suscripción push:', err);
  }
}

async function requestAndSubscribePush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: permission };
    await subscribeToPush(reg);
    return { ok: true };
  } catch (err) {
    console.warn('No se pudo activar la notificación push:', err);
    return { ok: false, reason: 'error' };
  }
}
