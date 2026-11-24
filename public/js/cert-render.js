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
  function seal(ctx, cx, cy, r, mark, text, ring) {
    ring = ring || SAFFRON;
    ctx.save();
    ctx.beginPath();
    for (var i = 0; i <= 72; i++) { var a = (i / 72) * Math.PI * 2, rr = i % 2 ? r : r + 5; ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); }
    ctx.closePath(); ctx.fillStyle = ring; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r - 4, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
    ctx.strokeStyle = ring; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, cy, r - 12, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r - 40, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#F2EDE3'; ctx.font = '700 ' + (r < 110 ? 11 : 13) + 'px ' + MS; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var chars = String(text).split(''), step = (Math.PI * 2) / chars.length;
    chars.forEach(function (ch, k) {
      var a = -Math.PI / 2 + k * step;
      ctx.save(); ctx.translate(cx + (r - 26) * Math.cos(a), cy + (r - 26) * Math.sin(a)); ctx.rotate(a + Math.PI / 2); ctx.fillText(ch, 0, 0); ctx.restore();
    });
    if (mark) { var mw = (r - 46) * 1.45, mh = mark.height * (mw / mark.width); ctx.drawImage(mark, cx - mw / 2, cy - mh / 2, mw, mh); }
    ctx.restore();
  }
  // The photo version (organiser, 24 Nov 2026: "one with photo and one without"): the
  // person's photo in a ring striped like the flag, a small seal on its edge, and what
  // they were at the event in a pill under it. Square-cropped, a little above centre,
  // where a face usually is.
  function portrait(ctx, cx, cy, r, img) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r + 11, 0, Math.PI * 2); ctx.clip();
    var top = cy - r - 11, band = (2 * r + 22) / 3;
    ctx.fillStyle = SAFFRON; ctx.fillRect(cx - r - 11, top, 2 * r + 22, band);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(cx - r - 11, top + band, 2 * r + 22, band);
    ctx.fillStyle = GREEN; ctx.fillRect(cx - r - 11, top + 2 * band, 2 * r + 22, band + 1);
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r + 3, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    var s = Math.min(img.width, img.height), sx = (img.width - s) / 2, sy = Math.max(0, (img.height - s) * 0.3);
    ctx.drawImage(img, sx, sy, s, s, cx - r, cy - r, 2 * r, 2 * r);
    ctx.restore();
  }
  function smallSeal(ctx, cx, cy, r, mark, ring) {
    ctx.save();
    ctx.beginPath();
    for (var i = 0; i <= 48; i++) { var a = (i / 48) * Math.PI * 2, rr = i % 2 ? r : r + 4; ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); }
    ctx.closePath(); ctx.fillStyle = ring; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r - 4, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
    ctx.strokeStyle = ring; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r - 9, 0, Math.PI * 2); ctx.stroke();
    if (mark) { var mw = (r - 12) * 1.5, mh = mark.height * (mw / mark.width); ctx.drawImage(mark, cx - mw / 2, cy - mh / 2, mw, mh); }
    ctx.restore();
  }
  function pill(ctx, cx, cy, text, fill, ink) {
    if (!text) return;
    ctx.save(); ctx.font = '700 15px ' + MS;
    var w = 0, i, chars = text.split('');
    for (i = 0; i < chars.length; i++) w += ctx.measureText(chars[i]).width + (i < chars.length - 1 ? 3 : 0);
    var pw = Math.min(PW - 60, w + 48), ph = 40;
    ctx.fillStyle = fill; roundRect(ctx, cx - pw / 2, cy - ph / 2, pw, ph, ph / 2); ctx.fill();
    ctx.fillStyle = ink; ctx.textBaseline = 'middle'; spaced(ctx, text, cx, cy + 1, 3, 'center');
    ctx.restore();
  }
  function photoSrc(u) {
    u = String(u || '').trim();
    if (!u) return '';
    var here = global.location && global.location.origin ? global.location.origin + '/' : '';
    if (/^https?:/i.test(u) && !(here && u.indexOf(here) === 0)) return '/api/image-proxy?url=' + encodeURIComponent(u);
    return u;
  }

  // A signature block, left-aligned at x: a line, the name, the role in capitals, the organisation.
  function signBlock(ctx, x, y, p, accent) {
    var maxW = 410;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(14,20,48,0.4)'; ctx.fillRect(x, y, 340, 1.5);
    ctx.fillStyle = INK; fit(ctx, p.name, '700', 28, 18, PF, maxW); ctx.fillText(p.name, x, y + 40);
    ctx.fillStyle = accent || RUST; fit(ctx, String(p.role || '').toUpperCase(), '700', 14, 11, MS, maxW - 40);
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
  // a campus panel is its own date and college. Speakers and Innovation Stage presenters
  // get a certificate of appreciation (organiser, 24 Nov 2026), each in its own colour:
  // saffron for taking part, gold for a speaker, green for the Innovation Stage.
  var GOLD = '#8A6514', GOLD_RING = '#E0B252', STAGE = '#0B6B2E', STAGE_RING = '#2FA84F';
  function content(o) {
    var k = contentBody(o);
    k.eyebrow = k.eyebrow || 'CERTIFICATE OF PARTICIPATION';
    k.lead1 = k.lead1 || 'This is to certify that';
    k.accent = k.accent || RUST;
    k.ring = k.ring || SAFFRON;
    k.pillText = k.pillText || INK;
    k.glow = k.glow || '#FFB36B';
    k.eventSubs = k.eventSubs || k.subs;
    // Designation and company under the name (organiser, 24 Nov 2026), when we have them.
    k.designation = String(o.designation || k.designation || '').replace(/\s+/g, ' ').trim();
    k.pill = String(k.pill || '').toUpperCase();
    return k;
  }
  function contentBody(o) {
    var ws = o.workshop || null, pn = o.panel || null, sp = o.speaker || null, st = o.stage || null;
    if (sp) {
      // A speaker on the programme: the session they spoke in, as moderator, panellist,
      // keynote or speaker, from Admin -> Conference.
      var sess = sp.session || {}, role = String(sp.role || 'speaker').toLowerCase();
      var keynote = role === 'keynote' || String(sess.type || '').toLowerCase() === 'keynote';
      var label = role === 'moderator' ? 'Moderator' : role === 'panellist' ? 'Panellist' : keynote ? 'Keynote Speaker' : 'Speaker';
      var lead = role === 'moderator' ? 'with thanks for moderating the panel'
        : role === 'panellist' ? 'with thanks for speaking on the panel'
        : keynote ? 'with thanks for delivering the keynote address' : 'with thanks for speaking in the session';
      var sday = dayLabel(sess.start);
      return {
        kind: 'speaker', eyebrow: 'CERTIFICATE OF APPRECIATION', lead1: 'This is presented to', lead: lead,
        headline: String(sess.title || 'Bharat AI Innovation 2026'), second: '',
        subs: [[[sess.room, sday].filter(Boolean).join(' · '), '#2A3150', '600', 21],
          ['at Bharat AI Innovation 2026, India’s B2B AI Conference & Exhibition', SLATE, '500', 21]],
        seal: 'BHARAT AI INNOVATION · MUMBAI 2026 · SPEAKER · ',
        when: (sday || '20–21 November 2026').toUpperCase(), where: 'World Trade Center, Mumbai',
        left: COMMITTEE, certId: 'BHAI-SPK-' + pad(sp.id != null ? sp.id : o.id, 4), foot: '',
        accent: GOLD, ring: GOLD_RING, glow: '#F0C766', pill: label,
      };
    }
    if (st) {
      // A talk on the Innovation Stage (Aryabhata Theatre, Expo Hall): an exhibitor's
      // talk, an Innovation Talk or a paid Showcase slot, all rows of innovation_talks.
      var tday = dayLabel(st.slot);
      return {
        kind: 'stage', eyebrow: 'CERTIFICATE OF APPRECIATION', lead1: 'This is presented to',
        lead: 'with thanks for presenting on the Innovation Stage', headline: String(st.topic || 'Innovation Talk'), second: '',
        subs: [[[st.title, st.company].filter(Boolean).join(', '), '#2A3150', '600', 21],
          ['Innovation Stage, Aryabhata Theatre · Bharat AI Innovation 2026', SLATE, '500', 21]],
        seal: 'BHARAT AI INNOVATION · INNOVATION STAGE · ',
        when: (tday || '20–21 November 2026').toUpperCase(), where: 'World Trade Center, Mumbai',
        left: COMMITTEE, certId: 'BHAI-IT-' + pad(st.id != null ? st.id : o.id, 4), foot: '',
        accent: STAGE, ring: STAGE_RING, glow: '#6FD98A', pillText: '#FFFFFF', pill: 'Innovation Stage',
        designation: [st.title, st.company].filter(Boolean).join(', '),
        eventSubs: [['Innovation Stage, Aryabhata Theatre · 20–21 November 2026'], ['at Bharat AI Innovation 2026, India’s B2B AI Conference & Exhibition']],
      };
    }
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
        foot: pn.claimed ? 'Attendance confirmed ' + pn.claimed : '', pill: 'Campus Series',
      };
    }
    if (ws) {
      return {
        kind: 'workshop', lead: 'has taken part in the workshop', headline: String(ws.title || 'Workshop'), second: '',
        subs: [['at Bharat AI Innovation 2026, India’s B2B AI Conference & Exhibition', SLATE, '500', 21]],
        seal: 'BHARAT AI INNOVATION · MUMBAI 2026 · WORKSHOP · ',
        when: (dayLabel(ws.day) || '20–21 November 2026').toUpperCase(), where: 'World Trade Center, Mumbai',
        left: facilitator(ws.speaker) || COMMITTEE, certId: 'BHAI-WS-' + pad(o.id, 4), foot: '', pill: 'Workshop',
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
      left: COMMITTEE, certId: 'BHAI-CERT-' + pad(o.id, 4), foot: '', pill: certPass || 'Participant',
      // The event style shows the pass in the pill, so its lines carry the date and place instead.
      eventSubs: [['India’s B2B AI Conference & Exhibition'], ['20–21 November 2026 · World Trade Center, Mumbai']].concat(certWs ? [['Workshop attended: ' + certWs]] : []),
    };
  }

  // The sponsor and partners of Mumbai 2026, in the order of src/data/partners.json (the
  // one list; smoke-cert-preview.mjs checks that this copy matches it). The event is over,
  // so the certificate keeps the partners who backed it.
  var POWERED_BY = { name: 'IDFC FIRST Bank', logo: '/images/logo-idfc-first-bank.webp' };
  var PARTNERS = [
    { name: 'Aegis Superintelligence Lab', label: 'AI Partner', logo: '/images/org-logos/aegis-superintelligence-lab.webp', dark: true },
    { name: 'Assessfy', label: 'Assessment OS Partner & Panel Host', logo: '/images/exhibitors/assessfy.webp' },
    { name: 'Aegis School of Data Science & AI', label: 'AI COE', logo: '/images/logo-aegis.webp' },
    { name: 'Jade Global', label: 'Panel Host Partner', logo: '/images/exhibitors/jade-global.webp' },
    { name: 'Pramaana Labs', label: 'Partner', logo: '/images/org-logos/pramaana-labs.webp' },
    { name: 'Decimal Point Analytics', label: 'Analytics Partner', logo: '/images/org-logos/decimal-point-analytics.webp' },
    { name: 'EXENI', label: 'Partner', logo: '/images/org-logos/exeni.webp' },
  ];

  // Which style: design C for the workshop (and the campus panel); the event style for the
  // certificate of participation, a speaker's and an Innovation Stage presenter's
  // (organiser, 24 Nov 2026: "create new style of certificate, this style we are using for
  // workshop"). o.style 'C' or 'event' forces one, for previews.
  function styleOf(o) {
    if (o.style === 'C' || o.style === 'event') return o.style;
    return o.workshop || o.panel ? 'C' : 'event';
  }

  async function draw(o) {
    o = o || {};
    var name = String(o.name || '').trim() || 'Attendee';
    var k = content(o);
    var pn = o.panel || null;
    var ev = styleOf(o) === 'event';
    var loaded = await Promise.all([tryImage(IMG.bharat), tryImage(IMG.mark), ev ? null : tryImage(IMG.aegis), tryImage(pn && pn.hostLogo), tryImage(photoSrc(o.photo)),
      ev ? Promise.all([tryImage(POWERED_BY.logo)].concat(PARTNERS.map(function (p) { return tryImage(p.logo); }))) : null,
      fontsReady([name, k.headline, k.second, k.left.name, k.left.org, DEAN.name, DEAN.org, k.where].concat(k.subs.concat(k.eventSubs).map(function (s) { return s[0]; }), PARTNERS.map(function (p) { return p.label; })).join(' '))]);
    // A photo that will not load leaves the certificate without one: the seal design.
    var bharat = loaded[0], mark = loaded[1], aegis = loaded[2], hostLogo = loaded[3], photo = loaded[4];

    var canvas = document.createElement('canvas'); canvas.width = W * SCALE; canvas.height = H * SCALE;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.textBaseline = 'alphabetic';
    if (ev) { paintEvent(ctx, o, k, name, { bharat: bharat, mark: mark, photo: photo, sponsor: loaded[5][0], partners: loaded[5].slice(1) }); return canvas; }

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
    if (photo) {
      portrait(ctx, PW / 2, 560, 132, photo);
      smallSeal(ctx, PW / 2 + 98, 560 + 98, 40, mark, k.ring);
      pill(ctx, PW / 2, 770, k.pill, k.ring, k.pillText);
    } else {
      seal(ctx, PW / 2, 600, 118, mark, k.seal, k.ring);
    }
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
    ctx.fillStyle = k.accent; ctx.font = '600 20px ' + MS; spaced(ctx, k.eyebrow, X, 330, 6, 'left');
    ctx.fillStyle = SLATE; ctx.font = '500 22px ' + MR; ctx.fillText(k.lead1, X, 388);
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
    signBlock(ctx, X, 850, k.left, k.accent);
    signBlock(ctx, X + 470, 850, DEAN, k.accent);

    ctx.fillStyle = '#9A9FAD'; ctx.font = '500 14px ' + MR;
    spaced(ctx, 'CERTIFICATE ID  ' + k.certId, R - 20, 1050, 2, 'right');
    if (k.foot) { ctx.textAlign = 'left'; fit(ctx, k.foot, '500', 14, 11, MR, 420); ctx.fillText(k.foot, X, 1050); }
    return canvas;
  }

  /* The event style (24 Nov 2026), for the certificate of participation, a speaker's and
   * an Innovation Stage presenter's: deep ink, centred, our logo with the Hindi line top
   * left, the QR top right, the person's photo (or the seal) above the name, no
   * signatures, and a white band along the foot with "Powered by IDFC FIRST Bank" and the
   * seven partners, who asked to be seen after the event. */
  function paintEvent(ctx, o, k, name, im) {
    var CX = W / 2, BAND = 878, maxW = 1240;
    var bg = ctx.createRadialGradient(CX, 470, 60, CX, 520, 1000);
    bg.addColorStop(0, '#18235A'); bg.addColorStop(1, '#070A18');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    guilloche(ctx, 52, 22, 24, '#FFB15C', 0.06, 0, W);
    rosette(ctx, CX, 470, 340, '#FFB15C', 0.05);

    // Top row: logo and the Hindi line under it, the kind of certificate, the QR.
    var lw = 300, lh = 79;
    if (im.bharat) { lh = im.bharat.height * (lw / im.bharat.width); ctx.drawImage(im.bharat, 78, 64, lw, lh); }
    else { ctx.textAlign = 'left'; ctx.fillStyle = '#F2EDE3'; ctx.font = '700 28px ' + MS; ctx.fillText('BHARAT AI INNOVATION', 78, 120); }
    hindi(ctx, 78 + lw / 2, 64 + lh + 40, 28);
    ctx.textAlign = 'center';
    ctx.fillStyle = k.glow; ctx.font = '600 20px ' + MS;
    var tw = spaced(ctx, k.eyebrow, CX, 132, 7, 'center');
    ctx.globalAlpha = 0.7; ctx.fillRect(CX - tw / 2 - 86, 125, 56, 1.5); ctx.fillRect(CX + tw / 2 + 30, 125, 56, 1.5); ctx.globalAlpha = 1;
    var q = qrCode(o.verifyUrl), qx = W - 78 - 150, qy = 56;
    if (q) {
      ctx.fillStyle = '#FFFFFF'; roundRect(ctx, qx, qy, 150, 150, 12); ctx.fill();
      drawQR(ctx, q, qx + 10, qy + 10, 130);
      ctx.fillStyle = '#C8CBDA'; ctx.font = '700 11px ' + MS; spaced(ctx, 'SCAN TO VERIFY', qx + 75, qy + 174, 2.5, 'center');
      ctx.fillStyle = '#7F85A3'; ctx.font = '500 12px ' + MR; spaced(ctx, k.certId, qx + 75, qy + 194, 1.5, 'center');
    } else {
      ctx.fillStyle = '#7F85A3'; ctx.font = '500 12px ' + MR; spaced(ctx, 'CERTIFICATE ID  ' + k.certId, W - 78, BAND - 18, 1.5, 'right');
    }

    // The photo in a ring striped like the flag, or the seal; what they were, in a pill.
    var my = 290;
    if (im.photo) { portrait(ctx, CX, my, 86, im.photo); smallSeal(ctx, CX + 66, my + 66, 28, im.mark, k.ring); }
    else seal(ctx, CX, my, 96, im.mark, k.seal, k.ring);
    pill(ctx, CX, 430, k.pill, k.ring, k.pillText);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#C8CBDA'; ctx.font = '500 22px ' + MR; ctx.fillText(k.lead1, CX, 490);
    var nm = setLines(ctx, name, '700', 78, 50, PF, maxW, 52, 36);
    var y = nm.lines.length > 1 ? 550 : 568, lineH = Math.round(nm.size * 1.1);
    // A two-line name and a two-line title together leave less room above the partners'
    // band: the last lines go first (the logo already says Bharat AI Innovation 2026).
    var hdPre = setLines(ctx, k.headline, '700', 38, 30, MS, maxW, 34, 24);
    var subs = k.eventSubs.slice();
    var bottom = function () {
      return y + (nm.lines.length - 1) * lineH + (k.designation ? 44 : 0) + 26 + 50 + 48
        + (hdPre.lines.length - 1) * Math.round(hdPre.size * 1.25) + subs.reduce(function (a, s, i) { return a + (i ? 30 : 38); }, 0);
    };
    while (subs.length > 1 && bottom() > BAND - 30) subs.pop();
    var ng = ctx.createLinearGradient(0, y - nm.size, 0, y + (nm.lines.length - 1) * lineH); ng.addColorStop(0, '#FFFFFF'); ng.addColorStop(1, '#F3E3CC');
    ctx.fillStyle = ng; ctx.font = '700 ' + nm.size + 'px ' + PF;
    nm.lines.forEach(function (ln, i) { ctx.fillText(ln, CX, y + i * lineH); });
    y += (nm.lines.length - 1) * lineH;
    if (k.designation) { ctx.fillStyle = '#E3E6F0'; fit(ctx, k.designation, '600', 22, 15, MR, maxW); y += 44; ctx.fillText(k.designation, CX, y); }
    y += 26;
    ctx.fillStyle = SAFFRON; ctx.fillRect(CX - 60, y, 40, 3); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(CX - 20, y, 40, 3); ctx.fillStyle = GREEN_DARK; ctx.fillRect(CX + 20, y, 40, 3);
    y += 50; ctx.fillStyle = '#C8CBDA'; ctx.font = '500 22px ' + MR; ctx.fillText(k.lead, CX, y);
    var hd = setLines(ctx, k.headline, '700', 38, 30, MS, maxW, 34, 24);
    ctx.fillStyle = '#FFFFFF'; ctx.font = '700 ' + hd.size + 'px ' + MS;
    y += 48; hd.lines.forEach(function (ln, i) { ctx.fillText(ln, CX, y + i * Math.round(hd.size * 1.25)); });
    y += (hd.lines.length - 1) * Math.round(hd.size * 1.25);
    subs.forEach(function (s, i) {
      ctx.fillStyle = i ? '#9EA3BB' : '#E3E6F0';
      fit(ctx, s[0], i ? '500' : '600', 20, 14, MR, maxW);
      y += i ? 30 : 38; ctx.fillText(s[0], CX, y);
    });

    // The partners' band.
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(28, BAND, W - 56, H - 28 - BAND);
    ctx.fillStyle = SAFFRON; ctx.fillRect(28, BAND, (W - 56) / 3, 3); ctx.fillStyle = '#E8E2D4'; ctx.fillRect(28 + (W - 56) / 3, BAND, (W - 56) / 3, 3); ctx.fillStyle = GREEN; ctx.fillRect(28 + 2 * (W - 56) / 3, BAND, (W - 56) / 3 + 1, 3);
    // IDFC FIRST Bank larger than any partner (organiser, 24 Nov 2026: "make idfc first logo relatively bigger").
    ctx.font = '700 15px ' + MS;
    var label = 'POWERED BY', sw = 0, i;
    for (i = 0; i < label.length; i++) sw += ctx.measureText(label[i]).width + (i < label.length - 1 ? 3 : 0);
    var sh = 66, swid = im.sponsor ? im.sponsor.width * (sh / im.sponsor.height) : 0, sx = CX - (sw + 18 + swid) / 2;
    ctx.fillStyle = SLATE; ctx.font = '700 15px ' + MS; spaced(ctx, label, sx, BAND + 55, 3, 'left');
    if (im.sponsor) { ctx.save(); roundRect(ctx, sx + sw + 18, BAND + 16, swid, sh, 8); ctx.clip(); ctx.drawImage(im.sponsor, sx + sw + 18, BAND + 16, swid, sh); ctx.restore(); }
    else { ctx.fillStyle = INK; ctx.font = '700 18px ' + MS; ctx.textAlign = 'left'; ctx.fillText(POWERED_BY.name, sx + sw + 18, BAND + 56); }
    ctx.fillStyle = '#ECE7DC'; ctx.fillRect(CX - 600, BAND + 96, 1200, 1);
    var colW = (W - 140) / PARTNERS.length;
    PARTNERS.forEach(function (p, j) {
      var cx = 70 + colW * j + colW / 2, cy = BAND + 134, img = im.partners[j];
      if (img) {
        var h = 40, w = img.width * (h / img.height);
        if (w > 150) { w = 150; h = img.height * (w / img.width); }
        ctx.save(); if (p.dark) { roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 6); ctx.clip(); }
        ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h); ctx.restore();
      } else { ctx.fillStyle = INK; ctx.textAlign = 'center'; fit(ctx, p.name, '700', 15, 10, MS, colW - 16); ctx.fillText(p.name, cx, cy + 5); }
      ctx.fillStyle = SLATE; ctx.font = '700 10px ' + MS;
      var parts = String(p.label).toUpperCase(), lines = [parts];
      if (ctx.measureText(parts).width + parts.length * 1.2 > colW - 14) lines = split2(ctx, parts);
      lines.forEach(function (ln, m) { spaced(ctx, ln, cx, cy + 42 + m * 13, 1.2, 'center'); });
    });

    // The frame, over everything.
    ctx.strokeStyle = 'rgba(255,153,51,0.75)'; ctx.lineWidth = 1.5; ctx.strokeRect(28, 28, W - 56, H - 56);
    ctx.strokeStyle = k.ring; ctx.lineWidth = 3;
    [[28, 28, 1, 1], [W - 28, 28, -1, 1], [28, H - 28, 1, -1], [W - 28, H - 28, -1, -1]].forEach(function (c) {
      ctx.beginPath(); ctx.moveTo(c[0], c[1] + 60 * c[3]); ctx.lineTo(c[0], c[1]); ctx.lineTo(c[0] + 60 * c[2], c[1]); ctx.stroke();
    });
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
    styleOf: styleOf, PARTNERS: PARTNERS, POWERED_BY: POWERED_BY,
    DEAN: DEAN, COMMITTEE: COMMITTEE, IMAGES: IMG, SAMPLE_VERIFY_URL: 'https://bharataiinnovation.com/certificate/sample',
  };
})(typeof window !== 'undefined' ? window : this);
