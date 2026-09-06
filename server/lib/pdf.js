const fs = require('fs');
const PDFDocument = require('pdfkit');

const PINK_DARK = '#9B1B57';
const TEXT_MUTED = '#666666';

function clientLabel(client) {
  const name = [client.first_name, client.last_name].filter(Boolean).join(' ');
  return client.business_name ? `${name} — ${client.business_name}` : name;
}

function money(v) {
  return '$' + Number(v || 0).toLocaleString('es-AR');
}

function drawHeader(doc, title, order) {
  doc.fillColor(PINK_DARK).fontSize(20).text('VOLPAIA', { continued: false });
  doc.fontSize(14).fillColor('#000000').text(title);
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor(TEXT_MUTED)
    .text(`Pedido #${order.order_number} · ${new Date().toLocaleDateString('es-AR')}`);
  doc.moveDown(1);
}

/**
 * PDF completo del pedido, con precios. Se genera al crear el pedido y se
 * regenera cada vez que se edita mientras está en "Pedido creado".
 */
function generateOrderPdf(filePath, { order, items, client }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    drawHeader(doc, 'Pedido', order);

    doc.fillColor('#000000').fontSize(11).text(`Cliente: ${clientLabel(client)}`);
    if (client.phone) doc.fontSize(10).fillColor(TEXT_MUTED).text(`Tel: ${client.phone}`);
    doc.moveDown(1);

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

    doc.moveDown(1);
    doc.fontSize(8).fillColor(TEXT_MUTED)
      .text('El envío no está incluido en este monto; se abona por separado directo al transportista.');

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
function generatePreparationPdf(filePath, { order, items, client }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    drawHeader(doc, 'Lista de preparación', order);
    doc.fillColor('#000000').fontSize(11).text(`Cliente: ${clientLabel(client)}`);
    doc.moveDown(1.2);

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
