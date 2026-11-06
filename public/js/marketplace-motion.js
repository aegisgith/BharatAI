/* Motion on /marketplace only: the credits, the licence and how to remove it are at the top of
   css/marketplace-motion.css. Rebuilt without React from Vengeance UI (MIT, copyright 2025-2026
   Ashutoshx7) and the free version of Skiper UI. With animations off this file does nothing at
   all, and the page reads in full. Search, filters and forms live in marketplace-app.js and do
   not depend on it. */
(function () {
  'use strict';
  if (!window.matchMedia || !window.IntersectionObserver) return;
  if (!matchMedia('(prefers-reduced-motion: no-preference)').matches) return;

  var mouse = matchMedia('(hover: hover)').matches;
  var each = function (sel, fn) { Array.prototype.slice.call(document.querySelectorAll(sel)).forEach(fn); };

  // The first cards settle in once they arrive, and never again: filtering re-adds them.
  var grid = document.getElementById('listings-container');
  if (grid) {
    grid.classList.add('mk-enter');
    new MutationObserver(function (m, self) {
      if (!grid.querySelector('.listing-card:not(.listing-card--skeleton)')) return;
      self.disconnect();
      setTimeout(function () { grid.classList.remove('mk-enter'); }, 1300);
    }).observe(grid, { childList: true });
  }

  // Stagger Text: each word of a section heading rises when the heading comes into view.
  function mask(node, i) {
    var outer = document.createElement('span');
    var inner = document.createElement('span');
    outer.className = 'mk-w';
    inner.style.setProperty('--i', i);
    if (node.parentNode) node.parentNode.insertBefore(outer, node);
    inner.appendChild(node);
    outer.appendChild(inner);
    return outer;
  }
  function split(el) {
    var i = 0;
    Array.prototype.slice.call(el.childNodes).forEach(function (n) {
      if (n.nodeType !== 3) return;
      var frag = document.createDocumentFragment();
      n.nodeValue.split(/(\s+)/).forEach(function (w) {
        if (!w) return;
        if (/^\s+$/.test(w)) frag.appendChild(document.createTextNode(' '));
        else frag.appendChild(mask(document.createTextNode(w), i++));
      });
      el.replaceChild(frag, n);
    });
    el.classList.add('mk-split');
  }
  var heading = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('mk-in');
      heading.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  each('.mk-h2:not(.mk-sell-title)', function (h) { split(h); heading.observe(h); });

  // Skiper 16: as the next card comes up over a stuck one, the stuck one shrinks a little.
  var cards = Array.prototype.slice.call(document.querySelectorAll('.mk-card'));
  if (cards.length) {
    var stackTick = 0;
    var stack = function () {
      stackTick = 0;
      var travel = innerHeight * 0.6;
      cards.forEach(function (c, i) {
        var next = cards[i + 1];
        if (!next || getComputedStyle(c).position !== 'sticky') { c.style.transform = ''; return; }
        var gap = next.getBoundingClientRect().top - parseFloat(getComputedStyle(next).top);
        var p = Math.max(0, Math.min(1, 1 - gap / travel));
        c.style.transform = p ? 'scale(' + (1 - p * 0.05).toFixed(4) + ')' : '';
      });
    };
    var stackSoon = function () { if (!stackTick) stackTick = requestAnimationFrame(stack); };
    var stackOn = false;
    new IntersectionObserver(function (entries) {
      var seen = entries[0].isIntersecting;
      if (seen && !stackOn) { addEventListener('scroll', stackSoon, { passive: true }); stackSoon(); }
      if (!seen && stackOn) removeEventListener('scroll', stackSoon);
      stackOn = seen;
    }).observe(document.querySelector('.mk-stack'));
    addEventListener('resize', stackSoon, { passive: true });
  }

  // Spotlight Navbar: the line rests on the current page and goes to the link under a mouse.
  var nav = document.querySelector('.mp-nav');
  if (nav && mouse && matchMedia('(min-width: 901px)').matches) {
    var here = nav.querySelector('[aria-current="page"]');
    var light = document.createElement('i');
    light.className = 'mk-light';
    light.setAttribute('aria-hidden', 'true');
    var place = function (a) {
      nav.style.setProperty('--mk-x', a.offsetLeft + 'px');
      nav.style.setProperty('--mk-w', a.offsetWidth + 'px');
    };
    nav.appendChild(light);
    nav.classList.add('mk-spot');
    each('.mp-nav .mp-nav-link', function (a) { a.addEventListener('pointerenter', function () { place(a); }); });
    nav.addEventListener('pointerleave', function () { if (here) place(here); });
    if (here) {
      place(here);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { place(here); });
      addEventListener('resize', function () { place(here); }, { passive: true });
    }
  }

  // Glow Border Card: the edge of each card lights by how near it is to a mouse.
  if (grid && mouse) {
    var mx = 0, my = 0, glowTick = 0;
    var glow = function () {
      glowTick = 0;
      Array.prototype.slice.call(grid.children).forEach(function (c) {
        var b = c.getBoundingClientRect();
        c.style.setProperty('--mx', (mx - b.left) + 'px');
        c.style.setProperty('--my', (my - b.top) + 'px');
      });
    };
    grid.classList.add('mk-glow');
    grid.addEventListener('pointermove', function (e) {
      mx = e.clientX; my = e.clientY;
      if (!glowTick) glowTick = requestAnimationFrame(glow);
    }, { passive: true });
  }

  // Skiper 31: the letters of the companies' heading gather as it comes up the screen. They are
  // fully in place by the time it is three quarters of the way up, well before it is read.
  var last = document.querySelector('.mk-sell-title');
  if (last) {
    last.setAttribute('aria-label', last.textContent.replace(/\s+/g, ' ').trim());
    var letters = [];
    var frag = document.createDocumentFragment();
    last.textContent.split(/(\s+)/).forEach(function (w) {
      if (!w) return;
      if (/^\s+$/.test(w)) { frag.appendChild(document.createTextNode(' ')); return; }
      var word = document.createElement('span');
      word.className = 'mk-word';
      word.setAttribute('aria-hidden', 'true');
      w.split('').forEach(function (ch) {
        var s = document.createElement('span');
        s.className = 'mk-ch';
        s.textContent = ch;
        word.appendChild(s);
        letters.push(s);
      });
      frag.appendChild(word);
    });
    last.textContent = '';
    last.appendChild(frag);
    letters.forEach(function (s, i) {
      var d = i - (letters.length - 1) / 2;
      s.style.setProperty('--d', d.toFixed(1));
      s.style.setProperty('--a', Math.abs(d).toFixed(1));
    });
    var gatherTick = 0;
    var gather = function () {
      gatherTick = 0;
      var top = last.getBoundingClientRect().top;
      var p = Math.max(0, Math.min(1, (innerHeight * 1.05 - top) / (innerHeight * 0.3)));
      last.style.setProperty('--p', p.toFixed(3));
    };
    var gatherSoon = function () { if (!gatherTick) gatherTick = requestAnimationFrame(gather); };
    addEventListener('scroll', gatherSoon, { passive: true });
    addEventListener('resize', gatherSoon, { passive: true });
    gather();
  }

  // Border Beam: round the search bar until someone uses it, and round the companies' button.
  function beam(host) {
    var b = document.createElement('span');
    b.className = 'mk-beam';
    b.setAttribute('aria-hidden', 'true');
    host.appendChild(b);
    return b;
  }
  var bar = document.querySelector('.mk-toolbar-row');
  var search = document.getElementById('mk-search');
  if (bar && search) {
    var barBeam = beam(bar);
    search.addEventListener('focus', function () { barBeam.classList.add('is-done'); }, { once: true });
  }
  var sell = document.querySelector('.mk-sell-btn');
  if (sell) beam(sell);

  // Nothing keeps moving once it is off the screen.
  var away = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { e.target.classList.toggle('mk-off', !e.isIntersecting); });
  });
  each('.mk-hero, .mk-sell', function (box) { away.observe(box); });
})();
