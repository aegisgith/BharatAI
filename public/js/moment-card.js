/* Bharat AI Innovation 2026, after the event: "Share your Bharat AI moment".
 *
 * The organiser, 23 Nov 2026: social creatives for delegates, VIP, free and Expo
 * pass holders, on photos of the event where "भारत एआई इनोवेशन" can be seen, with
 * the words ready for LinkedIn, Facebook, Instagram and X, #BharatAIInnovation and
 * our handle, and "Powered by IDFC FIRST Bank" with the partners' logos in a strip
 * at the bottom. Four cards:
 *   attended  "I attended Bharat AI Innovation" (speakers: "I spoke at")
 *   met       "Look who I met at Bharat AI Innovation", naming the person
 *   talk      an Innovation Talk or keynote: topic, speaker, designation, company
 *   panel     a panel: topic and every panellist
 *
 * The page that drives this is /share (public/share.html, js/share-studio.js).
 * Nothing here talks to the server: the caller hands in the person, the session
 * and any photo, and gets a PNG and the captions back. A photo the person picks
 * from their phone is drawn here and never uploaded.
 *
 * Rules carried over from the earlier social kit (29 Oct 2026):
 *   - the logo on every card with the Hindi line in the tricolour right under it;
 *   - never cut a face: a portrait's frame takes the photo's own shape, and a
 *     person's own photo is shown whole (blurred fill around it), never cropped;
 *   - the pass printed is the one on the record, never one picked on the page.
 */
(function (global) {
  'use strict';

  var EVENT = {
    name: 'Bharat AI Innovation',
    year: '2026',
    wordsHi: ['भारत', 'एआई', 'इनोवेशन'],
    words: ['Bharat', 'AI', 'Innovation'],
    tagline: "India's B2B AI Conference & Exhibition",
    when: '20–21 Nov 2026',
    whenLong: '20 and 21 November 2026',
    where: 'WTC Mumbai',
    whereLong: 'World Trade Center, Mumbai',
    site: 'bharataiinnovation.com',
    next: 'Bharat Mandapam, New Delhi, 28–29 July 2027'
  };

  /* The handles, as the site footer links them (23 Nov 2026). Instagram's is
   * bharataiinnovation.ai, not bharataiinnovation. The site links no X account,
   * so X captions carry the hashtag only until one is confirmed: put it here.
   * LinkedIn and Facebook only tag a page picked from the list as you type, so
   * their captions spell the name and the page tells people to pick it. */
  var HANDLES = {
    linkedin: '@Bharat AI Innovation',
    facebook: '@BharatAIInnovation',
    instagram: '@bharataiinnovation.ai',
    x: ''
  };
  var POWERED = 'Powered by IDFC FIRST Bank';

  var C = {
    ink: '#0A0C1B', ink2: '#141A3C', paper: '#FFFFFF', cream: '#FFFBF3',
    saffron: '#FF7A00', saffronLt: '#FF9933', mute: '#AEB5CC', faint: '#7D86A6',
    text: '#10131F', textMute: '#4B5165', rule: '#E6E8F0'
  };
  // भारत saffron, एआई white, इनोवेशन green, lifted for a dark ground (creative rules).
  var TRI = ['#FF9933', '#FFFFFF', '#1FA015'];
  var DISP = '"Bricolage Grotesque", "Montserrat", Arial, sans-serif';
  var BODY = '"Manrope", Arial, sans-serif';
  var MUKTA = '"Mukta", "Nirmala UI", "Noto Sans Devanagari", sans-serif';

  /* The colour of each pass, as js/pass-render.js prints it, so the card agrees
   * with the badge the person wore. Hindi as on the pass; Visitor had none. */
  var PASSES = {
    visitor:   { label: 'VISITOR PASS', words: 'Visitor', hi: 'आगंतुक पास', c1: '#2B8CFF', c2: '#1F6FD6' },
    speaker:   { label: 'SPEAKER', words: 'Speaker', hi: 'वक्ता', c1: '#FF7A00', c2: '#E06400' },
    delegate:  { label: 'DELEGATE PASS', words: 'Delegate', hi: 'प्रतिनिधि पास', c1: '#00996C', c2: '#007352', paid: true },
    premium:   { label: 'PREMIUM DELEGATE', words: 'Premium Delegate', hi: 'प्रीमियम प्रतिनिधि पास', c1: '#0B7A75', c2: '#075C58', paid: true },
    academic:  { label: 'ACADEMIC PASS', words: 'Academic Delegate', hi: 'शैक्षणिक पास', c1: '#7C5CFF', c2: '#5B3FD6', paid: true },
    vip:       { label: 'VIP PASS', words: 'VIP', hi: 'विशिष्ट अतिथि पास', c1: '#F3D27A', c2: '#C79A2A', gold: true, paid: true },
    exhibitor: { label: 'EXHIBITOR', words: 'Exhibitor', hi: 'प्रदर्शक', c1: '#E4599C', c2: '#C23F80' },
    organiser: { label: 'ORGANISER', words: 'Organiser', hi: 'आयोजक', c1: '#2A2A30', c2: '#0B0B0D', edge: '#FF7A00' },
    jury:      { label: 'JURY', words: 'Jury', hi: 'निर्णायक मंडल', c1: '#D64545', c2: '#A83232' },
    media:     { label: 'MEDIA', words: 'Media', hi: 'मीडिया', c1: '#00A3C4', c2: '#007F99' },
    influencer:{ label: 'INFLUENCER', words: 'Influencer', hi: 'इन्फ्लुएंसर', c1: '#9C27B0', c2: '#7B1FA2' },
    student:   { label: 'STUDENT PASS', words: 'Student', hi: 'छात्र पास', c1: '#AD1457', c2: '#880E4F' },
    expo:      { label: 'EXPO PASS', words: 'Expo', hi: 'एक्सपो पास', c1: '#BF360C', c2: '#9A2B09' },
    investor:  { label: 'INVESTOR', words: 'Investor', hi: 'निवेशक', c1: '#C8803E', c2: '#9C5F27' },
    startup:   { label: 'STARTUP', words: 'Startup', hi: 'स्टार्टअप', c1: '#7CB342', c2: '#5A8A2C' },
    staff:     { label: 'TEAM', words: 'Team', hi: 'सहायक दल', c1: '#78909C', c2: '#546E7A' }
  };

  // Same order of tests as pass-render.js tierFor(), so the two never disagree.
  function passKey(badge, role) {
    var b = String(badge || '').toLowerCase(), r = String(role || '').toLowerCase();
    if (!b && !r) return '';
    if (b.indexOf('vip') >= 0) return 'vip';
    if (b.indexOf('premium delegate') >= 0) return 'premium';
    if (b.indexOf('delegate') >= 0) return 'delegate';
    if (b.indexOf('academic') >= 0) return 'academic';
    if (b.indexOf('student') >= 0) return 'student';
    if (b.indexOf('expo') >= 0) return 'expo';
    if (b.indexOf('speaker') >= 0 || r.indexOf('speaker') >= 0) return 'speaker';
    if (b.indexOf('exhibitor') >= 0 || r.indexOf('exhibitor') >= 0) return 'exhibitor';
    if (b.indexOf('organi') >= 0) return 'organiser';
    if (b.indexOf('jury') >= 0) return 'jury';
    if (b.indexOf('influencer') >= 0) return 'influencer';
    if (b.indexOf('media') >= 0 || b.indexOf('press') >= 0) return 'media';
    if (b.indexOf('investor') >= 0) return 'investor';
    if (b.indexOf('startup') >= 0) return 'startup';
    if (b.indexOf('staff') >= 0) return 'staff';
    return 'visitor';
  }

  /* Photos from the event where the Hindi name can be read, all already public on
   * /gallery or the home page (static files on this site, so a canvas may read
   * them). fx/fy: the point to keep in frame, the screen with भारत एआई इनोवेशन. */
  var G = '/img/gallery/mumbai-2026/', M = '/img/mumbai-2026/';
  var BACKDROPS = [
    { id: 'big-screen', src: G + 'talk-giant-screen.webp', fx: 0.42, fy: 0.36, label: 'The big screen' },
    { id: 'main-stage', src: M + 'keynote-main-stage.webp', fx: 0.66, fy: 0.38, label: 'Main stage' },
    { id: 'on-stage', src: G + 'talk-bharat-ai-screen.webp', fx: 0.5, fy: 0.38, label: 'On stage' },
    { id: 'speakers', src: G + 'stage-group-day2.webp', fx: 0.5, fy: 0.42, label: 'Speakers on stage' },
    { id: 'lamp', src: G + 'lamp-lighting-opening.webp', fx: 0.55, fy: 0.42, label: 'Lamp lighting' },
    { id: 'together', src: G + 'speakers-together.webp', fx: 0.45, fy: 0.4, label: 'Day one' },
    { id: 'panel-day2', src: G + 'panel-group-day2.webp', fx: 0.45, fy: 0.42, label: 'Day two' },
    { id: 'welcome', src: G + 'welcome-day2.webp', fx: 0.42, fy: 0.36, label: 'Welcome' },
    { id: 'arch', src: G + 'entrance-arch.webp', fx: 0.42, fy: 0.3, label: 'The entrance' }
  ];
  // Each panel's own photo (gallery.json), by session id in Admin → Conference.
  var PANEL_PHOTOS = {
    124: { src: G + 'panel-viksit-bharat-full.webp', fx: 0.5, fy: 0.45 },
    147: { src: G + 'panel-healthcare.webp', fx: 0.5, fy: 0.45 },
    126: { src: G + 'panel-financial-inclusion.webp', fx: 0.5, fy: 0.45 },
    151: { src: G + 'panel-growth-engines.webp', fx: 0.5, fy: 0.45 },
    127: { src: G + 'panel-beyond-pilots.webp', fx: 0.5, fy: 0.45 },
    130: { src: G + 'panel-human-plus-ai.webp', fx: 0.5, fy: 0.45 },
    137: { src: M + 'panel-telecom.webp', fx: 0.5, fy: 0.42 },
    138: { src: G + 'panel-ai-workforce.webp', fx: 0.5, fy: 0.45 },
    158: { src: G + 'panel-agriculture.webp', fx: 0.5, fy: 0.42 },
    140: { src: G + 'panel-insurance.webp', fx: 0.5, fy: 0.45 },
    143: { src: G + 'panel-media-wide.webp', fx: 0.5, fy: 0.45 },
    145: { src: G + 'panel-learning-outcomes.webp', fx: 0.5, fy: 0.45 }
  };

  /* Post: 4:5, what LinkedIn, Instagram, Facebook and X show largest in the feed.
   * Story: 9:16 for Instagram and WhatsApp status, with room left at the top and
   * the bottom where those apps lay their own buttons over the picture. */
  var SIZES = {
    post:  { key: 'post',  w: 1080, h: 1350, pad: 56, k: 1,    stripeH: 200, safeT: 40,  safeB: 0,   lockH: 70 },
    story: { key: 'story', w: 1080, h: 1920, pad: 64, k: 1.14, stripeH: 236, safeT: 150, safeB: 130, lockH: 80 }
  };

  // ------------------------------------------------------------------ basics
  function font(w, s, f) { return w + ' ' + Math.round(s) + 'px ' + f; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function str(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

  function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var faces = ['800 60px "Bricolage Grotesque"', '700 40px "Bricolage Grotesque"', '600 30px "Bricolage Grotesque"',
                 '800 24px Manrope', '700 24px Manrope', '600 24px Manrope', '500 24px Manrope',
                 '700 40px Mukta', '600 30px Mukta'];
    return Promise.all(faces.map(function (f) {
      return document.fonts.load(f, f.indexOf('Mukta') >= 0 ? 'भारत एआई इनोवेशन' : 'Bharat AI 2026').catch(function () {});
    })).then(function () { return document.fonts.ready; }).catch(function () {});
  }

  var imgCache = {};
  // Our own files and data/blob URLs only: a picture from another site would
  // taint the canvas and the card could not be saved at all.
  function safeSrc(src) {
    if (!src || typeof src !== 'string') return '';
    if (/^(data|blob):/.test(src) || /^\/(?!\/)/.test(src)) return src;
    try { if (new URL(src).origin === global.location.origin) return src; } catch (e) {}
    return '';
  }
  function loadImage(src) {
    if (src && typeof src === 'object') return Promise.resolve(src);
    src = safeSrc(src);
    if (!src) return Promise.resolve(null);
    if (!imgCache[src]) {
      imgCache[src] = new Promise(function (resolve) {
        var im = new Image();
        im.decoding = 'async';
        im.onload = function () { resolve(im); };
        im.onerror = function () { delete imgCache[src]; resolve(null); };
        im.src = src;
      });
    }
    return imgCache[src];
  }

  function rr(ctx, x, y, w, h, r) {
    var t = typeof r === 'number' ? [r, r, r, r] : r;
    ctx.beginPath();
    ctx.moveTo(x + t[0], y);
    ctx.lineTo(x + w - t[1], y); ctx.quadraticCurveTo(x + w, y, x + w, y + t[1]);
    ctx.lineTo(x + w, y + h - t[2]); ctx.quadraticCurveTo(x + w, y + h, x + w - t[2], y + h);
    ctx.lineTo(x + t[3], y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - t[3]);
    ctx.lineTo(x, y + t[0]); ctx.quadraticCurveTo(x, y, x + t[0], y);
    ctx.closePath();
  }

  function tracked(ctx, text, x, y, track, align) {
    var chars = String(text).split(''), w = 0, i;
    for (i = 0; i < chars.length; i++) w += ctx.measureText(chars[i]).width + (i < chars.length - 1 ? track : 0);
    var cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    var keep = ctx.textAlign; ctx.textAlign = 'left';
    for (i = 0; i < chars.length; i++) { ctx.fillText(chars[i], cx, y); cx += ctx.measureText(chars[i]).width + track; }
    ctx.textAlign = keep;
    return w;
  }
  function trackedW(ctx, text, track) {
    var chars = String(text).split(''), w = 0;
    for (var i = 0; i < chars.length; i++) w += ctx.measureText(chars[i]).width + (i < chars.length - 1 ? track : 0);
    return w;
  }

  // Words on one line, each its own colour (the tricolour name).
  function wordsW(ctx, words, gap) {
    return words.reduce(function (a, w) { return a + ctx.measureText(w).width; }, 0) + gap * (words.length - 1);
  }
  function drawWords(ctx, words, colours, x, y, gap, align) {
    var total = wordsW(ctx, words, gap);
    var cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    var keep = ctx.textAlign; ctx.textAlign = 'left';
    for (var i = 0; i < words.length; i++) { ctx.fillStyle = colours[i % colours.length]; ctx.fillText(words[i], cx, y); cx += ctx.measureText(words[i]).width + gap; }
    ctx.textAlign = keep;
    return total;
  }
  function fitWords(ctx, words, maxW, weight, size, min, fam, gapRatio) {
    var s = size;
    for (; s > min; s -= 1) { ctx.font = font(weight, s, fam); if (wordsW(ctx, words, s * gapRatio) <= maxW) break; }
    ctx.font = font(weight, s, fam);
    return { size: s, gap: s * gapRatio };
  }
  function fitOne(ctx, text, maxW, weight, size, min, fam) {
    var s = size;
    for (; s > min; s -= 1) { ctx.font = font(weight, s, fam); if (ctx.measureText(text).width <= maxW) break; }
    ctx.font = font(weight, s, fam);
    return s;
  }

  // Lines that fit maxW, at most maxLines, the last cut with an ellipsis.
  function wrap(ctx, text, maxW, maxLines) {
    var words = str(text).split(' ').filter(Boolean), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (!cur || ctx.measureText(t).width <= maxW) cur = t; else { lines.push(cur); cur = words[i]; }
    }
    if (cur) lines.push(cur);
    var cut = lines.length > maxLines;
    if (cut) lines = lines.slice(0, maxLines);
    for (var j = 0; j < lines.length; j++) {
      var l = lines[j], last = j === lines.length - 1 && cut;
      if (ctx.measureText(l).width <= maxW && !last) continue;
      while (l.length > 1 && ctx.measureText(l + '…').width > maxW) l = l.slice(0, -1);
      lines[j] = l.replace(/[\s,;:–-]+$/, '') + (last || ctx.measureText(lines[j]).width > maxW ? '…' : '');
    }
    return lines;
  }
  // The biggest size at which the text fits in maxLines without an ellipsis.
  function fitBlock(ctx, text, maxW, weight, max, min, fam, maxLines) {
    for (var s = max; s >= min; s -= 2) {
      ctx.font = font(weight, s, fam);
      var lines = wrap(ctx, text, maxW, 99);
      var ok = lines.length <= maxLines && lines.every(function (l) { return ctx.measureText(l).width <= maxW; });
      if (ok) return { size: s, lines: lines };
    }
    ctx.font = font(weight, min, fam);
    return { size: min, lines: wrap(ctx, text, maxW, maxLines) };
  }

  function drawLines(ctx, lines, x, y, lead, align) {
    ctx.textAlign = align || 'left';
    for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], x, y + i * lead);
    ctx.textAlign = 'left';
  }

  // ------------------------------------------------------------------ photos
  function drawCover(ctx, img, x, y, w, h, fx, fy) {
    var s = Math.max(w / img.width, h / img.height);
    var dw = img.width * s, dh = img.height * s;
    var dx = clamp(x + w / 2 - (fx == null ? 0.5 : fx) * dw, x + w - dw, x);
    var dy = clamp(y + h / 2 - (fy == null ? 0.5 : fy) * dh, y + h - dh, y);
    ctx.drawImage(img, dx, dy, dw, dh);
  }
  function containRect(img, x, y, w, h) {
    var s = Math.min(w / img.width, h / img.height);
    var dw = img.width * s, dh = img.height * s;
    return { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh };
  }
  // A soft, dark copy of a picture behind it (no ctx.filter: Safari ignores it).
  function drawBlurFill(ctx, img, x, y, w, h) {
    var t = document.createElement('canvas');
    t.width = 36; t.height = Math.max(1, Math.round(36 * h / w));
    var tc = t.getContext('2d');
    drawCover(tc, img, 0, 0, t.width, t.height, 0.5, 0.5);
    ctx.save();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(t, x - 20, y - 20, w + 40, h + 40);
    ctx.fillStyle = 'rgba(10,12,27,0.45)'; ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  /* The top photo of a card. An event photo fills the band around its focal point;
   * the person's own photo is never cropped into a face: if its shape is far from
   * the band's, it is shown whole over a blurred copy of itself. */
  function drawBand(ctx, S, ph, y0, y1, fadeFrom) {
    var W = S.w, h = y1 - y0;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, y0, W, h); ctx.clip();
    if (ph && ph.img) {
      var a = ph.img.width / ph.img.height, b = W / h;
      if (ph.own && Math.abs(a - b) / b > 0.12) {
        drawBlurFill(ctx, ph.img, 0, y0, W, h);
        var r = containRect(ph.img, 0, y0, W, h);
        ctx.drawImage(ph.img, r.x, r.y, r.w, r.h);
      } else {
        drawCover(ctx, ph.img, 0, y0, W, h, ph.fx, ph.fy);
      }
    } else {
      var g0 = ctx.createLinearGradient(0, y0, W, y1);
      g0.addColorStop(0, '#1B2150'); g0.addColorStop(1, C.ink);
      ctx.fillStyle = g0; ctx.fillRect(0, y0, W, h);
    }
    // the logo and the date sit on the top of the photo
    var gt = ctx.createLinearGradient(0, y0, 0, y0 + 300 * S.k + S.safeT);
    gt.addColorStop(0, 'rgba(10,12,27,0.62)'); gt.addColorStop(1, 'rgba(10,12,27,0)');
    ctx.fillStyle = gt; ctx.fillRect(0, y0, W, 300 * S.k + S.safeT);
    // and the words below it start on the photo and carry on onto ink
    var f0 = fadeFrom == null ? y1 - h * 0.45 : fadeFrom;
    var gb = ctx.createLinearGradient(0, f0, 0, y1);
    gb.addColorStop(0, 'rgba(10,12,27,0)'); gb.addColorStop(0.55, 'rgba(10,12,27,0.78)'); gb.addColorStop(1, 'rgba(10,12,27,1)');
    ctx.fillStyle = gb; ctx.fillRect(0, f0, W, y1 - f0 + 1);
    ctx.restore();
  }

  /* A portrait: square photos fill the square; any other shape is drawn whole and
   * the frame takes its shape, so no forehead or chin is cut (creative rules). */
  function drawPortrait(ctx, img, x, y, side, opts) {
    opts = opts || {};
    var r = { x: x, y: y, w: side, h: side };
    if (img) {
      var a = img.width / img.height;
      if (Math.abs(a - 1) > 0.08) r = containRect(img, x, y, side, side);
    }
    var rad = opts.round ? Math.min(r.w, r.h) / 2 : Math.round(side * 0.1);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    ctx.fillStyle = opts.ring || '#FFFFFF';
    var ring = opts.ringW == null ? 4 : opts.ringW;
    if (opts.round) { ctx.beginPath(); ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) / 2 + ring, 0, Math.PI * 2); ctx.fill(); }
    else { rr(ctx, r.x - ring, r.y - ring, r.w + ring * 2, r.h + ring * 2, rad + ring); ctx.fill(); }
    ctx.restore();
    ctx.save();
    if (opts.round) { ctx.beginPath(); ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) / 2, 0, Math.PI * 2); }
    else rr(ctx, r.x, r.y, r.w, r.h, rad);
    ctx.clip();
    if (img) {
      if (Math.abs(img.width / img.height - 1) > 0.08 && !opts.round) ctx.drawImage(img, r.x, r.y, r.w, r.h);
      else drawCover(ctx, img, r.x, r.y, r.w, r.h, 0.5, 0.35);
    } else {
      var g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
      g.addColorStop(0, '#262C5A'); g.addColorStop(1, '#151937');
      ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = font(700, side * 0.36, DISP); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(initials(opts.name), r.x + r.w / 2, r.y + r.h / 2 + 2);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
    return r;
  }
  function initials(name) {
    var p = str(name).replace(/^(dr\.?|prof\.?|shri\.?|smt\.?|mr\.?|ms\.?|mrs\.?|hon’ble|hon'ble|cmde)\s+/ig, '').split(' ').filter(Boolean);
    return ((p[0] || '?').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
  }

  // ------------------------------------------------------------------ brand parts
  // The logo on a white chip, the Hindi name in the tricolour on ink below it.
  function drawLockup(ctx, S, A, x, y) {
    var h = S.lockH, logo = A.logo;
    var lw = logo ? logo.width * (h / logo.height) : h * 2.4;
    var px = Math.round(h * 0.22), py = Math.round(h * 0.14);
    var w = Math.round(lw + px * 2), chipH = Math.round(h + py * 2);
    var hi = fitWords(ctx, EVENT.wordsHi, w - px * 1.2, 700, Math.round(h * 0.42), 12, MUKTA, 0.28);
    var band = Math.round(hi.size * 1.6), H = chipH + band;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.38)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6;
    ctx.fillStyle = C.ink; rr(ctx, x, y, w, H, 16); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#FFFFFF'; rr(ctx, x, y, w, chipH, [16, 16, 4, 4]); ctx.fill();
    if (logo) ctx.drawImage(logo, x + px, y + py, lw, h);
    ctx.font = font(700, hi.size, MUKTA);
    drawWords(ctx, EVENT.wordsHi, TRI, x + w / 2, y + chipH + band * 0.7, hi.gap, 'center');
    return { w: w, h: H };
  }

  function drawDatePill(ctx, S, yTop) {
    var k = S.k, t = 'MUMBAI  ·  ' + EVENT.when.toUpperCase();
    ctx.font = font(800, 19 * k, BODY);
    var tw = trackedW(ctx, t, 2.2 * k), h = Math.round(46 * k), w = tw + 36 * k, x = S.w - S.pad - w;
    ctx.fillStyle = 'rgba(10,12,27,0.72)'; rr(ctx, x, yTop, w, h, h / 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5; rr(ctx, x, yTop, w, h, h / 2); ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'middle';
    tracked(ctx, t, x + 18 * k, yTop + h / 2 + 1, 2.2 * k);
    ctx.textBaseline = 'alphabetic';
  }

  /* The sponsor and the partners on white across the foot of every card (the
   * organiser, 23 Nov 2026: sponsors judge the next booking by this). The same
   * names and order as src/data/partners.json. */
  function drawStripe(ctx, S, A, y, h) {
    var W = S.w, k = S.k, pad = S.pad;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = -4;
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, y, W, h);
    ctx.restore();
    // a thin tricolour edge on top: saffron, white (the stripe itself), green
    ctx.fillStyle = TRI[0]; ctx.fillRect(0, y, W / 3, 6 * k);
    ctx.fillStyle = TRI[2]; ctx.fillRect(W * 2 / 3, y, W / 3, 6 * k);

    var r1 = Math.round(64 * k), top = y + Math.round(20 * k);
    ctx.font = font(800, 18 * k, BODY);
    var cap = 'POWERED BY', capW = trackedW(ctx, cap, 3.2 * k);
    var idfc = A.idfc, iw = idfc ? idfc.width * (r1 / idfc.height) : 0;
    var gap = 20 * k, total = capW + (idfc ? gap + iw : 0), x0 = W / 2 - total / 2;
    ctx.fillStyle = '#5B6078'; ctx.textBaseline = 'middle';
    tracked(ctx, cap, x0, top + r1 / 2 + 1, 3.2 * k);
    ctx.textBaseline = 'alphabetic';
    if (idfc) { ctx.save(); rr(ctx, x0 + capW + gap, top, iw, r1, 6 * k); ctx.clip(); ctx.drawImage(idfc, x0 + capW + gap, top, iw, r1); ctx.restore(); }

    var dy = top + r1 + Math.round(12 * k);
    ctx.fillStyle = C.rule; ctx.fillRect(pad, dy, W - pad * 2, 2);
    var r2y = dy + Math.round(10 * k), r2h = y + h - r2y - Math.round(12 * k);
    var logos = (A.partners || []).filter(Boolean);
    if (!logos.length) return;
    var maxH = Math.min(r2h, 52 * k), maxW = 138 * k;
    var dims = logos.map(function (im) {
      var hh = maxH, ww = im.width * hh / im.height;
      if (ww > maxW) { ww = maxW; hh = im.height * ww / im.width; }
      return { im: im, w: ww, h: hh };
    });
    var sum = dims.reduce(function (a, d) { return a + d.w; }, 0);
    var avail = W - pad * 2, g = logos.length > 1 ? Math.min(44 * k, (avail - sum) / (logos.length - 1)) : 0;
    var scale = Math.min(1, avail / (sum + g * (logos.length - 1)));
    var lx = W / 2 - (sum + g * (logos.length - 1)) * scale / 2;
    for (var i = 0; i < dims.length; i++) {
      var d = dims[i], ww2 = d.w * scale, hh2 = d.h * scale;
      ctx.drawImage(d.im, lx, r2y + (r2h - hh2) / 2, ww2, hh2);
      lx += ww2 + g * scale;
    }
  }

  // "#BharatAIInnovation" and the address, on the ink just above the stripe.
  function drawFootLine(ctx, S, y) {
    var k = S.k;
    ctx.font = font(800, 23 * k, BODY); ctx.fillStyle = C.saffronLt; ctx.textAlign = 'left';
    ctx.fillText('#BharatAIInnovation', S.pad, y);
    ctx.font = font(600, 21 * k, BODY); ctx.fillStyle = C.mute; ctx.textAlign = 'right';
    ctx.fillText(EVENT.site, S.w - S.pad, y);
    ctx.textAlign = 'left';
  }

  function eyebrow(ctx, S, text, x, y, colour) {
    var k = S.k;
    ctx.fillStyle = colour || C.saffronLt;
    ctx.fillRect(x, y - 10 * k, 34 * k, 4 * k);
    ctx.font = font(800, 22 * k, BODY);
    tracked(ctx, text, x + 48 * k, y, 3.4 * k);
  }

  // The person who made the card, on its last line: photo, name, pass.
  function measureMe(S) { return Math.round(70 * S.k); }
  function drawMe(ctx, S, A, me, y, showPass) {
    var k = S.k, x = S.pad, side = Math.round(60 * k), maxW = S.w - S.pad * 2;
    if (A.me) { drawPortrait(ctx, A.me, x, y + (measureMe(S) - side) / 2, side, { round: true, ringW: 3, ring: passColour(me, showPass) }); x += side + 20 * k; }
    var P = showPass ? PASSES[me.pass] : null;
    var name = str(me.name) || 'Me';
    ctx.font = font(700, 27 * k, DISP); ctx.fillStyle = '#FFFFFF';
    var chipW = 0;
    if (P) { ctx.font = font(800, 15 * k, BODY); chipW = trackedW(ctx, P.label, 1.6 * k) + 26 * k; }
    ctx.font = font(700, 27 * k, DISP);
    var nameS = fitOne(ctx, name, S.w - S.pad - x - (chipW ? chipW + 16 * k : 0), 700, 27 * k, 18 * k, DISP);
    var ny = y + measureMe(S) / 2 - 4 * k;
    ctx.fillText(name, x, ny);
    var nw = ctx.measureText(name).width;
    if (P) {
      var cx = x + nw + 16 * k, ch = 30 * k, cy = ny - ch + 7 * k;
      var gr = ctx.createLinearGradient(cx, cy, cx + chipW, cy);
      gr.addColorStop(0, P.c1); gr.addColorStop(1, P.c2);
      ctx.fillStyle = gr; rr(ctx, cx, cy, chipW, ch, ch / 2); ctx.fill();
      if (P.edge) { ctx.strokeStyle = P.edge; ctx.lineWidth = 2; rr(ctx, cx, cy, chipW, ch, ch / 2); ctx.stroke(); }
      ctx.fillStyle = P.gold ? '#2A1F05' : '#FFFFFF'; ctx.font = font(800, 15 * k, BODY); ctx.textBaseline = 'middle';
      tracked(ctx, P.label, cx + 13 * k, cy + ch / 2 + 1, 1.6 * k);
      ctx.textBaseline = 'alphabetic';
    }
    var role = [str(me.title), str(me.company)].filter(Boolean).join(', ');
    if (role) {
      ctx.font = font(500, 21 * k, BODY); ctx.fillStyle = C.mute;
      ctx.fillText(wrap(ctx, role, S.w - S.pad - x, 1)[0], x, ny + 32 * k);
    }
    void nameS; void maxW;
  }
  function passColour(me, showPass) {
    var P = showPass ? PASSES[me.pass] : null;
    return P ? P.c1 : '#FFFFFF';
  }

  // "My takeaway" under the main block, in the person's own words.
  function measureTakeaway(ctx, S, text, w) {
    if (!str(text)) return null;
    var k = S.k;
    var fb = fitBlock(ctx, '“' + str(text) + '”', w - 8 * k, 600, 34 * k, 26 * k, DISP, 3);
    return { size: fb.size, lines: fb.lines, h: Math.round(30 * k + fb.lines.length * fb.size * 1.22) };
  }
  function drawTakeaway(ctx, S, m, label, x, y) {
    var k = S.k;
    ctx.fillStyle = C.saffronLt; ctx.font = font(800, 17 * k, BODY);
    tracked(ctx, label, x, y + 16 * k, 2.6 * k);
    ctx.fillStyle = '#FFFFFF'; ctx.font = font(600, m.size, DISP);
    drawLines(ctx, m.lines, x, y + 30 * k + m.size, m.size * 1.22);
  }

  // ------------------------------------------------------------------ the four cards
  function frame(ctx, S) {
    var g = ctx.createLinearGradient(0, 0, 0, S.h);
    g.addColorStop(0, C.ink2); g.addColorStop(1, C.ink);
    ctx.fillStyle = g; ctx.fillRect(0, 0, S.w, S.h);
  }
  // The bottom of every card, from the foot up. Returns the y above the foot line.
  function foot(ctx, S, A) {
    var stripeY = S.h - S.safeB - S.stripeH;
    if (S.safeB) { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, stripeY, S.w, S.h - stripeY); }
    drawStripe(ctx, S, A, stripeY, S.stripeH);
    var fy = stripeY - Math.round(30 * S.k);
    drawFootLine(ctx, S, fy);
    return fy - Math.round(48 * S.k);
  }

  function claimFor(me) {
    var p = me && me.pass;
    if (p === 'speaker') return { eyebrow: 'I SPOKE AT', verb: 'spoke' };
    if (p === 'exhibitor') return { eyebrow: 'WE EXHIBITED AT', verb: 'exhibited' };
    if (p === 'organiser' || p === 'staff') return { eyebrow: 'PROUD TO HAVE ORGANISED', verb: 'organised' };
    return { eyebrow: 'I ATTENDED', verb: 'attended' };
  }

  /* 1. "I attended": the event photo, the Hindi name big, and the person's
   * conference badge as they wore it, the pass colour across its foot. */
  function drawAttended(ctx, S, A, d) {
    var k = S.k, W = S.w, pad = S.pad, me = d.me || {};
    frame(ctx, S);
    var bottom = foot(ctx, S, A);
    var tk = measureTakeaway(ctx, S, d.takeaway, W - pad * 2);
    if (tk) { bottom -= tk.h; var tkY = bottom; bottom -= Math.round(34 * k); }

    var bh = Math.round((A.me ? 250 : 210) * k), badgeTop = bottom - bh;

    // the headline block above the badge
    var claim = claimFor(me);
    var hi = fitWords(ctx, EVENT.wordsHi, W - pad * 2, 700, 112 * k, 60, MUKTA, 0.26);
    var en = fitOne(ctx, 'Bharat AI Innovation 2026 · Mumbai', W - pad * 2, 700, 40 * k, 26, DISP);
    var headH = 22 * k + 26 * k + hi.size * 1.02 + 18 * k + en;
    var headTop = badgeTop - Math.round(40 * k) - headH;

    var bandEnd = Math.round(headTop + headH * 0.72);
    drawBand(ctx, S, d.photo, 0, bandEnd, headTop - 200 * k);
    var L = drawLockup(ctx, S, A, pad, S.safeT); void L;
    drawDatePill(ctx, S, S.safeT + 6 * k);

    var y = headTop + 22 * k;
    eyebrow(ctx, S, claim.eyebrow, pad, y);
    y += 26 * k + hi.size * 0.98;
    ctx.font = font(700, hi.size, MUKTA);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 24;
    drawWords(ctx, EVENT.wordsHi, TRI, pad - 4, y, hi.gap, 'left');
    ctx.restore();
    y += 18 * k + en;
    ctx.font = font(700, en, DISP); ctx.fillStyle = '#FFFFFF';
    ctx.fillText('Bharat AI Innovation 2026 · Mumbai', pad, y);

    drawBadge(ctx, S, A, me, d.showPass, pad, badgeTop, W - pad * 2, bh);
    if (tk) drawTakeaway(ctx, S, tk, 'MY BIGGEST TAKEAWAY', pad, tkY);
  }

  // The conference badge: photo, name, title, company, the pass across its foot.
  function drawBadge(ctx, S, A, me, showPass, x, y, w, h) {
    var k = S.k;
    var P = showPass ? PASSES[me.pass] : null;
    var footH = Math.round(54 * k);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14;
    ctx.fillStyle = '#FFFFFF'; rr(ctx, x, y, w, h, 24 * k); ctx.fill();
    ctx.restore();
    // the lanyard slot
    ctx.fillStyle = '#D9DCE6'; rr(ctx, x + w / 2 - 44 * k, y + 14 * k, 88 * k, 12 * k, 6 * k); ctx.fill();
    // the pass band
    ctx.save(); rr(ctx, x, y, w, h, 24 * k); ctx.clip();
    var g = ctx.createLinearGradient(x, 0, x + w, 0);
    if (P) { g.addColorStop(0, P.c1); g.addColorStop(1, P.c2); }
    else { g.addColorStop(0, '#FF7A00'); g.addColorStop(1, '#FF9933'); }
    ctx.fillStyle = g; ctx.fillRect(x, y + h - footH, w, footH);
    if (P && P.edge) { ctx.fillStyle = P.edge; ctx.fillRect(x, y + h - footH, w, 4 * k); }
    ctx.restore();
    var bandText = P ? P.label : 'BHARAT AI INNOVATION 2026';
    var bandHi = P ? P.hi : EVENT.wordsHi.join(' ');
    var ink = P && P.gold ? '#2A1F05' : '#FFFFFF';
    ctx.fillStyle = ink; ctx.textBaseline = 'middle';
    ctx.font = font(800, 21 * k, BODY);
    tracked(ctx, bandText, x + 30 * k, y + h - footH / 2 + 1, 4 * k);
    ctx.font = font(600, 24 * k, MUKTA); ctx.textAlign = 'right';
    ctx.fillText(bandHi, x + w - 30 * k, y + h - footH / 2 + 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    var bodyTop = y + 36 * k, bodyH = h - footH - 36 * k - 22 * k;
    var tx = x + 34 * k;
    if (A.me) {
      var side = Math.round(Math.min(bodyH, 168 * k));
      drawPortrait(ctx, A.me, tx, bodyTop + (bodyH - side) / 2, side, { ringW: 0, ring: '#FFFFFF' });
      tx += side + 30 * k;
    }
    var maxW = x + w - 30 * k - tx;
    var name = str(me.name) || 'Your name';
    var ns = fitBlock(ctx, name, maxW, 800, 50 * k, 30 * k, DISP, 2);
    var title = str(me.title), company = str(me.company);
    ctx.font = font(500, 24 * k, BODY);
    var tl = title ? wrap(ctx, title, maxW, 1) : [];
    ctx.font = font(700, 24 * k, BODY);
    var cl = company ? wrap(ctx, company, maxW, 1) : [];
    var blockH = ns.lines.length * ns.size * 1.05 + (tl.length ? 34 * k : 0) + (cl.length ? 34 * k : 0);
    var ty = bodyTop + (bodyH - blockH) / 2 + ns.size * 0.86;
    ctx.fillStyle = C.text; ctx.font = font(800, ns.size, DISP);
    drawLines(ctx, ns.lines, tx, ty, ns.size * 1.05);
    ty += (ns.lines.length - 1) * ns.size * 1.05;
    if (tl.length) { ty += 34 * k; ctx.font = font(500, 24 * k, BODY); ctx.fillStyle = C.textMute; ctx.fillText(tl[0], tx, ty); }
    if (cl.length) { ty += 34 * k; ctx.font = font(700, 24 * k, BODY); ctx.fillStyle = C.text; ctx.fillText(cl[0], tx, ty); }
  }

  /* 2. "Look who I met": their photo together as a print on the event photo,
   * or, without one, the two portraits side by side; the names below. */
  function drawMet(ctx, S, A, d) {
    var k = S.k, W = S.w, pad = S.pad, me = d.me || {};
    var people = (d.people || []).filter(function (p) { return p && str(p.name); }).slice(0, 3);
    // the whole card is the event photo, darkened, so the screen still reads
    frame(ctx, S);
    var stripeTop = S.h - S.safeB - S.stripeH;
    drawBand(ctx, S, d.backdrop, 0, stripeTop, stripeTop * 0.25);
    ctx.fillStyle = 'rgba(10,12,27,0.40)'; ctx.fillRect(0, 0, W, stripeTop);
    // the headline sits on the busiest part of the stage screen: a darker band there
    var hg = ctx.createLinearGradient(0, S.safeT + 100 * k, 0, S.safeT + 420 * k);
    hg.addColorStop(0, 'rgba(10,12,27,0)'); hg.addColorStop(0.35, 'rgba(10,12,27,0.72)');
    hg.addColorStop(0.75, 'rgba(10,12,27,0.72)'); hg.addColorStop(1, 'rgba(10,12,27,0.2)');
    ctx.fillStyle = hg; ctx.fillRect(0, S.safeT + 100 * k, W, 320 * k);
    var bottom = foot(ctx, S, A);

    var meH = measureMe(S); bottom -= meH; var meY = bottom; bottom -= Math.round(26 * k);
    var tk = measureTakeaway(ctx, S, d.takeaway, W - pad * 2);
    if (tk) { bottom -= tk.h; var tkY = bottom; bottom -= Math.round(30 * k); }
    // the people block
    var rows = people.map(function (p) {
      ctx.font = font(800, 40 * k, DISP);
      var ns = fitOne(ctx, str(p.name), W - pad * 2, 800, 40 * k, 26 * k, DISP);
      ctx.font = font(500, 23 * k, BODY);
      var role = [str(p.title), str(p.company)].filter(Boolean).join(', ');
      return { name: str(p.name), size: ns, role: role ? wrap(ctx, role, W - pad * 2, people.length > 1 ? 1 : 2) : [] };
    });
    var ph = rows.reduce(function (a, r) { return a + r.size + 10 * k + r.role.length * 30 * k + 18 * k; }, 0);
    bottom -= ph; var pY = bottom; bottom -= Math.round(26 * k);

    var L = drawLockup(ctx, S, A, pad, S.safeT);
    drawDatePill(ctx, S, S.safeT + 6 * k);
    var y = S.safeT + L.h + 56 * k;
    eyebrow(ctx, S, 'LOOK WHO I MET AT', pad, y);
    y += 22 * k;
    var en = fitWords(ctx, ['Bharat', 'AI', 'Innovation', '2026'], W - pad * 2, 800, 64 * k, 34, DISP, 0.24);
    y += en.size;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 26;
    drawWords(ctx, ['Bharat', 'AI', 'Innovation', '2026'], ['#FFFFFF', '#FFFFFF', '#FFFFFF', C.saffronLt], pad, y, en.gap, 'left');
    ctx.restore();
    var regionTop = y + 40 * k, regionBot = bottom;

    if (d.photo && d.photo.img) {
      drawPrint(ctx, S, d.photo.img, W / 2, regionTop, W - pad * 2, regionBot - regionTop, -2.2);
    } else {
      var faces = [];
      if (A.me) faces.push({ img: A.me, name: me.name, cap: 'Me' });
      people.forEach(function (p, i) { faces.push({ img: A.people[i], name: p.name, cap: firstName(p.name) }); });
      drawPortraitPrints(ctx, S, faces.slice(0, 3), regionTop, regionBot);
    }

    var yy = pY;
    rows.forEach(function (r) {
      yy += r.size;
      ctx.font = font(800, r.size, DISP); ctx.fillStyle = '#FFFFFF';
      ctx.fillText(r.name, pad, yy);
      ctx.font = font(500, 23 * k, BODY); ctx.fillStyle = C.mute;
      r.role.forEach(function (l) { yy += 30 * k; ctx.fillText(l, pad, yy); });
      yy += 10 * k + 18 * k;
    });
    if (tk) drawTakeaway(ctx, S, tk, 'WE TALKED ABOUT', pad, tkY);
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(pad, meY - 12 * k, W - pad * 2, 2);
    drawMe(ctx, S, A, me, meY, d.showPass);
  }
  function firstName(n) {
    var p = str(n).replace(/^(dr\.?|prof\.?|shri\.?|smt\.?|mr\.?|ms\.?|mrs\.?|hon’ble|hon'ble|cmde)\s+/ig, '').split(' ');
    return p[0] || str(n);
  }
  // A print with a white border, its own shape, turned a little.
  function drawPrint(ctx, S, img, cx, top, maxW, maxH, deg) {
    var k = S.k, f = 18 * k, fb = 18 * k;
    var room = { w: maxW * 0.92 - f * 2, h: maxH - f - fb - 24 * k };
    if (room.h < 80) return;
    var s = Math.min(room.w / img.width, room.h / img.height);
    var pw = img.width * s, ph = img.height * s;
    var fw = pw + f * 2, fh = ph + f + fb;
    var cy = top + maxH / 2;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(deg * Math.PI / 180);
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18;
    ctx.fillStyle = '#FFFFFF'; rr(ctx, -fw / 2, -fh / 2, fw, fh, 8 * k); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.drawImage(img, -fw / 2 + f, -fh / 2 + f, pw, ph);
    ctx.restore();
  }
  // Up to three square prints in a row, each with a first name under it.
  function drawPortraitPrints(ctx, S, faces, top, bot) {
    var k = S.k, W = S.w, n = faces.length;
    if (!n) return;
    var gap = 34 * k, capH = 56 * k;
    var side = Math.min((W - S.pad * 2 - gap * (n - 1)) / n - 28 * k, bot - top - capH - 40 * k, 380 * k);
    if (side < 60) return;
    var total = n * (side + 28 * k) + gap * (n - 1), x = W / 2 - total / 2;
    var tilt = n === 1 ? [0] : n === 2 ? [-3.5, 3] : [-4, 2, -2.5];
    for (var i = 0; i < n; i++) {
      var fw = side + 28 * k, fh = side + 14 * k + capH, cx = x + fw / 2, cy = top + (bot - top) / 2;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(tilt[i] * Math.PI / 180);
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14;
      ctx.fillStyle = '#FFFFFF'; rr(ctx, -fw / 2, -fh / 2, fw, fh, 8 * k); ctx.fill();
      ctx.shadowColor = 'transparent';
      drawPortrait(ctx, faces[i].img, -side / 2, -fh / 2 + 14 * k, side, { ringW: 0, name: faces[i].name });
      ctx.fillStyle = C.text; ctx.font = font(700, 26 * k, DISP); ctx.textAlign = 'center';
      var cap = faces[i].cap || firstName(faces[i].name);
      ctx.fillText(wrap(ctx, cap, side, 1)[0], 0, fh / 2 - capH / 2 + 9 * k);
      ctx.textAlign = 'left';
      ctx.restore();
      x += fw + gap;
    }
    if (n === 2) {
      ctx.fillStyle = C.saffron; ctx.beginPath(); ctx.arc(W / 2, top + (bot - top) / 2, 34 * k, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#FFFFFF'; ctx.font = font(800, 40 * k, DISP); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('+', W / 2, top + (bot - top) / 2 + 2 * k);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
  }

  /* 3. A talk: a session ticket, the topic and the speaker on the paper, the day,
   * time and hall on the stub. */
  function drawTalk(ctx, S, A, d) {
    var k = S.k, W = S.w, pad = S.pad, me = d.me || {}, t = d.talk || {};
    frame(ctx, S);
    var bottom = foot(ctx, S, A);
    var meH = measureMe(S); bottom -= meH; var meY = bottom; bottom -= Math.round(30 * k);
    var tk = measureTakeaway(ctx, S, d.takeaway, W - pad * 2);
    if (tk) { bottom -= tk.h; var tkY = bottom; bottom -= Math.round(32 * k); }

    var stubW = Math.round(206 * k), tw = W - pad * 2, mainW = tw - stubW, inX = pad + 40 * k, inW = mainW - 74 * k;
    var speakers = (t.speakers || []).slice(0, 2);
    var spSide = Math.round((speakers.length > 1 ? 104 : 136) * k);
    var spBlock = speakers.length ? speakers.length * spSide + (speakers.length - 1) * 22 * k : 0;
    var budget = bottom - (S.safeT + 330 * k) - (40 * k + 30 * k + 34 * k + spBlock + 44 * k);
    // A talk the programme lists without a topic shows what it was, unquoted.
    var topic = str(t.topic) ? '“' + str(t.topic) + '”' : (str(t.fallback) || 'An Innovation Talk');
    var maxTopicLines = Math.max(2, Math.min(5, Math.floor(budget / (40 * k * 1.12))));
    var tb = fitBlock(ctx, topic, inW, 800, 50 * k, 30 * k, DISP, maxTopicLines);
    var th = 46 * k + 32 * k + tb.lines.length * tb.size * 1.1 + 34 * k + spBlock + 46 * k;
    var tTop = bottom - th;

    drawBand(ctx, S, d.photo, 0, tTop + 90 * k, tTop - 220 * k);
    drawLockup(ctx, S, A, pad, S.safeT);
    drawDatePill(ctx, S, S.safeT + 6 * k);

    // the ticket
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 44; ctx.shadowOffsetY = 16;
    ctx.fillStyle = C.cream; rr(ctx, pad, tTop, tw, th, 24 * k); ctx.fill();
    ctx.restore();
    ctx.save(); rr(ctx, pad, tTop, tw, th, 24 * k); ctx.clip();
    var sg = ctx.createLinearGradient(0, tTop, 0, tTop + th);
    sg.addColorStop(0, '#FF7A00'); sg.addColorStop(1, '#E85D00');
    ctx.fillStyle = sg; ctx.fillRect(pad + mainW, tTop, stubW, th);
    ctx.restore();
    // the tear line and its two notches
    var px = pad + mainW;
    ctx.strokeStyle = 'rgba(16,19,31,0.35)'; ctx.lineWidth = 3; ctx.setLineDash([10 * k, 9 * k]);
    ctx.beginPath(); ctx.moveTo(px, tTop + 26 * k); ctx.lineTo(px, tTop + th - 26 * k); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.arc(px, tTop, 17 * k, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px, tTop + th, 17 * k, 0, Math.PI * 2); ctx.fill();

    var y = tTop + 46 * k;
    ctx.fillStyle = C.saffron; ctx.font = font(800, 19 * k, BODY);
    tracked(ctx, 'I ATTENDED ' + (t.kindWords || 'AN INNOVATION TALK').toUpperCase(), inX, y, 3 * k);
    y += 32 * k + tb.size * 0.92;
    ctx.fillStyle = C.text; ctx.font = font(800, tb.size, DISP);
    drawLines(ctx, tb.lines, inX, y, tb.size * 1.1);
    y += (tb.lines.length - 1) * tb.size * 1.1 + 30 * k;
    ctx.fillStyle = 'rgba(16,19,31,0.12)'; ctx.fillRect(inX, y, inW, 2);
    y += 26 * k;
    speakers.forEach(function (sp, i) {
      var r = drawPortrait(ctx, A.speakers[i], inX, y, spSide, { ringW: 0, name: sp.name });
      var sx = inX + spSide + 26 * k, sw = inX + inW - sx;
      var ns = fitOne(ctx, str(sp.name), sw, 800, 32 * k, 22 * k, DISP);
      var ly = y + (spSide - (ns + 30 * k * 2)) / 2 + ns;
      ctx.fillStyle = C.text; ctx.font = font(800, ns, DISP); ctx.fillText(str(sp.name), sx, ly);
      ctx.font = font(500, 21 * k, BODY); ctx.fillStyle = C.textMute;
      if (str(sp.title)) { ly += 30 * k; ctx.fillText(wrap(ctx, str(sp.title), sw, 1)[0], sx, ly); }
      ctx.font = font(700, 21 * k, BODY); ctx.fillStyle = C.text;
      if (str(sp.company)) { ly += 30 * k; ctx.fillText(wrap(ctx, str(sp.company), sw, 1)[0], sx, ly); }
      y += Math.max(spSide, r.h) + 22 * k;
    });

    // the stub
    var cx = pad + mainW + stubW / 2, sy = tTop + 56 * k;
    function stubItem(label, value, lines) {
      ctx.fillStyle = 'rgba(255,255,255,0.78)'; ctx.font = font(800, 15 * k, BODY);
      tracked(ctx, label, cx, sy, 2.6 * k, 'center');
      sy += 34 * k;
      ctx.fillStyle = '#FFFFFF'; ctx.font = font(800, 27 * k, DISP);
      var ls = wrap(ctx, value, stubW - 30 * k, lines || 1);
      drawLines(ctx, ls, cx, sy, 31 * k, 'center');
      sy += (ls.length - 1) * 31 * k + 46 * k;
    }
    if (t.day) stubItem('DAY', t.day);
    if (t.time) stubItem('TIME', t.time);
    if (t.hall) stubItem('HALL', t.hall.replace(/\s+(Hall|Theatre)$/i, ''), 2);
    ctx.fillStyle = '#FFFFFF'; ctx.font = font(800, 16 * k, BODY);
    tracked(ctx, 'ATTENDED', cx, tTop + th - 34 * k, 3 * k, 'center');

    if (tk) drawTakeaway(ctx, S, tk, 'WHAT I LEARNED', pad, tkY);
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(pad, meY - 12 * k, W - pad * 2, 2);
    drawMe(ctx, S, A, me, meY, d.showPass);
  }

  /* 4. A panel: the panel's own photo, the topic, and every panellist with their
   * designation and company; the moderator marked. */
  function drawPanel(ctx, S, A, d) {
    var k = S.k, W = S.w, pad = S.pad, me = d.me || {}, p = d.panel || {};
    frame(ctx, S);
    var bottom = foot(ctx, S, A);
    var meH = measureMe(S); bottom -= meH; var meY = bottom; bottom -= Math.round(30 * k);
    var tk = measureTakeaway(ctx, S, d.takeaway, W - pad * 2);
    if (tk) { bottom -= tk.h; var tkY = bottom; bottom -= Math.round(32 * k); }

    var people = (p.people || []).slice(0, 10), n = people.length;
    var gap = 18 * k, rowGap = 20 * k;
    var meta = [p.day, p.time, p.hall].filter(Boolean).join('  ·  ');
    /* Every panellist stays on the card (they are the ones who reshare it). The
     * layout is searched, not fixed: one, two or three rows; photo sizes; two,
     * one or no lines for the designation; a three- or two-line topic. The
     * biggest faces that still leave the panel's own photo its band under the
     * logo win, a designation line counting for something. Text heights are
     * measured on the real names, not reserved. */
    var minHeadTop = S.safeT + (S.key === 'story' ? (n <= 6 ? 420 : 290) : n <= 6 ? 330 : 270) * k;
    var topicText = str(p.topic) || 'Panel discussion';
    var tbs = [fitBlock(ctx, topicText, W - pad * 2, 800, 52 * k, 30 * k, DISP, 3), fitBlock(ctx, topicText, W - pad * 2, 800, 44 * k, 28 * k, DISP, 2)];
    function tileText(cols, rl) {
      var tileW = (W - pad * 2 - gap * (cols - 1)) / cols;
      var nameS = clamp(tileW * 0.125, 18 * k, 26 * k), roleS = clamp(tileW * 0.088, 14 * k, 19 * k);
      var maxNL = 1, maxTL = 0, maxCL = 0;
      people.forEach(function (pp) {
        ctx.font = font(800, nameS, DISP); maxNL = Math.max(maxNL, wrap(ctx, str(pp.name), tileW - 6 * k, 2).length);
        ctx.font = font(500, roleS, BODY); if (rl && str(pp.title)) maxTL = Math.max(maxTL, wrap(ctx, str(pp.title), tileW - 6 * k, rl).length);
        if (str(pp.company)) maxCL = 1;
      });
      return { tileW: tileW, nameS: nameS, roleS: roleS, h: maxNL * nameS * 1.12 + (maxTL + maxCL) * roleS * 1.25 + 18 * k };
    }
    var L = null;
    for (var rows0 = 1; rows0 <= 3; rows0++) {
      var cols0 = Math.ceil(n / rows0);
      if (!n || (n > 1 && rows0 > 1 && Math.ceil(n / (rows0 - 1)) === cols0)) continue;
      var r0 = Math.ceil(n / cols0);
      for (var rl = 2; rl >= 0; rl--) {
        var tt = tileText(cols0, rl);
        if (tt.tileW < 118 * k) continue;
        var maxSide = Math.min(tt.tileW - 12 * k, (S.key === 'story' ? 230 : 170) * k);
        for (var ti = 0; ti < tbs.length; ti++) {
          var headH0 = 22 * k + 30 * k + tbs[ti].lines.length * tbs[ti].size * 1.08 + (meta ? 40 * k : 0);
          var room = bottom - 44 * k - headH0 - minHeadTop;
          var sd = Math.floor(Math.min(maxSide, (room - (r0 - 1) * rowGap) / r0 - 14 * k - tt.h));
          if (sd < 70 * k) continue;
          var score = sd * (rl === 2 ? 1 : rl === 1 ? 0.93 : 0.8) * (ti === 0 ? 1 : 0.96);
          if (!L || score > L.score) L = { score: score, cols: cols0, rows: r0, side: sd, roleLines: rl, tt: tt, tb: tbs[ti], headH: headH0 };
        }
      }
    }
    if (!L) {
      var cF = Math.min(5, Math.max(1, n)), tF = tileText(cF, 0), sF = Math.round(70 * k), rF = Math.ceil(n / cF);
      L = { cols: cF, rows: rF, side: sF, roleLines: 0, tt: tF, tb: tbs[1] };
      L.headH = 22 * k + 30 * k + L.tb.lines.length * L.tb.size * 1.08 + (meta ? 40 * k : 0);
    }
    var cols = L.cols, side = L.side, tb = L.tb, headH = L.headH;
    var tileW = L.tt.tileW, nameS = L.tt.nameS, roleS = L.tt.roleS;
    var tileH = side + 14 * k + L.tt.h;
    var gridTop = bottom - (L.rows * tileH + (L.rows - 1) * rowGap);
    var headTop = gridTop - 44 * k - headH;

    drawBand(ctx, S, d.photo, 0, Math.round(headTop + headH * 0.5), headTop - 230 * k);
    drawLockup(ctx, S, A, pad, S.safeT);
    drawDatePill(ctx, S, S.safeT + 6 * k);

    var y = headTop + 22 * k;
    eyebrow(ctx, S, 'I ATTENDED A PANEL DISCUSSION', pad, y);
    y += 30 * k + tb.size * 0.9;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 22;
    ctx.fillStyle = '#FFFFFF'; ctx.font = font(800, tb.size, DISP);
    drawLines(ctx, tb.lines, pad, y, tb.size * 1.08);
    ctx.restore();
    y += (tb.lines.length - 1) * tb.size * 1.08;
    if (meta) { y += 40 * k; ctx.font = font(700, 21 * k, BODY); ctx.fillStyle = C.mute; ctx.fillText(meta, pad, y); }

    for (var i = 0; i < n; i++) {
      var r = Math.floor(i / cols), c = i % cols;
      var inRow = Math.min(cols, n - r * cols);
      var rowW = inRow * tileW + (inRow - 1) * gap, rx = W / 2 - rowW / 2;
      var tx = rx + c * (tileW + gap), ty = gridTop + r * (tileH + rowGap);
      var pp = people[i];
      var pr = drawPortrait(ctx, A.panel[i], tx + (tileW - side) / 2, ty, side, { ringW: 3, ring: pp.moderator ? C.saffron : '#FFFFFF', name: pp.name });
      if (pp.moderator) {
        ctx.font = font(800, 13 * k, BODY);
        var mw = trackedW(ctx, 'MODERATOR', 1.6 * k) + 18 * k, mh = 26 * k, mx = tx + tileW / 2 - mw / 2, my = pr.y + pr.h - mh / 2;
        ctx.fillStyle = C.saffron; rr(ctx, mx, my, mw, mh, mh / 2); ctx.fill();
        ctx.fillStyle = '#FFFFFF'; ctx.textBaseline = 'middle';
        tracked(ctx, 'MODERATOR', mx + 9 * k, my + mh / 2 + 1, 1.6 * k);
        ctx.textBaseline = 'alphabetic';
      }
      var cy2 = ty + side + 14 * k + (pp.moderator ? 10 * k : 0) + nameS;
      var cx2 = tx + tileW / 2;
      ctx.fillStyle = '#FFFFFF'; ctx.font = font(800, nameS, DISP);
      var nl = wrap(ctx, str(pp.name), tileW - 6 * k, 2);
      drawLines(ctx, nl, cx2, cy2, nameS * 1.12, 'center');
      cy2 += (nl.length - 1) * nameS * 1.12 + roleS * 1.4;
      ctx.font = font(500, roleS, BODY); ctx.fillStyle = C.mute;
      var tl = str(pp.title) && L.roleLines ? wrap(ctx, str(pp.title), tileW - 6 * k, L.roleLines) : [];
      drawLines(ctx, tl, cx2, cy2, roleS * 1.25, 'center');
      cy2 += tl.length * roleS * 1.25;
      ctx.font = font(700, roleS, BODY); ctx.fillStyle = '#FFC285';
      var cl = str(pp.company) ? wrap(ctx, str(pp.company), tileW - 6 * k, 1) : [];
      drawLines(ctx, cl, cx2, cy2, roleS * 1.25, 'center');
    }

    if (tk) drawTakeaway(ctx, S, tk, 'WHAT I LEARNED', pad, tkY);
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(pad, meY - 12 * k, W - pad * 2, 2);
    drawMe(ctx, S, A, me, meY, d.showPass);
  }

  var DRAW = { attended: drawAttended, met: drawMet, talk: drawTalk, panel: drawPanel };

  /* render(kind, data, opts) -> { canvas, filename, width, height }
   * data.me      { name, title, company, photo (url or Image), pass (key of PASSES) }
   * data.showPass  print the pass (it comes from the record, never from the page)
   * data.photo   { img or src, fx, fy, own }   the top photo; for met, their photo together
   * data.backdrop  (met) the event photo behind the print
   * data.people  (met) [{ name, title, company, photo }]
   * data.talk    { kindWords, topic, speakers: [{ name, title, company, photo }], day, time, hall }
   * data.panel   { topic, people: [{ name, title, company, photo, moderator }], day, time, hall }
   * data.takeaway  one line in their own words */
  async function render(kind, data, opts) {
    opts = opts || {};
    var S = SIZES[opts.size] || SIZES.post;
    data = data || {};
    await ensureFonts();
    var me = data.me || {};
    async function photoOf(ph) {
      if (!ph) return null;
      var img = await loadImage(ph.img || ph.src);
      return img ? { img: img, fx: ph.fx, fy: ph.fy, own: !!ph.own } : null;
    }
    var partnersP = (opts.partnerLogos || PARTNER_LOGOS).map(loadImage);
    var A = {
      logo: await loadImage('/images/Bharat%20AI%20Innovation%20Logo.png'),
      idfc: await loadImage('/images/logo-idfc-first-bank.webp'),
      partners: await Promise.all(partnersP),
      me: await loadImage(me.photo),
      people: await Promise.all((data.people || []).slice(0, 3).map(function (p) { return loadImage(p && p.photo); })),
      speakers: await Promise.all(((data.talk && data.talk.speakers) || []).slice(0, 2).map(function (p) { return loadImage(p && p.photo); })),
      panel: await Promise.all(((data.panel && data.panel.people) || []).slice(0, 10).map(function (p) { return loadImage(p && p.photo); }))
    };
    var d = {
      me: me, showPass: !!data.showPass && !!PASSES[me.pass], takeaway: str(data.takeaway).slice(0, 160),
      photo: await photoOf(data.photo), backdrop: await photoOf(data.backdrop),
      people: data.people || [], talk: data.talk || {}, panel: data.panel || {}
    };
    var canvas = opts.canvas || document.createElement('canvas');
    canvas.width = S.w; canvas.height = S.h;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, S.w, S.h);
    (DRAW[kind] || drawAttended)(ctx, S, A, d);
    var who = str(me.name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'me';
    return { canvas: canvas, width: S.w, height: S.h, size: S.key,
      filename: 'BharatAI2026-' + kind + '-' + who + '-' + S.key + '.png' };
  }

  // Same names, files and order as src/data/partners.json (the home page strip).
  var PARTNER_LOGOS = [
    '/images/org-logos/aegis-superintelligence-lab.webp',
    '/images/exhibitors/assessfy.webp',
    '/images/logo-aegis.webp',
    '/images/exhibitors/jade-global.webp',
    '/images/org-logos/pramaana-labs.webp',
    '/images/org-logos/decimal-point-analytics.webp',
    '/images/org-logos/exeni.webp'
  ];

  // ------------------------------------------------------------------ the words
  /* One caption per platform. LinkedIn and Facebook: the full post with the link;
   * Instagram: no link (it would not be clickable), more hashtags; X: 280
   * characters, a link counting 23; WhatsApp: short, with the link. People are
   * written "@Name" on LinkedIn and Facebook to show where to tag them. */
  function link(kind, platform) {
    return 'https://' + EVENT.site + '/delhi?utm_source=' + platform + '&utm_medium=share_card&utm_campaign=mumbai26-' + kind;
  }
  function personLine(p, at) {
    var n = (at ? '@' : '') + str(p.name);
    var t = str(p.title), c = str(p.company);
    return n + (t && c ? ', ' + t + ', ' + c : t ? ', ' + t : c ? ', ' + c : '');
  }
  function personShort(p, at) {
    var n = (at ? '@' : '') + str(p.name), t = str(p.title), c = str(p.company);
    return n + (t && c ? ', ' + t + ' at ' + c : t ? ', ' + t : c ? ' of ' + c : '');
  }
  function listNames(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }
  function asPass(me, showPass) {
    var P = showPass ? PASSES[me && me.pass] : null;
    if (!P || !P.paid) return '';
    return P.words === 'VIP' ? ' as a VIP guest' : ' as ' + (/^[AEIOU]/.test(P.words) ? 'an ' : 'a ') + P.words;
  }
  var TAGS = {
    attended: ['#BharatAIInnovation', '#AgenticAI', '#ArtificialIntelligence', '#AI', '#Mumbai'],
    met: ['#BharatAIInnovation', '#Networking', '#AgenticAI', '#AI'],
    talk: ['#BharatAIInnovation', '#InnovationTalk', '#AgenticAI', '#AI'],
    panel: ['#BharatAIInnovation', '#PanelDiscussion', '#AgenticAI', '#AI']
  };
  var IG_EXTRA = ['#AIIndia', '#WTCMumbai', '#TechConference', '#GenAI', '#Innovation', '#India'];

  function body(kind, d, platform) {
    var at = platform === 'linkedin' || platform === 'facebook';
    var me = d.me || {}, tk = str(d.takeaway), out = [];
    var handle = HANDLES[platform] || 'Bharat AI Innovation';
    if (kind === 'attended') {
      var v = claimFor(me).verb;
      if (v === 'spoke') out.push('I spoke at Bharat AI Innovation 2026 at ' + EVENT.whereLong + ', on ' + EVENT.whenLong + '.');
      else if (v === 'exhibited') out.push('We exhibited at Bharat AI Innovation 2026 at ' + EVENT.whereLong + ', on ' + EVENT.whenLong + '.');
      else if (v === 'organised') out.push('Proud to have been part of the team behind Bharat AI Innovation 2026 at ' + EVENT.whereLong + ', on ' + EVENT.whenLong + '.');
      else out.push('I attended Bharat AI Innovation 2026 at ' + EVENT.whereLong + ', on ' + EVENT.whenLong + (asPass(me, d.showPass) ? ',' + asPass(me, d.showPass) : '') + '.');
      if (tk) out.push('', 'My biggest takeaway: ' + tk);
      out.push('', 'Two days of talks, panels and live demos on AI and Agentic AI, with the people building it in India.' +
        (v === 'spoke' ? ' Thank you to everyone who came to listen and stayed to talk.' : v === 'exhibited' ? ' Thank you to everyone who came to our booth.' : ' Thank you, ' + handle + ', and everyone I met there.'));
    } else if (kind === 'met') {
      var ps = (d.people || []).filter(function (p) { return str(p.name); });
      out.push('Look who I met at Bharat AI Innovation 2026!', '');
      if (ps.length === 1) out.push('It was great to meet ' + personShort(ps[0], at) + '.');
      else if (ps.length) out.push('It was great to meet ' + listNames(ps.map(function (p) { return personShort(p, at); })) + '.');
      if (tk) out.push('We talked about ' + tk.replace(/[.!]+$/, '') + '.');
      out.push('', 'This is why I go to events like this: the people building AI in India, in one room. Thank you, ' + handle + '.');
    } else if (kind === 'talk') {
      var t = d.talk || {}, sp = (t.speakers || []).filter(function (s) { return str(s.name); });
      var what = (t.kindWords || 'the Innovation Talk').replace(/^an? /i, 'the ');
      var by = sp.length ? ' by ' + listNames(sp.map(function (s) { return personLine(s, at); })) : '';
      out.push('I attended ' + what + (str(t.topic) ? ' "' + str(t.topic) + '"' : '') + by + ', at Bharat AI Innovation 2026, ' + EVENT.whereLong + '.');
      if (tk) out.push('', 'What I learned: ' + tk);
      out.push('', 'Thank you' + (sp.length ? ', ' + listNames(sp.map(function (s) { return str(s.name); })) : '') + ', for a talk worth the trip. And thank you, ' + handle + '.');
    } else if (kind === 'panel') {
      var p = d.panel || {}, people = p.people || [];
      var pan = people.filter(function (x) { return !x.moderator; }), mod = people.filter(function (x) { return x.moderator; });
      out.push('I attended the panel discussion "' + (str(p.topic) || 'Panel discussion') + '" at Bharat AI Innovation 2026, ' + EVENT.whereLong + ', and learned a lot.');
      if (pan.length) { out.push('', 'On the panel:'); pan.forEach(function (x) { out.push('• ' + personLine(x, at)); }); }
      if (mod.length) out.push('Moderated by ' + listNames(mod.map(function (x) { return personLine(x, at); })));
      if (tk) out.push('', 'What I learned: ' + tk);
      out.push('', 'Thank you to the panel, and to ' + handle + '.');
    }
    return out;
  }

  function captionFor(kind, d, platform) {
    var tags = TAGS[kind] || TAGS.attended;
    if (platform === 'x') return xCaption(kind, d);
    var lines = body(kind, d, platform);
    if (platform === 'instagram') {
      lines.push('', 'Next edition: ' + EVENT.next + '. Details: ' + EVENT.site + '/delhi', '', POWERED,
        tags.concat(IG_EXTRA).join(' '));
    } else if (platform === 'whatsapp') {
      lines.push('', 'Next edition: ' + EVENT.next + '.', link(kind, 'whatsapp'), '', '#BharatAIInnovation');
    } else {
      lines.push('', 'Next edition: ' + EVENT.next + '.', link(kind, platform), '', POWERED, tags.join(' '));
    }
    return lines.join('\n');
  }

  // X counts a link as 23 characters whatever its length.
  function xLen(s) { return s.replace(/https?:\/\/\S+/g, new Array(24).join('x')).length; }
  function xCaption(kind, d) {
    var url = link(kind, 'x'), h = HANDLES.x ? ' ' + HANDLES.x : '', tk = str(d.takeaway);
    var me = d.me || {};
    function build(main, extra) {
      return [main + (extra ? ' ' + extra : ''), 'Next: New Delhi, 28–29 July 2027' + h, url, '#AgenticAI'].join('\n');
    }
    /* Fit in 280: the event's own words go first (the person's takeaway is the
     * part worth keeping), then the takeaway is shortened, never the link. */
    function cut(t) { return t.slice(0, -4).replace(/\s+\S*$/, '').replace(/[\s,;:.–-]+$/, '') + '…'; }
    function fit(head, flex, tail, dropFlex) {
      function make(f, t) { return build(head.replace('{F}', f).replace(/…\./g, '…').replace(/: \./, '.'), t); }
      var f = flex, t = tail, s = make(f, t);
      if (xLen(s) > 280 && dropFlex && t) { f = ''; s = make(f, t); }
      while (xLen(s) > 280 && t.length > 30) { t = cut(t); s = make(f, t); }
      while (xLen(s) > 280 && f.length > 12) { f = cut(f); s = make(f, t); }
      if (xLen(s) > 280) s = make(f, '');
      return s;
    }
    var tail = tk ? 'Takeaway: ' + tk : '';
    if (kind === 'attended') {
      var v = claimFor(me).verb;
      var lead = v === 'spoke' ? 'I spoke at' : v === 'exhibited' ? 'We exhibited at' : v === 'organised' ? 'Proud to have organised' : 'I attended';
      return fit(lead + ' #BharatAIInnovation 2026 at WTC Mumbai: {F}.', 'two days of AI and Agentic AI talks, panels and demos', tail, true);
    }
    if (kind === 'met') {
      var ps = (d.people || []).filter(function (p) { return str(p.name); });
      var who = listNames(ps.map(function (p) { return str(p.name) + (str(p.company) ? ' (' + str(p.company) + ')' : ''); }));
      return fit('Look who I met at #BharatAIInnovation 2026, Mumbai: {F}.', who || 'great people building AI in India', tk ? 'We talked about ' + tk.replace(/[.!]+$/, '') + '.' : '');
    }
    if (kind === 'talk') {
      var t = d.talk || {}, sp = (t.speakers || [])[0];
      var by = sp ? ' by ' + str(sp.name) + (str(sp.company) ? ' (' + str(sp.company) + ')' : '') : '';
      return fit('Attended "{F}"' + by + ' at #BharatAIInnovation 2026, Mumbai.', str(t.topic) || 'an Innovation Talk', tail);
    }
    var p = d.panel || {};
    var names = (p.people || []).filter(function (x) { return !x.moderator; }).slice(0, 3).map(function (x) { return str(x.name); });
    return fit('Attended the panel "{F}" at #BharatAIInnovation 2026, Mumbai' + (names.length ? ', with ' + names.join(', ') + ' and more' : '') + '.', str(p.topic) || 'Panel discussion', tail);
  }

  function captions(kind, d) {
    d = d || {};
    return {
      linkedin: captionFor(kind, d, 'linkedin'),
      instagram: captionFor(kind, d, 'instagram'),
      facebook: captionFor(kind, d, 'facebook'),
      x: captionFor(kind, d, 'x'),
      whatsapp: captionFor(kind, d, 'whatsapp')
    };
  }

  global.BhaiMomentCard = {
    EVENT: EVENT, HANDLES: HANDLES, PASSES: PASSES, SIZES: SIZES,
    BACKDROPS: BACKDROPS, PANEL_PHOTOS: PANEL_PHOTOS, PARTNER_LOGOS: PARTNER_LOGOS,
    passKey: passKey, claimFor: claimFor, render: render, captions: captions, xLength: xLen,
    link: link, loadImage: loadImage
  };
})(window);
