'use strict';
/** QR code SVG (tanpa layanan luar). Library: qrcode-generator (MIT) di src/lib. */
const qrcode = require('../lib/qrcode-generator');

function qrSvg(text, { margin = 2, level = 'M' } = {}) {
  const qr = qrcode(0, level);
  qr.addData(String(text));
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin, scalable: true });
}

module.exports = { qrSvg };
