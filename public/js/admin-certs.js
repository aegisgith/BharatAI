/* Certificates by email (24 Nov 2026), at the top of Admin -> After the Event.
 *
 * The organiser: a participation certificate to everyone who came (Delegate, Visitor, VIP,
 * Premium, Expo and the rest), a different one to speakers, and another to Innovation Talk
 * and Showcase presenters; "show me design first, I'll approve, then send"; and "in case no
 * photo on record don't send, send them email to update photo", "in all category of
 * certificate".
 *
 * For each group: who is in it, with and without a photo, each email as it would go, a test
 * to your own address, the list, and the two runs (bulk runs of kind cert_ready and
 * cert_photo, sent by the minute clock at about 30 a minute; nobody gets the same email
 * twice). Server: src/routes/certificates.ts. Styles: admin-after.css (the afd- classes).
 *
 * Volunteers (same day: "Pillai students who volunteered, we need to make their certificate
 * with photo"): the organisers tick who volunteered among the Organiser pass holders and
 * save the list; they get the volunteer certificate instead of the participation one.
 *
 *   CertDesk.mount(element, { api, toast, startCampaign })
 */
(function (w) {
  'use strict';

  var opts = null, host = null, data = null, busy = false;
  var passOn = null;   // the passes ticked for participants
  var volOn = null, volDirty = false;   // who is ticked as a volunteer, and whether that is unsaved
  var GROUPS = [
    { key: 'participants', ref: 1, title: 'Participants',
      who: 'Everyone checked in at the venue, volunteers apart.', what: 'Certificate of participation (saffron), with their pass and their photo.' },
    { key: 'volunteers', ref: 4, title: 'Volunteers',
      who: 'The people ticked below. To start with: the Pillai University students on Organiser passes who were checked in.', what: 'Certificate of appreciation for volunteering (blue), with their photo and their college. They do not get the participation one as well.' },
    { key: 'speakers', ref: 2, title: 'Speakers',
      who: 'Everyone on a published session of the programme (Conference), one certificate per session, one email per person.', what: 'Certificate of appreciation (gold), with the session, the hall and the day.' },
    { key: 'stage', ref: 3, title: 'Innovation Stage',
      who: 'Every Innovation Stage talk that got a time, one email per address (the speaker, else the booth contact).', what: 'Certificate of appreciation (green), with the talk and the company.' },
  ];

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function num(n) { return Number(n || 0).toLocaleString('en-IN'); }
  function toast(m, t) { if (opts && opts.toast) opts.toast(esc(m), t || 'success'); }
  function emailOk(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')); }

  // Who a run would go to now, as the server counts it (it checks again on every send).
  function due(g, variant) {
    var d = (data && data.groups && data.groups[g.key]) || {};
    // A volunteer photo request also goes to those waiting for a face check.
    var list = (d.rows || []).concat(g.key === 'volunteers' && variant === 'photo' ? (d.checking || []) : []);
    return list.filter(function (r) {
      if (!emailOk(r.email)) return false;
      if (g.key === 'participants' && passOn && !passOn[r.pass]) return false;
      var has = g.key === 'participants' ? !!r.photo : !!r.photo;
      if (variant === 'ready') return has && r.sent !== 'certificate';
      return !has && r.sent !== 'photo request' && r.sent !== 'certificate';
    });
  }

  function groupHtml(g) {
    var d = (data && data.groups && data.groups[g.key]) || {};
    if (d.error) return '<section class="afd-panel"><b>' + esc(g.title) + '</b><p class="afd-warn">' + esc(d.error) + '</p></section>';
    var ready = due(g, 'ready'), photo = due(g, 'photo');
    var att = g.key === 'participants' || g.key === 'volunteers';
    var facts = att
      ? num(d.total) + (g.key === 'volunteers' ? ' volunteers' : ' checked in') + ': <b>' + num(d.with_photo) + '</b> with a photo, <b>' + num(d.no_photo) + '</b> without'
        + (d.unsubscribed ? ', ' + num(d.unsubscribed) + ' unsubscribed (left out)' : '') + (d.no_email ? ', ' + num(d.no_email) + ' with no email' : '')
        + (d.not_checked_in ? ', ' + num(d.not_checked_in) + ' never scanned in at the badge desk' : '') + '.'
      : num(d.certificates) + ' certificates for ' + num(d.addresses) + ' people: <b>' + num(d.with_photo) + '</b> with a photo, <b>' + num(d.no_photo) + '</b> without.';
    var vols = g.key !== 'volunteers' ? '' : '<fieldset class="cd-passes cd-vols"><legend>Who volunteered (Organiser pass holders)'
      + (d.saved ? '' : ': a starting list, not saved yet') + '</legend>' + (d.choices || []).map(function (p) {
        var on = volOn ? !!volOn[p.id] : !!p.on;
        return '<label><input type="checkbox" data-vol="' + esc(p.id) + '"' + (on ? ' checked' : '') + '> ' + esc(p.name)
          + ' <span class="afd-sub">' + esc([p.title, String(p.email || '').replace(/^[^@]*/, ''), p.checked_in ? 'scanned in' : 'never scanned in', p.photo ? 'photo' : 'no photo'].filter(Boolean).join(' · ')) + '</span></label>';
      }).join('') + '</fieldset><div class="afd-actions"><button type="button" class="afd-btn afd-small" data-act="vol-save" data-g="volunteers"' + (volDirty || !d.saved ? '' : ' disabled') + '>Save the list</button>'
      + (volDirty ? ' <span class="afd-warn">Not saved: save the list before you email anyone.</span>' : '') + '</div>';
    if (g.key === 'volunteers' && volDirty) { ready = []; photo = []; }
    var chk = g.key === 'volunteers' ? (d.checking || []) : [];
    if (chk.length) {
      vols += '<p class="afd-note"><b>Waiting for a face check: ' + num(chk.length) + '</b> (never scanned in at the badge desk; '
        + num(chk.filter(function (r) { return r.photo; }).length) + ' have added a photo). The photo request asks them for a photo and says we will match it with the event photos. '
        + 'Whoever is found: tick them above, save, then email the certificates. '
        + '<button type="button" class="afd-btn afd-small" data-act="cert-preview" data-g="volunteers" data-v="check">Preview their email</button></p>'
        + '<details><summary>Waiting for a face check (' + num(chk.length) + ')</summary><div class="afd-table-wrap"><table class="afd-table"><thead><tr><th>Person</th><th>Email</th><th>Photo</th><th>Emailed</th></tr></thead><tbody>'
        + chk.map(function (r) { return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.email || '') + '</td><td>' + (r.photo ? 'Yes' : '<b>No</b>') + '</td><td>' + esc(r.sent || 'Not yet') + '</td></tr>'; }).join('')
        + '</tbody></table></div></details>';
    }
    var passes = g.key !== 'participants' ? '' : '<fieldset class="cd-passes"><legend>Passes that get it</legend>' + (d.passes || []).map(function (p) {
      var on = !passOn || passOn[p.pass];
      return '<label><input type="checkbox" data-pass="' + esc(p.pass) + '"' + (on ? ' checked' : '') + '> ' + esc(p.pass)
        + ' <span class="afd-sub">' + num(p.with_photo) + ' with photo, ' + num(p.no_photo) + ' without</span></label>';
    }).join('') + '</fieldset>';
    var warn = '';
    if ((d.no_email || []).length && g.key !== 'participants') warn += '<p class="afd-warn">No email address for: ' + d.no_email.map(function (x) { return esc(x.name); }).join(', ') + '.</p>';
    if ((d.no_time || []).length) warn += '<p class="afd-warn">' + num(d.no_time.length) + ' talks never got a time on the stage, so they get no certificate: ' + d.no_time.map(function (x) { return esc(x.name + (x.company ? ' (' + x.company + ')' : '')); }).join(', ') + '.</p>';
    var rows = (d.rows || []).map(function (r) {
      var what = g.key === 'participants' ? esc(r.pass) : g.key === 'volunteers' ? (r.checked_in ? 'Yes' : '<b>No</b>')
        : g.key === 'speakers' ? (r.sessions || []).map(esc).join('<br>') : (r.talks || []).map(esc).join('<br>');
      return '<tr><td>' + esc(r.name) + (r.designation ? '<div class="afd-sub">' + esc(r.designation) + '</div>' : '') + '</td>'
        + '<td>' + esc(r.email || '') + (r.via_booth ? '<div class="afd-sub">booth contact</div>' : '') + '</td><td>' + what + '</td>'
        + '<td>' + (r.photo ? 'Yes' : '<b>No</b>') + '</td><td>' + esc(r.sent || 'Not yet') + '</td></tr>';
    }).join('');
    return '<section class="afd-panel" data-group="' + g.key + '">'
      + '<h3>' + esc(g.title) + '</h3>'
      + '<p class="afd-note">' + esc(g.who) + ' ' + esc(g.what) + ' Without a photo on record they get an email asking for one instead' + (att ? ' (they add it in the app).' : ' (they reply with it; add it in Conference or Innovation Talks, then run the certificates again).') + '</p>'
      + '<p>' + facts + '</p>' + passes + vols + warn
      + '<div class="afd-actions">'
      + '<button type="button" class="afd-btn afd-small" data-act="cert-preview" data-g="' + g.key + '" data-v="ready">Preview the certificate email</button>'
      + '<button type="button" class="afd-btn afd-small" data-act="cert-preview" data-g="' + g.key + '" data-v="photo">Preview the photo request</button>'
      + '</div><div class="afd-actions">'
      + '<button type="button" class="afd-btn afd-small afd-primary" data-act="cert-run" data-g="' + g.key + '" data-v="ready"' + (ready.length ? '' : ' disabled') + '>Email ' + num(ready.length) + ' certificates</button>'
      + '<button type="button" class="afd-btn afd-small afd-primary" data-act="cert-run" data-g="' + g.key + '" data-v="photo"' + (photo.length ? '' : ' disabled') + '>Email ' + num(photo.length) + ' photo requests</button>'
      + '</div>'
      + '<details><summary>The list (' + num((d.rows || []).length) + ')</summary><div class="afd-table-wrap"><table class="afd-table"><thead><tr><th>Person</th><th>Email</th><th>' + (g.key === 'participants' ? 'Pass' : g.key === 'volunteers' ? 'Scanned in' : g.key === 'speakers' ? 'Sessions' : 'Talk') + '</th><th>Photo</th><th>Emailed</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>'
      + '</section>';
  }

  function draw() {
    if (!host) return;
    if (!data) { host.innerHTML = '<div class="afd"><p class="afd-note">Loading the certificates...</p></div>'; return; }
    host.innerHTML = '<div class="afd"><section class="afd-card"><div class="afd-card-head"><h2>Certificates</h2>'
      + '<p>One email per person from the event address, with a button to their own certificate: it opens a page that draws it with their photo and saves it, and adds it to LinkedIn. Every certificate has a QR that opens a page on our site confirming it. Runs go at about 30 a minute and nobody gets the same email twice. The workshop certificates stay in the app as before.</p></div>'
      + '<div class="afd-actions"><label class="afd-sub" for="cd-test-to">Send a test of any email to</label> <input id="cd-test-to" type="email" class="cd-input" placeholder="you@example.com" autocomplete="email"></div>'
      + GROUPS.map(groupHtml).join('') + '</section></div>';
  }

  function preview(title, subject, html) {
    var old = document.getElementById('cd-preview');
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = 'cd-preview';
    box.className = 'afd-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);
    box.innerHTML = '<div class="afd-modal-card"><div class="afd-modal-head"><div><b>' + esc(title) + '</b><div class="afd-sub">Subject: ' + esc(subject) + '</div></div>'
      + '<div><button type="button" class="afd-btn afd-small" data-test>Send me a test</button> <button type="button" class="afd-btn afd-small" data-close>Close</button></div></div><iframe title="Email preview" sandbox=""></iframe></div>';
    document.body.appendChild(box);
    box.querySelector('iframe').srcdoc = html;
    var close = function () { box.remove(); document.removeEventListener('keydown', onKey); };
    var onKey = function (e) { if (e.key === 'Escape') close(); };
    box.addEventListener('click', function (e) { if (e.target === box || e.target.hasAttribute('data-close')) close(); });
    document.addEventListener('keydown', onKey);
    box.querySelector('[data-close]').focus();
    return box;
  }

  async function onClick(e) {
    var b = e.target.closest('[data-act]');
    if (!b || !host.contains(b) || b.disabled || busy) return;
    var act = b.getAttribute('data-act'), key = b.getAttribute('data-g'), variant = b.getAttribute('data-v');
    var g = GROUPS.filter(function (x) { return x.key === key; })[0];
    if (!g) return;
    try {
      if (act === 'cert-preview') {
        var m = data.emails[g.key][variant];
        var box = preview(g.title + ': ' + (variant === 'ready' ? 'certificate email' : variant === 'check' ? 'photo request, waiting for a face check' : 'photo request'), m.subject, m.html);
        box.querySelector('[data-test]').addEventListener('click', async function () {
          var to = ((document.getElementById('cd-test-to') || {}).value || '').trim() || (w.prompt('Send the test to which address?') || '').trim();
          if (!emailOk(to)) { toast('Type the address to send the test to.', 'error'); return; }
          try { await opts.api.post('/api/admin/certificates/test', { to: to, group: g.key, variant: variant }); toast('Test sent to ' + to + '.'); }
          catch (err) { toast((err && err.message) || 'The test did not go.', 'error'); }
        });
      } else if (act === 'vol-save') {
        var vd = (data.groups && data.groups.volunteers) || {};
        var ids = (vd.choices || []).filter(function (p) { return volOn ? !!volOn[p.id] : !!p.on; }).map(function (p) { return p.id; });
        busy = true; b.disabled = true;
        var res = await opts.api.post('/api/admin/certificates/volunteers', { ids: ids });
        toast('Saved: ' + num(res && res.count != null ? res.count : ids.length) + ' volunteers.');
        volOn = null; volDirty = false;
        await refresh();
      } else if (act === 'cert-run') {
        var list = due(g, variant);
        if (!list.length) return;
        var nChk = list.filter(function (r) { return (data.groups.volunteers && data.groups.volunteers.checking || []).indexOf(r) >= 0; }).length;
        var words = variant === 'ready'
          ? 'Email ' + list.length + ' ' + g.title.toLowerCase() + ' their certificate? One email each, about 30 a minute.'
          : 'Email ' + list.length + ' ' + g.title.toLowerCase() + ' asking for a photo for their certificate' + (nChk ? ' (' + nChk + ' of them waiting for a face check)' : '') + '? One email each, about 30 a minute.';
        if (!w.confirm(words + '\n\nThis cannot be taken back once it starts (you can pause it under Settings, Bulk email).')) return;
        busy = true; b.disabled = true;
        var audience = 'all';
        if (g.key === 'participants' && passOn) audience = 'only:' + Object.keys(passOn).filter(function (k) { return passOn[k]; }).join('|');
        await opts.startCampaign(variant === 'ready' ? 'cert_ready' : 'cert_photo', { audience: audience, ref_id: g.ref, title: (variant === 'ready' ? 'Certificate: ' : 'Certificate photo request: ') + g.title });
        await refresh();
      }
    } catch (err) {
      toast((err && err.message) || 'That did not work. Please try again.', 'error');
    } finally {
      busy = false;
      if (b.isConnected) b.disabled = false;
    }
  }

  function onChange(e) {
    var t = e.target;
    if (t && t.hasAttribute && t.hasAttribute('data-vol')) {
      var vd = data && data.groups && data.groups.volunteers;
      if (!volOn) { volOn = {}; ((vd && vd.choices) || []).forEach(function (p) { volOn[p.id] = !!p.on; }); }
      volOn[t.getAttribute('data-vol')] = !!t.checked;
      volDirty = true;
      draw();
      return;
    }
    if (!t || !t.hasAttribute || !t.hasAttribute('data-pass')) return;
    var d = data && data.groups && data.groups.participants;
    passOn = passOn || {};
    ((d && d.passes) || []).forEach(function (p) { if (!(p.pass in passOn)) passOn[p.pass] = true; });
    passOn[t.getAttribute('data-pass')] = !!t.checked;
    draw();
  }

  async function refresh() {
    try { data = await opts.api.get('/api/admin/certificates'); }
    catch (err) { data = { groups: {}, emails: {} }; toast('The certificates did not load: ' + ((err && err.message) || ''), 'error'); }
    draw();
  }

  function styles() {
    if (document.getElementById('cd-styles')) return;
    var st = document.createElement('style');
    st.id = 'cd-styles';
    st.textContent = '.cd-passes{border:1px solid var(--af-line,#e5e7eb);border-radius:10px;padding:8px 12px;margin:10px 0;display:flex;flex-wrap:wrap;gap:6px 18px}'
      + '.cd-passes legend{font-weight:700;font-size:13px;padding:0 4px}.cd-passes label{display:flex;align-items:center;gap:6px;min-height:32px}'
      + '.cd-input{min-height:36px;padding:6px 10px;border:1px solid var(--af-line,#d1d5db);border-radius:8px;min-width:240px}'
      + '.afd details summary{cursor:pointer;margin:10px 0 4px;font-weight:600}';
    document.head.appendChild(st);
  }

  async function mount(el, o) {
    opts = o;
    styles();
    if (host !== el) {
      host = el;
      host.addEventListener('click', onClick);
      host.addEventListener('change', onChange);
    }
    draw();
    await refresh();
  }

  w.CertDesk = { mount: mount };
})(window);
