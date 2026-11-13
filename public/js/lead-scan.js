/* Booth lead scanner, /exhibitor/scan (13 Nov 2026).
 *
 * One badge after another without leaving the page. The camera keeps running; after a
 * scan a card slides up over it with the visitor's name, and Hot / Warm / Cold, what
 * they want and a note are saved as they are tapped. "Done" goes back to the camera.
 *
 * With no signal a scan is kept on this phone (localStorage, one list per exhibitor) and
 * sent when the signal returns: on the browser's "online" event, every 20 seconds, and
 * when the page is shown again. The time it was scanned goes with it.
 *
 * Only the token of a /verify/<token> link is taken from a code, so no code can send
 * the phone elsewhere; the server checks the token's signature. The page is built by
 * exhibitorScanHTML in src/index.tsx; bump LEAD_SCAN_VERSION there on any change here.
 */
(function () {
  'use strict';
  var root = document.getElementById('scan');
  if (!root) return;
  var EX = root.getAttribute('data-ex') || '0';
  var QKEY = 'bhai-leadq-' + EX, RKEY = 'bhai-leadr-' + EX;
  var KEEP_DAYS = 4, RECENT_MAX = 30, SHOW_RECENT = 12;
  function $(id) { return document.getElementById(id); }
  var v = $('v'), e = $('e'), camBtn = $('cam'), card = $('card'), st = $('st'), note = $('n'), qbox = $('queue'), recentBox = $('recent');
  var VERIFY = /\/verify\/([A-Za-z0-9._%-]+)/;

  // ---- what this phone remembers ----
  function load(k) { try { var x = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(x) ? x : []; } catch (err) { return []; } }
  function save(k, x) { try { localStorage.setItem(k, JSON.stringify(x)); } catch (err) { /* private mode: kept in memory */ } }
  var cutoff = Date.now() - KEEP_DAYS * 86400000;
  var queue = load(QKEY).filter(function (q) { return q && q.token; });
  var recent = load(RKEY).filter(function (r) { return r && r.token && Number(r.t) > cutoff; });

  function remember(token, fields) {
    var r = null;
    for (var i = 0; i < recent.length; i++) if (recent[i].token === token) { r = recent.splice(i, 1)[0]; break; }
    r = r || { token: token, name: '', org: '', rating: '', state: 'waiting', msg: '' };
    for (var k in fields) r[k] = fields[k];
    r.t = Date.now();
    recent.unshift(r);
    recent = recent.slice(0, RECENT_MAX);
    save(RKEY, recent);
    drawRecent();
  }
  function enqueue(token, at, fields) {
    var q = null;
    for (var i = 0; i < queue.length; i++) if (queue[i].token === token) { q = queue[i]; break; }
    if (!q) { q = { token: token, at: at, fields: {} }; queue.push(q); }
    for (var k in fields) q.fields[k] = fields[k];
    save(QKEY, queue);
    drawQueue();
  }
  function unqueue(token) {
    queue = queue.filter(function (q) { return q.token !== token; });
    save(QKEY, queue);
    drawQueue();
  }

  function drawQueue() {
    var n = queue.length;
    qbox.hidden = !n;
    qbox.textContent = n ? n + (n === 1 ? ' scan is' : ' scans are') + ' waiting to send. They go as soon as there is signal.' : '';
  }
  function drawRecent() {
    var list = recent.slice(0, SHOW_RECENT);
    recentBox.textContent = '';
    if (!list.length) {
      var none = document.createElement('li'); none.className = 'none';
      none.textContent = 'Nobody yet. To try it, scan your own pass or a colleague’s: it says so, and nothing is saved.';
      recentBox.appendChild(none); return;
    }
    list.forEach(function (r) {
      var li = document.createElement('li'), b = document.createElement('button'), nm = document.createElement('span'), sm = document.createElement('span'), tg = document.createElement('span');
      b.type = 'button';
      nm.className = 'nm'; nm.textContent = r.name || 'Visitor';
      sm.className = 'sm'; sm.textContent = r.state === 'waiting' ? 'Waiting for signal. The name comes when it is sent.' : r.state === 'refused' ? (r.msg || 'Not saved') : (r.org || '');
      nm.appendChild(sm);
      tg.className = 'tg' + (r.state === 'waiting' ? ' wait' : r.state === 'refused' ? ' bad' : '');
      tg.textContent = r.state === 'waiting' ? 'Waiting' : r.state === 'refused' ? 'Not saved' : (r.rating ? r.rating.charAt(0).toUpperCase() + r.rating.slice(1) : 'Saved');
      b.appendChild(nm); b.appendChild(tg);
      if (r.state !== 'refused') b.addEventListener('click', function () { openCard(r.token, false); });
      else b.disabled = true;
      li.appendChild(b); recentBox.appendChild(li);
    });
  }

  // ---- the card ----
  var cur = null, lastToken = '', lastClosed = 0, paused = false, noteTouched = false;
  function say(t, c) { st.textContent = t; st.className = 'st' + (c ? ' ' + c : ''); }
  function paint() {
    if (!cur) return;
    card.querySelectorAll('[data-r]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-r') === cur.rating ? 'true' : 'false'); });
    card.querySelectorAll('[data-t]').forEach(function (b) { b.setAttribute('aria-pressed', cur.tags.indexOf(b.getAttribute('data-t')) >= 0 ? 'true' : 'false'); });
  }
  function showWho(vis) {
    var ph = $('cph'), cn = $('cn'), ct = $('ct'), cp = $('cp');
    var name = (vis && vis.name) || 'Visitor';
    cn.textContent = name;
    ct.textContent = vis ? [vis.job_title, vis.company].filter(Boolean).join(' · ') : '';
    cp.hidden = !(vis && vis.badge_type); cp.textContent = (vis && vis.badge_type) || '';
    ph.textContent = '';
    var src = vis && vis.avatar_url ? String(vis.avatar_url) : '';
    if (src && /^(\/|https:\/\/)/.test(src)) {
      var img = document.createElement('img'); img.alt = ''; img.src = src;
      img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover';
      img.onerror = function () { ph.textContent = name.charAt(0).toUpperCase(); };
      ph.appendChild(img);
    } else ph.textContent = vis ? name.charAt(0).toUpperCase() : '?';
  }
  function setEditable(on) { $('edit').hidden = !on; }

  function openCard(token, fresh) {
    paused = true;
    var r = null;
    for (var i = 0; i < recent.length; i++) if (recent[i].token === token) { r = recent[i]; break; }
    var at = fresh ? Date.now() : (r && r.at) || Date.now();
    cur = { token: token, at: at, rating: (r && r.rating) || '', tags: (r && r.tags) || [], note: '' };
    noteTouched = false;
    note.value = '';
    showWho(r && r.name ? { name: r.name, company: r.org } : null);
    setEditable(true);
    paint();
    say(fresh ? 'Saving this lead…' : 'Opening…', '');
    card.hidden = false;
    if (fresh) { try { if (navigator.vibrate) navigator.vibrate(40); } catch (err) {} }
    send(token, at, {}, true);
  }
  function closeCard() {
    if (cur && noteTouched && note.value !== cur.note) send(cur.token, cur.at, { note: note.value }, false);
    if (cur) { lastToken = cur.token; lastClosed = Date.now(); }
    cur = null;
    card.hidden = true;
    paused = false;
  }

  // ---- talking to the server ----
  var flushing = false;
  function post(body) {
    return fetch('/api/exhibitor/leads/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j || {} }; }); });
  }
  function body(token, at, fields) { var b = { token: token, at: at }; for (var k in fields) b[k] = fields[k]; return b; }
  function arrived(token, j, first) {
    var vis = j.visitor || {}, lead = j.lead || {};
    remember(token, { at: (cur && cur.token === token && cur.at) || Date.now(), name: vis.name || '', org: [vis.job_title, vis.company].filter(Boolean).join(' · '), rating: lead.rating || '', tags: lead.tags || [], state: 'sent', msg: '' });
    if (!cur || cur.token !== token) return;
    cur.rating = lead.rating || ''; cur.tags = lead.tags || [];
    if (first) { cur.note = lead.note || ''; if (!noteTouched) note.value = cur.note; }
    showWho(vis); paint();
    say(first ? (j.again ? 'Already in your leads. Change the rating or the note if you like.' : 'Saved to your leads.') : 'Saved.', 'ok');
  }
  function refused(token, j) {
    unqueue(token);
    var own = !!j.own;
    if (!own) remember(token, { state: 'refused', msg: j.error || 'Not saved' });
    if (!cur || cur.token !== token) return;
    showWho(null); setEditable(false);
    say(j.error || 'This code was not saved.', own ? 'ok' : 'bad');
  }
  function kept(token, first, why) {
    var r = null;
    for (var i = 0; i < recent.length; i++) if (recent[i].token === token) { r = recent[i]; break; }
    if (!r || r.state !== 'sent') remember(token, { at: cur && cur.token === token ? cur.at : Date.now(), state: 'waiting' });
    if (cur && cur.token === token) say(why || 'No signal. This scan is kept on this phone and sent when the signal returns. You can still mark it Hot, Warm or Cold.', 'warn');
  }
  function send(token, at, fields, first) {
    // Waiting scans go in order, so a change made now never overtakes the scan itself.
    var waiting = queue.some(function (q) { return q.token === token; });
    if (navigator.onLine === false || waiting) { enqueue(token, at, fields); kept(token, first); flush(); return; }
    post(body(token, at, fields)).then(function (res) {
      if (res.status === 200 && res.j.success) { arrived(token, res.j, first); return; }
      if (res.status === 400 || res.status === 404) { refused(token, res.j); return; }
      // Signed out, too many, or not switched on yet: kept, and tried again later.
      enqueue(token, at, fields);
      kept(token, first, res.status === 401 ? 'You are signed out. Sign in to the event app again on this phone; this scan is kept and sent then.' : (res.j.error || null));
    }).catch(function () { enqueue(token, at, fields); kept(token, first); });
  }
  function flush() {
    if (flushing || !queue.length || navigator.onLine === false) return;
    flushing = true;
    var q = queue[0];
    post(body(q.token, q.at, q.fields)).then(function (res) {
      flushing = false;
      if (res.status === 200 && res.j.success) { unqueue(q.token); arrived(q.token, res.j, false); flush(); return; }
      if (res.status === 400 || res.status === 404) { refused(q.token, res.j); flush(); return; }
      if (res.status === 401) qbox.textContent = queue.length + ' waiting to send. You are signed out: sign in to the event app again on this phone.';
    }).catch(function () { flushing = false; });
  }
  window.addEventListener('online', flush);
  setInterval(flush, 20000);

  // ---- the card's buttons ----
  card.querySelectorAll('[data-r]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!cur) return;
      var r = b.getAttribute('data-r');
      cur.rating = cur.rating === r ? '' : r; paint();
      send(cur.token, cur.at, { rating: cur.rating }, false);
    });
  });
  card.querySelectorAll('[data-t]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!cur) return;
      var k = b.getAttribute('data-t'), i = cur.tags.indexOf(k);
      if (i >= 0) cur.tags.splice(i, 1); else cur.tags.push(k);
      paint();
      send(cur.token, cur.at, { tags: cur.tags.join(',') }, false);
    });
  });
  note.addEventListener('input', function () { noteTouched = true; });
  $('next').addEventListener('click', closeCard);
  $('x').addEventListener('click', closeCard);

  // ---- the camera ----
  var stream = null, det = null, useJs = !('BarcodeDetector' in window), cv = null, cx = null, lastBad = 0;
  function tokenOf(raw) { var m = VERIFY.exec(String(raw || '')); return m ? m[1] : ''; }
  function found(raw) {
    if (paused) return false;
    var t = tokenOf(raw);
    if (!t) {
      if (Date.now() - lastBad > 3000) { lastBad = Date.now(); e.textContent = 'That code is not a Bharat AI Innovation pass.'; setTimeout(function () { if (Date.now() - lastBad >= 2900) e.textContent = ''; }, 3000); }
      return false;
    }
    // The badge just closed is often still in front of the camera.
    if (t === lastToken && Date.now() - lastClosed < 4000) return false;
    e.textContent = '';
    openCard(t, true);
    return true;
  }
  function readJs() {
    if (typeof jsQR !== 'function' || !v.videoWidth) return null;
    if (!cv) { cv = document.createElement('canvas'); cx = cv.getContext('2d', { willReadFrequently: true }); }
    var scale = Math.min(1, 640 / v.videoWidth), w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    cx.drawImage(v, 0, 0, w, h);
    var code = jsQR(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
    return code && code.data ? code.data : null;
  }
  function readNative() {
    if (!det) det = new BarcodeDetector({ formats: ['qr_code'] });
    return det.detect(v).then(function (codes) { return codes && codes.length ? (codes[0].rawValue || '') : null; });
  }
  function loop() {
    if (!stream) return;
    if (paused || document.visibilityState === 'hidden' || !v.videoWidth) { setTimeout(loop, 250); return; }
    var p = useJs ? Promise.resolve(readJs()) : readNative().catch(function () { useJs = true; return readJs(); });
    p.then(function (raw) { if (raw) found(raw); }).catch(function () {}).then(function () { setTimeout(loop, 200); });
  }
  function live() { return !!(stream && stream.getVideoTracks().some(function (t) { return t.readyState === 'live'; })); }
  function start() {
    e.textContent = ''; camBtn.hidden = true;
    if (useJs && typeof jsQR !== 'function') { e.textContent = 'This browser cannot scan in the page. Use your phone camera app on the QR instead.'; return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { e.textContent = 'This browser cannot use the camera here. Use your phone camera app on the QR instead.'; return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (s) {
      var first = !stream;
      stream = s; v.srcObject = s;
      var p = v.play && v.play(); if (p && p.catch) p.catch(function () {});
      var check = (!useJs && BarcodeDetector.getSupportedFormats)
        ? BarcodeDetector.getSupportedFormats().then(function (fm) { if (fm.indexOf('qr_code') < 0) useJs = true; }).catch(function () { useJs = true; })
        : Promise.resolve();
      check.then(function () { if (first) loop(); });
      keepAwake();
    }).catch(function () {
      e.textContent = 'The camera is blocked. Allow it for this site, or use your phone camera app on the QR.';
      camBtn.hidden = false;
    });
  }
  // The screen stays on while the page is open, where the phone allows it.
  function keepAwake() { try { if (navigator.wakeLock && document.visibilityState === 'visible') navigator.wakeLock.request('screen').catch(function () {}); } catch (err) {} }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    keepAwake(); flush();
    // Phones stop the camera when the screen goes off; it starts again here.
    if (stream && !live()) { var old = stream; stream = null; try { old.getTracks().forEach(function (t) { t.stop(); }); } catch (err) {} start(); }
  });
  camBtn.addEventListener('click', start);

  drawQueue(); drawRecent(); flush(); start();
  // For the browser checks (scripts/verify/browser-booth-leads.cjs).
  window.BhaiLeadScan = { found: found, flush: flush, queue: function () { return queue.slice(); }, close: closeCard };
})();
