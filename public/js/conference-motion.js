/* Motion on /conference only: the licence and how to remove it are at the top of
   css/conference-motion.css. Rebuilt without React from Vengeance UI (MIT, copyright
   2025-2026 Ashutoshx7). With animations off this file does nothing at all. */
(function () {
  'use strict';
  if (!window.matchMedia || !window.IntersectionObserver) return;
  if (!matchMedia('(prefers-reduced-motion: no-preference)').matches) return;

  // Stagger Text: each word of a section heading rises when the heading comes into view.
  // Words stay real text with real spaces. A coloured span moves as one piece.
  function mask(node, i) {
    var outer = document.createElement('span');
    var inner = document.createElement('span');
    outer.className = 'cf-w';
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
    el.classList.add('cf-split');
  }
  var seen = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('cf-in');
      seen.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('h2.section-title, .registration-cta h2').forEach(function (h) {
    split(h);
    seen.observe(h);
  });

  // Spotlight Navbar: main.js marks the current section's link; the light goes there.
  var links = document.querySelector('.conf-subnav-links');
  if (links) {
    var light = document.createElement('i');
    light.className = 'cf-light';
    light.setAttribute('aria-hidden', 'true');
    var place = function () {
      var a = links.querySelector('.conf-subnav-link.active');
      if (!a) return;
      links.style.setProperty('--cf-x', a.offsetLeft + 'px');
      links.style.setProperty('--cf-w', a.offsetWidth + 'px');
      // On a narrow phone the menu scrolls sideways: keep the lit link in view.
      if (links.scrollWidth > links.clientWidth) links.scrollLeft = a.offsetLeft - (links.clientWidth - a.offsetWidth) / 2;
    };
    links.appendChild(light);
    links.classList.add('cf-spot');
    new MutationObserver(place).observe(links, { subtree: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', place, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    place();
    if (matchMedia('(hover: hover)').matches) {
      links.addEventListener('pointermove', function (e) {
        var box = links.getBoundingClientRect();
        links.style.setProperty('--cf-mouse', (e.clientX - box.left) + 'px');
        links.style.setProperty('--cf-glow', '1');
      }, { passive: true });
      links.addEventListener('pointerleave', function () { links.style.setProperty('--cf-glow', '0'); });
    }
  }

  // Border Beam: on the main button at the foot of the page.
  var button = document.querySelector('.registration-cta .btn-primary');
  if (button) {
    var beam = document.createElement('span');
    beam.className = 'cf-beam';
    beam.setAttribute('aria-hidden', 'true');
    button.appendChild(beam);
  }

  // Nothing keeps moving once it is off the screen.
  var away = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { e.target.classList.toggle('cf-off', !e.isIntersecting); });
  });
  document.querySelectorAll('.page-header, .registration-cta').forEach(function (box) { away.observe(box); });
})();
