/* Bharat AI Innovation 2026 — event pass renderer.
 *
 * There were two of these. The app drew the design from the Claude Design export
 * (Bharat AI Passes.dc.html); the admin panel kept an older one that still said
 * "16th Bharat AI Innovation — Celebrating Innovation that Impacts", which is the
 * awards wording, and whose QR pointed at a subdomain that 301s to the homepage.
 * A pass issued at the desk therefore looked nothing like the one the same person
 * had already downloaded.
 *
 * One file, loaded by both pages, so they cannot drift apart again.
 *
 * Drawn on canvas rather than rendered as HTML so the download stays a PNG: a
 * delegate at the badge desk may have no signal, and an image in the camera roll
 * works where a web page does not.
 */
(function (global) {
  'use strict';

  var TIERS = {
    visitor:  { label: 'VISITOR PASS',  hi: '',                  c1: '#2B8CFF', c2: '#1f6fd6', edge: 'rgba(43,140,255,0.50)',  inner: 'rgba(43,140,255,0.28)', top: '#0b1c3d' },
    speaker:  { label: 'SPEAKER PASS',  hi: 'वक्ता पास',          c1: '#FF7A00', c2: '#e06400', edge: 'rgba(255,122,0,0.50)',   inner: 'rgba(255,122,0,0.28)',  top: '#2a1608' },
    delegate: { label: 'DELEGATE PASS', hi: 'प्रतिनिधि पास',      c1: '#00996C', c2: '#007352', edge: 'rgba(0,153,108,0.50)',   inner: 'rgba(0,153,108,0.28)',  top: '#052419' },
    academic: { label: 'ACADEMIC PASS', hi: 'शैक्षणिक पास',       c1: '#7C5CFF', c2: '#5b3fd6', edge: 'rgba(124,92,255,0.50)',  inner: 'rgba(124,92,255,0.28)', top: '#170f33' },
    vip:      { label: 'V I P',         hi: 'विशिष्ट अतिथि पास',  c1: '#E9C356', c2: '#c79a2a', edge: '#D4A21A',               inner: 'rgba(233,195,86,0.60)', top: '#3a2c0a', gold: true }
  };

  // The pass must state the tier the holder actually has. An earlier version
  // hardcoded "DELEGATE PASS", so Visitor Pass holders were issued a badge claiming
  // a tier they had not bought.
  function tierFor(u) {
    var b = String((u && u.badge_type) || '').toLowerCase();
    var r = String((u && u.role) || '').toLowerCase();
    if (b.indexOf('vip') >= 0) return 'vip';
    if (b.indexOf('delegate') >= 0) return 'delegate';
    if (b.indexOf('academic') >= 0) return 'academic';
    if (b.indexOf('speaker') >= 0 || r.indexOf('speaker') >= 0) return 'speaker';
    return 'visitor';
  }

  // Canvas draws with whatever font is resolved at fillText time, so the faces must
  // be loaded before the first stroke or it silently falls back to a system serif.
  function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var faces = ['800 44px Montserrat', '700 32px Montserrat', '700 68px "Playfair Display"',
                 '600 30px Mukta', '600 28px Inter', '400 26px Inter'];
    return Promise.all(faces.map(function (f) {
      return document.fonts.load(f, 'Bharat भारत').catch(function () {});
    })).then(function () {
      return document.fonts.ready.catch(function () {});
    }).catch(function () {});
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* Draws the pass and returns { dataUrl, filename, tier, label }.
   * opts.token — the signed pass token the QR should carry. Without one the QR
   * falls back to the app, which verifies nothing; callers should always pass it. */
  async function render(user, opts) {
    opts = opts || {};
    var tierKey = tierFor(user);
    var T = TIERS[tierKey];

    await ensureFonts();

    var S = 2, CW = 440, W = CW * S;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = 1500 * S;
    var ctx = canvas.getContext('2d');
    var proxy = function (u) { return '/api/image-proxy?url=' + encodeURIComponent(u); };

    var passId = 'BHAI-2026-' + String(user.id == null ? '0' : user.id).padStart(4, '0');
    // Was networking.bharataiinnovation.com?email=<address> — a subdomain that 301s
    // to the homepage, and a code that handed the holder's email to anyone who
    // photographed the pass. It now points at the signed verification page.
    var qrTarget = opts.token
      ? 'https://bharataiinnovation.com/verify/' + encodeURIComponent(opts.token)
      : 'https://bharataiinnovation.com/app';

    var logo = null, aegis = null, agba = null, assessfy = null, qr = null, photo = null;
    if (user.avatar_url) { try { photo = await loadImage(user.avatar_url); } catch (e) {} }
    try { logo = await loadImage('/images/Bharat%20AI%20Innovation%20Logo.png'); } catch (e) {}
    try { aegis = await loadImage('/images/passes/aegis.png'); } catch (e) {}
    try { agba = await loadImage('/images/passes/agba.png'); } catch (e) {}
    try { assessfy = await loadImage('/images/passes/assessfy.jpg'); } catch (e) {}
    // Cross-origin images taint the canvas and make toDataURL throw, so the QR goes
    // through the same-origin proxy the logos already use.
    try { qr = await loadImage(proxy('https://api.qrserver.com/v1/create-qr-code/?size=340x340&margin=0&data=' + encodeURIComponent(qrTarget))); } catch (e) {}

    var mid = W / 2;
    function px(v) { return v * S; }
    var f = function (weight, size, family) { ctx.font = weight + ' ' + (size * S) + 'px ' + family; };
    var MONT = '"Montserrat", Arial, sans-serif';
    var PLAY = '"Playfair Display", Georgia, serif';
    var MUKTA = '"Mukta", "Nirmala UI", "Noto Sans Devanagari", Arial, sans-serif';
    var INTER = '"Inter", Arial, sans-serif';
    var centre = function (txt, y, colour) { ctx.fillStyle = colour; ctx.textAlign = 'center'; ctx.fillText(txt, mid, y); };

    // Three words, three colours, centred as one group.
    function tricolour(words, y) {
      var widths = words.map(function (w) { return ctx.measureText(w.t).width; });
      var gap = ctx.measureText(' ').width;
      var total = widths.reduce(function (a, b) { return a + b; }, 0) + gap * (words.length - 1);
      var x = mid - total / 2;
      ctx.textAlign = 'left';
      for (var i = 0; i < words.length; i++) {
        ctx.fillStyle = words[i].c;
        ctx.fillText(words[i].t, x, y);
        x += widths[i] + gap;
      }
      ctx.textAlign = 'center';
    }

    function divider(y, strong) {
      var g = ctx.createLinearGradient(px(30), 0, W - px(30), 0);
      var a = strong ? 0.5 : 0.3;
      g.addColorStop(0, 'rgba(212,162,26,0)');
      g.addColorStop(0.5, 'rgba(212,162,26,' + a + ')');
      g.addColorStop(1, 'rgba(212,162,26,0)');
      ctx.fillStyle = g; ctx.fillRect(px(30), y, W - px(60), Math.max(1, S));
    }

    // ---- card background ----
    var bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    if (T.gold) { bg.addColorStop(0, '#3a2c0a'); bg.addColorStop(0.4, '#1c1405'); bg.addColorStop(1, '#0b0803'); }
    else { bg.addColorStop(0, T.top); bg.addColorStop(0.55, '#0a0e2a'); bg.addColorStop(1, '#080b22'); }
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, canvas.height);

    var y = px(30);

    // ---- VIP ribbon ----
    if (T.gold) {
      var rw = px(230), rh = px(30), rx = mid - rw / 2;
      var rg = ctx.createLinearGradient(rx, 0, rx + rw, 0);
      rg.addColorStop(0, '#c79a2a'); rg.addColorStop(0.5, '#f3d97a'); rg.addColorStop(1, '#c79a2a');
      ctx.fillStyle = rg; roundRect(ctx, rx, y, rw, rh, rh / 2); ctx.fill();
      f('800', 10, MONT); ctx.fillStyle = '#1a1206';
      ctx.textAlign = 'center'; ctx.fillText('✦ PREMIUM ALL-ACCESS ✦', mid, y + rh * 0.68);
      y += rh + px(18);
    }

    // ---- logo on white ----
    if (logo) {
      var lw = px(120), lh = lw * (logo.height / logo.width);
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, mid - lw / 2 - px(12), y, lw + px(24), lh + px(16), px(8)); ctx.fill();
      ctx.drawImage(logo, mid - lw / 2, y + px(8), lw, lh);
      y += lh + px(16);
    }

    // ---- wordmarks ----
    y += px(36);
    f('800', 22, MONT);
    tricolour([{ t: 'Bharat', c: '#FF7A00' }, { t: 'AI', c: '#ffffff' }, { t: 'Innovation', c: '#00996C' }], y);
    y += px(21);
    f('600', 15, MUKTA);
    tricolour([{ t: 'भारत', c: '#FF7A00' }, { t: 'एआई', c: T.gold ? '#efe6c9' : '#e8edf5' }, { t: 'इनोवेशन', c: T.gold ? '#5fbf8f' : '#00b57f' }], y);
    y += px(20);
    f('400', 13, INTER);
    centre('Conference & Exhibition 2026', y, T.gold ? '#9a8a5a' : '#8892b0');

    y += px(24); divider(y, T.gold); y += px(24);

    // ---- avatar ----
    var R = px(T.gold ? 64 : 60);
    var cy = y + R;
    var ag = ctx.createRadialGradient(mid - R * 0.3, cy - R * 0.35, R * 0.1, mid, cy, R);
    ag.addColorStop(0, T.gold ? '#fbeeb0' : T.c1); ag.addColorStop(1, T.gold ? '#b8871f' : T.c2);
    // The design gives the avatar a soft coloured glow (box-shadow 0 8px 26px in the
    // tier's own tint). Canvas has no box-shadow, so it is drawn as a shadow on the
    // fill and cleared immediately - anything drawn after would inherit it.
    ctx.save();
    ctx.shadowColor = T.inner; ctx.shadowBlur = px(26); ctx.shadowOffsetY = px(8);
    ctx.beginPath(); ctx.arc(mid, cy, R, 0, Math.PI * 2); ctx.fillStyle = ag; ctx.fill();
    ctx.restore();
    ctx.lineWidth = px(T.gold ? 4 : 3); ctx.strokeStyle = T.gold ? '#f3d97a' : T.edge; ctx.stroke();
    f('700', T.gold ? 54 : 56, PLAY);
    ctx.fillStyle = T.gold ? '#7a5510' : '#ffffff'; ctx.textAlign = 'center';
    if (photo) {
      // Cover-fit inside the circle so a non-square photo is cropped, not squashed.
      ctx.save();
      ctx.beginPath(); ctx.arc(mid, cy, R - px(2), 0, Math.PI * 2); ctx.clip();
      var sc = Math.max((R * 2) / photo.width, (R * 2) / photo.height);
      var pwd = photo.width * sc, phd = photo.height * sc;
      ctx.drawImage(photo, mid - pwd / 2, cy - phd / 2, pwd, phd);
      ctx.restore();
    } else {
      ctx.fillText(T.gold ? '♛' : String(user.name || '?').trim().charAt(0).toUpperCase(), mid, cy + px(T.gold ? 19 : 20));
    }
    y = cy + R + px(20);

    // ---- name / designation / organisation ----
    f('700', 34, PLAY);
    var name = String(user.name || 'Attendee');
    while (ctx.measureText(name).width > W - px(60) && name.length > 4) { name = name.slice(0, -2); }
    centre(name === String(user.name || '') ? name : name + '…', y + px(26), T.gold ? '#f3d97a' : '#ffffff');
    y += px(38);
    if (user.job_title) { f('400', 14, INTER); centre(String(user.job_title), y + px(12), T.gold ? '#c8b98a' : '#c3ccdd'); y += px(20); }
    if (user.company) { f('400', 14, INTER); centre(String(user.company).toUpperCase(), y + px(12), T.gold ? '#9a8a5a' : '#8892b0'); y += px(20); }

    y += px(24); divider(y, T.gold); y += px(24);

    // ---- tier pill ----
    f('800', T.gold ? 18 : 16, MONT);
    var pw = ctx.measureText(T.label).width + px(T.gold ? 88 : 68);
    var ph = px(T.hi ? 52 : 46);
    var pxx = mid - pw / 2;
    var pg = ctx.createLinearGradient(0, y, 0, y + ph);
    if (T.gold) { pg.addColorStop(0, '#fbeeb0'); pg.addColorStop(0.45, '#E9C356'); pg.addColorStop(1, '#c79a2a'); }
    else { pg.addColorStop(0, T.c1); pg.addColorStop(1, T.c2); }
    ctx.fillStyle = pg; roundRect(ctx, pxx, y, pw, ph, ph / 2); ctx.fill();
    if (T.gold) { ctx.lineWidth = S; ctx.strokeStyle = '#f3d97a'; ctx.stroke(); }
    ctx.fillStyle = T.gold ? '#5a3f08' : '#ffffff'; ctx.textAlign = 'center';
    if (T.hi) {
      ctx.fillText(T.label, mid, y + px(23));
      f('500', 12, MUKTA);
      ctx.fillStyle = T.gold ? '#5a3f08' : 'rgba(255,255,255,0.9)';
      ctx.fillText(T.hi, mid, y + px(41));
    } else {
      ctx.fillText(T.label, mid, y + ph * 0.66);
    }
    y += ph + px(24); divider(y, T.gold); y += px(24);

    // ---- when and where ----
    f('700', 17, MONT); centre('20–21 Nov 2026', y + px(14), '#D4A21A'); y += px(24);
    f('400', 13, INTER); centre('WTC Mumbai, Cuffe Parade, Mumbai', y + px(11), '#c3ccdd'); y += px(19);
    f('400', 13, INTER); centre('9:00 AM – 6:00 PM', y + px(11), T.gold ? '#9a8a5a' : '#8892b0'); y += px(30);

    // ---- ticket id + QR ----
    f('400', 13, '"Courier New", monospace');
    ctx.letterSpacing = px(2) + 'px';
    centre(passId, y + px(11), '#c9a94a');
    ctx.letterSpacing = '0px';
    y += px(26);
    if (qr) {
      var q = px(150), pad = px(9);
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, mid - q / 2 - pad, y, q + pad * 2, q + pad * 2, px(6)); ctx.fill();
      ctx.drawImage(qr, mid - q / 2, y + pad, q, q);
      y += q + pad * 2;
    }
    f('400', 12, INTER); centre('Scan at the badge desk to verify & check in', y + px(20), T.gold ? '#7a6a3a' : '#5a6a8a');
    y += px(30);
    // Terms clause 2 requires photo ID matching the registration name at the badge
    // desk. Printing it here is what makes identity checks work without the event
    // ever collecting or storing an identity document.
    f('600', 11, INTER);
    centre('Carry a government photo ID matching this name', y + px(14), T.gold ? '#9a8a5a' : '#7b88a6');
    y += px(28);

    // ---- partners ----
    divider(y, T.gold); y += px(22);
    var stripH = px(50);
    ctx.fillStyle = '#ffffff'; roundRect(ctx, px(30), y, W - px(60), stripH, px(8)); ctx.fill();
    var logos = [{ i: aegis, h: 30 }, { i: agba, h: 26 }, { i: assessfy, h: 22 }].filter(function (o) { return o.i; });
    if (logos.length) {
      var gapL = px(14), widths = logos.map(function (o) { return o.i.width * (px(o.h) / o.i.height); });
      var totalL = widths.reduce(function (a, b) { return a + b; }, 0) + gapL * (logos.length - 1);
      var lx = mid - totalL / 2;
      for (var k = 0; k < logos.length; k++) {
        var hh = px(logos[k].h);
        ctx.drawImage(logos[k].i, lx, y + (stripH - hh) / 2, widths[k], hh);
        lx += widths[k] + gapL;
      }
    }
    y += stripH + px(16);
    f('400', 11, INTER);
    centre('bharataiinnovation.com • networking.bharataiinnovation.com', y + px(9), '#4a577a');
    y += px(30);

    // ---- borders, then crop to the height actually used ----
    var H = Math.ceil(y);
    ctx.lineWidth = px(T.gold ? 2 : 1); ctx.strokeStyle = T.edge;
    roundRect(ctx, px(7), px(7), W - px(14), H - px(14), px(20)); ctx.stroke();
    ctx.lineWidth = S; ctx.strokeStyle = T.inner;
    roundRect(ctx, px(16), px(16), W - px(32), H - px(32), px(14)); ctx.stroke();

    var out = document.createElement('canvas');
    out.width = W; out.height = H;
    out.getContext('2d').drawImage(canvas, 0, 0, W, H, 0, 0, W, H);

    return {
      dataUrl: out.toDataURL('image/png'),
      filename: 'BHAI-2026-' + T.label.replace(/ /g, '') + '-' + String(user.name || 'attendee').replace(/[^A-Za-z0-9]+/g, '-') + '.png',
      tier: tierKey,
      label: T.label,
      width: W,
      height: H
    };
  }

  async function download(user, opts) {
    var res = await render(user, opts);
    var link = document.createElement('a');
    link.download = res.filename;
    link.href = res.dataUrl;
    link.click();
    return res;
  }

  global.BhaiPass = { TIERS: TIERS, tierFor: tierFor, ensureFonts: ensureFonts, render: render, download: download };
})(window);
