/* "Register a guest" for the organising team, in the app (16 Nov 2026).
 *
 * The organiser: when the team has only a guest's mobile number, register them and
 * send the pass on WhatsApp, from the team member's own phone. Opened from the account
 * menu of anyone holding the Organiser pass (openTeamGuest() in the app); the server
 * side is src/routes/team-guests.ts, which checks the pass again.
 *
 * Nothing is sent from here by itself: "Send on WhatsApp" opens the team member's
 * WhatsApp on the guest's number with the message written, and they press Send.
 */
(function (global) {
  'use strict';

  var PASSES = [
    { key: 'visitor', label: 'Visitor Pass', note: 'Free' },
    { key: 'delegate', label: 'Delegate Pass', note: 'Complimentary, with lunch' },
    { key: 'vip', label: 'VIP Pass', note: 'Complimentary, with lunch' }
  ];

  var root = null, lastFocus = null, guests = [], busy = false;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  var CSS = ''
    + '.tg-back{position:fixed;inset:0;z-index:9990;background:rgba(15,18,40,.55);display:flex;align-items:flex-end;justify-content:center;}'
    + '@media (min-width:640px){.tg-back{align-items:center;padding:24px;}}'
    + '.tg-sheet{background:#fff;color:#1E2140;width:100%;max-width:480px;max-height:92vh;overflow-y:auto;-webkit-overflow-scrolling:touch;border-radius:18px 18px 0 0;padding:0 16px calc(20px + env(safe-area-inset-bottom));font-family:Inter,Arial,sans-serif;font-size:16px;line-height:1.45;box-shadow:0 -8px 40px rgba(0,0,0,.25);}'
    + '@media (min-width:640px){.tg-sheet{border-radius:18px;}}'
    + '.tg-top{position:sticky;top:0;background:#fff;display:flex;align-items:center;gap:8px;padding:14px 0 10px;border-bottom:1px solid #E4E7F4;margin-bottom:14px;z-index:1;}'
    + '.tg-top h2{flex:1;margin:0;font:700 18px Montserrat,Inter,Arial,sans-serif;}'
    + '.tg-x{min-width:44px;min-height:44px;border:0;background:#F1F3FA;border-radius:12px;font-size:22px;line-height:1;color:#1E2140;cursor:pointer;}'
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
    + '.tg-wa{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:54px;border-radius:12px;background:#25D366;color:#073b1c;font:700 17px Inter,Arial,sans-serif;text-decoration:none;margin:0 0 10px;}'
    + '.tg-wa svg{width:22px;height:22px;flex:none;}'
    + '.tg-row{display:flex;gap:8px;margin:0 0 10px;}'
    + '.tg-row > *{flex:1;}'
    + '.tg-sec{display:flex;align-items:center;justify-content:center;min-height:48px;padding:8px 10px;border-radius:12px;border:1px solid #C9CEE3;background:#fff;color:#1E2140;font:600 15px Inter,Arial,sans-serif;text-decoration:none;cursor:pointer;text-align:center;}'
    + '.tg-small{margin:0 0 14px;font-size:13px;color:#4A5070;}'
    + '.tg-list{margin:18px 0 0;padding:14px 0 0;border-top:1px solid #E4E7F4;}'
    + '.tg-list h3{margin:0 0 10px;font:700 16px Montserrat,Inter,Arial,sans-serif;}'
    + '.tg-g{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #F0F2F8;}'
    + '.tg-g div{flex:1;min-width:0;}'
    + '.tg-g b{display:block;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
    + '.tg-g span{display:block;font-size:13px;color:#4A5070;}'
    + '.tg-g a{flex:none;min-height:44px;min-width:44px;padding:0 12px;display:flex;align-items:center;justify-content:center;border-radius:10px;background:#25D366;color:#073b1c;font:700 14px Inter,Arial,sans-serif;text-decoration:none;}'
    + '.tg-empty{font-size:14px;color:#6B7194;margin:0;}';

  var WA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.6-.3z"/></svg>';

  function ensureStyle() {
    if (document.getElementById('tg-style')) return;
    var s = document.createElement('style');
    s.id = 'tg-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function api(method, body) {
    return fetch('/api/team/guests', {
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d || {} }; });
    });
  }

  function sheet(inner) {
    root.querySelector('.tg-body').innerHTML = inner;
  }

  function formHTML(v, err) {
    v = v || {};
    err = err || {};
    var pass = v.pass || 'visitor';
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
      + '<p class="tg-lead">For a guest you have only a mobile number for. You get the pass link to send them on WhatsApp.</p>'
      + '<form id="tg-form" novalidate>'
      + field('name', 'Guest&rsquo;s name', { max: 120, help: 'As it should be printed on the pass.' })
      + field('mobile', 'Mobile number', { type: 'tel', mode: 'tel', max: 20, help: '10 digits. For a number outside India, start with + and the country code.' })
      + '<fieldset class="tg-passes"><legend class="tg-legend">Pass</legend>'
      + PASSES.map(function (p) {
          return '<label class="tg-pass' + (p.key === pass ? ' on' : '') + '"><input type="radio" name="pass" value="' + p.key + '"' + (p.key === pass ? ' checked' : '') + '>'
            + '<span><b>' + p.label + '</b><span>' + p.note + '</span></span></label>';
        }).join('')
      + (err.field === 'pass' ? '<p class="tg-bad">' + esc(err.error) + '</p>' : '')
      + '</fieldset>'
      + field('company', 'Organisation <span class="tg-opt">(optional)</span>', { max: 160 })
      + field('job_title', 'Designation <span class="tg-opt">(optional)</span>', { max: 160 })
      + field('email', 'Email', { type: 'email', mode: 'email', max: 200, optional: true, help: 'Leave it empty if you do not have it. With an email they can also use the app.' })
      + '<button type="submit" class="tg-go" id="tg-go">Make the pass</button>'
      + '</form>'
      + listHTML();
  }

  function sendHTML(g) {
    return '<a class="tg-wa" id="tg-wa" href="' + esc(g.whatsapp_url) + '" target="_blank" rel="noopener">' + WA_ICON + 'Send on WhatsApp</a>'
      + '<p class="tg-small">WhatsApp opens on ' + esc(g.mobile) + ' with the message written. Check it and press Send.</p>'
      + '<div class="tg-row">'
      +   '<button type="button" class="tg-sec" data-copy="1">Copy the message</button>'
      +   '<a class="tg-sec" href="' + esc(g.sms_url) + '">Send by SMS</a>'
      + '</div>'
      + '<div class="tg-row"><a class="tg-sec" href="' + esc(g.pass_url) + '" target="_blank" rel="noopener">Open the pass</a></div>';
  }

  function doneHTML(g, note) {
    return (note ? '<div class="tg-note" role="status">' + esc(note) + '</div>'
      : '<div class="tg-done" role="status"><h3>Pass ready for ' + esc(g.name) + '</h3><p>' + esc(g.badge_type) + ' &middot; ' + esc(g.ref) + ' &middot; ' + esc(g.mobile) + '</p></div>')
      + sendHTML(g)
      + '<button type="button" class="tg-go" id="tg-again">Register another guest</button>'
      + listHTML();
  }

  function listHTML() {
    var rows = guests.map(function (g, i) {
      return '<div class="tg-g"><div><b>' + esc(g.name) + '</b><span>' + esc(g.badge_type) + ' &middot; ' + esc(g.mobile) + '</span></div>'
        + '<a href="' + esc(g.whatsapp_url) + '" target="_blank" rel="noopener" aria-label="Send the pass to ' + esc(g.name) + ' on WhatsApp" data-i="' + i + '">WhatsApp</a></div>';
    }).join('');
    return '<div class="tg-list"><h3>Guests you registered' + (guests.length ? ' (' + guests.length + ')' : '') + '</h3>'
      + (rows || '<p class="tg-empty">None yet.</p>') + '</div>';
  }

  function loadList() {
    return api('GET').then(function (r) {
      if (r.status === 200 && r.data && Array.isArray(r.data.guests)) guests = r.data.guests;
    }).catch(function () {});
  }

  function copyText(text, btn) {
    var ok = function () { if (btn) { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy the message'; }, 2500); } };
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

  var current = null;
  function showForm(v, err) {
    current = null;
    sheet(formHTML(v, err));
    var form = document.getElementById('tg-form');
    form.addEventListener('submit', submit);
    form.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'pass') {
        Array.prototype.forEach.call(form.querySelectorAll('.tg-pass'), function (l) {
          l.classList.toggle('on', !!l.querySelector('input:checked'));
        });
      }
    });
    var focus = err && err.field ? document.getElementById('tg-' + err.field) : document.getElementById('tg-name');
    if (focus && focus.focus) { try { focus.focus({ preventScroll: !err }); } catch (e) { focus.focus(); } }
  }

  function showDone(g, note) {
    current = g;
    sheet(doneHTML(g, note));
    var top = root.querySelector('.tg-sheet');
    if (top) top.scrollTop = 0;
    var wa = document.getElementById('tg-wa');
    if (wa) { try { wa.focus({ preventScroll: true }); } catch (e) { wa.focus(); } }
  }

  function values() {
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

  function localCheck(v) {
    if (v.name.length < 2) return { field: 'name', error: 'Write the guest’s name as it should be printed on the pass.' };
    var d = v.mobile.replace(/\D/g, '');
    if (d.length < 8) return { field: 'mobile', error: 'Write the guest’s mobile number: 10 digits.' };
    return null;
  }

  function submit(e) {
    e.preventDefault();
    if (busy) return;
    var v = values();
    var bad = localCheck(v);
    if (bad) { showForm(v, bad); return; }
    busy = true;
    var btn = document.getElementById('tg-go');
    if (btn) { btn.disabled = true; btn.textContent = 'Making the pass…'; }
    api('POST', v).then(function (r) {
      busy = false;
      if (r.status === 201 && r.data.guest) {
        guests = [r.data.guest].concat(guests.filter(function (g) { return g.id !== r.data.guest.id; }));
        showDone(r.data.guest);
      } else if (r.status === 409 && r.data.guest) {
        showDone(r.data.guest, r.data.error);
      } else {
        showForm(v, { field: r.data.field || '', error: r.data.error || 'That did not work. Check your internet and try again.' });
      }
    }).catch(function () {
      busy = false;
      showForm(v, { error: 'That did not work. Check your internet and try again.' });
    });
  }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t === root || t.closest('.tg-x')) { close(); return; }
    if (t.closest('#tg-again')) { showForm({ pass: 'visitor' }); return; }
    var copy = t.closest('[data-copy]');
    if (copy && current) { copyText(current.message, copy); }
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function close() {
    if (!root) return;
    root.remove();
    root = null;
    document.removeEventListener('keydown', onKey);
    document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  function open() {
    ensureStyle();
    if (root) return;
    lastFocus = document.activeElement;
    root = document.createElement('div');
    root.className = 'tg-back';
    root.innerHTML = '<div class="tg-sheet" role="dialog" aria-modal="true" aria-labelledby="tg-title">'
      + '<div class="tg-top"><h2 id="tg-title">Register a guest</h2><button type="button" class="tg-x" aria-label="Close">&times;</button></div>'
      + '<div class="tg-body"></div></div>';
    root.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    document.documentElement.style.overflow = 'hidden';
    showForm({ pass: 'visitor' });
    loadList().then(function () {
      if (!root) return;
      var list = root.querySelector('.tg-list');
      if (list) list.outerHTML = listHTML();
    });
  }

  global.TeamGuest = { open: open, close: close };
})(window);
