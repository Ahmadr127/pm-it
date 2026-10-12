/* Halaman login: tampilkan/sembunyikan password, peringatan Caps Lock, tombol loading. */
(function () {
  'use strict';
  const form = document.querySelector('[data-login-form]');
  if (!form) return;
  const pw = form.querySelector('#password');
  const toggle = form.querySelector('[data-pw-toggle]');
  const caps = form.querySelector('[data-caps]');
  toggle.addEventListener('click', () => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    toggle.innerHTML = show ? '<i class="bi bi-eye-slash"></i>' : '<i class="bi bi-eye"></i>';
    toggle.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
    pw.focus();
  });
  const capsCheck = (e) => { if (e.getModifierState) caps.classList.toggle('d-none', !e.getModifierState('CapsLock')); };
  pw.addEventListener('keydown', capsCheck); pw.addEventListener('keyup', capsCheck);
  pw.addEventListener('blur', () => caps.classList.add('d-none'));
  form.addEventListener('submit', (e) => {
    const u = form.querySelector('#username');
    if (!u.value.trim() || !pw.value) {
      e.preventDefault();
      [u, pw].forEach((el) => el.classList.toggle('is-invalid', !el.value.trim()));
      (u.value.trim() ? pw : u).focus();
      return;
    }
    const btn = form.querySelector('button[type=submit]');
    btn.classList.add('is-loading'); btn.lastChild.textContent = 'Memeriksa...';
  });
  form.addEventListener('input', (e) => e.target.classList.remove('is-invalid'));
  window.addEventListener('pageshow', () => { const b = form.querySelector('button[type=submit]'); b.classList.remove('is-loading'); b.lastChild.textContent = 'Masuk'; });
}());
