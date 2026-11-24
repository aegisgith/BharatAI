/* Bharat AI Innovation 2026: certificate renderer.
 *
 * One drawing, loaded by the app (the attendee's own download) and by the admin
 * panel (Admin -> Workshops and Attendees preview the same certificate), so what
 * the organisers check is exactly what the attendee gets. Same reason as
 * pass-render.js: two copies of a drawing drift apart.
 *
 * It only draws. Who may have a certificate is the server's answer
 * (GET /api/attendees/:id/certificate-eligibility, and /panels for a campus
 * panel); the callers ask it first.
 *
 *   BhaiCert.draw({ id, name,
 *                   workshop: { title, speaker, day } | null,
 *                   panel: { slug, title, titleShort, subtitle, host, hostShort, city,
 *                            dateLabel, timeLabel, hostLogo, claimed } | null,
 *                   pass, workshopAttended, verifyUrl }) -> Promise<canvas>
 *   BhaiCert.filename(isWorkshop)
 *
 * Design C "Tricolour split" (organiser's pick, 24 Nov 2026): an ink panel on the
 * left with our logo, "भारत एआई इनोवेशन" in tricolour under it (on ink, as white
 * cannot read on paper), a round seal and the dates, edged by a saffron-white-green
 * stripe; a white page on the right, set left-aligned, with the Aegis School of Data
 * Science and AI logo and the QR at its top, signed by the facilitator and the Dean.
 *
 * The QR (the organiser, 24 Nov 2026: "so no one can copy it and fake it") opens
 * /certificate/<code> on our site. The code is signed by the server, and that page
 * reads the holder's name and what they earned from our records, so a real code
 * pasted onto an edited certificate shows the real holder. It is drawn here by the
 * bundled encoder (/js/vendor/qrcode-generator.js); the link is never sent to a QR
 * service, because it opens a page with the person's name.
 *
 * Drawn at twice the size (3200 x 2260) so it prints sharply; every measure below is
 * in the 1600 x 1130 layout.
 */
(function (global) {
  'use strict';

  var W = 1600, H = 1130, SCALE = 2, PW = 480;
  var SAFFRON = '#FF9933', GREEN = '#138808', GREEN_DARK = '#1FA015', INK = '#0E1430', RUST = '#B4520A', SLATE = '#5B6275';
  var PF = '"Playfair Display", Georgia, serif';
  var MS = 'Montserrat, Arial, sans-serif';
  var MR = 'Manrope, Arial, sans-serif';
  var MK = 'Mukta, "Nirmala UI", "Noto Sans Devanagari", sans-serif';
  // Made by scripts/cert/prep-logos.mjs. Same origin, so no proxy.
  var IMG = { bharat: '/images/cert/bharat-on-dark.png', mark: '/images/cert/mark-on-dark.png', aegis: '/images/cert/aegis.png' };
  var HINDI = [['भारत', SAFFRON], ['एआई', '#FFFFFF'], ['इनोवेशन', GREEN_DARK]];

  // Every certificate is signed by two people (organiser, 24 Nov 2026): on the
  // left the facilitator (a workshop's speaker; the Organizing Committee where a
  // certificate has none), on the right the Dean. Spelling as on the site.
  var DEAN = { name: 'Dr. Abhijit Gangopadhyay', role: 'Dean', org: 'Aegis School of Data Science and AI' };
  var COMMITTEE = { name: 'Organizing Committee', role: 'Bharat AI Innovation 2026', org: 'Aegis Knowledge Trust' };

  // "Dr. Ashish Tendulkar, PhD, IIT Bombay; Google AI" -> the name before the
  // first comma signs; the rest is the line under the role.
  function facilitator(speaker) {
    var s = String(speaker || '').trim();
    if (!s) return null;
    var i = s.indexOf(',');
    var name = (i < 0 ? s : s.slice(0, i)).trim();
    var rest = (i < 0 ? '' : s.slice(i + 1)).trim().replace(/\s*;\s*/g, ' · ');
    return name ? { name: name, role: 'Workshop Facilitator', org: rest } : null;
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }
  function tryImage(src) { return src ? loadImage(src).catch(function () { return null; }) : Promise.resolve(null); }

  // The site's fonts (fonts-app.css, loaded by /app and /admin) for every character
  // drawn, so a canvas drawn before they arrive does not fall back to Arial. Never
  // waits more than four seconds: a slow phone gets the fallback, not a stuck button.
  function fontsReady(text) {
    var d = global.document;
    if (!d || !d.fonts || typeof d.fonts.load !== 'function') return Promise.resolve();
    var t = String(text || '') + ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789·–’&:';
    var want = [['700 40px "Playfair Display"', t], ['600 20px Montserrat', t], ['700 20px Montserrat', t],
      ['500 20px Manrope', t], ['600 20px Manrope', t], ['700 34px Mukta', HINDI.map(function (w) { return w[0]; }).join(' ')]];
    var all = Promise.all(want.map(function (w) { return d.fonts.load(w[0], w[1]).catch(function () {}); }));
    return Promise.race([all, new Promise(function (r) { setTimeout(r, 4000); })]);
  }

  // Set the font, then step the size down until the line fits the width.
  function fit(ctx, text, weight, size, min, family, maxW) {
    ctx.font = weight + ' ' + size + 'px ' + family;
    while (size > min && ctx.measureText(text).width > maxW) { size -= 1; ctx.font = weight + ' ' + size + 'px ' + family; }
    return size;
  }
  // Two lines, broken at the space that leaves the longer line shortest.
  function split2(ctx, text) {
    var words = String(text).split(/\s+/), best = null;
    for (var i = 1; i < words.length; i++) {
      var a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      var m = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
      if (!best || m < best.m) best = { a: a, b: b, m: m };
    }
    return best ? [best.a, best.b] : [String(text)];
  }
  // A line that fits at size..min on one line, else two lines at the size that fits both.
  function setLines(ctx, text, weight, size, min, family, maxW, twoMax, twoMin) {
    var s = fit(ctx, text, weight, size, min, family, maxW);
    if (ctx.measureText(text).width <= maxW) return { lines: [text], size: s };
    ctx.font = weight + ' ' + twoMax + 'px ' + family;
    var parts = split2(ctx, text);
    if (parts.length < 2) return { lines: [text], size: s };
    var longer = ctx.measureText(parts[0]).width > ctx.measureText(parts[1]).width ? parts[0] : parts[1];
    return { lines: parts, size: fit(ctx, longer, weight, twoMax, twoMin, family, maxW) };
  }
  // Letter-spaced capitals, drawn a character at a time.
  function spaced(ctx, text, x, y, sp, align) {
    var chars = String(text).split(''), w = 0, i;
    for (i = 0; i < chars.length; i++) w += ctx.measureText(chars[i]).width + (i < chars.length - 1 ? sp : 0);
    var sx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    var prev = ctx.textAlign; ctx.textAlign = 'left';
    for (i = 0; i < chars.length; i++) { ctx.fillText(chars[i], sx, y); sx += ctx.measureText(chars[i]).width + sp; }
    ctx.textAlign = prev;
    return w;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // भारत saffron, एआई white, इनोवेशन green: always on ink.
  function hindi(ctx, cx, y, size) {
    ctx.font = '700 ' + size + 'px ' + MK;
    var gap = size * 0.32, tot = gap * 2;
    HINDI.forEach(function (w) { tot += ctx.measureText(w[0]).width; });
    var x = cx - tot / 2, prev = ctx.textAlign; ctx.textAlign = 'left';
    HINDI.forEach(function (w) { ctx.fillStyle = w[1]; ctx.fillText(w[0], x, y); x += ctx.measureText(w[0]).width + gap; });
    ctx.textAlign = prev;
  }
  // Fine security-print waves and a rosette, as on a banknote: hard to redraw by hand.
  function guilloche(ctx, y0, amp, n, color, alpha, x0, x1) {
    ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 0.9;
    for (var k = 0; k < n; k++) {
      ctx.beginPath();
      for (var x = x0; x <= x1; x += 4) {
        var y = y0 + amp * Math.sin(x / 95 + k * 0.21) * Math.cos(x / 310 - k * 0.09) + (k - n / 2) * 1.6;
        if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  function rosette(ctx, cx, cy, R, color, alpha) {
    ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 0.8;
    var r = R * 0.38, d = R * 0.3;
    ctx.beginPath();
    for (var t = 0; t <= Math.PI * 2 * 19; t += 0.02) {
      var x = cx + (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
      var y = cy + (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
      if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.restore();
  }
  // A round seal: saffron serrated edge, ink disc, the event name around it, the mark inside.
  function seal(ctx, cx, cy, r, mark, text) {
    ctx.save();
    ctx.beginPath();
    for (var i = 0; i <= 72; i++) { var a = (i / 72) * Math.PI * 2, rr = i % 2 ? r : r + 5; ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); }
    ctx.closePath(); ctx.fillStyle = SAFFRON; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r - 4, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
    ctx.strokeStyle = SAFFRON; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, cy, r - 12, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r - 40, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#F2EDE3'; ctx.font = '700 13px ' + MS; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var chars = String(text).split(''), step = (Math.PI * 2) / chars.length;
    chars.forEach(function (ch, k) {
      var a = -Math.PI / 2 + k * step;
      ctx.save(); ctx.translate(cx + (r - 26) * Math.cos(a), cy + (r - 26) * Math.sin(a)); ctx.rotate(a + Math.PI / 2); ctx.fillText(ch, 0, 0); ctx.restore();
    });
    if (mark) { var mw = (r - 46) * 1.45, mh = mark.height * (mw / mark.width); ctx.drawImage(mark, cx - mw / 2, cy - mh / 2, mw, mh); }
    ctx.restore();
  }
  // A signature block, left-aligned at x: a line, the name, the role in capitals, the organisation.
  function signBlock(ctx, x, y, p) {
    var maxW = 410;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(14,20,48,0.4)'; ctx.fillRect(x, y, 340, 1.5);
    ctx.fillStyle = INK; fit(ctx, p.name, '700', 28, 18, PF, maxW); ctx.fillText(p.name, x, y + 40);
    ctx.fillStyle = RUST; fit(ctx, String(p.role || '').toUpperCase(), '700', 14, 11, MS, maxW - 40);
    spaced(ctx, String(p.role || '').toUpperCase(), x, y + 68, 2.5, 'left');
    if (p.org) {
      ctx.fillStyle = SLATE;
      var o = setLines(ctx, p.org, '500', 17, 15, MR, maxW, 16, 12);
      o.lines.forEach(function (ln, i) { ctx.fillText(ln, x, y + 94 + i * 22); });
    }
  }

  // The QR as whole device pixels per module, so it stays sharp when printed.
  function qrCode(text) {
    if (!text || typeof global.qrcode !== 'function') return null;
    try { var q = global.qrcode(0, 'M'); q.addData(String(text)); q.make(); return q; } catch (e) { return null; }
  }
  function drawQR(ctx, q, x, y, size) {
    var n = q.getModuleCount(), dev = Math.round(size * SCALE), cell = Math.floor(dev / n), real = cell * n;
    var ox = Math.round(x * SCALE + (dev - real) / 2), oy = Math.round(y * SCALE + (dev - real) / 2);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = INK;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
    ctx.restore();
  }

  var pad = function (v, n) { return String(v == null ? '' : v).padStart(n, '0'); };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function dayLabel(iso) {
    var p = String(iso || '').slice(0, 10).split('-');
    return p.length === 3 && MONTHS[Number(p[1]) - 1] ? Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + p[0] : '';
  }

  // What each kind of certificate says. Workshop and conference are the Mumbai event;
  // a campus panel is its own date and college.
  function content(o) {
    var ws = o.workshop || null, pn = o.panel || null;
    if (pn) {
      var t = String(pn.titleShort || pn.title || 'Campus panel');
      return {
        kind: 'panel', lead: 'has participated in the pre-event panel discussion',
        headline: t + (pn.subtitle ? ':' : ''), second: String(pn.subtitle || ''),
        subs: [['Hosted at ' + [pn.host, pn.city].filter(Boolean).join(', '), SLATE, '500', 21],
          [[pn.dateLabel, pn.timeLabel].filter(Boolean).join('  ·  '), SLATE, '500', 21]],
        seal: 'BHARAT AI INNOVATION · CAMPUS SERIES 2026 · ',
        when: String(pn.dateLabel || '').toUpperCase(), where: [pn.hostShort || pn.host, pn.city].filter(Boolean).join(', '),
        left: COMMITTEE,
        certId: 'BHAI-CS-' + String(pn.slug || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) + '-' + pad(o.id, 5),
        foot: pn.claimed ? 'Attendance confirmed ' + pn.claimed : '',
      };
    }
    if (ws) {
      return {
        kind: 'workshop', lead: 'has taken part in the workshop', headline: String(ws.title || 'Workshop'), second: '',
        subs: [['at Bharat AI Innovation 2026, India’s B2B AI Conference & Exhibition', SLATE, '500', 21]],
        seal: 'BHARAT AI INNOVATION · MUMBAI 2026 · WORKSHOP · ',
        when: (dayLabel(ws.day) || '20–21 November 2026').toUpperCase(), where: 'World Trade Center, Mumbai',
        left: facilitator(ws.speaker) || COMMITTEE, certId: 'BHAI-WS-' + pad(o.id, 4), foot: '',
      };
    }
    var subs = [['India’s B2B AI Conference & Exhibition', SLATE, '500', 21]];
    var certPass = String(o.pass || '').trim(), certWs = String(o.workshopAttended || '').trim();
    if (certPass) subs.push(['Pass: ' + certPass, RUST, '700', 22, MS]);
    if (certWs) subs.push(['Workshop attended: ' + certWs, SLATE, '500', 20]);
    return {
      kind: 'conference', lead: 'has participated in', headline: 'Bharat AI Innovation 2026', second: '', subs: subs,
      seal: 'BHARAT AI INNOVATION · MUMBAI 2026 · CONFERENCE · ',
      when: '20–21 NOVEMBER 2026', where: 'World Trade Center, Mumbai',
      left: COMMITTEE, certId: 'BHAI-CERT-' + pad(o.id, 4), foot: '',
    };
  }

  async function draw(o) {
    o = o || {};
    var name = String(o.name || '').trim() || 'Attendee';
    var k = content(o);
    var pn = o.panel || null;
    var loaded = await Promise.all([tryImage(IMG.bharat), tryImage(IMG.mark), tryImage(IMG.aegis), tryImage(pn && pn.hostLogo),
      fontsReady([name, k.headline, k.second, k.left.name, k.left.org, DEAN.name, DEAN.org, k.where].concat(k.subs.map(function (s) { return s[0]; })).join(' '))]);
    var bharat = loaded[0], mark = loaded[1], aegis = loaded[2], hostLogo = loaded[3];

    var canvas = document.createElement('canvas'); canvas.width = W * SCALE; canvas.height = H * SCALE;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.textBaseline = 'alphabetic';

    // ---- the ink panel ----
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
    var pg = ctx.createLinearGradient(0, 0, 0, H); pg.addColorStop(0, '#141C42'); pg.addColorStop(1, '#090D22');
    ctx.fillStyle = pg; ctx.fillRect(0, 0, PW, H);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, PW, H); ctx.clip();
    rosette(ctx, PW / 2, 640, 230, '#FFB15C', 0.08);
    guilloche(ctx, H - 60, 18, 20, '#FFB15C', 0.08, 0, PW);
    ctx.restore();
    ctx.fillStyle = SAFFRON; ctx.fillRect(PW, 0, 9, H); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(PW + 9, 0, 9, H); ctx.fillStyle = GREEN; ctx.fillRect(PW + 18, 0, 9, H);
    ctx.fillStyle = 'rgba(14,20,48,0.08)'; ctx.fillRect(PW + 9, 0, 9, H);
    if (bharat) { var lw = 360, lh = bharat.height * (lw / bharat.width); ctx.drawImage(bharat, (PW - lw) / 2, 100, lw, lh); }
    else { ctx.textAlign = 'center'; ctx.fillStyle = '#F2EDE3'; ctx.font = '700 32px ' + MS; ctx.fillText('BHARAT AI INNOVATION', PW / 2, 170); }
    hindi(ctx, PW / 2, 248, 34);
    seal(ctx, PW / 2, 600, 118, mark, k.seal);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFB36B'; fit(ctx, k.when, '600', 15, 12, MS, PW - 80); spaced(ctx, k.when, PW / 2, 930, 3, 'center');
    ctx.fillStyle = '#C8CBDA'; fit(ctx, k.where, '500', 19, 14, MR, PW - 60); ctx.fillText(k.where, PW / 2, 964);

    // ---- the white page ----
    var X = 600, R = W - 90, maxW = R - X - 20;
    ctx.strokeStyle = '#E8E2D4'; ctx.lineWidth = 1; ctx.strokeRect(PW + 52, 40, W - PW - 92, H - 80);
    var q = qrCode(o.verifyUrl), QS = 150;
    // Logos along the top: Aegis (and a campus panel's host college) on the left, the
    // QR on the right. Without a QR the Aegis logo takes the right, as designed.
    var logos = [];
    if (aegis) logos.push({ img: aegis, w: 240, h: aegis.height * (240 / aegis.width) });
    if (hostLogo) { var hh = 84, hw = hostLogo.width * (hh / hostLogo.height); if (hw > 220) { hw = 220; hh = hostLogo.height * (hw / hostLogo.width); } logos.push({ img: hostLogo, w: hw, h: hh }); }
    var lx = q ? X : R - 20 - logos.reduce(function (a, m, i) { return a + m.w + (i ? 49 : 0); }, 0), mid = q ? 80 + QS / 2 : 135;
    logos.forEach(function (m, i) {
      if (i) { ctx.fillStyle = 'rgba(14,20,48,0.15)'; ctx.fillRect(lx + 24, mid - 34, 1.5, 68); lx += 49; }
      ctx.drawImage(m.img, lx, mid - m.h / 2, m.w, m.h); lx += m.w;
    });
    if (q) {
      drawQR(ctx, q, R - QS, 80, QS);
      ctx.fillStyle = SLATE; ctx.font = '700 12px ' + MS; spaced(ctx, 'SCAN TO VERIFY', R - QS / 2, 80 + QS + 24, 2.5, 'center');
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = RUST; ctx.font = '600 20px ' + MS; spaced(ctx, 'CERTIFICATE OF PARTICIPATION', X, 330, 6, 'left');
    ctx.fillStyle = SLATE; ctx.font = '500 22px ' + MR; ctx.fillText('This is to certify that', X, 388);
    // The name: one line down to 50 px, else two lines (the longest real names).
    var nm = setLines(ctx, name, '700', 86, 50, PF, maxW, 56, 36);
    ctx.fillStyle = INK; ctx.font = '700 ' + nm.size + 'px ' + PF;
    var y = nm.lines.length > 1 ? 444 : 484;
    nm.lines.forEach(function (ln, i) { ctx.fillText(ln, X, y + i * Math.round(nm.size * 1.08)); });
    y += (nm.lines.length - 1) * Math.round(nm.size * 1.08);
    y += 30; ctx.fillStyle = SAFFRON; ctx.fillRect(X, y, 90, 4); ctx.fillStyle = GREEN; ctx.fillRect(X + 90, y, 30, 4);
    y += 70; ctx.fillStyle = SLATE; ctx.font = '500 22px ' + MR; ctx.fillText(k.lead, X, y);
    // The workshop or panel title: one line down to 32 px, else two lines.
    var hd = setLines(ctx, k.headline, '700', 40, 32, MS, maxW, 36, 26);
    ctx.fillStyle = INK; ctx.font = '700 ' + hd.size + 'px ' + MS;
    y += 56; hd.lines.forEach(function (ln, i) { ctx.fillText(ln, X, y + i * Math.round(hd.size * 1.25)); });
    y += (hd.lines.length - 1) * Math.round(hd.size * 1.25);
    if (k.second) { ctx.fillStyle = '#2A3150'; fit(ctx, k.second, '600', 26, 18, MR, maxW); y += 42; ctx.fillText(k.second, X, y); }
    k.subs.forEach(function (s, i) {
      ctx.fillStyle = s[1]; fit(ctx, s[0], s[2], s[3], 14, s[4] || MR, maxW);
      y += i ? 36 : 48; ctx.fillText(s[0], X, y);
    });

    // Signed by the facilitator (or the Organizing Committee) and the Dean.
    signBlock(ctx, X, 850, k.left);
    signBlock(ctx, X + 470, 850, DEAN);

    ctx.fillStyle = '#9A9FAD'; ctx.font = '500 14px ' + MR;
    spaced(ctx, 'CERTIFICATE ID  ' + k.certId, R - 20, 1050, 2, 'right');
    if (k.foot) { ctx.textAlign = 'left'; fit(ctx, k.foot, '500', 14, 11, MR, 420); ctx.fillText(k.foot, X, 1050); }
    return canvas;
  }

  function filename(isWorkshop) {
    return isWorkshop ? 'BharatAI-2026-Workshop-Certificate.png' : 'BharatAI-2026-Certificate.png';
  }

  // Kept for a page still running the app code from before 24 Nov 2026, whose
  // campus-panel certificate drew its own page and called this for the two signatures.
  function signoff(ctx, W2, y, people, family) {
    family = family || 'Inter, Arial';
    var list = (people || []).filter(Boolean);
    ctx.save(); ctx.textAlign = 'center';
    list.forEach(function (p, i) {
      var cx = list.length === 1 ? W2 / 2 : W2 / 2 + (i === 0 ? -340 : 340);
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(cx - 160, y, 320, 2);
      ctx.fillStyle = '#ffffff'; fit(ctx, p.name, '600', 26, 18, family, 440); ctx.fillText(p.name, cx, y + 40);
      ctx.fillStyle = '#ff9a52'; fit(ctx, p.role || '', '600', 18, 13, family, 440); ctx.fillText(p.role || '', cx, y + 70);
      if (p.org) { ctx.fillStyle = '#9698ac'; fit(ctx, p.org, '400', 17, 12, family, 440); ctx.fillText(p.org, cx, y + 96); }
    });
    ctx.restore();
  }

  global.BhaiCert = {
    draw: draw, filename: filename, facilitator: facilitator, content: content, signoff: signoff,
    DEAN: DEAN, COMMITTEE: COMMITTEE, IMAGES: IMG, SAMPLE_VERIFY_URL: 'https://bharataiinnovation.com/certificate/sample',
  };
})(typeof window !== 'undefined' ? window : this);
