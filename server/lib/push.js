const webpush = require('web-push');

// Las claves VAPID identifican a nuestro servidor ante los navegadores para
// mandar notificaciones push. Se generan una única vez y se guardan en la
// tabla settings — si se regeneraran en cada reinicio, todas las
// suscripciones que ya hicieron los celulares/PCs quedarían inválidas.
function ensureVapidKeys(db) {
  let row = db.prepare('SELECT vapid_public_key, vapid_private_key FROM settings WHERE id = 1').get();
  if (!row || !row.vapid_public_key || !row.vapid_private_key) {
    const keys = webpush.generateVAPIDKeys();
    db.prepare('UPDATE settings SET vapid_public_key = ?, vapid_private_key = ? WHERE id = 1')
      .run(keys.publicKey, keys.privateKey);
    row = { vapid_public_key: keys.publicKey, vapid_private_key: keys.privateKey };
  }
  webpush.setVapidDetails('mailto:manubattilana@gmail.com', row.vapid_public_key, row.vapid_private_key);
  return row.vapid_public_key;
}

function subscriptionsFor(db, userIds) {
  if (!userIds || userIds.length === 0) return db.prepare('SELECT * FROM push_subscriptions').all();
  const placeholders = userIds.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (${placeholders})`).all(...userIds);
}

/**
 * Manda una notificación push a un usuario puntual (userIds = [id]), a
 * varios, o a todos los que tengan suscripción activa (userIds vacío/null).
 * payload: { title, body, url } — se muestra como notificación nativa del
 * sistema operativo en el celular/PC.
 */
function sendPush(db, userIds, payload) {
  const subs = subscriptionsFor(db, userIds);
  const body = JSON.stringify(payload);
  for (const sub of subs) {
    const pushSubscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
    webpush.sendNotification(pushSubscription, body).catch(err => {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        // La suscripción ya no existe del lado del navegador (se desinstaló
        // la PWA, se revocó el permiso, etc.) — la limpiamos.
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      } else {
        console.error('Error enviando notificación push:', err && err.message);
      }
    });
  }
}

module.exports = { ensureVapidKeys, sendPush };
