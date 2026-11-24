/* Bharat AI Innovation 2026: certificate renderer.
 *
 * One drawing, loaded by the app (the attendee's own download) and by the admin
 * panel (Admin -> Workshops and Attendees preview the same certificate), so what
 * the organisers check is exactly what the attendee gets. Same reason as
 * pass-render.js: two copies of a drawing drift apart.
 *
 * It only draws. Who may have a certificate is the server's answer
 * (GET /api/attendees/:id/certificate-eligibility); the callers ask it first.
 *
 *   BhaiCert.draw({ id, name, workshop: { title, speaker } | null,
 *                   pass, workshopAttended, logo }) -> Promise<canvas>
 *   BhaiCert.filename(isWorkshop)
 *
 * Moved here from the app on 23 Nov 2026 unchanged, except that the
 * "conducted by ..." line now shrinks to fit between the borders as the title
 * does (a speaker entry with a long affiliation reached the inner border).
 */
(function (global) {
  'use strict';

  var LOGO = 'https://bharataiinnovation.com/images/Bharat%20AI%20Innovation%20Logo.png';
  // Aegis School of Data Science and AI: dark red and grey on a clear background,
  // so it is only ever drawn on white (the same file the passes carry).
  var AEGIS_LOGO = 'https://bharataiinnovation.com/images/passes/aegis.png';
  var proxy = function (u) { return '/api/image-proxy?url=' + encodeURIComponent(u); };

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

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Two signature blocks side by side: a line, the name, the role, the organisation.
  // y is the signature line; the block ends about 100 px below it.
  function signoff(ctx, W, y, people, family) {
    family = family || 'Inter, Arial';
    var list = (people || []).filter(Boolean);
    var span = 340, colW = 440;
    ctx.save();
    ctx.textAlign = 'center';
    list.forEach(function (p, i) {
      var cx = list.length === 1 ? W / 2 : W / 2 + (i === 0 ? -span : span);
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(cx - 160, y, 320, 2);
      ctx.fillStyle = '#ffffff'; fit(ctx, p.name, '600', 26, 18, family, colW); ctx.fillText(p.name, cx, y + 40);
      ctx.fillStyle = '#ff9a52'; fit(ctx, p.role || '', '600', 18, 13, family, colW); ctx.fillText(p.role || '', cx, y + 70);
      if (p.org) { ctx.fillStyle = '#9698ac'; fit(ctx, p.org, '400', 17, 12, family, colW); ctx.fillText(p.org, cx, y + 96); }
    });
    ctx.restore();
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

  // Set the font, then step the size down until the line fits the width.
  function fit(ctx, text, weight, size, min, family, maxW) {
    ctx.font = weight + ' ' + size + 'px ' + family;
    while (size > min && ctx.measureText(text).width > maxW) { size -= 1; ctx.font = weight + ' ' + size + 'px ' + family; }
    return size;
  }

  async function draw(o) {
    o = o || {};
    var ws = o.workshop || null;
    var name = String(o.name || '');
    var W = 1600, H = 1130;
    var canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    // Background
    var bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0b0d1a'); bg.addColorStop(1, '#141730');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // Saffron corner glow
    var glow = ctx.createRadialGradient(W * 0.85, H * 0.1, 40, W * 0.85, H * 0.1, 700);
    glow.addColorStop(0, 'rgba(255,107,0,0.22)'); glow.addColorStop(1, 'rgba(255,107,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    // Double border
    ctx.strokeStyle = 'rgba(255,107,0,0.55)'; ctx.lineWidth = 4; ctx.strokeRect(40, 40, W - 80, H - 80);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.5; ctx.strokeRect(58, 58, W - 116, H - 116);
    // Logos on one rounded white card: Bharat AI Innovation 340 wide (was 150
    // until 24 Nov 2026, the organiser asked for it bigger), then a thin rule,
    // then Aegis School of Data Science and AI. Both PNGs need white behind them.
    // Whichever fails to load is left out; the card shrinks to what is there.
    var marks = [];
    try { var bl = await loadImage(o.logo || proxy(LOGO)); marks.push({ img: bl, w: 340, h: bl.height * (340 / bl.width) }); } catch (e) {}
    try { var al = await loadImage(o.aegisLogo || proxy(AEGIS_LOGO)); marks.push({ img: al, w: al.width * (124 / al.height), h: 124 }); } catch (e) {}
    if (marks.length) {
      var padX = 26, padY = 14, gap = 30, top = 90;
      var innerH = Math.max.apply(null, marks.map(function (m) { return m.h; }));
      var cardW = padX * 2 + marks.reduce(function (a, m) { return a + m.w; }, 0) + (marks.length - 1) * (gap * 2 + 2);
      var x = (W - cardW) / 2;
      ctx.fillStyle = '#ffffff'; roundRect(ctx, x, top, cardW, innerH + padY * 2, 16); ctx.fill();
      x += padX;
      marks.forEach(function (m, i) {
        if (i) { ctx.fillStyle = 'rgba(11,13,26,0.18)'; ctx.fillRect(x + gap, top + padY + 10, 2, innerH - 20); x += gap * 2 + 2; }
        ctx.drawImage(m.img, x, top + padY + (innerH - m.h) / 2, m.w, m.h);
        x += m.w;
      });
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff9a52'; ctx.font = '600 26px Inter, Arial'; ctx.fillText('CERTIFICATE OF PARTICIPATION', W / 2, 320);
    ctx.fillStyle = '#c8c9d6'; ctx.font = '400 22px Inter, Arial'; ctx.fillText('This is proudly presented to', W / 2, 400);
    ctx.fillStyle = '#ffffff'; ctx.font = '700 68px Georgia, serif'; ctx.fillText(name || 'Attendee', W / 2, 500);
    // underline
    var uw = Math.min(560, name.length * 34 + 120);
    var ug = ctx.createLinearGradient(W / 2 - uw / 2, 0, W / 2 + uw / 2, 0);
    ug.addColorStop(0, 'rgba(255,107,0,0)'); ug.addColorStop(0.5, 'rgba(255,107,0,0.9)'); ug.addColorStop(1, 'rgba(255,107,0,0)');
    ctx.fillStyle = ug; ctx.fillRect(W / 2 - uw / 2, 528, uw, 3);
    ctx.fillStyle = '#c8c9d6'; ctx.font = '400 24px Inter, Arial';
    ctx.fillText(ws ? 'for taking part in the workshop' : 'for participating in', W / 2, 600);
    // A long workshop title is set smaller until it fits between the borders.
    var headline = ws ? String(ws.title || 'Workshop') : 'Bharat AI Innovation 2026';
    ctx.fillStyle = '#ffffff';
    var hs = 40;
    ctx.font = '700 ' + hs + 'px Inter, Arial';
    while (hs > 24 && ctx.measureText(headline).width > W - 260) { hs -= 2; ctx.font = '700 ' + hs + 'px Inter, Arial'; }
    ctx.fillText(headline, W / 2, 660);
    ctx.fillStyle = '#9698ac';
    var by = ws ? ((ws.speaker ? 'conducted by ' + ws.speaker + ' at ' : 'at ') + 'Bharat AI Innovation 2026') : "India's B2B AI Conference & Exhibition";
    fit(ctx, by, '400', 22, 15, 'Inter, Arial', W - 260);
    ctx.fillText(by, W / 2, 705);
    ctx.font = '400 22px Inter, Arial';
    ctx.fillText('20–21 November 2026 · World Trade Center, Mumbai', W / 2, 745);
    if (!ws) {
      var certPass = String(o.pass || '').trim();
      var certWs = String(o.workshopAttended || '').trim();
      if (certPass) { ctx.fillStyle = '#ff9a52'; ctx.font = '600 24px Inter, Arial'; ctx.fillText('Pass: ' + certPass, W / 2, 805); }
      if (certWs) {
        var certLine = 'Workshop attended: ' + certWs;
        ctx.fillStyle = '#c8c9d6';
        fit(ctx, certLine, '400', 22, 15, 'Inter, Arial', W - 260);
        ctx.fillText(certLine, W / 2, 848);
      }
    }
    // Signed by the facilitator and the Dean.
    signoff(ctx, W, 905, [(ws && facilitator(ws.speaker)) || COMMITTEE, DEAN]);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#6b6a63'; ctx.font = '400 15px Inter, Arial';
    ctx.fillText('Certificate ID: ' + (ws ? 'BHAI-WS-' : 'BHAI-CERT-') + String(o.id == null ? '' : o.id).padStart(4, '0'), W / 2, 1042);
    return canvas;
  }

  function filename(isWorkshop) {
    return isWorkshop ? 'BharatAI-2026-Workshop-Certificate.png' : 'BharatAI-2026-Certificate.png';
  }

  // signoff, DEAN, COMMITTEE and the Aegis logo are shared with the campus-panel
  // certificate (generatePanelCertificate in the app), which draws its own page.
  global.BhaiCert = {
    draw: draw, filename: filename, signoff: signoff, facilitator: facilitator,
    DEAN: DEAN, COMMITTEE: COMMITTEE, AEGIS_LOGO_PATH: '/images/passes/aegis.png',
  };
})(typeof window !== 'undefined' ? window : this);
