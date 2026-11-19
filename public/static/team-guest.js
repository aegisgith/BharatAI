/* "Register guests" for the organising team, in the app (16 Nov 2026).
 *
 * The organiser: when the team has only a guest's mobile number, register them and
 * send the pass on WhatsApp, from the team member's own phone; then, the same day, let
 * each team member upload a guest list from their own account and send the messages
 * from their phone or through WhatsApp Web. Opened from the account menu of anyone
 * holding the Organiser pass (openTeamGuest() in the app); the server side is
 * src/routes/team-guests.ts, which checks the pass again.
 *
 * Three parts in one sheet: Add one (name, mobile, pass), Upload a list (.csv or .xlsx,
 * read here in the browser, sent as rows), and Send (every guest, one tap each). Nothing
 * is sent from here by itself: a tap opens the team member's WhatsApp (the app on a
 * phone, WhatsApp Web on a laptop) with the message written, and they press Send there.
 * The tap marks the guest as sent, with Undo, so a long list can be worked through.
 *
 * 19 Nov 2026: exhibitors get the same sheet on /marketplace/dashboard (Visitor passes),
 * opened as TeamGuest.open(tab, EXHIBITOR options): a Visitor Pass only, the company's
 * limit shown, a Send by email button, and the server under /api/mp/dashboard/guests.
 */
(function (global) {
  'use strict';

  var PASSES = [
    { key: 'visitor', label: 'Visitor Pass', note: 'Free' },
    { key: 'delegate', label: 'Delegate Pass', note: 'Complimentary, with lunch' },
    { key: 'vip', label: 'VIP Pass', note: 'Complimentary, with lunch' }
  ];
  var XLSX_SRC = '/js/vendor/xlsx.full.min.js?v=0.18.5b';
  var MAX_ROWS = 300;

  // Who is using the sheet. The team's is the default; open() takes the exhibitor's.
  var TEAM = {
    base: '/api/team/guests',
    title: 'Register guests',
    passes: PASSES,
    leadOne: 'For a guest you have only a mobile number for. You get the pass link to send them on WhatsApp.',
    again: 'Register another guest',
    everyone: true,
    email: false,
    onClose: null
  };
  var EXHIBITOR = {
    base: '/api/mp/dashboard/guests',
    title: 'Invite visitors',
    passes: [PASSES[0]],
    leadOne: 'Your guest gets a free Visitor Pass. Then send them the pass link from your own WhatsApp, SMS or email.',
    again: 'Invite another visitor',
    everyone: false,
    email: true
  };
  var cfg = TEAM;
  var limitInfo = null;          // { limit, used, left } for an exhibitor
  function onePass() { return cfg.passes.length === 1; }

  var ua = navigator.userAgent || '';
  var onPhone = /Android|iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  var root = null, lastFocus = null, busy = false;
  var tab = 'one';               // one | list | send
  var guests = [], counts = { total: 0, sent: 0, to_send: 0 }, everyone = false;
  var filter = 'to_send';        // to_send | sent | all
  var current = null;            // the guest just made on the Add one tab
  var sheet = null;              // { name, rows, inputs } after a file is read
  var sheetPass = 'visitor';
  var uploaded = null;           // the server's answer to the last upload
  var formValues = { pass: 'visitor' };
  var formError = null;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function waHref(g) { return onPhone ? g.whatsapp_url : g.whatsapp_web_url; }
  function timeOf(iso) {
    if (!iso) return '';
    var d = new Date(String(iso).replace(' ', 'T') + (/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? '' : 'Z'));
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  }

  var CSS = ''
    + '.tg-back{position:fixed;inset:0;z-index:9990;background:rgba(15,18,40,.55);display:flex;align-items:flex-end;justify-content:center;}'
    + '@media (min-width:640px){.tg-back{align-items:center;padding:24px;}}'
    + '.tg-sheet{background:#fff;color:#1E2140;width:100%;max-width:520px;max-height:92vh;overflow-y:auto;-webkit-overflow-scrolling:touch;border-radius:18px 18px 0 0;padding:0 16px calc(20px + env(safe-area-inset-bottom));font-family:Inter,Arial,sans-serif;font-size:16px;line-height:1.45;box-shadow:0 -8px 40px rgba(0,0,0,.25);}'
    + '@media (min-width:640px){.tg-sheet{border-radius:18px;max-height:88vh;}}'
    + '.tg-top{position:sticky;top:0;background:#fff;z-index:1;border-bottom:1px solid #E4E7F4;margin-bottom:14px;}'
    + '.tg-head{display:flex;align-items:center;gap:8px;padding:14px 0 8px;}'
    + '.tg-head h2{flex:1;margin:0;font:700 18px Montserrat,Inter,Arial,sans-serif;}'
    + '.tg-x{min-width:44px;min-height:44px;border:0;background:#F1F3FA;border-radius:12px;font-size:22px;line-height:1;color:#1E2140;cursor:pointer;}'
    + '.tg-tabs{display:flex;gap:4px;padding:0 0 8px;}'
    + '.tg-tab{flex:1;min-height:44px;border:0;border-radius:10px;background:#F1F3FA;color:#1E2140;font:600 14px Inter,Arial,sans-serif;cursor:pointer;padding:0 6px;}'
    + '.tg-tab[aria-selected=true]{background:#1E2140;color:#fff;}'
    + '.tg-tab small{display:block;font-weight:400;font-size:11px;opacity:.8;}'
    + '.tg-lead{margin:0 0 14px;color:#4A5070;font-size:14px;}'
    + '.tg-f{margin:0 0 14px;}'
    + '.tg-f label,.tg-legend{display:block;font-weight:600;font-size:15px;margin:0 0 6px;}'
    + '.tg-opt{font-weight:400;color:#6B7194;}'
    + '.tg-in{display:block;width:100%;min-height:48px;padding:10px 12px;border:1px solid #C9CEE3;border-radius:12px;font:400 16px Inter,Arial,sans-serif;color:#1E2140;background:#fff;}'
    + '.tg-in:focus{outline:3px solid #FFD2B0;border-color:#C84F00;}'
    + '.tg-in[aria-invalid=true]{border-color:#B42318;}'
    + '.tg-help{margin:4px 0 0;font-size:13px;color:#6B7194;}'
    + '.tg-bad{margin:4px 0 0;font-size:14px;color:#B42318;font-weight:600;}'
    + '.tg-passes{border:0;margin:0 0 14px;padding:0;}'
    + '.tg-pass{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid #C9CEE3;border-radius:12px;margin:0 0 8px;cursor:pointer;min-height:48px;}'
    + '.tg-pass input{margin-top:3px;width:20px;height:20px;accent-color:#C84F00;flex:none;}'
    + '.tg-pass b{display:block;font-size:15px;}'
    + '.tg-pass span{display:block;font-size:13px;color:#4A5070;}'
    + '.tg-pass.on{border-color:#C84F00;background:#FFF7F0;}'
    + '.tg-go{display:block;width:100%;min-height:52px;border:0;border-radius:12px;background:#C84F00;color:#fff;font:700 17px Inter,Arial,sans-serif;cursor:pointer;margin:6px 0 0;}'
    + '.tg-go[disabled]{opacity:.6;cursor:default;}'
    + '.tg-alert{margin:0 0 14px;padding:12px;border-radius:12px;background:#FEF3F2;border:1px solid #FECDCA;color:#912018;font-size:15px;}'
    + '.tg-note{margin:0 0 14px;padding:12px;border-radius:12px;background:#FFF7ED;border:1px solid #FED7AA;color:#7C2D12;font-size:15px;}'
    + '.tg-done{margin:0 0 14px;padding:14px;border-radius:14px;background:#ECFDF3;border:1px solid #ABEFC6;}'
    + '.tg-done h3{margin:0 0 4px;font:700 17px Montserrat,Inter,Arial,sans-serif;color:#05603A;overflow-wrap:anywhere;}'
    + '.tg-done p{margin:0;font-size:14px;color:#054F31;}'
    + '.tg-wa{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:54px;border-radius:12px;background:#25D366;color:#073b1c;font:700 17px Inter,Arial,sans-serif;text-decoration:none;margin:0 0 10px;padding:0 12px;text-align:center;}'
    + '.tg-wa svg{width:22px;height:22px;flex:none;}'
    + '.tg-wa.off{background:#E4E7F4;color:#6B7194;pointer-events:none;}'
    + '.tg-row{display:flex;gap:8px;margin:0 0 10px;}'
    + '.tg-row > *{flex:1;}'
    + '.tg-sec{display:flex;align-items:center;justify-content:center;min-height:48px;padding:8px 10px;border-radius:12px;border:1px solid #C9CEE3;background:#fff;color:#1E2140;font:600 15px Inter,Arial,sans-serif;text-decoration:none;cursor:pointer;text-align:center;}'
    + '.tg-small{margin:0 0 14px;font-size:13px;color:#4A5070;}'
    + '.tg-file{display:flex;align-items:center;justify-content:center;min-height:54px;border:2px dashed #C9CEE3;border-radius:12px;background:#FAFBFE;color:#1E2140;font:600 15px Inter,Arial,sans-serif;cursor:pointer;margin:0 0 8px;padding:0 12px;text-align:center;}'
    + '.tg-file input{position:absolute;width:1px;height:1px;opacity:0;}'
    + '.tg-link{color:#C84F00;font-weight:600;text-decoration:underline;}'
    + '.tg-table{width:100%;border-collapse:collapse;font-size:13px;margin:0 0 12px;}'
    + '.tg-table th{text-align:left;font-weight:600;color:#4A5070;padding:4px 6px;border-bottom:1px solid #E4E7F4;}'
    + '.tg-table td{padding:6px;border-bottom:1px solid #F0F2F8;vertical-align:top;overflow-wrap:anywhere;}'
    + '.tg-sum{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px;}'
    + '.tg-sum span{display:inline-block;padding:6px 10px;border-radius:999px;font-size:13px;font-weight:600;background:#F1F3FA;color:#1E2140;}'
    + '.tg-sum .ok{background:#ECFDF3;color:#05603A;}.tg-sum .warn{background:#FFF7ED;color:#7C2D12;}.tg-sum .bad{background:#FEF3F2;color:#912018;}'
    + '.tg-chips{display:flex;gap:6px;margin:0 0 10px;flex-wrap:wrap;}'
    + '.tg-chip{min-height:40px;padding:0 12px;border-radius:999px;border:1px solid #C9CEE3;background:#fff;color:#1E2140;font:600 13px Inter,Arial,sans-serif;cursor:pointer;}'
    + '.tg-chip[aria-pressed=true]{background:#1E2140;color:#fff;border-color:#1E2140;}'
    + '.tg-next{margin:0 0 14px;padding:12px;border-radius:14px;background:#F6FFF9;border:1px solid #ABEFC6;}'
    + '.tg-next p{margin:0 0 8px;font-size:14px;}'
    + '.tg-g{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #F0F2F8;}'
    + '.tg-g > div{flex:1;min-width:0;}'
    + '.tg-g b{display:block;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
    + '.tg-g span{display:block;font-size:13px;color:#4A5070;}'
    + '.tg-g .sent{color:#05603A;font-weight:600;}'
    + '.tg-g .sent button{border:0;background:none;color:#C84F00;font:600 13px Inter,Arial,sans-serif;cursor:pointer;padding:0 0 0 6px;min-height:28px;text-decoration:underline;}'
    + '.tg-g a.wa{flex:none;min-height:44px;min-width:44px;padding:0 12px;display:flex;align-items:center;justify-content:center;border-radius:10px;background:#25D366;color:#073b1c;font:700 14px Inter,Arial,sans-serif;text-decoration:none;}'
    + '.tg-g a.wa.again{background:#fff;border:1px solid #C9CEE3;color:#1E2140;}'
    + '.tg-empty{font-size:14px;color:#6B7194;margin:0;}'
    + '.tg-tog{display:flex;align-items:center;gap:8px;font-size:13px;color:#4A5070;margin:0 0 10px;min-height:32px;}'
    + '.tg-tog input{width:18px;height:18px;accent-color:#C84F00;}'
    + '.tg-fixed{display:flex;gap:10px;align-items:baseline;padding:12px;border:1px solid #C84F00;background:#FFF7F0;border-radius:12px;margin:0 0 14px;}'
    + '.tg-fixed b{font-size:15px;}.tg-fixed span{font-size:13px;color:#4A5070;}'
    + '.tg-left{margin:0 0 14px;padding:10px 12px;border-radius:12px;background:#F1F3FA;font-size:14px;color:#1E2140;}';

  var WA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.6-.3z"/></svg>';

  function ensureStyle() {
    if (document.getElementById('tg-style')) return;
    var s = document.createElement('style');
    s.id = 'tg-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d || {} }; });
    });
  }

  function loadList() {
    return api('GET', cfg.base + (everyone && cfg.everyone ? '?all=1' : '')).then(function (r) {
      if (r.status === 200 && r.data && Array.isArray(r.data.guests)) {
        guests = r.data.guests;
        counts = r.data.counts || { total: guests.length, sent: 0, to_send: guests.length };
        limitInfo = typeof r.data.limit === 'number' ? { limit: r.data.limit, used: r.data.used || 0, left: r.data.left || 0 } : null;
      }
    }).catch(function () {});
  }
  // How many more an exhibitor may give, above the form and the upload.
  function leftHTML() {
    if (!limitInfo) return '';
    if (limitInfo.left <= 0) return '<div class="tg-note" role="status">You have given all ' + limitInfo.limit + ' Visitor Passes your company can give. For more, use Report a problem on your dashboard.</div>';
    return '<p class="tg-left">You can give <b>' + limitInfo.left + '</b> more Visitor Pass' + (limitInfo.left === 1 ? '' : 'es') + ' (' + limitInfo.used + ' of ' + limitInfo.limit + ' given).</p>';
  }
  function counted(n) {
    if (!limitInfo || !n) return;
    limitInfo.used += n; limitInfo.left = Math.max(0, limitInfo.limit - limitInfo.used);
  }
  function recount() {
    var sent = guests.filter(function (g) { return g.sent_at; }).length;
    counts = { total: guests.length, sent: sent, to_send: guests.length - sent };
  }
  function putGuest(g) {
    guests = [g].concat(guests.filter(function (x) { return x.id !== g.id; }));
    recount();
  }

  // ---------- the sheet ----------

  function render() {
    if (!root) return;
    var body = root.querySelector('.tg-body');
    root.querySelector('.tg-tabs').innerHTML = tabsHTML();
    body.innerHTML = tab === 'one' ? oneHTML() : tab === 'list' ? listHTML() : sendHTML();
    if (tab === 'one' && !current) {
      var f = document.getElementById('tg-form');
      if (f) {
        f.addEventListener('submit', submitOne);
        f.addEventListener('change', onPassChange);
      }
    }
  }
  function tabsHTML() {
    var t = function (key, label, small) {
      return '<button type="button" class="tg-tab" role="tab" data-tab="' + key + '" aria-selected="' + (tab === key) + '">' + label + (small ? '<small>' + small + '</small>' : '') + '</button>';
    };
    return t('one', 'Add one', '') + t('list', 'Upload a list', '') + t('send', 'Send', counts.to_send ? counts.to_send + ' to send' : (counts.total ? 'all sent' : ''));
  }

  // ---- Add one ----
  function oneHTML() {
    if (current) {
      return (current.note ? '<div class="tg-note" role="status">' + esc(current.note) + '</div>'
        : '<div class="tg-done" role="status"><h3>Pass ready for ' + esc(current.name) + '</h3><p>' + esc(current.badge_type) + ' &middot; ' + esc(current.ref) + ' &middot; ' + esc(current.mobile) + '</p></div>')
        + kitHTML(current)
        + '<button type="button" class="tg-go" id="tg-again">' + esc(cfg.again) + '</button>';
    }
    var v = formValues, err = formError || {};
    var field = function (id, label, opts) {
      var bad = err.field === id;
      return '<div class="tg-f"><label for="tg-' + id + '">' + label + (opts.optional ? ' <span class="tg-opt">(if you have it)</span>' : '') + '</label>'
        + '<input class="tg-in" id="tg-' + id + '" name="' + id + '" type="' + (opts.type || 'text') + '"'
        + (opts.mode ? ' inputmode="' + opts.mode + '"' : '') + ' autocomplete="off"'
        + (opts.max ? ' maxlength="' + opts.max + '"' : '')
        + ' value="' + esc(v[id] || '') + '"' + (bad ? ' aria-invalid="true" aria-describedby="tg-' + id + '-bad"' : '') + '>'
        + (bad ? '<p class="tg-bad" id="tg-' + id + '-bad">' + esc(err.error) + '</p>' : (opts.help ? '<p class="tg-help">' + opts.help + '</p>' : ''))
        + '</div>';
    };
    return (err.error && !err.field ? '<div class="tg-alert" role="alert">' + esc(err.error) + '</div>' : '')
      + '<p class="tg-lead">' + esc(cfg.leadOne) + '</p>'
      + leftHTML()
      + '<form id="tg-form" novalidate>'
      + field('name', 'Guest&rsquo;s name', { max: 120, help: 'As it should be printed on the pass.' })
      + field('mobile', 'Mobile number', { type: 'tel', mode: 'tel', max: 20, help: '10 digits. For a number outside India, start with + and the country code.' })
      + passRadios(v.pass || 'visitor', err.field === 'pass' ? err.error : '')
      + field('company', 'Organisation <span class="tg-opt">(optional)</span>', { max: 160 })
      + field('job_title', 'Designation <span class="tg-opt">(optional)</span>', { max: 160 })
      + field('email', 'Email', { type: 'email', mode: 'email', max: 200, optional: true, help: 'Leave it empty if you do not have it. With an email they can also use the app.' })
      + '<button type="submit" class="tg-go" id="tg-go">Make the pass</button>'
      + '</form>';
  }
  function passRadios(pass, bad, name) {
    name = name || 'pass';
    // One pass to give (an exhibitor's Visitor Pass): said, not asked; the sheet says nothing.
    if (onePass()) return name === 'pass' ? '<div class="tg-fixed"><b>' + esc(cfg.passes[0].label) + '</b><span>' + esc(cfg.passes[0].note) + '</span></div>' : '';
    return '<fieldset class="tg-passes"><legend class="tg-legend">' + (name === 'pass' ? 'Pass' : 'Pass for rows that do not say') + '</legend>'
      + cfg.passes.map(function (p) {
          return '<label class="tg-pass' + (p.key === pass ? ' on' : '') + '"><input type="radio" name="' + name + '" value="' + p.key + '"' + (p.key === pass ? ' checked' : '') + '>'
            + '<span><b>' + p.label + '</b><span>' + p.note + '</span></span></label>';
        }).join('')
      + (bad ? '<p class="tg-bad">' + esc(bad) + '</p>' : '')
      + '</fieldset>';
  }
  function kitHTML(g) {
    return '<a class="tg-wa" data-send="' + g.id + '" href="' + esc(waHref(g)) + '" target="_blank" rel="noopener">' + WA_ICON + (onPhone ? 'Send on WhatsApp' : 'Send in WhatsApp Web') + '</a>'
      + '<p class="tg-small">' + (onPhone ? 'WhatsApp opens on ' + esc(g.mobile) + ' with the message written. Check it and press Send.'
        : 'WhatsApp Web opens in a new tab on ' + esc(g.mobile) + ' with the message written. Press Send there. (Your phone must be linked: on the phone, WhatsApp &rsaquo; Linked devices.)') + '</p>'
      + '<div class="tg-row">'
      +   '<button type="button" class="tg-sec" data-copy="' + g.id + '">Copy the message</button>'
      +   (onPhone ? '<a class="tg-sec" href="' + esc(g.sms_url) + '">Send by SMS</a>' : '')
      + '</div>'
      + (cfg.email && g.email_url ? '<div class="tg-row"><a class="tg-sec" data-send="' + g.id + '" href="' + esc(g.email_url) + '">Send by email</a></div>' : '')
      + '<div class="tg-row"><a class="tg-sec" href="' + esc(g.pass_url) + '" target="_blank" rel="noopener">Open the pass</a></div>';
  }
  function onPassChange(e) {
    if (e.target && (e.target.name === 'pass' || e.target.name === 'sheetpass')) {
      var form = e.target.closest('form') || root;
      Array.prototype.forEach.call(form.querySelectorAll('.tg-pass'), function (l) {
        l.classList.toggle('on', !!l.querySelector('input:checked'));
      });
      if (e.target.name === 'sheetpass') sheetPass = e.target.value;
    }
  }
  function formRead() {
    var form = document.getElementById('tg-form');
    var v = {};
    ['name', 'mobile', 'company', 'job_title', 'email'].forEach(function (k) {
      var el = form.querySelector('[name="' + k + '"]');
      v[k] = el ? String(el.value || '').trim() : '';
    });
    var p = form.querySelector('input[name="pass"]:checked');
    v.pass = p ? p.value : 'visitor';
    return v;
  }
  function submitOne(e) {
    e.preventDefault();
    if (busy) return;
    var v = formRead();
    formValues = v;
    if (v.name.length < 2) { formError = { field: 'name', error: 'Write the guest\u2019s name as it should be printed on the pass.' }; render(); focusField('name'); return; }
    if (v.mobile.replace(/\D/g, '').length < 8) { formError = { field: 'mobile', error: 'Write the guest\u2019s mobile number: 10 digits.' }; render(); focusField('mobile'); return; }
    busy = true;
    var btn = document.getElementById('tg-go');
    if (btn) { btn.disabled = true; btn.textContent = 'Making the pass\u2026'; }
    api('POST', cfg.base, v).then(function (r) {
      busy = false;
      if (r.status === 201 && r.data.guest) {
        putGuest(r.data.guest); counted(1);
        current = r.data.guest; formError = null; formValues = { pass: 'visitor' };
        render(); scrollTop(); focusFirst('[data-send]');
      } else if (r.status === 409 && r.data.guest) {
        putGuest(r.data.guest);
        current = r.data.guest; current.note = r.data.error; formError = null; formValues = { pass: 'visitor' };
        render(); scrollTop();
      } else {
        formError = { field: r.data.field || '', error: r.data.error || 'That did not work. Check your internet and try again.' };
        render(); if (formError.field) focusField(formError.field);
      }
    }).catch(function () {
      busy = false;
      formError = { error: 'That did not work. Check your internet and try again.' };
      render();
    });
  }

  // ---- Upload a list ----
  function listHTML() {
    var out = (onePass()
        ? '<p class="tg-lead">A CSV or Excel sheet (.csv, .xlsx) with the columns <b>Name</b> and <b>Mobile</b>; <b>Organisation</b>, <b>Designation</b> and <b>Email</b> if you have them. Everyone on it gets a free Visitor Pass. Up to ' + MAX_ROWS + ' guests a sheet.</p>' + leftHTML()
        : '<p class="tg-lead">A .csv or .xlsx sheet with the columns <b>Name</b> and <b>Mobile</b>; <b>Pass</b> (Visitor, Delegate or VIP), <b>Organisation</b>, <b>Designation</b> and <b>Email</b> if you have them. Up to ' + MAX_ROWS + ' guests a sheet.</p>')
      + '<label class="tg-file"><input type="file" id="tg-file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel">'
      + (sheet ? esc(sheet.name) + ' \u00b7 choose another' : 'Choose the sheet') + '</label>'
      + '<p class="tg-small">No sheet yet? <a class="tg-link" href="' + esc(cfg.base) + '/template.csv" download="guest-list.csv">Download a blank one</a> and fill it in.</p>';
    if (uploaded) {
      var c = uploaded.counts;
      out += '<div class="tg-done" role="status"><h3>' + c.added + ' guest' + (c.added === 1 ? '' : 's') + ' registered</h3>'
        + '<p>' + (c.already ? c.already + ' already on the list. ' : '') + (c.skipped ? c.skipped + ' skipped. ' : '') + (c.added ? 'Their passes are ready to send.' : '') + '</p></div>';
      if (uploaded.stopped) out += '<div class="tg-alert" role="alert">' + esc(uploaded.stopped) + '</div>';
      var trouble = uploaded.results.filter(function (r) { return r.status !== 'added'; });
      if (trouble.length) {
        out += '<table class="tg-table"><thead><tr><th>Row</th><th>Who</th><th>What happened</th></tr></thead><tbody>'
          + trouble.slice(0, 60).map(function (r) {
              return '<tr><td>' + r.row + '</td><td>' + esc(r.name || '') + (r.mobile ? '<br>' + esc(r.mobile) : '') + '</td><td>' + esc(r.reason || '') + '</td></tr>';
            }).join('')
          + (trouble.length > 60 ? '<tr><td colspan="3">and ' + (trouble.length - 60) + ' more</td></tr>' : '')
          + '</tbody></table>';
      }
      if (c.added || c.already) out += '<button type="button" class="tg-go" id="tg-tosend">Send the passes on WhatsApp</button>';
      return out;
    }
    if (sheet && sheet.error) out += '<div class="tg-alert" role="alert">' + esc(sheet.error) + '</div>';
    if (sheet && !sheet.error) {
      var rows = sheet.inputs;
      out += '<div class="tg-sum"><span>' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + '</span>'
        + (sheet.missing ? '<span class="warn">' + sheet.missing + ' without a name or a mobile</span>' : '') + '</div>'
        + '<table class="tg-table"><thead><tr><th>Name</th><th>Mobile</th>' + (onePass() ? '' : '<th>Pass</th>') + '</tr></thead><tbody>'
        + rows.slice(0, 5).map(function (r) { return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.mobile) + '</td>' + (onePass() ? '' : '<td>' + esc(r.pass || '') + '</td>') + '</tr>'; }).join('')
        + (rows.length > 5 ? '<tr><td colspan="3">and ' + (rows.length - 5) + ' more</td></tr>' : '')
        + '</tbody></table>'
        + '<form id="tg-sheetform" novalidate>' + passRadios(sheetPass, '', 'sheetpass')
        + '<button type="submit" class="tg-go" id="tg-upload">Register ' + rows.length + ' guest' + (rows.length === 1 ? '' : 's') + '</button></form>';
    }
    return out;
  }

  function onFile(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    uploaded = null;
    sheet = { name: file.name, inputs: [], rows: [] };
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    var done = function (rows) {
      if (!rows.length) { sheet.error = 'The sheet has no rows under its heading row.'; render(); return; }
      if (rows.length > MAX_ROWS) { sheet.error = 'A sheet may have up to ' + MAX_ROWS + ' guests. This one has ' + rows.length + '. Split it and upload the parts.'; render(); return; }
      sheet.rows = rows;
      sheet.inputs = rows.map(preview);
      sheet.missing = sheet.inputs.filter(function (r) { return !r.name || !r.mobile; }).length;
      if (sheet.missing === sheet.inputs.length) sheet.error = 'Could not find a Name and a Mobile column. Head the columns Name, Mobile, Pass, Organisation, Designation, Email, as in the blank sheet.';
      render();
    };
    var fail = function (msg) { sheet.error = msg; render(); };
    var reader = new FileReader();
    reader.onerror = function () { fail('Could not read that file.'); };
    if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
      reader.onload = function (e) { try { done(parseCsv(String(e.target.result || ''))); } catch (err) { fail('Could not read that file: ' + err.message); } };
      reader.readAsText(file);
    } else {
      reader.onload = function (e) {
        withXlsx(function (XLSX) {
          if (!XLSX) { fail('Could not load the Excel reader. Check your internet, or save the sheet as .csv.'); return; }
          try {
            var wb = XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            done(XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }));
          } catch (err) { fail('Could not read that file: ' + err.message); }
        });
      };
      reader.readAsArrayBuffer(file);
    }
  }
  function withXlsx(cb) {
    if (global.XLSX) { cb(global.XLSX); return; }
    var s = document.createElement('script');
    s.src = XLSX_SRC;
    s.onload = function () { cb(global.XLSX || null); };
    s.onerror = function () { s.remove(); cb(null); };
    document.head.appendChild(s);
  }
  // A .csv as Excel or Google Sheets writes it: quoted cells, commas inside quotes, CRLF;
  // tabs when the first line has no comma.
  function parseCsv(text) {
    text = text.replace(/^\uFEFF/, '');
    var lines = text.split(/\r\n|\n|\r/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) return [];
    var sep = lines[0].indexOf(',') < 0 && lines[0].indexOf('\t') >= 0 ? '\t' : ',';
    var split = function (line) {
      var out = [], cur = '', q = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (q) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') { q = false; }
          else { cur += ch; }
        } else if (ch === '"') { q = true; }
        else if (ch === sep) { out.push(cur); cur = ''; }
        else { cur += ch; }
      }
      out.push(cur);
      return out;
    };
    var heads = split(lines[0]).map(function (h) { return h.trim(); });
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var vals = split(lines[i]);
      if (vals.every(function (v) { return !v.trim(); })) continue;
      var row = {};
      heads.forEach(function (h, k) { if (h) row[h] = (vals[k] || '').trim(); });
      rows.push(row);
    }
    return rows;
  }
  // The same heading words the server understands, for the preview only; the server
  // reads the sheet's own headings again and decides.
  var HEAD = [
    ['first', /^first\s*name$/i], ['last', /^(last\s*name|surname|family\s*name)$/i],
    ['name', /^((full\s*)?names?|guest(\s*name)?|name of .*|participants?|delegates?|attendees?|members?|person|invitee)$/i],
    ['mobile', /^((mobile|phone|contact|cell|whatsapp|wa|telephone)(\s*(no|number|num))?\.?|mob\.?(\s*no\.?)?|contact\s*details)$/i],
    ['pass', /^(pass(\s*type)?|badge(\s*type)?|category|ticket(\s*type)?)$/i]
  ];
  function preview(row) {
    var got = {};
    Object.keys(row).forEach(function (k) {
      var t = String(k).trim().replace(/[:*]+$/, '').replace(/\s+/g, ' ').trim();
      for (var i = 0; i < HEAD.length; i++) { if (HEAD[i][1].test(t) && !got[HEAD[i][0]]) { got[HEAD[i][0]] = String(row[k] == null ? '' : row[k]).trim(); break; } }
    });
    return { name: got.name || [got.first, got.last].filter(Boolean).join(' '), mobile: got.mobile || '', pass: got.pass || '' };
  }
  function submitSheet(e) {
    e.preventDefault();
    if (busy || !sheet || !sheet.rows.length) return;
    busy = true;
    var btn = document.getElementById('tg-upload');
    if (btn) { btn.disabled = true; btn.textContent = 'Registering\u2026'; }
    api('POST', cfg.base + '/bulk', { rows: sheet.rows, default_pass: sheetPass }).then(function (r) {
      busy = false;
      if (r.status === 201 && r.data.results) {
        uploaded = r.data;
        counted((r.data.counts && r.data.counts.added) || 0);
        r.data.results.forEach(function (x) { if (x.guest) putGuest(x.guest); });
        sheet = null;
        render(); scrollTop();
        loadList().then(render);
      } else {
        sheet.error = r.data.error || 'That did not work. Check your internet and try again.';
        render();
      }
    }).catch(function () { busy = false; sheet.error = 'That did not work. Check your internet and try again.'; render(); });
  }

  // ---- Send ----
  function sendHTML() {
    var shown = guests.filter(function (g) { return filter === 'all' ? true : filter === 'sent' ? !!g.sent_at : !g.sent_at; });
    var next = guests.filter(function (g) { return !g.sent_at; })[0] || null;
    var chip = function (key, label, n) { return '<button type="button" class="tg-chip" data-filter="' + key + '" aria-pressed="' + (filter === key) + '">' + label + ' (' + n + ')</button>'; };
    var out = '<p class="tg-lead">' + (onPhone ? 'Each tap opens WhatsApp on that guest\u2019s number with the message written. Press Send there and come back for the next one.'
      : 'Each tap opens WhatsApp Web in a new tab on that guest\u2019s number with the message written. Press Send there and come back for the next one. Your phone must be linked to WhatsApp Web (on the phone: WhatsApp \u203a Linked devices).') + '</p>';
    if (next) {
      out += '<div class="tg-next"><p><b>Next:</b> ' + esc(next.name) + ' \u00b7 ' + esc(next.badge_type) + ' \u00b7 ' + esc(next.mobile) + '</p>'
        + '<a class="tg-wa" data-send="' + next.id + '" href="' + esc(waHref(next)) + '" target="_blank" rel="noopener">' + WA_ICON + (onPhone ? 'Send to ' : 'Send in WhatsApp Web to ') + esc(next.name.split(' ')[0]) + '</a></div>';
    } else if (guests.length) {
      out += '<div class="tg-done" role="status"><h3>Every pass is sent</h3><p>' + counts.sent + ' of ' + counts.total + '. Tap a name below to send one again.</p></div>';
    }
    out += '<div class="tg-chips">' + chip('to_send', 'To send', counts.to_send) + chip('sent', 'Sent', counts.sent) + chip('all', 'All', counts.total) + '</div>'
      + (cfg.everyone ? '<label class="tg-tog"><input type="checkbox" id="tg-everyone"' + (everyone ? ' checked' : '') + '> Show guests the whole team registered</label>' : '');
    if (!shown.length) {
      out += '<p class="tg-empty">' + (guests.length ? 'Nobody here.' : 'No guests yet. Add one, or upload a list.') + '</p>';
    } else {
      out += shown.map(function (g) {
        var sent = g.sent_at;
        return '<div class="tg-g" data-row="' + g.id + '"><div><b>' + esc(g.name) + '</b><span>' + esc(g.badge_type) + ' \u00b7 ' + esc(g.mobile) + (g.by ? ' \u00b7 by ' + esc(g.by) : '') + '</span>'
          + (sent ? '<span class="sent">Sent ' + esc(timeOf(sent)) + '<button type="button" data-unsend="' + g.id + '">Not sent? Undo</button></span>' : '')
          + '</div><a class="wa' + (sent ? ' again' : '') + '" data-send="' + g.id + '" href="' + esc(waHref(g)) + '" target="_blank" rel="noopener" aria-label="' + (sent ? 'Send again to ' : 'Send to ') + esc(g.name) + '">' + (sent ? 'Again' : 'WhatsApp') + '</a></div>';
      }).join('');
    }
    return out;
  }
  function byId(id) { for (var i = 0; i < guests.length; i++) if (guests[i].id === id) return guests[i]; return null; }
  // The tap opened WhatsApp; the guest is marked sent now (Undo on the row), so a list
  // can be worked through without a second tap per person.
  function markSent(id) {
    var g = byId(id);
    if (!g) return;
    if (!g.sent_at) { g.sent_at = new Date().toISOString(); recount(); }
    api('POST', cfg.base + '/' + id + '/sent').then(function (r) {
      if (r.status === 200 && r.data.sent_at) { var x = byId(id); if (x) x.sent_at = r.data.sent_at; }
      if (tab === 'send') render();
    }).catch(function () {});
    if (tab === 'send') setTimeout(render, 400);
    else render();
  }
  function unsend(id) {
    var g = byId(id);
    if (!g) return;
    g.sent_at = null; recount(); render();
    api('POST', cfg.base + '/' + id + '/unsent').catch(function () {});
  }

  // ---------- plumbing ----------

  function copyText(text, btn) {
    var ok = function () { if (btn) { var was = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = was; }, 2500); } };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok).catch(function () { fallbackCopy(text); ok(); });
    } else { fallbackCopy(text); ok(); }
  }
  function fallbackCopy(text) {
    var t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); } catch (e) { /* nothing more to try */ }
    t.remove();
  }
  function scrollTop() { var s = root && root.querySelector('.tg-sheet'); if (s) s.scrollTop = 0; }
  function focusField(id) { var el = document.getElementById('tg-' + id); if (el) { try { el.focus(); } catch (e) {} } }
  function focusFirst(sel) { var el = root && root.querySelector(sel); if (el) { try { el.focus({ preventScroll: true }); } catch (e) {} } }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t === root || t.closest('.tg-x')) { close(); return; }
    var tb = t.closest('.tg-tab');
    if (tb) { tab = tb.getAttribute('data-tab'); render(); if (tab === 'send') loadList().then(render); return; }
    if (t.closest('#tg-again')) { current = null; render(); focusField('name'); return; }
    if (t.closest('#tg-tosend')) { tab = 'send'; filter = 'to_send'; render(); return; }
    var copy = t.closest('[data-copy]');
    if (copy) { var g = byId(Number(copy.getAttribute('data-copy'))); if (g) copyText(g.message, copy); return; }
    var send = t.closest('[data-send]');
    if (send) { markSent(Number(send.getAttribute('data-send'))); return; }   // the link itself still opens
    var un = t.closest('[data-unsend]');
    if (un) { unsend(Number(un.getAttribute('data-unsend'))); return; }
    var ch = t.closest('[data-filter]');
    if (ch) { filter = ch.getAttribute('data-filter'); render(); return; }
  }
  function onChange(e) {
    var t = e.target;
    if (!t) return;
    if (t.id === 'tg-file') { onFile(t); return; }
    if (t.id === 'tg-everyone') { everyone = !!t.checked; loadList().then(render); return; }
    if (t.name === 'sheetpass' || t.name === 'pass') onPassChange(e);
  }
  function onSubmit(e) {
    if (e.target && e.target.id === 'tg-sheetform') submitSheet(e);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function close() {
    if (!root) return;
    root.remove();
    root = null;
    document.removeEventListener('keydown', onKey);
    document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    if (typeof cfg.onClose === 'function') { try { cfg.onClose(); } catch (e) {} }
  }

  // which: 'one' | 'list' | 'send'. opts: none for the team; for an exhibitor,
  // { exhibitor: true, onClose: fn } (or any of the EXHIBITOR keys to override).
  function open(which, opts) {
    ensureStyle();
    if (root) return;
    opts = opts || {};
    cfg = {};
    [TEAM, opts.exhibitor ? EXHIBITOR : {}, opts].forEach(function (o) { Object.keys(o).forEach(function (k) { cfg[k] = o[k]; }); });
    guests = []; counts = { total: 0, sent: 0, to_send: 0 }; everyone = false; limitInfo = null; filter = 'to_send';
    lastFocus = document.activeElement;
    tab = which || 'one';
    current = null; formError = null; formValues = { pass: 'visitor' }; sheet = null; uploaded = null;
    root = document.createElement('div');
    root.className = 'tg-back';
    root.innerHTML = '<div class="tg-sheet" role="dialog" aria-modal="true" aria-labelledby="tg-title">'
      + '<div class="tg-top"><div class="tg-head"><h2 id="tg-title">' + esc(cfg.title) + '</h2><button type="button" class="tg-x" aria-label="Close">&times;</button></div>'
      + '<div class="tg-tabs" role="tablist"></div></div>'
      + '<div class="tg-body"></div></div>';
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('submit', onSubmit);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    document.documentElement.style.overflow = 'hidden';
    render();
    if (tab === 'one') focusField('name');
    loadList().then(function () { if (root) render(); });
  }

  global.TeamGuest = { open: open, close: close };
})(window);
