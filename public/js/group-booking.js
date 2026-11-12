// /group: the group booking form. Rendered by groupPageHTML() in src/index.tsx (the
// GROUP BOOKING block); this file adds and removes people, keeps the total live,
// checks every field the way POST /api/group/start checks it (a refusal is always
// said on screen, next to the field), then hands over to CCAvenue.
// The form is kept in this tab (sessionStorage), so coming back from the payment
// page, or a reload, does not lose the list; the result page clears it once paid.
(function () {
  'use strict';
  var form = document.getElementById('gb-form');
  if (!form) return;
  var GST = Number(form.getAttribute('data-gst') || 18);
  var MIN = Number(form.getAttribute('data-min') || 3);
  // Highest tier first, as the server's GROUP_TIERS: [{ min: 5, pct: 30 }, { min: 3, pct: 15 }].
  var TIERS = []; try { TIERS = JSON.parse(form.getAttribute('data-tiers') || '[]'); } catch (e) { TIERS = []; }
  function pctFor(k) { for (var i = 0; i < TIERS.length; i++) if (k >= TIERS[i].min) return TIERS[i].pct; return 0; }
  var MAX = Number(form.getAttribute('data-max') || 50);
  var PAY = form.getAttribute('data-pay') === '1';
  var KEY = 'bai_group_draft';
  var EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>.]{2,}$/;
  var GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/;
  var FIELDS = ['name', 'email', 'mobile', 'designation'];
  var BUYER = ['name', 'email', 'mobile'];
  var list = document.getElementById('gb-people');
  var tpl = document.getElementById('gb-row');
  var me = document.getElementById('gb-me');
  var addBtn = document.getElementById('gb-add');
  var go = document.getElementById('gb-go');
  var msg = document.getElementById('gb-msg');
  var gst = document.getElementById('gb-gst');
  var busy = false;

  function $(id) { return document.getElementById(id); }
  function val(el) { return el ? String(el.value || '').trim() : ''; }
  function each(nodes, fn) { Array.prototype.forEach.call(nodes, fn); }
  function mobileOk(v) { var d = String(v || '').replace(/\D/g, '').length; return d >= 10 && d <= 15; }
  function money(paise) {
    return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });
  }
  function rows() { return Array.prototype.slice.call(list.querySelectorAll('.gb-person')); }
  function input(row, k) { return row.querySelector('input[name="' + k + '"]'); }
  function blank(row) { return FIELDS.every(function (k) { return !val(input(row, k)); }); }
  function chosen() { return form.querySelector('input[name="pass"]:checked'); }

  function renumber() {
    var all = rows();
    all.forEach(function (r, i) {
      r.querySelector('.gb-person-no').textContent = 'Person ' + (i + 1);
      var x = r.querySelector('.gb-remove');
      x.setAttribute('aria-label', 'Remove person ' + (i + 1));
      x.hidden = all.length <= 1;
    });
    addBtn.disabled = all.length >= MAX;
    $('gb-max').hidden = all.length < MAX;
  }
  function newRow(atTop) {
    var li = tpl.content.firstElementChild.cloneNode(true);
    if (atTop && list.firstElementChild) list.insertBefore(li, list.firstElementChild); else list.appendChild(li);
    renumber();
    return li;
  }

  // n people on the list (empty rows do not count); the price is shown for at least MIN.
  function sums() {
    var o = chosen();
    var was = o ? Number(o.getAttribute('data-list')) : 0;
    var n = rows().filter(function (r) { return !blank(r); }).length, k = Math.max(n, MIN);
    var pct = pctFor(k), unit = was ? Math.round(was * (100 - pct) / 100) : 0;
    var base = k * unit * 100, tax = Math.round(base * GST / 100), off = k * (was - unit) * 100;
    var top = TIERS.length ? TIERS[0] : null;
    return { n: n, k: k, unit: unit, pct: pct, more: top && k < top.min ? top.min - k : 0, topPct: top ? top.pct : 0, total: base + tax, save: off + Math.round(off * GST / 100) };
  }
  function show() {
    var s = sums();
    $('gb-total').textContent = (s.n < MIN ? 'For ' + MIN + ' people: ' : '') + s.k + ' × ' + money(s.unit * 100) + ' + ' + GST + '% GST = ' + money(s.total);
    $('gb-save').textContent = 'You save ' + money(s.save) + ' on the list price (' + s.pct + '% off).' + (s.more ? ' Add ' + s.more + ' more and every pass is ' + s.topPct + '% off.' : '');
    $('gb-count').textContent = s.n >= MIN ? s.n + ' people on the list.' : s.n + ' of at least ' + MIN + ' people added.';
    if (!busy) go.textContent = 'Pay ' + money(s.total) + ' and book ' + s.k + ' passes';
  }

  // ---- saying what is wrong, next to it ----
  function clearMarks() {
    each(form.querySelectorAll('[aria-invalid]'), function (el) { el.removeAttribute('aria-invalid'); });
    each(form.querySelectorAll('.gb-err'), function (el) { el.textContent = ''; });
    msg.textContent = '';
  }
  function fail(el, where, text) {
    if (el) el.setAttribute('aria-invalid', 'true');
    if (where) where.textContent = text;
    msg.textContent = text;
    if (el && el.focus) {
      el.focus();
      try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* older browsers */ }
    }
    return null;
  }
  function failField(id, text) { return fail($('gb-' + id), $('gb-err-' + id), text); }
  function failRow(row, k, text) { return fail(k ? input(row, k) : null, row.querySelector('.gb-row-err'), text); }
  function failPass(text) { return fail(form.querySelector('input[name="pass"]'), $('gb-err-pass'), text); }

  // The GST invoice section: all empty is an invoice in the buyer's own name.
  function billing() {
    var name = val($('gb-gst-name')), gstin = val($('gb-gstin')).split(' ').join('').toUpperCase(), address = val($('gb-gst-address'));
    if (!name && !gstin && !address) return { billing: { legal_name: '', gstin: '', address: '' } };
    if (!name) return { error: 'Add the registered company name for the GST invoice, or leave that section empty.', id: 'gst-name' };
    if (gstin && !GSTIN.test(gstin)) return { error: 'That GSTIN does not look right. A GSTIN is 15 characters, like 27AAACB1234C1Z5.', id: 'gstin' };
    if (gstin && !address) return { error: 'Add the billing address registered with that GSTIN: the tax invoice has to print it.', id: 'gst-address' };
    return { billing: { legal_name: name, gstin: gstin, address: address } };
  }

  // The same checks, in the same order, as the server: returns the billing to send, or null.
  function check() {
    clearMarks();
    if (!chosen()) return failPass('Choose the pass for your group: Delegate, Premium Delegate or VIP.');
    if (val($('gb-buyer-name')).length < 2) return failField('buyer-name', 'Please add your name.');
    if (!EMAIL.test(val($('gb-buyer-email')))) return failField('buyer-email', 'Please type your full email address. The receipt goes there.');
    if (!mobileOk(val($('gb-buyer-mobile')))) return failField('buyer-mobile', 'Please add your mobile number, so the team can reach you about the booking.');
    var b = billing();
    if (b.error) { gst.open = true; return failField(b.id, b.error); }
    var seen = {}, all = rows(), n = 0;
    for (var i = 0; i < all.length; i++) {
      var r = all[i], no = i + 1;
      if (blank(r)) continue;
      var email = val(input(r, 'email')).toLowerCase(), mobile = val(input(r, 'mobile'));
      if (val(input(r, 'name')).length < 2) return failRow(r, 'name', 'Person ' + no + ': please add their name.');
      if (!EMAIL.test(email)) return failRow(r, 'email', 'Person ' + no + ': please type their full email address. Their pass goes there.');
      if (mobile && !mobileOk(mobile)) return failRow(r, 'mobile', 'Person ' + no + ': please check the mobile number, or leave it empty.');
      if (seen[email]) return failRow(r, 'email', 'Person ' + no + ' has the same email as person ' + seen[email] + '. Each person needs their own email address.');
      seen[email] = no;
      n++;
    }
    if (n < MIN) {
      var text = 'A group booking is ' + MIN + ' passes or more. ' + (n ? 'You have ' + n + ' on the list: add ' + (MIN - n) + ' more.' : 'Add the people who are coming.');
      var empty = all.filter(blank)[0];
      return empty ? failRow(empty, 'name', text) : fail(addBtn, $('gb-err-people'), text);
    }
    if (n > MAX) return fail(addBtn, $('gb-err-people'), 'One booking takes up to ' + MAX + ' people. For more, make a second booking, or write to info@bharataiinnovation.com.');
    return b.billing;
  }

  // ---- the list kept in this tab ----
  function draft() {
    var d = { pass: (chosen() || {}).value || '', me: me.checked, buyer: {}, gst: {}, people: [] };
    ['name', 'email', 'mobile', 'company'].forEach(function (k) { d.buyer[k] = val($('gb-buyer-' + k)); });
    ['gst-name', 'gstin', 'gst-address'].forEach(function (k) { d.gst[k] = val($('gb-' + k)); });
    d.people = rows().map(function (r) {
      var o = { buyer: r.hasAttribute('data-buyer') };
      FIELDS.forEach(function (k) { o[k] = val(input(r, k)); });
      return o;
    });
    return d;
  }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(draft())); } catch (e) { /* private mode: nothing kept */ } }
  var timer = null;
  function later() { clearTimeout(timer); timer = setTimeout(save, 300); }
  function restore() {
    var d = null;
    try { d = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { d = null; }
    if (!d || !d.people || !d.people.length) return;
    each(form.querySelectorAll('input[name="pass"]'), function (el) { if (el.value === d.pass) el.checked = true; });
    ['name', 'email', 'mobile', 'company'].forEach(function (k) { if (d.buyer && d.buyer[k]) $('gb-buyer-' + k).value = d.buyer[k]; });
    ['gst-name', 'gstin', 'gst-address'].forEach(function (k) { if (d.gst && d.gst[k]) { $('gb-' + k).value = d.gst[k]; gst.open = true; } });
    var people = d.people.slice(0, MAX);
    while (rows().length < people.length) newRow(false);
    people.forEach(function (o, i) {
      var r = rows()[i];
      FIELDS.forEach(function (k) { input(r, k).value = o[k] || ''; });
      if (o.buyer) r.setAttribute('data-buyer', '1');
    });
    me.checked = !!d.me;
  }

  // ---- "I am attending too": the buyer is a person on the list ----
  function buyerRow() { return list.querySelector('.gb-person[data-buyer]'); }
  function syncMe() {
    var r = buyerRow();
    if (!me.checked) {
      if (r) { BUYER.forEach(function (k) { input(r, k).value = ''; }); r.removeAttribute('data-buyer'); }
      show();
      return;
    }
    if (!r) {
      var top = rows()[0];
      r = top && blank(top) ? top : rows().length < MAX ? newRow(true) : null;
      if (!r) return;
      r.setAttribute('data-buyer', '1');
    }
    BUYER.forEach(function (k) { input(r, k).value = val($('gb-buyer-' + k)); });
    show();
  }
  me.addEventListener('change', function () { syncMe(); save(); });
  BUYER.forEach(function (k) { $('gb-buyer-' + k).addEventListener('input', function () { if (me.checked) syncMe(); }); });

  list.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('.gb-remove') : null;
    if (!b || rows().length <= 1) return;
    var r = b.closest('.gb-person'), i = rows().indexOf(r);
    if (r.hasAttribute('data-buyer')) me.checked = false;
    r.parentNode.removeChild(r);
    renumber(); show(); save();
    var next = rows()[Math.min(i, rows().length - 1)];
    if (next) input(next, 'name').focus();
  });
  addBtn.addEventListener('click', function () {
    if (rows().length >= MAX) return;
    var r = newRow(false);
    show(); save();
    input(r, 'name').focus();
  });
  form.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t && t.getAttribute && t.getAttribute('aria-invalid')) {
      t.removeAttribute('aria-invalid');
      var row = t.closest ? t.closest('.gb-person') : null;
      var where = row ? row.querySelector('.gb-row-err') : $('gb-err-' + String(t.id || '').replace(/^gb-/, ''));
      if (where) where.textContent = '';
    }
    show(); later();
  });
  form.addEventListener('change', function () { show(); later(); });

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (busy) return;
    var bill = check();
    if (!bill) return;
    if (!PAY) { msg.textContent = 'Online payment is not available just now. Please try again in a little while.'; return; }
    save();
    busy = true; go.disabled = true; go.textContent = 'Opening secure payment...';
    var body = {
      pass_type: chosen().value,
      buyer: { name: val($('gb-buyer-name')), email: val($('gb-buyer-email')), mobile: val($('gb-buyer-mobile')), company: val($('gb-buyer-company')) },
      billing: bill,
      members: rows().map(function (r) { var o = {}; FIELDS.forEach(function (k) { o[k] = val(input(r, k)); }); return o; })
    };
    fetch('/api/group/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (x.ok && x.j.pay_url) { location.href = x.j.pay_url; return; }
        busy = false; go.disabled = false; show();
        var j = x.j || {}, text = j.error || 'We could not start the payment. Please try again.';
        var row = j.row ? rows()[j.row - 1] : null;
        if (row) return failRow(row, j.field, text);
        if (j.field === 'billing') { gst.open = true; return fail($('gb-gst-name'), $('gb-err-gst-name'), text); }
        if (j.field === 'pass') return failPass(text);
        if (j.field === 'members') return fail(addBtn, $('gb-err-people'), text);
        if (j.field && $('gb-' + j.field)) return failField(j.field, text);
        msg.textContent = text;
      })
      .catch(function () { busy = false; go.disabled = false; show(); msg.textContent = 'Network error. Nothing was charged. Please try again.'; });
  });

  // Back from the payment page, the browser may show this page as it was left.
  window.addEventListener('pageshow', function (ev) { if (ev.persisted) { busy = false; go.disabled = !PAY; show(); } });

  restore();
  renumber();
  show();
  if (!PAY) go.disabled = true;
})();
