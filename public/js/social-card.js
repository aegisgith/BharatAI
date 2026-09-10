/* Bharat AI Innovation 2026 — shareable social card renderer.
 *
 * Sibling of /js/pass-render.js, and deliberately NOT the same picture. The pass
 * is a utility document: it carries a signed QR, a pass ID and the holder's tier,
 * and it exists to get one person through the badge desk. This is a promotional
 * one, posted publicly by the holder, so it carries none of that — a QR that
 * verifies a real identity has no business on a LinkedIn feed, and a printed tier
 * invites both forgery and "why did they get VIP" support mail.
 *
 * What it does carry is the holder's face, their name, and a claim about the
 * event. The claim is derived from the attendee record rather than picked in the
 * UI: a visitor who could self-select "I'm speaking at" produces a post the event
 * would have to publicly disown.
 *
 * Two sizes, because one is useless. 1080x1080 is the LinkedIn/Instagram feed,
 * 1080x1920 is WhatsApp Status and Stories — and for an Indian B2B audience the
 * second is very likely the bigger channel of the two. Both come from the one
 * draw() below with a different metrics profile, so they cannot drift into two
 * different-looking cards the way the pass and the desk badge once did.
 *
 * Fonts are Montserrat and Manrope on purpose. The certificate renderer in the
 * app asks canvas for Inter, which this app has never loaded — every line of it
 * silently renders as Arial. These two are in the page's stylesheet.
 */
(function (global) {
  'use strict';

  var EVENT = {
    name: 'Bharat AI Innovation',
    // Split because each word takes a different colour. Kept as words rather than
    // one string so the tricolour cannot drift out of step with the wording.
    words: ['Bharat', 'AI', 'Innovation'],
    wordsHi: ['भारत', 'एआई', 'इनोवेशन'],
    year: '2026',
    sub: 'Conference & Exhibition 2026',
    tagline: "India's Largest AI Conference & Exhibition",
    when: '20–21 Nov 2026',
    where: 'WTC Mumbai',
    site: 'bharataiinnovation.com'
  };

  var INK = {
    bg1: '#0A0C1B',
    bg2: '#161B3A',
    saffronLo: '#FF9E4D',
    white: '#FFFFFF',
    mute: '#9AA3BF',
    faint: '#6B7597'
  };

  // Saffron, white, green - the flag, in the order the words are read. Values are
  // lifted verbatim from pass-render.js so the two documents cannot drift apart.
  var TIRANGA_EN = ['#FF7A00', '#ffffff', '#00996C'];
  var TIRANGA_HI = ['#FF7A00', '#e8edf5', '#00b57f'];
  var MUKTA = '"Mukta", "Nirmala UI", "Noto Sans Devanagari", Arial, sans-serif';
  var MONT = '"Montserrat", Arial, sans-serif';
  var MANR = '"Manrope", Arial, sans-serif';

  var VARIANTS = {
    speaker:   { eyebrow: "I'M SPEAKING AT",     slug: 'Speaking'   },
    exhibitor: { eyebrow: "WE'RE EXHIBITING AT", slug: 'Exhibiting' },
    attending: { eyebrow: "I'M ATTENDING",       slug: 'Attending'  }
  };

  /* Speakers and exhibitors have both the largest networks and a professional
   * reason to post, so they get the line that is actually about them. Everyone
   * else — visitor, delegate, academic, VIP — attends. VIP is deliberately not
   * its own line: it is a ticket tier, not something to announce. */
  function variantFor(u) {
    var hay = (String((u && u.role) || '') + ' ' + String((u && u.badge_type) || '')).toLowerCase();
    if (hay.indexOf('speaker') >= 0) return 'speaker';
    if (hay.indexOf('exhibitor') >= 0) return 'exhibitor';
    return 'attending';
  }

  var SIZES = {
    square: {
      key: 'square', w: 1080, h: 1080,
      padX: 84, padTop: 54,
      logoH: 76, logoPad: 15, gapLogo: 30,
      ebSize: 27, ebTrack: 6, ebRule: 66, gapEb: 54,
      photoR: 140, ring: 7, gapPhoto: 30,
      nameSize: 50, nameMin: 30, gapName: 13,
      roleSize: 24, gapRole: 34,
      heroSize: 70, heroMin: 40, heroLead: 14, hiSize: 42, subLead: 16, subSize: 25,
      stripH: 98, stripGap: 22, stripPad: 30,
      pillH: 62, pillSize: 25, pillGap: 22, gapAbovePill: 30,
      urlSize: 22, urlBottom: 46
    },
    story: {
      key: 'story', w: 1080, h: 1920,
      padX: 84, padTop: 140,
      logoH: 96, logoPad: 18, gapLogo: 52,
      ebSize: 33, ebTrack: 7, ebRule: 82, gapEb: 72,
      photoR: 218, ring: 9, gapPhoto: 54,
      nameSize: 68, nameMin: 36, gapName: 18,
      roleSize: 30, gapRole: 52,
      heroSize: 88, heroMin: 46, heroLead: 18, hiSize: 52, subLead: 20, subSize: 30,
      stripH: 116, stripGap: 28, stripPad: 34,
      pillH: 78, pillSize: 29, pillGap: 28, gapAbovePill: 52,
      urlSize: 25, urlBottom: 120
    }
  };

  function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var faces = ['800 76px Montserrat', '700 52px Montserrat', '600 26px Montserrat',
                 '700 26px Manrope', '500 26px Manrope', '400 23px Manrope'];
    return Promise.all(faces.map(function (f) {
      return document.fonts.load(f, 'Bharat AI 2026').catch(function () {});
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

  /* An avatar_url may be an inline data URL, an /api/uploads/ key, or — for rows
   * imported from elsewhere — an external https URL. The last kind taints the
   * canvas and makes toDataURL throw, which would fail the download with no
   * visible cause, so it goes through the proxy the passes already use. */
  function photoSrc(u) {
    var s = String(u || '');
    if (!s) return '';
    if (s.indexOf('data:') === 0 || s.charAt(0) === '/') return s;
    return '/api/image-proxy?url=' + encodeURIComponent(s);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* Shrinks the face until the line fits, then truncates if it still does not.
   * Long Indian names and long company names are the normal case here, not the
   * edge case, and a name running off the side of a public post is worse than a
   * name set two points smaller. */
  function fitText(ctx, text, maxW, weight, size, minSize, family) {
    var s = size;
    ctx.font = weight + ' ' + s + 'px ' + family;
    while (ctx.measureText(text).width > maxW && s > minSize) {
      s -= 1;
      ctx.font = weight + ' ' + s + 'px ' + family;
    }
    var out = text;
    if (ctx.measureText(out).width > maxW) {
      while (out.length > 1 && ctx.measureText(out + '…').width > maxW) out = out.slice(0, -1);
      out += '…';
    }
    return { text: out, size: s };
  }

  // Canvas letterSpacing is not reliable across the browsers delegates actually
  // use, so the tracked eyebrow is drawn a glyph at a time.
  function trackedWidth(ctx, text, track) {
    var w = 0;
    for (var i = 0; i < text.length; i++) {
      w += ctx.measureText(text.charAt(i)).width + (i < text.length - 1 ? track : 0);
    }
    return w;
  }

  function trackedText(ctx, text, cx, y, track, colour) {
    var total = trackedWidth(ctx, text, track);
    var x = cx - total / 2;
    ctx.fillStyle = colour;
    ctx.textAlign = 'left';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      ctx.fillText(ch, x, y);
      x += ctx.measureText(ch).width + track;
    }
    return total;
  }

  /* Three words, three colours, centred as one group rather than three separate
     centred strings - which is what makes it read as one title instead of a stack. */
  function drawWords(ctx, words, colours, cx, y, spaceW) {
    var widths = words.map(function (w) { return ctx.measureText(w).width; });
    var total = widths.reduce(function (a, b) { return a + b; }, 0) + spaceW * (words.length - 1);
    var x = cx - total / 2;
    ctx.textAlign = 'left';
    for (var i = 0; i < words.length; i++) {
      ctx.fillStyle = colours[i % colours.length];
      ctx.fillText(words[i], x, y);
      x += widths[i] + spaceW;
    }
    return total;
  }

  // Shrinks a whole multi-word line until the group fits the width.
  function fitWords(ctx, words, maxW, weight, size, minSize, family, spaceRatio) {
    var s = size;
    for (;;) {
      ctx.font = weight + ' ' + s + 'px ' + family;
      var sp = s * spaceRatio;
      var w = words.reduce(function (a, t) { return a + ctx.measureText(t).width; }, 0) + sp * (words.length - 1);
      if (w <= maxW || s <= minSize) return { size: s, space: sp };
      s -= 1;
    }
  }

  /* Centre-cropping a headshot at the true centre reliably cuts the top of the
   * head off, because faces sit in the upper third of a portrait. Tall images are
   * therefore cropped from above centre. */
  function drawAvatar(ctx, img, cx, cy, r) {
    var side = Math.min(img.width, img.height);
    var sx = (img.width - side) / 2;
    var sy = img.height > img.width ? (img.height - side) * 0.3 : (img.height - side) / 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(img, sx, sy, side, side, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }

  /* The employer's mark, set in a white disc over the top-left of the portrait —
   * the same lockup the speaker cards on bharataiinnovation.com use. It is the
   * cheapest credibility the card can carry: "a person" becomes "a CTO at a
   * company you have heard of" without another line of type. */
  function drawCompanyChip(ctx, img, mid, cy, photoR) {
    var r = Math.round(photoR * 0.33);
    var cx = mid - photoR * 0.70;
    var ccy = cy - photoR * 0.70;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(cx, ccy, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Contained, never cropped: a logo is a wordmark as often as it is a glyph,
    // and half a wordmark is worse than none.
    var box = (r - r * 0.30) * 2;
    var scale = Math.min(box / img.width, box / img.height);
    var w = img.width * scale, h = img.height * scale;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, ccy, r - 2, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(img, cx - w / 2, ccy - h / 2, w, h);
    ctx.restore();
  }

  /* Free mailboxes are not employers. A Gmail favicon sitting on a card that
   * names somebody's company is worse than leaving the disc off entirely. */
  var FREE_MAIL = ['gmail.', 'googlemail.', 'yahoo.', 'ymail.', 'outlook.', 'hotmail.', 'live.',
                   'msn.', 'rediffmail.', 'icloud.', 'me.com', 'proton.', 'protonmail.', 'aol.', 'zoho.'];

  function companyDomain(user) {
    var site = String((user && user.website_url) || '').trim();
    if (site) {
      var host = site.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[\/?#]/)[0];
      if (host && host.indexOf('.') > 0) return host.toLowerCase();
    }
    var email = String((user && user.email) || '');
    var at = email.lastIndexOf('@');
    if (at < 0) return '';
    var d = email.slice(at + 1).toLowerCase();
    for (var i = 0; i < FREE_MAIL.length; i++) { if (d.indexOf(FREE_MAIL[i]) === 0) return ''; }
    return d.indexOf('.') > 0 ? d : '';
  }

  /* Derived, because nothing in this app stores a company logo. The delegate's
   * own website_url is preferred over their email domain — they typed one of
   * them on purpose. Returns '' when there is nothing trustworthy to draw, and
   * the caller is expected to accept a card without a disc rather than force one. */
  function companyLogoUrl(user) {
    var d = companyDomain(user);
    if (!d) return '';
    return '/api/image-proxy?url=' + encodeURIComponent('https://www.google.com/s2/favicons?sz=128&domain=' + d);
  }

  function drawInitial(ctx, name, cx, cy, r) {
    var g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, '#2A3157'); g.addColorStop(1, '#151A34');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = '700 ' + Math.round(r * 0.9) + 'px ' + MONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(name || '?').trim().charAt(0).toUpperCase() || '?', cx, cy + 2);
    ctx.textBaseline = 'alphabetic';
  }

  function background(ctx, S) {
    var W = S.w, H = S.h;

    var base = ctx.createLinearGradient(0, 0, W * 0.5, H);
    base.addColorStop(0, INK.bg1); base.addColorStop(1, INK.bg2);
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);

    var warm = ctx.createRadialGradient(W * 0.84, H * 0.10, 30, W * 0.84, H * 0.10, W * 0.78);
    warm.addColorStop(0, 'rgba(255,122,24,0.26)'); warm.addColorStop(1, 'rgba(255,122,24,0)');
    ctx.fillStyle = warm; ctx.fillRect(0, 0, W, H);

    var cool = ctx.createRadialGradient(W * 0.12, H * 0.92, 30, W * 0.12, H * 0.92, W * 0.72);
    cool.addColorStop(0, 'rgba(232,64,108,0.16)'); cool.addColorStop(1, 'rgba(232,64,108,0)');
    ctx.fillStyle = cool; ctx.fillRect(0, 0, W, H);

    // A faint dot grid. Invisible as a pattern at thumbnail size, but it stops the
    // large flat areas reading as an unfinished export.
    ctx.fillStyle = 'rgba(255,255,255,0.028)';
    for (var gy = 40; gy < H; gy += 38) {
      for (var gx = 40; gx < W; gx += 38) { ctx.fillRect(gx, gy, 2, 2); }
    }

    var bar = ctx.createLinearGradient(0, 0, W, 0);
    bar.addColorStop(0, '#FF6B00'); bar.addColorStop(0.55, '#FF9E4D'); bar.addColorStop(1, '#E8406C');
    ctx.fillStyle = bar; ctx.fillRect(0, 0, W, 7);
  }

  function hairline(ctx, x1, x2, y, fadeLeft) {
    var g = ctx.createLinearGradient(x1, y, x2, y);
    if (fadeLeft) { g.addColorStop(0, 'rgba(255,122,24,0)'); g.addColorStop(1, 'rgba(255,122,24,0.85)'); }
    else { g.addColorStop(0, 'rgba(255,122,24,0.85)'); g.addColorStop(1, 'rgba(255,122,24,0)'); }
    ctx.fillStyle = g; ctx.fillRect(x1, y, x2 - x1, 2);
  }

  function identityLine(user) {
    var bits = [];
    if (user && user.job_title) bits.push(String(user.job_title).trim());
    if (user && user.company) bits.push(String(user.company).trim());
    return bits.filter(Boolean).join(' · ');
  }

  /* Sizes every line before a single one is drawn, and splits the result into the
   * height that cannot shrink and the height that can. draw() needs both to know
   * where the block starts. */
  function measure(ctx, S, user) {
    var maxW = S.w - S.padX * 2;
    var roleText = identityLine(user);
    var m = {
      name: fitText(ctx, String((user && user.name) || 'Attendee').trim(), maxW, '700', S.nameSize, S.nameMin, MONT),
      role: roleText ? fitText(ctx, roleText, maxW, '500', S.roleSize, 18, MANR) : null,
      hero: fitWords(ctx, EVENT.words, maxW, '800', S.heroSize, S.heroMin, MONT, 0.30),
      hi: fitWords(ctx, EVENT.wordsHi, maxW, '600', S.hiSize, 24, MUKTA, 0.34),
      sub: fitText(ctx, EVENT.sub, maxW, '400', S.subSize, 16, MANR)
    };
    m.fixed = S.ebSize + S.photoR * 2 + S.ring + m.name.size +
              (m.role ? m.role.size : 0) +
              m.hero.size + S.heroLead + m.hi.size + S.subLead + m.sub.size;
    m.gaps = S.gapEb + S.gapPhoto + (m.role ? S.gapName : 0) + S.gapRole;
    return m;
  }

  /* The partner lockup from the pass, on a white plate. It is the one element that
     makes the card read as issued by the event rather than made by the person in
     it, which is exactly what an "I'm attending" post needs to borrow. */
  function drawPartnerStrip(ctx, S, assets, y) {
    var W = S.w, mid = W / 2, x = S.padX, w = W - S.padX * 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.30)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 5;
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, x, y, w, S.stripH, 14); ctx.fill();
    ctx.restore();

    var scale = S.stripH / 98;
    var logos = [{ i: assets.aegis, h: 54 }, { i: assets.agba, h: 46 }, { i: assets.assessfy, h: 38 }]
      .filter(function (o) { return o.i; });
    if (!logos.length) return;
    var gap = 40 * scale;
    var widths = logos.map(function (o) { return o.i.width * ((o.h * scale) / o.i.height); });
    var total = widths.reduce(function (a, b) { return a + b; }, 0) + gap * (logos.length - 1);
    // Long partner names before a short one can outgrow the plate on the square
    // card, so the whole lockup shrinks together rather than one logo clipping.
    var fit = Math.min(1, (w - S.stripPad * 2) / total);
    var lx = mid - (total * fit) / 2;
    for (var k = 0; k < logos.length; k++) {
      var hh = logos[k].h * scale * fit, ww = widths[k] * fit;
      ctx.drawImage(logos[k].i, lx, y + (S.stripH - hh) / 2, ww, hh);
      lx += ww + gap * fit;
    }
  }

  /* Draws the whole card. One function for both sizes: everything that decides
   * what the card SAYS lives here, and the size profile only decides how much
   * room each part gets. */
  function draw(ctx, S, user, V, assets, opts) {
    var W = S.w, mid = W / 2;

    background(ctx, S);

    var m = measure(ctx, S, user);

    // ---- the two fixed anchors: the logo at the top, and the bottom stack of
    // partner strip, date pill and address. Everything else is centred between. ----
    var logoBoxH = 0, logoW = 0;
    if (assets.logo) {
      logoW = assets.logo.width * (S.logoH / assets.logo.height);
      logoBoxH = S.logoH + S.logoPad * 2;
      // The logo file has a white background baked in, so on a dark card it lands
      // as a stray white rectangle. Set in a white chip it reads as a lockup.
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 4;
      ctx.fillStyle = '#FFFFFF';
      roundRect(ctx, mid - logoW / 2 - S.logoPad * 1.4, S.padTop, logoW + S.logoPad * 2.8, logoBoxH, 18);
      ctx.fill();
      ctx.restore();
      ctx.drawImage(assets.logo, mid - logoW / 2, S.padTop + S.logoPad, logoW, S.logoH);
    }

    var urlY = S.h - S.urlBottom;
    var stripY = urlY - S.urlSize - S.stripGap - S.stripH;
    var when = EVENT.when + '  ·  ' + EVENT.where;
    if (opts.booth) when = 'Booth ' + opts.booth + '  ·  ' + when;
    ctx.font = '700 ' + S.pillSize + 'px ' + MANR;
    var pillW = ctx.measureText(when).width + 68;
    var pillY = stripY - S.pillGap - S.pillH;

    /* Flowing from a fixed top put content underneath the bottom stack on the
     * square card and left a hole in the middle of the story one, and it would
     * have broken again the first time a name wrapped. The block is therefore
     * centred in the gap, and the gaps inside it are squeezed - never the type -
     * if a long name has left less room than it wants. */
    var topLimit = S.padTop + logoBoxH + S.gapLogo;
    var botLimit = pillY - S.gapAbovePill;
    var avail = botLimit - topLimit;
    var k = m.gaps > 0 ? Math.max(0.3, Math.min(1, (avail - m.fixed) / m.gaps)) : 1;
    var flowH = m.fixed + m.gaps * k;
    var y = topLimit + Math.max(0, (avail - flowH) / 2);

    // ---- the claim, above the portrait: it is the first thing the post says ----
    ctx.font = '600 ' + S.ebSize + 'px ' + MONT;
    y += S.ebSize;
    var ebW = trackedText(ctx, V.eyebrow, mid, y, S.ebTrack, INK.saffronLo);
    var ruleY = y - Math.round(S.ebSize * 0.32);
    var gapToRule = 26;
    hairline(ctx, mid - ebW / 2 - gapToRule - S.ebRule, mid - ebW / 2 - gapToRule, ruleY, true);
    hairline(ctx, mid + ebW / 2 + gapToRule, mid + ebW / 2 + gapToRule + S.ebRule, ruleY, false);
    y += S.gapEb * k;

    // ---- photo ----
    var cy = y + S.photoR;
    ctx.save();
    ctx.shadowColor = 'rgba(255,122,24,0.45)'; ctx.shadowBlur = 46;
    var ring = ctx.createLinearGradient(mid - S.photoR, cy - S.photoR, mid + S.photoR, cy + S.photoR);
    ring.addColorStop(0, '#FF6B00'); ring.addColorStop(1, '#FFC46B');
    ctx.strokeStyle = ring; ctx.lineWidth = S.ring;
    ctx.beginPath(); ctx.arc(mid, cy, S.photoR + S.ring / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    if (assets.photo) drawAvatar(ctx, assets.photo, mid, cy, S.photoR);
    else drawInitial(ctx, user && user.name, mid, cy, S.photoR);
    if (assets.companyLogo) drawCompanyChip(ctx, assets.companyLogo, mid, cy, S.photoR);
    y = cy + S.photoR + S.ring + S.gapPhoto * k;

    // ---- name ----
    ctx.font = '700 ' + m.name.size + 'px ' + MONT;
    ctx.textAlign = 'center'; ctx.fillStyle = INK.white;
    y += m.name.size;
    ctx.fillText(m.name.text, mid, y);

    // ---- title · company ----
    if (m.role) {
      y += S.gapName * k + m.role.size;
      ctx.font = '500 ' + m.role.size + 'px ' + MANR;
      ctx.textAlign = 'center'; ctx.fillStyle = INK.mute;
      ctx.fillText(m.role.text, mid, y);
    }
    y += S.gapRole * k;

    // ---- the wordmark, exactly as the pass sets it: the name in the tricolour,
    // the same name in Devanagari beneath it, then what the event is ----
    ctx.font = '800 ' + m.hero.size + 'px ' + MONT;
    y += m.hero.size;
    drawWords(ctx, EVENT.words, TIRANGA_EN, mid, y, m.hero.space);

    ctx.font = '600 ' + m.hi.size + 'px ' + MUKTA;
    y += S.heroLead + m.hi.size;
    drawWords(ctx, EVENT.wordsHi, TIRANGA_HI, mid, y, m.hi.space);

    ctx.font = '400 ' + m.sub.size + 'px ' + MANR;
    ctx.textAlign = 'center'; ctx.fillStyle = '#8892b0';
    y += S.subLead + m.sub.size;
    ctx.fillText(m.sub.text, mid, y);

    // ---- bottom stack ----
    ctx.save();
    ctx.shadowColor = 'rgba(255,107,0,0.35)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 6;
    var pg = ctx.createLinearGradient(mid - pillW / 2, pillY, mid + pillW / 2, pillY + S.pillH);
    pg.addColorStop(0, '#FF6B00'); pg.addColorStop(1, '#FF8C38');
    ctx.fillStyle = pg;
    roundRect(ctx, mid - pillW / 2, pillY, pillW, S.pillH, S.pillH / 2); ctx.fill();
    ctx.restore();
    ctx.font = '700 ' + S.pillSize + 'px ' + MANR;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(when, mid, pillY + S.pillH / 2 + 1);
    ctx.textBaseline = 'alphabetic';

    drawPartnerStrip(ctx, S, assets, stripY);

    ctx.font = '400 ' + S.urlSize + 'px ' + MANR;
    ctx.textAlign = 'center'; ctx.fillStyle = INK.faint;
    ctx.fillText(EVENT.site, mid, urlY);
  }

  /* opts.size — 'square' (default) or 'story'.
   * opts.booth — printed only when the caller has an allocation it trusts. It is
   *   deliberately not read off attendees/exhibitors here: booth_number there is
   *   free text that a paid request never writes to, and a wrong stand number on
   *   a public post sends people to somebody else's booth. */
  async function render(user, opts) {
    opts = opts || {};
    var S = SIZES[opts.size] || SIZES.square;
    var V = VARIANTS[opts.variant || variantFor(user)] || VARIANTS.attending;

    await ensureFonts();

    /* A card of somebody's face that quietly renders their first initial instead
     * is worse than no card: they post it before noticing. One retry covers the
     * dropped request, and a photo that still will not load is reported rather
     * than papered over, so the caller can say so instead of handing over a
     * letter in a circle. */
    var assets = { logo: null, photo: null, companyLogo: null, aegis: null, agba: null, assessfy: null };
    var photoFailed = false;
    var src = photoSrc(user && user.avatar_url);
    if (src) {
      try {
        assets.photo = await loadImage(src);
      } catch (e) {
        try {
          assets.photo = await loadImage(src + (src.indexOf('?') >= 0 ? '&' : '?') + 'retry=' + Date.now());
        } catch (e2) { photoFailed = true; }
      }
    }
    try { assets.logo = await loadImage('/images/Bharat%20AI%20Innovation%20Logo.png'); } catch (e) {}
    // The same three files the pass puts on its white strip.
    try { assets.aegis = await loadImage('/images/passes/aegis.png'); } catch (e) {}
    try { assets.agba = await loadImage('/images/passes/agba.png'); } catch (e) {}
    try { assets.assessfy = await loadImage('/images/passes/assessfy.jpg'); } catch (e) {}

    /* The employer disc is opt-out, not opt-in: pass companyLogo:'' to suppress
     * it. A favicon lookup can come back as a generic globe for a domain the
     * service does not know, so the caller is expected to show the delegate the
     * result before they post it. Anything under 32px is that placeholder or a
     * 16px favicon that would smear at this size — better dropped than drawn. */
    var logoSrc = opts.companyLogo === '' ? '' : (opts.companyLogo || companyLogoUrl(user));
    if (logoSrc) {
      try {
        var cl = await loadImage(logoSrc);
        if (cl.width >= 32 && cl.height >= 32) assets.companyLogo = cl;
      } catch (e) {}
    }

    var canvas = document.createElement('canvas');
    canvas.width = S.w; canvas.height = S.h;
    var ctx = canvas.getContext('2d');
    draw(ctx, S, user, V, assets, opts);

    var safeName = String((user && user.name) || 'attendee').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      dataUrl: canvas.toDataURL('image/png'),
      filename: 'BharatAI2026-' + V.slug + '-' + safeName + '-' + S.key + '.png',
      variant: V.eyebrow,
      size: S.key,
      width: S.w,
      height: S.h,
      photoFailed: photoFailed
    };
  }

  /* The caption is half the feature. A card with no words next to it is a card
   * most people do not post, and the tagged link is the only reason any of this
   * is worth building — it is what makes the reach measurable at all. */
  function caption(user, opts) {
    opts = opts || {};
    var v = opts.variant || variantFor(user);
    var link = 'https://' + EVENT.site + '/?utm_source=social_card&utm_medium=attendee&utm_campaign=' + v;
    var lead;
    if (v === 'speaker') lead = "I'm speaking at " + EVENT.name + ' ' + EVENT.year + '.';
    else if (v === 'exhibitor') lead = "We're exhibiting at " + EVENT.name + ' ' + EVENT.year + '.';
    else lead = "I'm attending " + EVENT.name + ' ' + EVENT.year + '.';

    return [
      lead,
      '',
      EVENT.tagline + ' — ' + EVENT.when + ', ' + EVENT.where + '.',
      (v === 'attending'
        ? 'Come and say hello if you are there.'
        : 'Come and find us — I would be glad to talk.'),
      '',
      link,
      '',
      '#BharatAIInnovation #BharatAI2026 #ArtificialIntelligence #AI #Mumbai'
    ].join('\n');
  }

  async function download(user, opts) {
    var res = await render(user, opts);
    var link = document.createElement('a');
    link.download = res.filename;
    link.href = res.dataUrl;
    link.click();
    return res;
  }

  global.BhaiSocialCard = {
    EVENT: EVENT,
    SIZES: SIZES,
    VARIANTS: VARIANTS,
    variantFor: variantFor,
    companyDomain: companyDomain,
    companyLogoUrl: companyLogoUrl,
    ensureFonts: ensureFonts,
    render: render,
    caption: caption,
    download: download
  };
})(window);
