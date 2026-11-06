/* Motion on /training-workshop only: the credits, the licence and how to remove it are at the
   top of css/workshop-motion.css. Rebuilt without React from Vengeance UI (MIT, copyright
   2025-2026 Ashutoshx7) and the free version of Skiper UI. With animations off this file does
   nothing at all, and the page reads in full. */
(function () {
  'use strict';
  if (!window.matchMedia || !window.IntersectionObserver) return;
  if (!matchMedia('(prefers-reduced-motion: no-preference)').matches) return;

  var mouse = matchMedia('(hover: hover)').matches;
  var each = function (sel, fn) { Array.prototype.slice.call(document.querySelectorAll(sel)).forEach(fn); };

  // Runs fn while el is on the screen and the tab is in front, and stops it otherwise.
  function whileSeen(el, every, fn) {
    var timer = 0;
    var seen = false;
    var sync = function () {
      var go = seen && !document.hidden;
      if (go && !timer) timer = setInterval(fn, every);
      if (!go && timer) { clearInterval(timer); timer = 0; }
    };
    new IntersectionObserver(function (entries) { seen = entries[0].isIntersecting; sync(); }).observe(el);
    document.addEventListener('visibilitychange', sync);
  }

  // Stagger Text: each word of a section heading rises when the heading comes into view.
  // Words stay real text with real spaces. A coloured span moves as one piece.
  function mask(node, i) {
    var outer = document.createElement('span');
    var inner = document.createElement('span');
    outer.className = 'tw-w';
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
    el.classList.add('tw-split');
  }
  var heading = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('tw-in');
      heading.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  each('h2.section-title', function (h) { split(h); heading.observe(h); });

  // Team Reveal Grid: one face at a time in colour, passing on by itself until a mouse or the
  // keyboard picks one. A tap follows the link to that workshop.
  var tiles = document.querySelector('.tw-tiles');
  if (tiles) {
    var people = Array.prototype.slice.call(tiles.querySelectorAll('.tw-tile'));
    var now = 0;
    var held = false;
    var pick = function (i) {
      now = i;
      people.forEach(function (p, n) { p.classList.toggle('is-on', n === i); });
    };
    people.forEach(function (p, i) {
      if (mouse) {
        p.addEventListener('pointerenter', function () { held = true; pick(i); });
        p.addEventListener('pointerleave', function () { held = false; });
      }
      p.addEventListener('focus', function () { held = true; pick(i); });
      p.addEventListener('blur', function () { held = false; });
    });
    tiles.classList.add('tw-live');
    pick(0);
    whileSeen(tiles, 2800, function () { if (!held) pick((now + 1) % people.length); });
  }

  // Skiper 16: as the next card comes up over a stuck one, the stuck one shrinks a little.
  var cards = Array.prototype.slice.call(document.querySelectorAll('.format-row'));
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
    }).observe(document.querySelector('.format-list'));
    addEventListener('resize', stackSoon, { passive: true });
  }

  // Spotlight Navbar: main.js marks the current workshop's link; the light goes there.
  var links = document.querySelector('.conf-subnav-links');
  if (links) {
    var light = document.createElement('i');
    light.className = 'tw-light';
    light.setAttribute('aria-hidden', 'true');
    var lit = null;
    var place = function () {
      var a = links.querySelector('.conf-subnav-link.active');
      if (!a) return;
      links.style.setProperty('--tw-x', a.offsetLeft + 'px');
      links.style.setProperty('--tw-w', a.offsetWidth + 'px');
      // On a phone the menu scrolls sideways: keep the lit link in view, without moving the page.
      if (a !== lit && links.scrollWidth > links.clientWidth) links.scrollLeft = a.offsetLeft - (links.clientWidth - a.offsetWidth) / 2;
      lit = a;
    };
    links.appendChild(light);
    links.classList.add('tw-spot');
    new MutationObserver(place).observe(links, { subtree: true, attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', place, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    place();
    if (mouse) {
      links.addEventListener('pointermove', function (e) {
        var box = links.getBoundingClientRect();
        links.style.setProperty('--tw-mouse', (e.clientX - box.left) + 'px');
        links.style.setProperty('--tw-glow', '1');
      }, { passive: true });
      links.addEventListener('pointerleave', function () { links.style.setProperty('--tw-glow', '0'); });
    }
  }

  // Highlight Grid: one highlight passes along the roles, or to the one under a mouse.
  var roles = document.querySelector('.tw-audience');
  if (roles) {
    var tags = Array.prototype.slice.call(roles.querySelectorAll('.track-tag'));
    var glide = document.createElement('i');
    glide.className = 'tw-glide';
    glide.setAttribute('aria-hidden', 'true');
    var at = 0;
    var over = false;
    var moveTo = function (i) {
      at = i;
      var t = tags[i];
      glide.style.transform = 'translate(' + t.offsetLeft + 'px,' + t.offsetTop + 'px)';
      glide.style.width = t.offsetWidth + 'px';
      glide.style.height = t.offsetHeight + 'px';
      tags.forEach(function (x, n) { x.classList.toggle('is-on', n === i); });
    };
    roles.classList.add('tw-glide-on');
    roles.insertBefore(glide, roles.firstChild);
    moveTo(0);
    addEventListener('resize', function () { moveTo(at); }, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { moveTo(at); });
    if (mouse) {
      tags.forEach(function (t, i) { t.addEventListener('pointerenter', function () { over = true; moveTo(i); }); });
      roles.addEventListener('pointerleave', function () { over = false; });
    }
    whileSeen(roles, 1800, function () { if (!over) moveTo((at + 1) % tags.length); });
  }

  // Skiper 31: the letters of the last heading gather as it comes up the screen. They are fully
  // in place by the time the heading is three quarters of the way up, well before it is read.
  var last = document.querySelector('.cta-section h2');
  if (last) {
    last.setAttribute('aria-label', last.textContent.replace(/\s+/g, ' ').trim());
    var count = 0;
    var letters = [];
    var spread = function (parent) {
      Array.prototype.slice.call(parent.childNodes).forEach(function (n) {
        if (n.nodeType === 1) { spread(n); return; }
        if (n.nodeType !== 3) return;
        var frag = document.createDocumentFragment();
        n.nodeValue.split(/(\s+)/).forEach(function (w) {
          if (!w) return;
          if (/^\s+$/.test(w)) { frag.appendChild(document.createTextNode(' ')); return; }
          var word = document.createElement('span');
          word.className = 'tw-word';
          word.setAttribute('aria-hidden', 'true');
          w.split('').forEach(function (ch) {
            var s = document.createElement('span');
            s.className = 'tw-ch';
            s.textContent = ch;
            word.appendChild(s);
            letters.push(s);
            count++;
          });
          frag.appendChild(word);
        });
        parent.replaceChild(frag, n);
      });
    };
    spread(last);
    letters.forEach(function (s, i) {
      var d = i - (count - 1) / 2;
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

  // Border Beam: on the main button at the foot of the page.
  var button = document.querySelector('.cta-section .btn-primary');
  if (button) {
    var beam = document.createElement('span');
    beam.className = 'tw-beam';
    beam.setAttribute('aria-hidden', 'true');
    button.style.position = 'relative';
    button.appendChild(beam);
  }

  // Nothing keeps moving once it is off the screen.
  var away = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { e.target.classList.toggle('tw-off', !e.isIntersecting); });
  });
  each('.page-header, .tw-pass--lead, .cta-section', function (box) { away.observe(box); });
})();
