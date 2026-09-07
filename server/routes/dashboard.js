const express = require('express');
const { checkReminders } = require('../lib/reminders');
const ordersRouterFactory = require('./orders');

const STATUSES = ordersRouterFactory.STATUSES;
const LAST_INDEX = ordersRouterFactory.LAST_INDEX;

module.exports = function dashboardRouterFactory(db) {
const router = express.Router();

router.get('/', (req, res) => {
  checkReminders(db);

  const pendingRows = db.prepare(`
    SELECT status_index, COUNT(*) AS count
    FROM orders
    WHERE cancelled = 0 AND status_index < ?
    GROUP BY status_index
    ORDER BY status_index ASC
  `).all(LAST_INDEX);
  const pendingByStatus = pendingRows.map(r => ({
    status_index: r.status_index,
    label: STATUSES[r.status_index],
    count: r.count,
  }));
  const pendingTotal = pendingByStatus.reduce((sum, r) => sum + r.count, 0);

  const commissionMonth = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
    FROM commissions
    WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
  `).get();

  const commissionUnpaid = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
    FROM commissions WHERE paid = 0
  `).get();

  const topProducts = db.prepare(`
    SELECT p.id, p.code, p.description, SUM(oi.quantity) AS total_quantity
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE o.cancelled = 0 AND o.created_at >= datetime('now', '-30 days')
    GROUP BY p.id
    ORDER BY total_quantity DESC
    LIMIT 5
  `).all();

  const remindersPending = db.prepare(`
    SELECT COUNT(*) AS count FROM notifications WHERE type = 'reminder' AND read = 0
  `).get().count;

  res.json({
    pendingByStatus,
    pendingTotal,
    commissionMonth: { total: commissionMonth.total, count: commissionMonth.count },
    commissionUnpaid: { total: commissionUnpaid.total, count: commissionUnpaid.count },
    topProducts,
    remindersPending,
  });
});

return router;
};
