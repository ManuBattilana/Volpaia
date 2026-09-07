const PRESENTATION_FIELD = {
  Docena: { enabled: 'sale_dozen', price: 'price_dozen' },
  'Pack x3': { enabled: 'sale_pack3', price: 'price_pack3' },
  Unidad: { enabled: 'sale_unit', price: 'price_unit' },
};

// Compartido entre Presupuestos y Pedidos: ambos arman su lista de ítems de
// la misma manera (elegir producto + presentación habilitada, precio de
// lista salvo que se pise a mano).
function validateItems(db, items) {
  const prepared = [];
  for (const item of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
    if (!product) throw new Error(`Producto ${item.product_id} no encontrado`);
    const pres = PRESENTATION_FIELD[item.presentation];
    if (!pres) throw new Error('Presentación inválida');
    if (!product[pres.enabled]) throw new Error(`El producto ${product.code} no tiene habilitada la presentación ${item.presentation}`);
    const listPrice = product[pres.price];
    if (listPrice === null || listPrice === undefined || listPrice === '') {
      throw new Error(`El producto ${product.code} no tiene precio definido para ${item.presentation}`);
    }
    const quantity = Number(item.quantity);
    if (!quantity || quantity <= 0) throw new Error('Cantidad inválida');
    const unitPrice = item.unit_price !== undefined && item.unit_price !== null && item.unit_price !== ''
      ? Number(item.unit_price)
      : listPrice;
    prepared.push({ product_id: product.id, quantity, presentation: item.presentation, unit_price: unitPrice });
  }
  return prepared;
}

module.exports = { validateItems, PRESENTATION_FIELD };
