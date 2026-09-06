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

async function setupPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (window.__volpaiaPushSetupDone) return;
  window.__volpaiaPushSetupDone = true;

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    if (Notification.permission === 'denied') return;

    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      if (Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;
      }
      const { publicKey } = await Api.get('/api/push/vapid-public-key');
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    await Api.post('/api/push/subscribe', subscription.toJSON());
  } catch (err) {
    console.warn('No se pudo activar la notificación push:', err);
  }
}
