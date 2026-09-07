// La libreta de stock guarda todo en "unidades sueltas" (una prenda) para
// poder convertir sin drama entre Docena/Pack x3/Unidad — una docena son 12
// prendas, un pack x3 son 3, una unidad es 1. El stock actual de un
// producto es la suma de todos sus movimientos (entradas, salidas y
// ajustes) en unidades.
const UNITS_PER_PRESENTATION = {
  Docena: 12,
  'Pack x3': 3,
  Unidad: 1,
};

function toUnits(presentation, quantity) {
  const factor = UNITS_PER_PRESENTATION[presentation];
  if (!factor) throw new Error(`Presentación inválida: ${presentation}`);
  return Number(quantity) * factor;
}

// Convierte unidades sueltas a cada presentación habilitada del producto,
// para mostrar el stock en la unidad que le resulte más cómoda a quien
// mira la pantalla (puede no ser un número entero — ej: 10 unidades son
// 0.83 docenas — así que se redondea hacia abajo para "cuánto puedo armar
// completo" y se deja el resto como sobrante en unidades sueltas).
function unitsToPresentations(product, totalUnits) {
  const result = {};
  if (product.sale_dozen) {
    result.Docena = Math.floor(totalUnits / UNITS_PER_PRESENTATION.Docena);
  }
  if (product.sale_pack3) {
    result['Pack x3'] = Math.floor(totalUnits / UNITS_PER_PRESENTATION['Pack x3']);
  }
  if (product.sale_unit) {
    result.Unidad = totalUnits;
  }
  return result;
}

function getProductStockUnits(db, productId) {
  const row = db.prepare('SELECT COALESCE(SUM(quantity_units), 0) AS total FROM stock_movements WHERE product_id = ?').get(productId);
  return row.total;
}

module.exports = { UNITS_PER_PRESENTATION, toUnits, unitsToPresentations, getProductStockUnits };
