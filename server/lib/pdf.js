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

function personLabel(person) {
  const name = [person.first_name, person.last_name].filter(Boolean).join(' ');
  return person.business_name ? `${name} — ${person.business_name}` : name;
}

function money(v) {
  return '$' + Number(v || 0).toLocaleString('es-AR');
}

function shippingLine(shipping_type, shipping_carrier, shipping_address) {
  if (!shipping_type && !shipping_carrier) return null;
  const parts = [];
  if (shipping_type) parts.push(shipping_type);
  if (shipping_carrier) parts.push(`Transporte: ${shipping_carrier}`);
  let line = `Envío: ${parts.join(' · ')}`;
  if (shipping_address) line += ` — ${shipping_address}`;
  return line;
}

function drawHeader(doc, title, subtitle, seller) {
  doc.font('Bold').fillColor(PINK_DARK).fontSize(20).text('VOLPAIA', { continued: false });
  doc.fontSize(14).fillColor('#000000').text(title);
  doc.font('Body');
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor(TEXT_MUTED)
    .text(`${subtitle} · ${new Date().toLocaleDateString('es-AR')}${seller ? ' · Vendedor: ' + seller : ''}`);
  doc.moveDown(1);
}

// `person` es cualquier fila con forma de cliente (un Cliente real, o un
// Presupuesto que todavía no generó cliente pero ya tiene los mismos
// campos completos). `shippingOverride` es opcional: para el PDF de un
// pedido puntual, el envío pudo corregirse distinto al habitual de esa
// persona.
function drawClientBlock(doc, person, shippingOverride) {
  const name = [person.first_name, person.last_name].filter(Boolean).join(' ');
  doc.fillColor('#000000').fontSize(11);
  if (name) doc.text(`Cliente: ${name}`);
  if (person.business_name) doc.text(`Emprendimiento: ${person.business_name}`);
  doc.fontSize(10).fillColor(TEXT_MUTED);
  if (person.fiscal_name) doc.text(`Razón social: ${person.fiscal_name}`);
  if (person.fiscal_id) doc.text(`DNI/CUIT: ${person.fiscal_id}`);
  if (person.phone) doc.text(`Tel: ${person.phone}`);
  if (person.email) doc.text(`Email: ${person.email}`);
  const addressParts = [person.address, person.locality, person.postal_code ? `CP ${person.postal_code}` : null, person.province].filter(Boolean);
  if (addressParts.length) doc.text(`Dirección: ${addressParts.join(', ')}`);
  const shipping = shippingLine(
    (shippingOverride && shippingOverride.shipping_type) || person.shipping_type,
    (shippingOverride && shippingOverride.shipping_carrier) || person.shipping_carrier,
    person.shipping_address
  );
  if (shipping) doc.text(shipping);
  doc.moveDown(1);
}

function drawItemsTable(doc, items) {
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
}

/**
 * PDF del Presupuesto: con precios y totales, lleva la leyenda "Factura X"
 * porque es el documento que se le manda a Damián para facturar. Se genera
 * al crear el presupuesto y se regenera cada vez que se edita mientras está
 * "Pendiente". Al confirmarse, este mismo PDF pasa a ser el del Pedido.
 */
function generateQuotePdf(filePath, { quote, items, seller }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    useOwnFonts(doc);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    drawHeader(doc, 'Presupuesto', `Presupuesto #${quote.quote_number}`, seller);
    drawClientBlock(doc, quote);
    drawItemsTable(doc, items);

    if (quote.notes) {
      doc.moveDown(1);
      doc.fontSize(10).fillColor(TEXT_MUTED).text('Notas:');
      doc.fillColor('#000000').text(quote.notes);
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

    drawHeader(doc, 'Lista de preparación', `Pedido #${order.order_number}`, seller);
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

module.exports = { generateQuotePdf, generatePreparationPdf };
