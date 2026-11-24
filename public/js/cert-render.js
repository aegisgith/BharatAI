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
  var proxy = function (u) { return '/api/image-proxy?url=' + encodeURIComponent(u); };

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
    // Logo, 340 wide (was 150 until 24 Nov 2026: the organiser asked for it bigger).
    // The PNG has a solid white background, so it sits on a rounded white card
    // rather than as a bare white block on the dark certificate.
    try {
      var logo = await loadImage(o.logo || proxy(LOGO));
      var lw = 340, lh = logo.height * (lw / logo.width), ly = 104;
      var px = 22, py = 14, cx = (W - lw) / 2 - px, cy = ly - py, cw = lw + px * 2, chh = lh + py * 2, r = 16;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx + r, cy);
      ctx.arcTo(cx + cw, cy, cx + cw, cy + chh, r); ctx.arcTo(cx + cw, cy + chh, cx, cy + chh, r);
      ctx.arcTo(cx, cy + chh, cx, cy, r); ctx.arcTo(cx, cy, cx + cw, cy, r);
      ctx.closePath(); ctx.fill();
      ctx.drawImage(logo, (W - lw) / 2, ly, lw, lh);
    } catch (e) { /* drawn without it, as before */ }
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
    // Signature line
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(W / 2 - 150, 900, 300, 2);
    ctx.fillStyle = '#9698ac'; ctx.font = '400 18px Inter, Arial'; ctx.fillText('Organizing Committee · Aegis Knowledge Trust', W / 2, 935);
    ctx.fillStyle = '#6b6a63'; ctx.font = '400 15px Inter, Arial';
    ctx.fillText('Certificate ID: ' + (ws ? 'BHAI-WS-' : 'BHAI-CERT-') + String(o.id == null ? '' : o.id).padStart(4, '0'), W / 2, 1010);
    return canvas;
  }

  function filename(isWorkshop) {
    return isWorkshop ? 'BharatAI-2026-Workshop-Certificate.png' : 'BharatAI-2026-Certificate.png';
  }

  global.BhaiCert = { draw: draw, filename: filename };
})(typeof window !== 'undefined' ? window : this);
