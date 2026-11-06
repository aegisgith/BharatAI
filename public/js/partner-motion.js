/* Motion on /partner only: the credits, the licence and how to remove it are at the top of
   css/partner-motion.css. Rebuilt without React from Vengeance UI (MIT, copyright 2025-2026
   Ashutoshx7) and the free version of Skiper UI. With animations off this file does nothing at
   all, and the page reads in full. The form, the bar and the folded sections do not depend on it. */
(function () {
  'use strict';
  if (!window.matchMedia || !window.IntersectionObserver) return;
  if (!matchMedia('(prefers-reduced-motion: no-preference)').matches) return;

  var each = function (sel, fn) { Array.prototype.slice.call(document.querySelectorAll(sel)).forEach(fn); };

  // Stagger Text: each word of a section heading rises when the heading comes into view.
  // Words stay real text with real spaces. A coloured span moves as one piece.
  function mask(node, i) {
    var outer = document.createElement('span');
    var inner = document.createElement('span');
    outer.className = 'pr-w';
    inner.style.setProperty('--i', i);
    if (node.parentNode) node.parentNode.insertBefore(outer, node);
    inner.appendChild(node);
    outer.appendChild(inner);
    return outer;
  }
  function split(el) {
    var i = 0;
    Array.prototype.slice.call(el.childNodes).forEach(function (n) {
      if (n.nodeType === 1 && n.tagName !== 'BR') {
        mask(n, i++);
      } else if (n.nodeType === 3) {
        var frag = document.createDocumentFragment();
        n.nodeValue.split(/(\s+)/).forEach(function (w) {
          if (!w) return;
          if (/^\s+$/.test(w)) frag.appendChild(document.createTextNode(' '));
          else frag.appendChild(mask(document.createTextNode(w), i++));
        });
        el.replaceChild(frag, n);
      }
    });
    el.classList.add('pr-split');
  }
  var heading = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('pr-in');
      heading.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  each('.pr-head .section-title', function (h) { split(h); heading.observe(h); });

  // Skiper 16: as the next card comes up over a stuck one, the stuck one shrinks a little.
  var cards = Array.prototype.slice.call(document.querySelectorAll('.beyond-grid--stack .beyond-card'));
  if (cards.length) {
    var stackTick = 0;
    var stack = function () {
      stackTick = 0;
      var travel = innerHeight * 0.5;
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
    }).observe(document.querySelector('.beyond-grid--stack'));
    addEventListener('resize', stackSoon, { passive: true });
  }

  // Spotlight Navbar: main.js marks the current section's link; the light goes there.
  var links = document.querySelector('.conf-subnav-links');
  if (links) {
    var light = document.createElement('i');
    light.className = 'pr-light';
    light.setAttribute('aria-hidden', 'true');
    var lit = null;
    var place = function () {
      var a = links.querySelector('.conf-subnav-link.active');
      if (!a) return;
      links.style.setProperty('--pr-x', a.offsetLeft + 'px');
      links.style.setProperty('--pr-w', a.offsetWidth + 'px');
      // On a phone the menu scrolls sideways: keep the lit link in view, without moving the page.
      if (a !== lit && links.scrollWidth > links.clientWidth) links.scrollLeft = a.offsetLeft - (links.clientWidth - a.offsetWidth) / 2;
      lit = a;
    };
    links.appendChild(light);
    links.classList.add('pr-spot');
    new MutationObserver(place).observe(links, { subtree: true, attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', place, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    place();
  }

  // Skiper 31: the letters of the last heading gather as it comes up the screen. They are fully in
  // place by the time it is three quarters of the way up, well before it is read.
  var last = document.querySelector('.pr-enquire h2');
  if (last) {
    last.setAttribute('aria-label', last.textContent.replace(/\s+/g, ' ').trim());
    var letters = [];
    var frag = document.createDocumentFragment();
    last.textContent.split(/(\s+)/).forEach(function (w) {
      if (!w) return;
      if (/^\s+$/.test(w)) { frag.appendChild(document.createTextNode(' ')); return; }
      var word = document.createElement('span');
      word.className = 'pr-word';
      word.setAttribute('aria-hidden', 'true');
      w.split('').forEach(function (ch) {
        var s = document.createElement('span');
        s.className = 'pr-ch';
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

  // Border Beam: on the form's button.
  var button = document.querySelector('.pr-submit');
  if (button) {
    var beam = document.createElement('span');
    beam.className = 'pr-beam';
    beam.setAttribute('aria-hidden', 'true');
    button.appendChild(beam);
  }

  // Nothing keeps moving once it is off the screen.
  var away = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { e.target.classList.toggle('pr-off', !e.isIntersecting); });
  });
  each('.pr-hero, .tier-card.exclusive, .pr-enquire', function (box) { away.observe(box); });
})();
