'use strict';
const express = require('express');
const { requireLogin, has } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

router.get('/', (req, res, next) => {
  if (has(req.user, 'dashboard.view')) return next();
  return next(Object.assign(new Error('Akun Anda belum memiliki akses ke halaman mana pun. Hubungi administrator.'), { status: 403 }));
}, require('./dashboard'));

// Panduan akses dari HP / PC lain + alamat & QR
router.get('/akses-perangkat', async (req, res) => {
  const { addresses } = require('../services/network');
  const { qrSvg } = require('../utils/qr');
  const a = await addresses(req.app, req);
  const caUrl = a.http ? `${a.http}/ca.crt` : null;
  res.render('access/index', {
    title: 'Akses dari HP / PC Lain', a, caUrl,
    qrApp: qrSvg(a.primary), qrCa: caUrl && a.httpsActive ? qrSvg(caUrl) : null,
  });
});

router.use('/', require('./scan'));
router.use('/assets', require('./assets'));
router.use('/employees', require('./employees'));
router.use('/org', require('./org'));
router.use('/maintenance', require('./maintenance'));
router.use('/schedules', require('./schedules'));
router.use('/follow-ups', require('./followups'));
router.use('/reports', require('./reports'));
router.use('/pengaturan', require('./data-settings'));
router.use('/spare-parts', require('./spareparts'));
// Perangkat lain (printer, UPS, scanner): menunggu persetujuan, sementara halaman informasi
router.get('/perangkat-lain', require('../middleware/auth').can('asset.view'), (req, res) => res.render('perangkat-lain/index', { title: 'Printer, UPS & Scanner' }));
router.use('/admin/backup', require('./backup'));
router.use('/admin', require('./admin'));
router.use('/api', require('./api'));
router.use('/files', require('./files'));

module.exports = router;
