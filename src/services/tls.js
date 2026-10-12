'use strict';
/**
 * HTTPS lokal tanpa library tambahan.
 * - Membuat CA lokal "PM-IT Local CA" (sekali, berlaku 10 tahun) dan sertifikat server untuk
 *   alamat IP / nama komputer server (diperbarui otomatis bila IP berubah atau hampir kedaluwarsa).
 * - HP / PC lain cukup memasang sertifikat CA (unduh dari /ca.crt) satu kali agar HTTPS dipercaya,
 *   sehingga aplikasi dapat dipasang sebagai PWA dari perangkat tersebut.
 * Sertifikat X.509 disusun manual (DER) dan ditandatangani dengan modul crypto bawaan Node.js.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------- DER encoder minimal ----------
function derLen(n) {
  if (n < 128) return Buffer.from([n]);
  const b = [];
  while (n > 0) { b.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | b.length, ...b]);
}
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
const seq = (...parts) => tlv(0x30, Buffer.concat(parts));
const set = (...parts) => tlv(0x31, Buffer.concat(parts));
const int = (buf) => tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const octet = (b) => tlv(0x04, b);
const utf8 = (s) => tlv(0x0c, Buffer.from(String(s), 'utf8'));
const nul = () => tlv(0x05, Buffer.alloc(0));
const ctx = (n, content) => tlv(0xa0 | n, content); // [n] EXPLICIT / constructed
function bitString(bytes, unused = 0) { return tlv(0x03, Buffer.concat([Buffer.from([unused]), bytes])); }
function oid(str) {
  const p = str.split('.').map(Number);
  const out = [40 * p[0] + p[1]];
  for (const v of p.slice(2)) {
    const st = [v & 0x7f]; let x = Math.floor(v / 128);
    while (x > 0) { st.unshift((x & 0x7f) | 0x80); x = Math.floor(x / 128); }
    out.push(...st);
  }
  return tlv(0x06, Buffer.from(out));
}
function time(d) {
  const p = (n) => String(n).padStart(2, '0');
  const rest = `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  const y = d.getUTCFullYear();
  return y < 2050 ? tlv(0x17, Buffer.from(`${String(y).slice(2)}${rest}`)) : tlv(0x18, Buffer.from(`${y}${rest}`));
}
const SHA256_RSA = seq(oid('1.2.840.113549.1.1.11'), nul());
const dn = (cn, org) => seq(set(seq(oid('2.5.4.10'), utf8(org))), set(seq(oid('2.5.4.3'), utf8(cn))));
const ext = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octet(value));

function ipBytes(ip) {
  if (ip.includes(':')) {
    const [head, tail] = ip.split('::');
    const h = head ? head.split(':') : []; const t = tail !== undefined && tail ? tail.split(':') : [];
    const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
    return Buffer.from(groups.flatMap((g) => { const v = parseInt(g || '0', 16); return [v >> 8, v & 0xff]; }));
  }
  return Buffer.from(ip.split('.').map(Number));
}

function keyId(publicKey) {
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha1').update(spki).digest();
}

/** Susun & tandatangani sertifikat X.509 v3 (SHA-256 / RSA). */
function buildCert({ subject, issuer, publicKey, signKey, issuerKeyId, days, isCA, dnsNames = [], ips = [] }) {
  const serial = crypto.randomBytes(16); serial[0] &= 0x7f;
  const notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  const notAfter = new Date(Date.now() + days * 24 * 3600 * 1000);
  const ski = keyId(publicKey);
  const exts = [
    ext('2.5.29.19', true, isCA ? seq(bool(true)) : seq()), // basicConstraints
    ext('2.5.29.15', true, isCA ? bitString(Buffer.from([0x06]), 1) : bitString(Buffer.from([0xa0]), 5)), // keyUsage
    ext('2.5.29.14', false, octet(ski)), // subjectKeyIdentifier
  ];
  if (issuerKeyId) exts.push(ext('2.5.29.35', false, seq(tlv(0x80, issuerKeyId)))); // authorityKeyIdentifier
  if (!isCA) {
    exts.push(ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1')))); // extKeyUsage: serverAuth
    const names = [...dnsNames.map((n) => tlv(0x82, Buffer.from(n, 'ascii'))), ...ips.map((ip) => tlv(0x87, ipBytes(ip)))];
    exts.push(ext('2.5.29.17', false, seq(...names))); // subjectAltName
  }
  const tbs = seq(
    ctx(0, int(Buffer.from([2]))), int(serial), SHA256_RSA, issuer,
    seq(time(notBefore), time(notAfter)), subject,
    publicKey.export({ type: 'spki', format: 'der' }),
    ctx(3, seq(...exts)),
  );
  const sig = crypto.sign('sha256', tbs, signKey);
  const der = seq(tbs, SHA256_RSA, bitString(sig));
  return { pem: `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`, notAfter };
}

// ---------- Pengelolaan file sertifikat ----------
const ORG = 'PM-IT Asset Monitoring';

/** Alamat IPv4 jaringan lokal komputer ini (urut: 192.168.x, 10.x, 172.16-31.x, lainnya). */
function lanAddresses() {
  // Adapter virtual (VirtualBox, VMware, Hyper-V, WSL, VPN) & alamat 169.254.x diletakkan paling belakang,
  // supaya QR / label memakai alamat jaringan kantor yang sebenarnya (WiFi / Ethernet).
  const VIRTUAL = /virtual|vmware|vbox|hyper-v|vethernet|wsl|docker|loopback|bluetooth|tap|tun|vpn|zerotier|tailscale|hamachi/i;
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ ip: a.address, name });
  }
  const rank = ({ ip, name }) => {
    if (ip.startsWith('169.254.')) return 90;
    let r = ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
    if (VIRTUAL.test(name)) r += 50;
    if (/^192\.168\.(56|99)\./.test(ip)) r += 40; // jaringan bawaan VirtualBox / Docker Desktop
    if (/wi-?fi|wlan|wireless|ethernet|lan/i.test(name)) r -= 0.5;
    return r;
  };
  const uniq = [...new Map(out.map((x) => [x.ip, x])).values()];
  return uniq.sort((a, b) => rank(a) - rank(b)).map((x) => x.ip);
}

function ensureCertificates(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const f = (n) => path.join(dir, n);
  let caKey; let caCertPem;
  if (fs.existsSync(f('ca.key.pem')) && fs.existsSync(f('ca.crt.pem'))) {
    caKey = crypto.createPrivateKey(fs.readFileSync(f('ca.key.pem')));
    caCertPem = fs.readFileSync(f('ca.crt.pem'), 'utf8');
  } else {
    const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    caKey = kp.privateKey;
    const name = dn(`PM-IT Local CA (${os.hostname()})`, ORG);
    caCertPem = buildCert({ subject: name, issuer: name, publicKey: kp.publicKey, signKey: caKey, days: 3650, isCA: true }).pem;
    fs.writeFileSync(f('ca.key.pem'), caKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(f('ca.crt.pem'), caCertPem);
    try { fs.unlinkSync(f('server.meta.json')); } catch (_) { /* belum ada */ }
  }
  const ips = ['127.0.0.1', ...lanAddresses()];
  const dnsNames = [...new Set(['localhost', os.hostname(), os.hostname().toLowerCase()])];
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(f('server.meta.json'), 'utf8')); } catch (_) { meta = null; }
  const fresh = meta && fs.existsSync(f('server.key.pem')) && fs.existsSync(f('server.crt.pem'))
    && JSON.stringify(meta.ips) === JSON.stringify(ips) && JSON.stringify(meta.dnsNames) === JSON.stringify(dnsNames)
    && new Date(meta.notAfter).getTime() - Date.now() > 30 * 24 * 3600 * 1000;
  if (!fresh) {
    const caCert = new crypto.X509Certificate(caCertPem);
    const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const cert = buildCert({
      subject: dn(os.hostname(), ORG), issuer: caIssuer(caCert),
      publicKey: kp.publicKey, signKey: caKey, issuerKeyId: keyId(caCert.publicKey), days: 397, isCA: false, dnsNames, ips,
    });
    fs.writeFileSync(f('server.key.pem'), kp.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(f('server.crt.pem'), cert.pem + caCertPem);
    fs.writeFileSync(f('server.meta.json'), JSON.stringify({ ips, dnsNames, notAfter: cert.notAfter }, null, 2));
  }
  return {
    key: fs.readFileSync(f('server.key.pem')),
    cert: fs.readFileSync(f('server.crt.pem')),
    caPem: caCertPem,
    ips, dnsNames,
  };
}

/** Ambil Name (subject) mentah dari sertifikat CA sebagai issuer. */
function caIssuer(caCert) {
  // Struktur: Certificate ::= SEQ { tbs SEQ { [0] ver, serial, sigAlg, issuer, validity, subject, ... } }
  const der = caCert.raw;
  const read = (buf, off) => { // kembalikan {start, hdr, len, end}
    let len = buf[off + 1]; let hdr = 2;
    if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = (len << 8) | buf[off + 2 + i]; hdr = 2 + n; }
    return { start: off, hdr, len, end: off + hdr + len };
  };
  const cert = read(der, 0);
  const tbs = read(der, cert.start + cert.hdr);
  let off = tbs.start + tbs.hdr;
  const fields = [];
  while (off < tbs.end && fields.length < 6) { const el = read(der, off); fields.push(el); off = el.end; }
  const subject = fields[5]; // [0]ver, serial, sigAlg, issuer, validity, subject
  return der.subarray(subject.start, subject.end);
}

function caDer(caPem) {
  return Buffer.from(caPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
}

module.exports = { ensureCertificates, lanAddresses, caDer, buildCert };
