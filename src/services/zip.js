'use strict';
/**
 * ZIP sederhana tanpa dependensi tambahan (cukup untuk file backup aplikasi).
 * - Penulis: streaming ke disk, satu file dibaca ke memori pada satu waktu, nama UTF-8, deflate / store.
 * - Pembaca: membaca central directory, mendukung store & deflate (format standar; bisa dibuka Windows Explorer).
 * Batas: total < 4 GB dan < 65.535 file (tanpa ZIP64) — jauh di atas kebutuhan aplikasi ini.
 */
const fs = require('fs');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}
// File yang sudah terkompresi tidak perlu di-deflate lagi
const STORED_EXT = /\.(jpe?g|png|webp|gif|pdf|zip|gz|mp4)$/i;
const LIMIT = 0xffffffff;

class ZipWriter {
  constructor(file) { this.fd = fs.openSync(file, 'w'); this.offset = 0; this.entries = []; }
  _write(buf) { fs.writeSync(this.fd, buf, 0, buf.length, this.offset); this.offset += buf.length; }
  add(name, data, mtime = new Date()) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const nameBuf = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
    let method = 0; let body = buf;
    if (!STORED_EXT.test(name) && buf.length > 64) {
      const z = zlib.deflateRawSync(buf, { level: 6 });
      if (z.length < buf.length) { method = 8; body = z; }
    }
    if (this.offset + body.length + 1024 > LIMIT || this.entries.length >= 65534) throw new Error('Ukuran backup melebihi batas 4 GB / 65.000 file.');
    const crc = crc32(buf); const { time, date } = dosTime(mtime);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8);
    h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18);
    h.writeUInt32LE(buf.length, 22); h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
    this.entries.push({ nameBuf, method, time, date, crc, csize: body.length, size: buf.length, offset: this.offset });
    this._write(h); this._write(nameBuf); this._write(body);
  }
  close() {
    const start = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.time, 12); c.writeUInt16LE(e.date, 14); c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.csize, 20); c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.nameBuf.length, 28); c.writeUInt32LE(e.offset, 42);
      this._write(c); this._write(e.nameBuf);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(this.entries.length, 8); end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12); end.writeUInt32LE(start, 16);
    this._write(end);
    fs.closeSync(this.fd);
  }
  abort() { try { fs.closeSync(this.fd); } catch (_) { /* sudah ditutup */ } }
}

/** Baca daftar isi ZIP. Mengembalikan { entries: [{ name, size }], read(name) -> Buffer, close() }. */
function openZip(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const fail = (m) => { fs.closeSync(fd); throw new Error(m); };
  if (size < 22) fail('File bukan ZIP yang valid.');
  const tailLen = Math.min(size, 65557);
  const tail = Buffer.alloc(tailLen);
  fs.readSync(fd, tail, 0, tailLen, size - tailLen);
  let p = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { p = i; break; }
  if (p < 0) fail('File bukan ZIP yang valid (akhir arsip tidak ditemukan).');
  const count = tail.readUInt16LE(p + 10); const cdSize = tail.readUInt32LE(p + 12); const cdOff = tail.readUInt32LE(p + 16);
  if (cdOff + cdSize > size) fail('File ZIP rusak / tidak lengkap.');
  const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOff);
  const entries = []; let q = 0;
  for (let i = 0; i < count; i++) {
    if (cd.readUInt32LE(q) !== 0x02014b50) fail('Daftar isi ZIP rusak.');
    const method = cd.readUInt16LE(q + 10); const crc = cd.readUInt32LE(q + 16); const csize = cd.readUInt32LE(q + 20); const usize = cd.readUInt32LE(q + 24);
    const nl = cd.readUInt16LE(q + 28); const xl = cd.readUInt16LE(q + 30); const cl = cd.readUInt16LE(q + 32); const off = cd.readUInt32LE(q + 42);
    entries.push({ name: cd.slice(q + 46, q + 46 + nl).toString('utf8'), method, crc, csize, size: usize, offset: off });
    q += 46 + nl + xl + cl;
  }
  const byName = new Map(entries.map((e) => [e.name, e]));
  return {
    entries,
    has: (name) => byName.has(name),
    read(name) {
      const e = typeof name === 'string' ? byName.get(name) : name;
      if (!e) throw new Error(`"${name}" tidak ada di dalam backup.`);
      const h = Buffer.alloc(30); fs.readSync(fd, h, 0, 30, e.offset);
      if (h.readUInt32LE(0) !== 0x04034b50) throw new Error('Data ZIP rusak.');
      const start = e.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
      const body = Buffer.alloc(e.csize); fs.readSync(fd, body, 0, e.csize, start);
      let out;
      if (e.method === 0) out = body;
      else if (e.method === 8) out = zlib.inflateRawSync(body);
      else throw new Error(`Metode kompresi ZIP tidak didukung (${e.method}).`);
      if (out.length !== e.size || crc32(out) !== e.crc) throw new Error(`Isi "${e.name}" rusak (checksum tidak cocok).`);
      return out;
    },
    close() { try { fs.closeSync(fd); } catch (_) { /* sudah ditutup */ } },
  };
}

module.exports = { ZipWriter, openZip, crc32 };
