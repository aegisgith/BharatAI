// /media-pass: the Media & Influencer Pass request form (12 Nov 2026). Rendered by
// mediaPassPageHTML() in src/index.tsx; this file shows the part for the chosen kind,
// checks every box before sending, and posts to /api/media-pass-application.
// check() asks the questions in the order checkMediaPass() on the server asks them,
// with the same words, so a mistake is named the same way whichever side finds it.
// The server's answer is the one that counts: a refusal it sends is shown under its box.
// window.MediaPassForm._t holds the parts that need no page, for the tests.
(function (w) {
  'use strict';

  var PLATFORMS = [['instagram', 'Instagram'], ['youtube', 'YouTube'], ['linkedin', 'LinkedIn'], ['x', 'X (Twitter)'], ['other', 'Other']];
  var FORMATS = ['posts', 'reels', 'stories', 'live', 'video', 'article', 'podcast'];

  // ---------------------------------------------------------------- the rules
  function t(v, n) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n); }
  function para(v, n) {
    return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
  }
  // A web address as typed: '' when empty, null when it is not one. "www.x.com/a" gains https://.
  function cleanUrl(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (s.length > 400 || /\s/.test(s)) return null;
    if (!/^https?:\/\//i.test(s)) {
      if (!/^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+([/?#]|$)/i.test(s)) return null;
      s = 'https://' + s;
    }
    try {
      var u = new URL(s);
      if (!/^https?:$/.test(u.protocol) || !/\.[a-z]{2,}$/i.test(u.hostname)) return null;
    } catch (e) { return null; }
    return s;
  }
  // "12000", "12,000", "12k", "1.2M", "1.5 lakh": the number. null when empty, -1 when not a number.
  function followers(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase().replace(/[,\s]/g, '').replace(/\+$/, '');
    if (!s) return null;
    var m = /^(\d+(?:\.\d+)?)(k|thousand|m|mn|million|l|lac|lakh|lakhs|cr|crore|crores)?$/.exec(s);
    if (!m) return -1;
    var mult = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, l: 1e5, lac: 1e5, lakh: 1e5, lakhs: 1e5, cr: 1e7, crore: 1e7, crores: 1e7 };
    var n = Math.round(parseFloat(m[1]) * (m[2] ? mult[m[2]] : 1));
    return n > 2e9 ? -1 : n;
  }
  function bad(field, error) { return { field: field, error: error }; }
  function links(list, key, none) {
    var raw = Array.isArray(list) ? list.slice(0, 3) : [];
    var n = 0;
    for (var i = 0; i < raw.length; i++) {
      var u = cleanUrl(raw[i]);
      if (u === null) return bad(key + '_' + (i + 1), 'Link ' + (i + 1) + ' does not look like a web address. Please check it.');
      if (u) n++;
    }
    return n ? null : bad(key + '_1', none);
  }
  // null when every answer is right, else { field, error } for the first one that is not.
  function check(b) {
    b = b || {};
    var kind = String(b.kind || '');
    if (kind !== 'media' && kind !== 'influencer') return bad('kind', 'Please choose Media or Influencer / creator.');
    if (t(b.name, 80).length < 2) return bad('name', 'Please add your full name.');
    var email = t(b.email, 120).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('email', 'Please type a full email address.');
    var digits = t(b.mobile, 20).replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) return bad('mobile', 'Please type your mobile number, with at least 10 digits.');
    if (t(b.organisation, 150).length < 2) return bad('organisation', 'Please add your organisation or channel name.');
    if (t(b.designation, 120).length < 2) return bad('designation', 'Please add your designation or role.');
    if (t(b.city, 80).length < 2) return bad('city', 'Please add your city.');
    var l;
    if (kind === 'media') {
      if (t(b.outlet, 150).length < 2) return bad('outlet', 'Please add the publication, channel or website you work for.');
      if (t(b.beat, 120).length < 2) return bad('beat', 'Please say what you cover, for example technology or business.');
      l = links(b.work_links, 'work', 'Please add at least one link to your recent published work.');
      if (l) return l;
      if (para(b.coverage, 1500).length < 15) return bad('coverage', 'Please tell us in a line or two what you plan to cover.');
    } else {
      var rows = Array.isArray(b.platforms) ? b.platforms : [];
      var any = 0;
      for (var p = 0; p < PLATFORMS.length; p++) {
        var key = PLATFORMS[p][0], label = PLATFORMS[p][1];
        var r = null;
        for (var j = 0; j < rows.length; j++) if (rows[j] && rows[j].platform === key) { r = rows[j]; break; }
        r = r || {};
        var other = key === 'other' ? t(r.name, 40) : '';
        var handle = t(r.handle, 200);
        var f = followers(r.followers);
        if (!handle && f === null && !other) continue;
        var what = key === 'other' ? (other || 'the other platform') : label;
        if (key === 'other' && !other) return bad('pf-other-name', 'Please name the other platform.');
        if (!handle) return bad('pf-' + key + '-handle', 'Please add your ' + what + ' handle or link.');
        if (/^(https?:\/\/|www\.)/i.test(handle) && !cleanUrl(handle)) return bad('pf-' + key + '-handle', 'Please check the ' + what + ' link.');
        if (f === null) return bad('pf-' + key + '-followers', 'Please add how many followers you have on ' + what + '.');
        if (f < 0) return bad('pf-' + key + '-followers', 'Please type the ' + what + ' followers as a number, for example 12000 or 12k.');
        any++;
      }
      if (!any) return bad('platforms', 'Please add at least one platform, with your handle or link and your followers.');
      if (t(b.niche, 150).length < 2) return bad('niche', 'Please add your main topic, for example AI, tech or startups.');
      if (t(b.audience, 150).length < 2) return bad('audience', 'Please say where most of your audience lives, for example Mumbai or all India.');
      var fm = Array.isArray(b.formats) ? b.formats.map(String) : [];
      if (!FORMATS.some(function (k) { return fm.indexOf(k) >= 0; })) return bad('formats', 'Please tick at least one thing you will make.');
      if ((para(b.before, 600) + para(b.during, 600) + para(b.after, 600)).length < 15) return bad('before', 'Please tell us what you will post before, during or after the event.');
      l = links(b.samples, 'sample', 'Please add at least one link to a sample of your content.');
      if (l) return l;
    }
    if (b.agree !== true) return bad('agree', 'Please tick the box to agree.');
    return null;
  }
  // The box on the page a field key names.
  function boxId(field) {
    var f = String(field || '');
    if (f === 'kind') return 'mp-kind-media';
    if (f === 'platforms') return 'pf-instagram-handle';
    if (f === 'formats') return 'mp-format-posts';
    if (f.indexOf('pf-') === 0) return f;
    var m = /^(work|sample)_(\d)$/.exec(f);
    if (m) return 'mp-' + m[1] + '-' + m[2];
    if (f === 'work' || f === 'samples') return 'mp-' + (f === 'work' ? 'work' : 'sample') + '-1';
    return 'mp-' + f;
  }

  w.MediaPassForm = { _t: { check: check, cleanUrl: cleanUrl, followers: followers, boxId: boxId, PLATFORMS: PLATFORMS, FORMATS: FORMATS } };

  // ---------------------------------------------------------------- the page
  var doc = w.document;
  if (!doc || !doc.getElementById) return;
  var form = doc.getElementById('mp-form');
  if (!form) return;
  var go = doc.getElementById('mp-go'), msg = doc.getElementById('mp-msg');

  function val(id) { var el = doc.getElementById(id); return el ? String(el.value || '') : ''; }
  function kindNow() { var k = form.querySelector('input[name="kind"]:checked'); return k ? k.value : ''; }
  function showPart() {
    var k = kindNow();
    doc.getElementById('mp-media').hidden = k !== 'media';
    doc.getElementById('mp-influencer').hidden = k !== 'influencer';
  }
  function collect() {
    var k = kindNow();
    var d = {
      kind: k, name: val('mp-name'), email: val('mp-email'), mobile: val('mp-mobile'), organisation: val('mp-organisation'),
      designation: val('mp-designation'), city: val('mp-city'), agree: !!(doc.getElementById('mp-agree') || {}).checked, website: val('mp-website')
    };
    if (k === 'media') {
      d.outlet = val('mp-outlet'); d.beat = val('mp-beat'); d.coverage = val('mp-coverage');
      d.work_links = [val('mp-work-1'), val('mp-work-2'), val('mp-work-3')];
    } else if (k === 'influencer') {
      d.platforms = PLATFORMS.map(function (p) {
        var row = { platform: p[0], handle: val('pf-' + p[0] + '-handle'), followers: val('pf-' + p[0] + '-followers') };
        if (p[0] === 'other') row.name = val('pf-other-name');
        return row;
      });
      d.niche = val('mp-niche'); d.audience = val('mp-audience');
      d.formats = Array.prototype.map.call(form.querySelectorAll('input[name="formats"]:checked'), function (x) { return x.value; });
      d.before = val('mp-before'); d.during = val('mp-during'); d.after = val('mp-after');
      d.samples = [val('mp-sample-1'), val('mp-sample-2'), val('mp-sample-3')];
      d.collabs = val('mp-collabs');
    }
    return d;
  }
  function clearErrors() {
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid="true"]'), function (el) { el.removeAttribute('aria-invalid'); });
    Array.prototype.forEach.call(form.querySelectorAll('.mp-err'), function (el) { el.textContent = ''; });
    msg.textContent = '';
  }
  // The sentence goes under the box it is about and beside the button, and the box is focused.
  function showError(field, text) {
    var el = doc.getElementById(boxId(field));
    var holder = el && (el.closest('.mp-plat') || el.closest('fieldset') || el.closest('.mp-field'));
    var err = field === 'platforms' ? doc.getElementById('mp-platforms-err') : holder && holder.querySelector('.mp-err');
    if (err) err.textContent = text;
    if (el && field !== 'kind' && field !== 'formats') el.setAttribute('aria-invalid', 'true');
    msg.textContent = 'Please check: ' + text;
    if (el) {
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
      try { (holder || el).scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* old browser */ }
    }
  }
  function post(body) {
    return fetch('/api/media-pass-application', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); });
  }

  Array.prototype.forEach.call(form.querySelectorAll('input[name="kind"]'), function (r) {
    r.addEventListener('change', function () { showPart(); clearErrors(); });
  });
  // A box being corrected loses its red outline straight away.
  form.addEventListener('input', function (ev) {
    var el = ev.target;
    if (el && el.getAttribute && el.getAttribute('aria-invalid') === 'true') {
      el.removeAttribute('aria-invalid');
      var holder = el.closest('.mp-plat') || el.closest('.mp-field');
      var err = holder && holder.querySelector('.mp-err');
      if (err) err.textContent = '';
    }
  });
  showPart();

  var sending = false;
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (sending) return;
    clearErrors();
    var d = collect();
    var e = check(d);
    if (e) { showError(e.field, e.error); return; }
    sending = true; go.disabled = true; go.textContent = 'Sending...';
    post(d).then(function (x) {
      sending = false; go.disabled = false; go.textContent = 'Send my request';
      if (x.ok) {
        var done = doc.getElementById('mp-done');
        doc.getElementById('mp-done-text').textContent = x.j.message || 'Thank you. We review every request and reply by email within 2 working days.';
        form.hidden = true; form.style.display = 'none';
        done.hidden = false;
        try { done.focus(); done.scrollIntoView({ block: 'start' }); } catch (er) { /* old browser */ }
        return;
      }
      if (x.j && x.j.field) { showError(x.j.field, x.j.error || 'Please check this box.'); return; }
      msg.textContent = (x.j && x.j.error) || 'That did not go through. Please try again.';
    }).catch(function () {
      sending = false; go.disabled = false; go.textContent = 'Send my request';
      msg.textContent = 'No connection. Nothing was sent. Please try again.';
    });
  });
})(typeof window !== 'undefined' ? window : this);
