const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const PINK_DARK = '#9B1B57';
const TEXT_MUTED = '#666666';

// pdfkit's "standard 14" fonts (Helvetica, etc.) load their metrics from
// data files bundled inside the pdfkit package itself. En algunos hostings
// esa resolución de archivos internos del paquete falla silenciosamente
// (el documento "termina" de generarse sin tirar error, pero el texto no se
// dibuja y queda una página en blanco). Para no depender de eso, registramos
// una tipografía propia que viaja con nuestro código en vez de con pdfkit.
const FONT_REGULAR = path.join(__dirname, '..', 'assets', 'fonts', 'WorkSans-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '..', 'assets', 'fonts', 'WorkSans-Bold.ttf');

function useOwnFonts(doc) {
  doc.registerFont('Body', FONT_REGULAR);
  doc.registerFont('Bold', FONT_BOLD);
  doc.font('Body');
}

function clientLabel(client) {
  const name = [client.first_name, client.last_name].filter(Boolean).join(' ');
  return client.business_name ? `${name} — ${client.business_name}` : name;
}

function money(v) {
  return '$' + Number(v || 0).toLocaleString('es-AR');
}

function shippingLine(client) {
  if (!client.shipping_type && !client.shipping_carrier) return null;
  const parts = [];
  if (client.shipping_type) parts.push(client.shipping_type);
  if (client.shipping_carrier) parts.push(`Transporte: ${client.shipping_carrier}`);
  let line = `Envío: ${parts.join(' · ')}`;
  if (client.shipping_address) line += ` — ${client.shipping_address}`;
  return line;
}

// Recuadro "FACTURA X" como el que usa Damián en sus facturas de papel: no
// es una factura fiscal, es la leyenda habitual para remitos/comprobantes
// internos de venta mayorista. Se dibuja arriba a la derecha del título.
function drawFacturaXBadge(doc) {
  const boxSize = 26;
  const boxX = 470;
  const boxY = 38;
  doc.save();
  doc.lineWidth(1.5).strokeColor('#000000').rect(boxX, boxY, boxSize, boxSize).stroke();
  doc.font('Bold').fontSize(18).fillColor('#000000').text('X', boxX, boxY + 4, { width: boxSize, align: 'center' });
  doc.font('Bold').fontSize(9).text('FACTURA X', boxX - 25, boxY + boxSize + 4, { width: boxSize + 50, align: 'center' });
  doc.restore();
  doc.font('Body');
}

function drawHeader(doc, title, order, seller) {
  // La leyenda "Factura X" solo tiene sentido en el comprobante de venta
  // (el PDF de pedido con precios), no en la lista de preparación interna.
  // doc.text(str, x, y, ...) con x/y explícitos deja el cursor de flujo
  // (doc.x/doc.y) posicionado ahí, así que hay que devolverlo al margen
  // izquierdo o el resto del documento queda arrastrado a esa columna.
  const topY = doc.y;
  if (title === 'Pedido') drawFacturaXBadge(doc);
  doc.x = doc.page.margins.left;
  doc.y = topY;
  doc.font('Bold').fillColor(PINK_DARK).fontSize(20).text('VOLPAIA', { continued: false });
  doc.fontSize(14).fillColor('#000000').text(title);
  doc.font('Body');
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor(TEXT_MUTED)
    .text(`Pedido #${order.order_number} · ${new Date().toLocaleDateString('es-AR')}${seller ? ' · Vendedor: ' + seller : ''}`);
  doc.moveDown(1);
}

function drawClientBlock(doc, client, order) {
  const name = [client.first_name, client.last_name].filter(Boolean).join(' ');
  doc.fillColor('#000000').fontSize(11);
  if (name) doc.text(`Cliente: ${name}`);
  if (client.business_name) doc.text(`Emprendimiento: ${client.business_name}`);
  doc.fontSize(10).fillColor(TEXT_MUTED);
  if (client.fiscal_name) doc.text(`Razón social: ${client.fiscal_name}`);
  if (client.fiscal_id) doc.text(`DNI/CUIT: ${client.fiscal_id}`);
  if (client.phone) doc.text(`Tel: ${client.phone}`);
  if (client.email) doc.text(`Email: ${client.email}`);
  const addressParts = [client.address, client.locality, client.postal_code ? `CP ${client.postal_code}` : null, client.province].filter(Boolean);
  if (addressParts.length) doc.text(`Dirección: ${addressParts.join(', ')}`);
  // El envío del pedido puede haberse corregido puntualmente; si no, se usa
  // el habitual del cliente.
  const shipping = shippingLine({
    shipping_type: (order && order.shipping_type) || client.shipping_type,
    shipping_carrier: (order && order.shipping_carrier) || client.shipping_carrier,
    shipping_address: client.shipping_address,
  });
  if (shipping) doc.text(shipping);
  doc.moveDown(1);
}

/**
 * PDF completo del pedido, con precios. Se genera al crear el pedido y se
 * regenera cada vez que se edita mientras está en "Pedido creado".
 */
function generateOrderPdf(filePath, { order, items, client, seller }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    useOwnFonts(doc);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    drawHeader(doc, 'Pedido', order, seller);
    drawClientBlock(doc, client, order);

    const colX = { desc: 40, pres: 260, qty: 340, price: 400, subtotal: 470 };
    doc.fontSize(10).fillColor(PINK_DARK);
    doc.text('Producto', colX.desc, doc.y, { continued: false });
    doc.text('Present.', colX.pres, doc.y - doc.currentLineHeight());
    doc.text('Cant.', colX.qty, doc.y - doc.currentLineHeight());
    doc.text('P. Unit.', colX.price, doc.y - doc.currentLineHeight());
    doc.text('Subtotal', colX.subtotal, doc.y - doc.currentLineHeight());
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#dddddd').stroke();
    doc.moveDown(0.3);

    let total = 0;
    doc.fillColor('#000000').fontSize(9.5);
    items.forEach(it => {
      const subtotal = it.quantity * it.unit_price;
      total += subtotal;
      const y = doc.y;
      doc.text(`${it.product_code || ''} - ${it.product_description || ''}`, colX.desc, y, { width: 210 });
      doc.text(it.presentation, colX.pres, y, { width: 70 });
      doc.text(String(it.quantity), colX.qty, y, { width: 50 });
      doc.text(money(it.unit_price), colX.price, y, { width: 60 });
      doc.text(money(subtotal), colX.subtotal, y, { width: 80 });
      doc.moveDown(0.8);
    });

    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#dddddd').stroke();
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor(PINK_DARK).text(`Total: ${money(total)}`, { align: 'right' });

    if (order.notes) {
      doc.moveDown(1);
      doc.fontSize(10).fillColor(TEXT_MUTED).text('Notas:');
      doc.fillColor('#000000').text(order.notes);
    }

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

/**
 * PDF de preparación (sin precios), con casillero para tildar cada ítem a
 * medida que se separa la mercadería. Pensado para verse bien también desde
 * el celular.
 */
function generatePreparationPdf(filePath, { order, items, client, seller }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    useOwnFonts(doc);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    drawHeader(doc, 'Lista de preparación', order, seller);
    drawClientBlock(doc, client, order);

    doc.fontSize(11);
    items.forEach(it => {
      const y = doc.y;
      doc.rect(40, y + 1, 12, 12).strokeColor('#999999').stroke();
      doc.fillColor('#000000').text(
        `${it.product_code || ''} - ${it.product_description || ''}  ·  ${it.presentation}  ·  x${it.quantity}`,
        62, y, { width: 480 }
      );
      doc.moveDown(1);
    });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

module.exports = { generateOrderPdf, generatePreparationPdf };
