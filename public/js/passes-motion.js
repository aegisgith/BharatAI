/* Motion on /passes only: the credits, the licence and how to remove it are at the top of
   css/passes-motion.css. Rebuilt without React from Vengeance UI (MIT, copyright 2025-2026
   Ashutoshx7) and the free version of Skiper UI. With animations off this file does nothing at
   all, and the page reads in full. Every link and button works without it. */
(function () {
  'use strict';
  if (!window.matchMedia || !window.IntersectionObserver) return;
  if (!matchMedia('(prefers-reduced-motion: no-preference)').matches) return;

  var mouse = matchMedia('(hover: hover)').matches;
  var each = function (sel, fn) { Array.prototype.slice.call(document.querySelectorAll(sel)).forEach(fn); };

  // Stagger Text: each word of a section heading rises when the heading comes into view.
  function mask(node, i) {
    var outer = document.createElement('span');
    var inner = document.createElement('span');
    outer.className = 'ps-word-mask';
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
    el.classList.add('ps-split');
  }
  var heading = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('ps-in');
      heading.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  each('.ps-h2', function (h) { split(h); heading.observe(h); });

  // Spotlight Navbar: the line rests on Passes and goes to the menu link under a mouse. Only where
  // the menu is one row: on a phone it scrolls sideways.
  var nav = document.querySelector('.ps-nav');
  if (nav && mouse && matchMedia('(min-width: 1280px)').matches) {
    var here = nav.querySelector('[aria-current="page"]');
    var light = document.createElement('i');
    light.className = 'ps-light';
    light.setAttribute('aria-hidden', 'true');
    var place = function (a) {
      nav.style.setProperty('--ps-lx', a.offsetLeft + 'px');
      nav.style.setProperty('--ps-lw', a.offsetWidth + 'px');
    };
    nav.appendChild(light);
    each('.ps-nav a', function (a) { a.addEventListener('pointerenter', function () { place(a); }); });
    nav.addEventListener('pointerleave', function () { if (here) place(here); });
    if (here) {
      place(here);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { place(here); });
      addEventListener('resize', function () { place(here); }, { passive: true });
    }
  }

  // A mouse over the chart lights the column under it, so a pass reads top to bottom.
  var chart = document.querySelector('.pcmp table');
  if (chart && mouse) {
    var lit = -1;
    var paint = function (col) {
      if (col === lit) return;
      lit = col;
      each('.pcmp .ps-col', function (c) { c.classList.remove('ps-col'); });
      if (col < 0) return;
      each('.pcmp thead tr', function (r) { if (r.children[col + 1]) r.children[col + 1].classList.add('ps-col'); });
      each('.pcmp-row', function (r) { if (r.children[col + 1]) r.children[col + 1].classList.add('ps-col'); });
    };
    chart.addEventListener('pointerover', function (e) {
      var cell = e.target.closest ? e.target.closest('td, thead th') : null;
      if (!cell) { paint(-1); return; }
      var at = Array.prototype.indexOf.call(cell.parentNode.children, cell) - 1;
      paint(at >= 0 ? at : -1);
    }, { passive: true });
    chart.addEventListener('pointerleave', function () { paint(-1); });
  }

  // Skiper 31: the letters of the last heading gather as it comes up the screen. They are fully in
  // place by the time it is three quarters of the way up, well before it is read.
  var last = document.querySelector('.ps-end-title');
  if (last) {
    last.setAttribute('aria-label', last.textContent.replace(/\s+/g, ' ').trim());
    var letters = [];
    var frag = document.createDocumentFragment();
    last.textContent.split(/(\s+)/).forEach(function (w) {
      if (!w) return;
      if (/^\s+$/.test(w)) { frag.appendChild(document.createTextNode(' ')); return; }
      var word = document.createElement('span');
      word.className = 'ps-word';
      word.setAttribute('aria-hidden', 'true');
      w.split('').forEach(function (ch) {
        var s = document.createElement('span');
        s.className = 'ps-ch';
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
    var tick = 0;
    var gather = function () {
      tick = 0;
      var top = last.getBoundingClientRect().top;
      var p = Math.max(0, Math.min(1, (innerHeight * 1.05 - top) / (innerHeight * 0.3)));
      last.style.setProperty('--p', p.toFixed(3));
    };
    var soon = function () { if (!tick) tick = requestAnimationFrame(gather); };
    addEventListener('scroll', soon, { passive: true });
    addEventListener('resize', soon, { passive: true });
    gather();
  }

  // Border Beam: on the last button.
  var button = document.querySelector('.ps-end .ps-buy');
  if (button) {
    var beam = document.createElement('span');
    beam.className = 'ps-beam';
    beam.setAttribute('aria-hidden', 'true');
    button.appendChild(beam);
  }

  // Nothing keeps moving once it is off the screen.
  var away = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { e.target.classList.toggle('ps-off', !e.isIntersecting); });
  });
  each('.ps-hero, .ps-pass--lead, .ps-end', function (box) { away.observe(box); });
})();
