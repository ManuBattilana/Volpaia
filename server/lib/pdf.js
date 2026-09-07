const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const PINK_DARK = '#9B1B57';
const PINK_LIGHT = '#FBEAF0';
const CYAN = '#009aa6';
const TEXT_MUTED = '#666666';
const PAGE_MARGIN = 40;
const PAGE_WIDTH = 595.28; // A4 en puntos
const CONTENT_RIGHT = PAGE_WIDTH - PAGE_MARGIN;

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo-trimmed.png');

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

// Encabezado moderno: el logo grande arriba a la izquierda, y a la derecha
// (alineado con el logo) el tipo de documento + número + fecha, para
// aprovechar todo el ancho de la hoja en vez de dejarla vacía arriba.
function drawHeader(doc, title, docNumber, seller) {
  const top = PAGE_MARGIN;
  try {
    doc.image(LOGO_PATH, PAGE_MARGIN, top, { height: 46 });
  } catch (e) {
    doc.font('Bold').fillColor(PINK_DARK).fontSize(26).text('VOLPAIA', PAGE_MARGIN, top);
  }

  doc.font('Bold').fillColor('#000000').fontSize(18).text(title, PAGE_MARGIN, top, { width: CONTENT_RIGHT - PAGE_MARGIN, align: 'right' });
  doc.font('Body').fontSize(11).fillColor(TEXT_MUTED).text(
    `${docNumber} · ${new Date().toLocaleDateString('es-AR')}${seller ? ' · Vendedor: ' + seller : ''}`,
    PAGE_MARGIN, top + 24, { width: CONTENT_RIGHT - PAGE_MARGIN, align: 'right' }
  );

  doc.y = top + 60;
  doc.moveTo(PAGE_MARGIN, doc.y).lineTo(CONTENT_RIGHT, doc.y).strokeColor(PINK_DARK).lineWidth(1.5).stroke();
  doc.moveDown(1.4);
}

// `person` es cualquier fila con forma de cliente (un Cliente real, o un
// Presupuesto que todavía no generó cliente pero ya tiene los mismos
// campos completos). `shippingOverride` es opcional: para el PDF de un
// pedido puntual, el envío pudo corregirse distinto al habitual de esa
// persona. Se dibuja como una tarjeta con fondo suave para separarlo
// claramente del resto, con letra más grande que antes.
function drawClientBlock(doc, person, shippingOverride) {
  const name = [person.first_name, person.last_name].filter(Boolean).join(' ');
  const addressParts = [person.address, person.locality, person.postal_code ? `CP ${person.postal_code}` : null, person.province].filter(Boolean);
  const shipping = shippingLine(
    (shippingOverride && shippingOverride.shipping_type) || person.shipping_type,
    (shippingOverride && shippingOverride.shipping_carrier) || person.shipping_carrier,
    person.shipping_address
  );

  const lines = [];
  if (person.fiscal_name) lines.push(['Razón social', person.fiscal_name]);
  if (person.fiscal_id) lines.push(['DNI/CUIT', person.fiscal_id]);
  if (person.phone) lines.push(['Tel', person.phone]);
  if (person.email) lines.push(['Email', person.email]);
  if (addressParts.length) lines.push(['Dirección', addressParts.join(', ')]);
  if (shipping) lines.push(['Envío', shipping.replace(/^Envío: /, '')]);

  const boxTop = doc.y;
  const lineHeight = 16;
  const headerHeight = person.business_name ? 44 : 26;
  const boxHeight = headerHeight + lines.length * lineHeight + 16;

  doc.roundedRect(PAGE_MARGIN, boxTop, CONTENT_RIGHT - PAGE_MARGIN, boxHeight, 8).fillColor(PINK_LIGHT).fill();

  let y = boxTop + 12;
  doc.font('Bold').fillColor(PINK_DARK).fontSize(15).text(name || '(Sin nombre)', PAGE_MARGIN + 16, y);
  y += 20;
  if (person.business_name) {
    doc.font('Body').fillColor('#000000').fontSize(11.5).text(person.business_name, PAGE_MARGIN + 16, y);
    y += 20;
  }
  doc.font('Body').fontSize(11);
  lines.forEach(([label, value]) => {
    doc.fillColor(TEXT_MUTED).text(`${label}: `, PAGE_MARGIN + 16, y, { continued: true });
    doc.fillColor('#000000').text(value);
    y += lineHeight;
  });

  doc.y = boxTop + boxHeight + 22;
}

// Franja fija cerca del pie de página, para que un presupuesto o pedido
// corto (pocos ítems) no termine con media hoja en blanco — siempre hay
// algo abajo, sea contenido o esta franja de cierre.
//
// OJO con la posición: pdfkit calcula automáticamente cuándo el contenido
// "no entra" en el margen inferior de la página y agrega una hoja nueva
// para seguir escribiendo ahí — si el texto del footer queda demasiado
// pegado al borde inferior (dentro de esa zona de margen), pdfkit lo manda
// de una a la página 2 en silencio, sin ningún error. Por eso se deja un
// colchón de sobra antes del margen inferior real.
function drawFooter(doc) {
  const bottom = doc.page.height - 90;
  doc.moveTo(PAGE_MARGIN, bottom).lineTo(CONTENT_RIGHT, bottom).strokeColor(PINK_DARK).lineWidth(1).stroke();
  doc.font('Bold').fontSize(12).fillColor(PINK_DARK).text('VOLPAIA', PAGE_MARGIN, bottom + 14, { continued: true, lineBreak: false });
  doc.font('Body').fontSize(11).fillColor(TEXT_MUTED).text('   mixed underwear   ·   ¡Gracias por tu pedido!', { lineBreak: false });
}

function drawItemsTable(doc, items) {
  const colX = { desc: PAGE_MARGIN, pres: 275, qty: 355, price: 415, subtotal: 485 };
  const tableTop = doc.y;

  doc.roundedRect(PAGE_MARGIN, tableTop, CONTENT_RIGHT - PAGE_MARGIN, 26, 6).fillColor(PINK_DARK).fill();
  doc.font('Bold').fillColor('#ffffff').fontSize(11);
  const headerY = tableTop + 7;
  doc.text('Producto', colX.desc + 10, headerY);
  doc.text('Present.', colX.pres, headerY);
  doc.text('Cant.', colX.qty, headerY);
  doc.text('P. Unit.', colX.price, headerY);
  doc.text('Subtotal', colX.subtotal, headerY, { width: CONTENT_RIGHT - colX.subtotal, align: 'right' });

  doc.y = tableTop + 26;

  let total = 0;
  doc.font('Body').fontSize(11);
  items.forEach((it, idx) => {
    const subtotal = it.quantity * it.unit_price;
    total += subtotal;
    const rowHeight = 26;
    const y = doc.y;
    if (idx % 2 === 1) {
      doc.rect(PAGE_MARGIN, y, CONTENT_RIGHT - PAGE_MARGIN, rowHeight).fillColor(PINK_LIGHT).fill();
    }
    const textY = y + 7;
    doc.fillColor('#000000');
    doc.text(`${it.product_code || ''} - ${it.product_description || ''}`, colX.desc + 10, textY, { width: colX.pres - colX.desc - 16 });
    doc.text(it.presentation, colX.pres, textY, { width: 75 });
    doc.text(String(it.quantity), colX.qty, textY, { width: 55 });
    doc.text(money(it.unit_price), colX.price, textY, { width: 65 });
    doc.text(money(subtotal), colX.subtotal, textY, { width: CONTENT_RIGHT - colX.subtotal, align: 'right' });
    doc.y = y + rowHeight;
  });

  doc.moveTo(PAGE_MARGIN, doc.y).lineTo(CONTENT_RIGHT, doc.y).strokeColor('#dddddd').stroke();
  doc.moveDown(0.6);
  doc.font('Bold').fontSize(16).fillColor(PINK_DARK).text(`Total: ${money(total)}`, PAGE_MARGIN, doc.y, { width: CONTENT_RIGHT - PAGE_MARGIN, align: 'right' });
  doc.moveDown(0.5);
}

/**
 * PDF del Presupuesto: con precios y totales, lleva la leyenda "Factura X"
 * porque es el documento que se le manda a Damián para facturar. Se genera
 * al crear el presupuesto y se regenera cada vez que se edita mientras está
 * "Pendiente". Al confirmarse, este mismo PDF pasa a ser el del Pedido.
 */
function generateQuotePdf(filePath, { quote, items, seller }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4' });
    useOwnFonts(doc);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    drawHeader(doc, 'Presupuesto', `N° ${quote.quote_number}`, seller);
    drawClientBlock(doc, quote);
    drawItemsTable(doc, items);

    if (quote.notes) {
      doc.moveDown(0.8);
      doc.font('Bold').fontSize(11).fillColor(PINK_DARK).text('Notas');
      doc.font('Body').fontSize(11).fillColor('#000000').text(quote.notes);
    }

    drawFooter(doc);
    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

/**
 * PDF de preparación (sin precios), con casillero grande para tildar cada
 * ítem a medida que se separa la mercadería. Mismo encabezado y tarjeta de
 * cliente que el presupuesto, para que se vea como parte del mismo
 * sistema — pero acá el checklist es lo protagonista, con texto e íconos
 * bien grandes para que se pueda usar de un vistazo parado en el depósito.
 */
function generatePreparationPdf(filePath, { order, items, client, seller }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4' });
    useOwnFonts(doc);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    drawHeader(doc, 'Lista de preparación', `Pedido #${order.order_number}`, seller);
    drawClientBlock(doc, client, order);

    doc.font('Bold').fontSize(13).fillColor(PINK_DARK).text(`Ítems a preparar (${items.length})`);
    doc.moveDown(0.6);

    items.forEach((it, idx) => {
      const boxSize = 22;
      const rowHeight = 40;
      const y = doc.y;
      if (idx % 2 === 1) {
        doc.rect(PAGE_MARGIN, y, CONTENT_RIGHT - PAGE_MARGIN, rowHeight).fillColor(PINK_LIGHT).fill();
      }
      doc.roundedRect(PAGE_MARGIN + 8, y + (rowHeight - boxSize) / 2, boxSize, boxSize, 4)
        .lineWidth(1.6).strokeColor(CYAN).stroke();

      doc.font('Bold').fillColor('#000000').fontSize(13.5).text(
        `${it.product_code || ''} - ${it.product_description || ''}`,
        PAGE_MARGIN + 44, y + 7, { width: 330 }
      );
      doc.font('Body').fillColor(TEXT_MUTED).fontSize(11).text(
        it.presentation,
        PAGE_MARGIN + 44, y + 23
      );
      doc.font('Bold').fillColor(PINK_DARK).fontSize(16).text(
        `x${it.quantity}`, 0, y + (rowHeight - 16) / 2, { width: CONTENT_RIGHT - 6, align: 'right' }
      );
      doc.y = y + rowHeight;
    });

    drawFooter(doc);
    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

module.exports = { generateQuotePdf, generatePreparationPdf };
