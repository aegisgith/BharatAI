// /showcase-slot: the booking form (POST /api/showcase/start, then CCAvenue) and
// the "send me the booking link" form (POST /api/showcase/link). Rendered by
// showcasePageHTML() in src/index.tsx; this file only handles the two submits.
(function () {
  'use strict';
  function fmt(n) { return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); });
  }

  var link = document.getElementById('sc-link');
  if (link) {
    link.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var input = document.getElementById('sc-email'), msg = document.getElementById('sc-msg'), btn = link.querySelector('button');
      var email = String(input.value || '').trim();
      msg.className = 'sc-msg';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = 'Please type a full email address.'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
      input.removeAttribute('aria-invalid');
      btn.disabled = true; msg.textContent = '';
      post('/api/showcase/link', { email: email }).then(function (x) {
        btn.disabled = false;
        if (x.ok) { msg.className = 'sc-msg sc-ok'; msg.textContent = x.j.message || 'The booking link is on its way.'; return; }
        msg.textContent = x.j.error || 'That did not work. Please try again.';
      }).catch(function () { btn.disabled = false; msg.textContent = 'Network error. Please try again.'; });
    });
  }

  var form = document.getElementById('sc-form');
  if (!form) return;
  var gst = Number(form.getAttribute('data-gst') || 18);
  var total = document.getElementById('sc-total'), go = document.getElementById('sc-go'), msg = document.getElementById('sc-msg');
  function chosen() { return form.querySelector('input[name="option"]:checked'); }
  function showTotal() {
    var o = chosen(); if (!o || !total) return;
    var base = Number(o.getAttribute('data-price') || 0);
    total.textContent = 'You pay ₹' + fmt(Math.round(base * (100 + gst)) / 100) + ' in total (₹' + fmt(base) + ' + ' + gst + '% GST)';
    if (go && !go.disabled) go.textContent = 'Pay ₹' + fmt(Math.round(base * (100 + gst)) / 100) + ' and book my slot';
  }
  form.addEventListener('change', showTotal);
  showTotal();
  function val(id) { var el = document.getElementById('sc-' + id); return el ? String(el.value || '').trim() : ''; }
  function bad(id, text) {
    var el = document.getElementById('sc-' + id);
    msg.className = 'sc-msg'; msg.textContent = text;
    if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); }
  }
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    ['name', 'company', 'title', 'mobile'].forEach(function (id) { var el = document.getElementById('sc-' + id); if (el) el.removeAttribute('aria-invalid'); });
    if (val('name').length < 2) return bad('name', 'Please add your name as it should appear on the programme.');
    if (!val('company')) return bad('company', 'Please add your company or organisation.');
    if (val('title').length < 4) return bad('title', 'Please give your talk a title.');
    if (val('mobile') && val('mobile').replace(/\D/g, '').length < 10) return bad('mobile', 'Please check the mobile number, or leave it empty.');
    var o = chosen();
    go.disabled = true; msg.textContent = ''; go.textContent = 'Opening secure payment...';
    post('/api/showcase/start', {
      t: form.getAttribute('data-token') || '', option: o ? o.value : 'slot',
      name: val('name'), company: val('company'), designation: val('designation'), mobile: val('mobile'), title: val('title'), summary: val('summary'),
    }).then(function (x) {
      if (x.ok && x.j.pay_url) { location.href = x.j.pay_url; return; }
      go.disabled = false; showTotal();
      if (x.j.field) return bad(x.j.field, x.j.error || 'Please check this field.');
      msg.className = 'sc-msg'; msg.textContent = x.j.error || 'We could not start the payment. Please try again.';
    }).catch(function () { go.disabled = false; showTotal(); msg.className = 'sc-msg'; msg.textContent = 'Network error. Nothing was charged. Please try again.'; });
  });
})();
