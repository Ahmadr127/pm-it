'use strict';
/** Alamat aplikasi untuk perangkat lain di jaringan (HP / PC Staff IT) dan untuk label QR. */
const config = require('../config');
const settings = require('./settings');
const { lanAddresses } = require('./tls');

/**
 * @returns {{ primary: string, https: string|null, http: string|null, ip: string|null, httpsActive: boolean, custom: boolean }}
 *  primary = alamat yang dipakai di label QR (pengaturan manual > HTTPS > HTTP).
 */
async function addresses(app, req = null) {
  const tls = app && app.locals && app.locals.tls;
  const ip = lanAddresses()[0] || null; // urutan terbaru: WiFi/LAN asli didahulukan, adapter virtual dibelakangkan
  const http = ip ? `http://${ip}:${config.port}` : null;
  const https = tls && ip ? `https://${ip}:${tls.port}` : null;
  const custom = String((await settings.get('public_base_url', '')) || '').trim().replace(/\/+$/, '');
  // Bila halaman dibuka lewat alamat jaringan (bukan localhost), alamat itulah yang terbukti bisa dijangkau
  let current = null;
  if (req) {
    const host = String(req.get('host') || '');
    if (host && !/^(localhost|127\.|\[?::1\]?)/i.test(host) && !/^192\.168\.(56|99)\./.test(host) && !host.startsWith('169.254.')) current = `${req.protocol}://${host}`;
  }
  return { primary: custom || current || https || http || `http://localhost:${config.port}`, https, http, ip, httpsActive: !!tls, custom: !!custom };
}

module.exports = { addresses };
