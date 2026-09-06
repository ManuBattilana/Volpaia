function checkReminders(db) {
  const settings = db.prepare('SELECT reminder_days_1, reminder_days_2 FROM settings WHERE id = 1').get();
  const orders = db.prepare(`
    SELECT * FROM orders
    WHERE status_index >= 8 AND cancelled = 0 AND shipping_date IS NOT NULL
      AND (reminder_1_done = 0 OR reminder_2_done = 0)
  `).all();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const order of orders) {
    const shipDate = new Date(order.shipping_date + 'T00:00:00');
    const days1 = order.reminder_days_1 ?? settings.reminder_days_1;
    const days2 = order.reminder_days_2 ?? settings.reminder_days_2;

    if (!order.reminder_1_done) {
      const due1 = new Date(shipDate);
      due1.setDate(due1.getDate() + days1);
      if (today >= due1) {
        db.prepare('UPDATE orders SET reminder_1_done = 1 WHERE id = ?').run(order.id);
        db.prepare('INSERT INTO notifications (user_id, type, order_id, message) VALUES (NULL, ?, ?, ?)')
          .run('reminder', order.id, `Recordatorio: consultarle al cliente del pedido #${order.order_number} si le llegó bien el paquete`);
      }
    }
    if (!order.reminder_2_done) {
      const due2 = new Date(shipDate);
      due2.setDate(due2.getDate() + days2);
      if (today >= due2) {
        db.prepare('UPDATE orders SET reminder_2_done = 1 WHERE id = ?').run(order.id);
        db.prepare('INSERT INTO notifications (user_id, type, order_id, message) VALUES (NULL, ?, ?, ?)')
          .run('reminder', order.id, `Recordatorio: consultarle al cliente del pedido #${order.order_number} si quiere hacer otro pedido`);
      }
    }
  }
}

module.exports = { checkReminders };
