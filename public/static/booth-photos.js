/* Booth photos on the exhibitor dashboard (23 Nov 2026).
 *
 * The event photos their company's name or logo is in (the booth fascia, standees,
 * screens, their own talk slide), found by reading the text in every photo on the
 * organiser's computer (scripts/photos/exh_match.py). Since 24 Nov 2026 also its
 * Innovation Talk, its speakers on stage and each of its team, under their own headings. The server is
 * src/routes/exhibitor-photos.ts: /api/mp/dashboard/booth-photos gives this company's
 * photos with links signed for it; "Save all" is one ZIP. Loaded after
 * marketplace-dashboard.js, whose esc(), api(), showToast() and switchSection() it uses.
 * The emailed sign-in link lands on /marketplace/dashboard#photos.
 */
(function () {
  'use strict';
  var nav = document.getElementById('dash-nav-photos');
  var card = document.getElementById('booth-photos-card');
  var grid = document.getElementById('booth-photos-grid');
  if (!nav || !card || !grid) return;

  var DAYS = { '2026-11-20': 'Friday 20 November', '2026-11-21': 'Saturday 21 November' };
  var photos = [];

  function style() {
    if (document.getElementById('booth-photos-css')) return;
    var s = document.createElement('style');
    s.id = 'booth-photos-css';
    s.textContent = '.booth-photos-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:12px}'
      + '.booth-photo{position:relative;border-radius:12px;overflow:hidden;background:#EEF0F6;border:1px solid #E1E4EF}'
      + '.booth-photo button{display:block;width:100%;padding:0;border:0;background:none;cursor:zoom-in}'
      + '.booth-photo img{display:block;width:100%;aspect-ratio:3/2;object-fit:cover}'
      + '.booth-photo-bar{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;font-size:12px;color:#5A6080;background:#fff}'
      + '.booth-photo-bar a{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 10px;border-radius:8px;border:1px solid #D6DAEA;color:#1E2140;text-decoration:none;font-weight:600}'
      + '.booth-day{grid-column:1/-1;margin:14px 0 0;font-size:14px;font-weight:700;color:#1E2140}'
      + '.booth-view{position:fixed;inset:0;z-index:80;background:rgba(10,12,30,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px}'
      + '.booth-view img{max-width:100%;max-height:calc(100vh - 110px);border-radius:8px}'
      + '.booth-view-bar{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;justify-content:center}'
      + '.booth-view-bar a,.booth-view-bar button{min-height:44px;padding:0 16px;border-radius:10px;border:0;font:inherit;font-weight:700;display:inline-flex;align-items:center;gap:8px;cursor:pointer;text-decoration:none}'
      + '.booth-view-bar a{background:#C84F00;color:#fff}.booth-view-bar button{background:#fff;color:#1E2140}';
    document.head.appendChild(s);
  }

  function fileName(p, i) { return 'bharat-ai-innovation-2026-' + String(i + 1).padStart(2, '0') + '.jpg'; }

  // What the photos are, in words, from the kinds of section the company has (24 Nov 2026:
  // the booth, its Innovation Talk, its speakers on stage, its team).
  var WORDS = { booth: 'your booth', talk: 'your Innovation Talk on stage', speaker: 'your speakers on stage', team: 'your team at the event' };
  function listWords(xs) { return xs.length <= 1 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }

  function draw(d) {
    photos = d.photos || [];
    if (!photos.length) {
      card.innerHTML = '<p class="text-sm" style="line-height:1.6;margin:0">We have not found ' + esc(d.company || 'your company') + ' in the event photos yet. We read the names on the booths and screens in every photo, and we match the faces of your team and speakers. If you would like us to look again, write to <a href="mailto:register@bharataiinnovation.com">register@bharataiinnovation.com</a> with your booth number.</p>';
      grid.innerHTML = '';
      return;
    }
    var what = listWords((d.kinds || ['booth']).map(function (k) { return WORDS[k]; }).filter(Boolean));
    var parts = Number(d.parts) || 1, per = Number(d.per_part) || photos.length, zips = '';
    if (d.zip) {
      if (parts <= 1) zips = '<a href="' + esc(d.zip) + '" class="mp-btn-primary" download><i class="fas fa-download mr-1"></i> Save all ' + photos.length + ' photos (ZIP)</a>';
      else for (var n = 1; n <= parts; n++) zips += '<a href="' + esc(d.zip) + '?n=' + n + '" class="mp-btn-primary" download style="margin:0 8px 8px 0"><i class="fas fa-download mr-1"></i> Save photos ' + ((n - 1) * per + 1) + ' to ' + Math.min(n * per, photos.length) + ' (ZIP)</a>';
    }
    card.innerHTML = '<p class="text-sm" style="line-height:1.6;margin:0 0 12px">We found <strong>' + esc(d.company) + '</strong> in <strong>' + photos.length + '</strong> of the event photos' + (what ? ': ' + esc(what) : '') + '. They are yours to use on LinkedIn, your website and your newsletters. Please tag <strong>#BharatAIInnovation</strong>.</p>'
      + '<div class="team-form-actions" style="flex-wrap:wrap">' + zips + '</div>'
      + '<p class="text-xs text-slate-500" style="margin:10px 0 0">Tap a photo to see it large. &ldquo;Save&rdquo; gives you the full-size photo.</p>';
    var html = '', last = null;
    photos.forEach(function (p, i) {
      var head = p.section || DAYS[p.day] || p.day || '';
      if (head !== last) { last = head; html += '<h3 class="booth-day">' + esc(head) + '</h3>'; }
      html += '<figure class="booth-photo" style="margin:0"><button type="button" data-booth-view="' + i + '" aria-label="See photo ' + (i + 1) + ' large"><img src="' + esc(p.s) + '" alt="' + esc(head) + ', photo ' + (i + 1) + '" loading="lazy"></button>'
        + '<figcaption class="booth-photo-bar"><span>' + esc([DAYS[p.day] ? DAYS[p.day].split(' ')[0] : '', p.time || ''].filter(Boolean).join(', ')) + '</span><a href="' + esc(p.o) + '" download="' + esc(fileName(p, i)) + '"><i class="fas fa-download"></i> Save</a></figcaption></figure>';
    });
    grid.innerHTML = html;
  }

  function view(i) {
    var p = photos[i];
    if (!p) return;
    var box = document.createElement('div');
    box.className = 'booth-view';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Photo ' + (i + 1) + ' of ' + photos.length);
    box.innerHTML = '<img src="' + esc(p.m) + '" alt="' + esc(p.section || 'Your photo') + ', photo ' + (i + 1) + '">'
      + '<div class="booth-view-bar"><button type="button" data-booth-prev' + (i ? '' : ' disabled') + '>Previous</button>'
      + '<a href="' + esc(p.o) + '" download="' + esc(fileName(p, i)) + '"><i class="fas fa-download"></i> Save full size</a>'
      + '<button type="button" data-booth-next' + (i < photos.length - 1 ? '' : ' disabled') + '>Next</button>'
      + '<button type="button" data-booth-close>Close</button></div>';
    document.body.appendChild(box);
    var close = function () { box.remove(); document.removeEventListener('keydown', key); };
    var go = function (j) { close(); view(j); };
    var key = function (e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' && i < photos.length - 1) go(i + 1);
      else if (e.key === 'ArrowLeft' && i > 0) go(i - 1);
    };
    box.addEventListener('click', function (e) {
      if (e.target === box || e.target.closest('[data-booth-close]')) close();
      else if (e.target.closest('[data-booth-prev]') && i > 0) go(i - 1);
      else if (e.target.closest('[data-booth-next]') && i < photos.length - 1) go(i + 1);
    });
    document.addEventListener('keydown', key);
    box.querySelector('[data-booth-close]').focus();
  }

  grid.addEventListener('click', function (e) {
    var b = e.target.closest('[data-booth-view]');
    if (b) view(Number(b.getAttribute('data-booth-view')));
  });

  async function load() {
    try {
      var d = await api('/api/mp/dashboard/booth-photos');
      if (!d || !d.eligible) return;
      style();
      nav.classList.remove('hidden');
      draw(d);
      if (location.hash === '#photos' && typeof switchSection === 'function') switchSection('photos');
    } catch (err) {
      // Not an exhibitor (a marketplace-only company) or not signed in: no tab.
      if (err && err.status && err.status !== 401) showToast(err.message || 'Your photos did not load.', true);
    }
  }
  load();
})();
