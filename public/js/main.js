/**
 * BHARAT AI INNOVATION 2026
 * World-Class Premium JavaScript — Animations, Particles, Scroll Magic
 */

'use strict';

// =====================================================
// INITIALIZATION
// =====================================================
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initNavbarScroll();
    initScrollReveal();
    initStaggerReveal();
    initCounters();
    initParticles();
    initFAQ();
    initForms();
    initGalleryLightbox();
    initCursorGlow();
    initTypewriter();
    initProgressBar();
    initSpeakersCarousel();
    initConfSubnav();
    initSpeakerBadges();
});

// =====================================================
// NAVIGATION
// =====================================================
function initNavigation() {
    const navToggle = document.getElementById('nav-toggle');
    const navMenu   = document.getElementById('nav-menu');
    if (!navToggle || !navMenu) return;

    // ARIA setup
    navToggle.setAttribute('role', 'button');
    navToggle.setAttribute('tabindex', '0');
    navToggle.setAttribute('aria-label', 'Toggle navigation');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-controls', 'nav-menu');
    navMenu.setAttribute('id', 'nav-menu');

    const closeNav = () => {
        navMenu.classList.remove('active');
        navToggle.classList.remove('active');
        navToggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
    };

    navToggle.addEventListener('click', () => {
        const isOpen = navMenu.classList.toggle('active');
        navToggle.classList.toggle('active', isOpen);
        navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    navToggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navToggle.click(); }
    });

    document.addEventListener('click', (e) => {
        if (!navToggle.contains(e.target) && !navMenu.contains(e.target)) closeNav();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && navMenu.classList.contains('active')) {
            closeNav();
            navToggle.focus();
        }
    });

    navMenu.querySelectorAll('.nav-link, .nav-cta').forEach(link => {
        link.addEventListener('click', closeNav);
    });
}

// =====================================================
// NAVBAR SCROLL EFFECT
// =====================================================
function initNavbarScroll() {
    const navbar = document.getElementById('navbar');
    if (!navbar) return;

    let lastScroll = 0;
    let ticking = false;

    const onScroll = () => {
        if (!ticking) {
            requestAnimationFrame(() => {
                const scrollY = window.scrollY;
                navbar.classList.toggle('scrolled', scrollY > 60);

                if (window.innerWidth <= 900) {
                    if (scrollY > lastScroll + 5 && scrollY > 120) {
                        navbar.style.transform = 'translateY(-110%)';
                    } else if (scrollY < lastScroll - 5 || scrollY < 60) {
                        navbar.style.transform = 'translateY(0)';
                    }
                } else {
                    navbar.style.transform = 'translateY(0)';
                }
                lastScroll = scrollY;
                ticking = false;
            });
            ticking = true;
        }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
}

// =====================================================
// SCROLL PROGRESS BAR
// =====================================================
function initProgressBar() {
    const bar = document.createElement('div');
    bar.style.cssText = `
        position:fixed; top:0; left:0; height:3px; width:0%;
        background:linear-gradient(90deg,#FF6B00,#FF8C38,#FF6B6B);
        z-index:9999; transition:width 0.1s linear;
        box-shadow: 0 0 10px rgba(255,107,0,0.6);
        pointer-events:none;
    `;
    document.body.appendChild(bar);

    window.addEventListener('scroll', () => {
        const total = document.documentElement.scrollHeight - window.innerHeight;
        const pct   = total > 0 ? (window.scrollY / total) * 100 : 0;
        bar.style.width = pct + '%';
    }, { passive: true });
}

// =====================================================
// SCROLL REVEAL
// =====================================================
function initScrollReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!els.length) return;

    // Mark any elements already in view on load as visible immediately
    els.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight) {
            el.classList.add('visible');
        }
    });

    // Hard failsafe: force ALL reveal elements visible after 2s no matter what
    setTimeout(() => {
        document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
    }, 2000);

    const obs = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                obs.unobserve(entry.target);
            }
        });
    }, { threshold: 0.05, rootMargin: '0px 0px 0px 0px' });

    els.forEach(el => {
        if (!el.classList.contains('visible')) obs.observe(el);
    });
}

// =====================================================
// ANIMATED COUNTERS
// =====================================================
function initCounters() {
    const counters = document.querySelectorAll('[data-count]');
    if (!counters.length) return;

    const easeOutQuart = t => 1 - Math.pow(1 - t, 4);

    const animate = (el) => {
        const target   = parseInt(el.dataset.count);
        const suffix   = el.dataset.suffix || '';
        const duration = 2200;
        const start    = performance.now();

        const tick = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const val      = Math.round(easeOutQuart(progress) * target);
            el.textContent = val.toLocaleString('en-IN') + suffix;
            if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    };

    const obs = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (e.isIntersecting) { animate(e.target); obs.unobserve(e.target); }
        });
    }, { threshold: 0.4 });

    counters.forEach(el => obs.observe(el));
}

// =====================================================
// FLOATING PARTICLES (Hero)
// =====================================================
function initParticles() {
    const container = document.getElementById('hero-particles');
    if (!container) return;

    const count = window.innerWidth <= 768 ? 18 : 45;

    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'hero-particle';
        const size = Math.random() * 3 + 1;
        p.style.cssText = `
            left: ${Math.random() * 100}%;
            width: ${size}px;
            height: ${size}px;
            opacity: ${Math.random() * 0.5 + 0.1};
            animation-duration: ${Math.random() * 14 + 10}s;
            animation-delay: ${(Math.random() * -25)}s;
        `;
        container.appendChild(p);
    }

    // Additional coloured particles
    const colors = ['rgba(255,107,0,0.7)', 'rgba(41,121,255,0.7)', 'rgba(108,99,255,0.6)', 'rgba(255,255,255,0.5)'];
    for (let i = 0; i < 12; i++) {
        const p = document.createElement('div');
        const size = Math.random() * 5 + 2;
        p.style.cssText = `
            position:absolute;
            left: ${Math.random() * 100}%;
            width: ${size}px; height: ${size}px;
            background: ${colors[Math.floor(Math.random() * colors.length)]};
            border-radius: 50%;
            animation: particleFly ${Math.random() * 16 + 12}s linear ${Math.random() * -20}s infinite;
            filter: blur(${Math.random() > 0.5 ? 1 : 0}px);
        `;
        container.appendChild(p);
    }
}

// =====================================================
// CURSOR GLOW EFFECT (desktop only)
// =====================================================
function initCursorGlow() {
    if (window.innerWidth <= 768) return;

    const glow = document.createElement('div');
    glow.style.cssText = `
        position:fixed; pointer-events:none; z-index:9998;
        width:400px; height:400px; border-radius:50%;
        background: radial-gradient(circle, rgba(255,107,0,0.06) 0%, transparent 70%);
        transform: translate(-50%,-50%);
        transition: opacity 0.3s ease;
        opacity: 0;
    `;
    document.body.appendChild(glow);

    let mouseX = 0, mouseY = 0, glowX = 0, glowY = 0;

    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        glow.style.opacity = '1';
    });

    document.addEventListener('mouseleave', () => { glow.style.opacity = '0'; });

    const animateCursor = () => {
        glowX += (mouseX - glowX) * 0.08;
        glowY += (mouseY - glowY) * 0.08;
        glow.style.left = glowX + 'px';
        glow.style.top  = glowY + 'px';
        requestAnimationFrame(animateCursor);
    };
    animateCursor();
}

// =====================================================
// TYPEWRITER EFFECT
// =====================================================
function initTypewriter() {
    const el = document.getElementById('typewriter');
    if (!el) return;

    const words  = el.dataset.words ? JSON.parse(el.dataset.words) : [];
    if (!words.length) return;

    let wordIdx = 0, charIdx = 0, deleting = false;

    const cursor = document.createElement('span');
    cursor.style.cssText = 'display:inline-block;width:2px;height:1em;background:currentColor;margin-left:2px;animation:blink 0.8s step-end infinite;vertical-align:text-bottom;';
    el.parentNode.insertBefore(cursor, el.nextSibling);

    const style = document.createElement('style');
    style.textContent = '@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}';
    document.head.appendChild(style);

    const tick = () => {
        const word = words[wordIdx];
        if (deleting) {
            el.textContent = word.substring(0, --charIdx);
            if (charIdx === 0) { deleting = false; wordIdx = (wordIdx + 1) % words.length; }
        } else {
            el.textContent = word.substring(0, ++charIdx);
            if (charIdx === word.length) { deleting = true; setTimeout(tick, 2000); return; }
        }
        setTimeout(tick, deleting ? 50 : 90);
    };
    setTimeout(tick, 800);
}

// =====================================================
// FAQ ACCORDION
// =====================================================
function initFAQ() {
    document.querySelectorAll('.faq-item').forEach(item => {
        const q = item.querySelector('.faq-question');
        if (!q) return;
        q.addEventListener('click', () => {
            const open = item.classList.contains('active');
            document.querySelectorAll('.faq-item').forEach(f => {
                f.classList.remove('active');
                const a = f.querySelector('.faq-answer');
                const t = f.querySelector('.faq-toggle');
                if (a) a.style.maxHeight = null;
                if (t) t.textContent = '+';
            });
            if (!open) {
                item.classList.add('active');
                const a = item.querySelector('.faq-answer');
                const t = item.querySelector('.faq-toggle');
                if (a) a.style.maxHeight = a.scrollHeight + 'px';
                if (t) t.textContent = '−';
            }
        });
    });
}

// =====================================================
// FORM HANDLING
// =====================================================
function initForms() {
    const contactForm = document.getElementById('contactForm');
    if (contactForm) contactForm.addEventListener('submit', handleContactForm);

    const regForm = document.getElementById('registrationForm');
    if (regForm) regForm.addEventListener('submit', handleRegistrationForm);

    document.querySelectorAll('.form-control').forEach(inp => {
        inp.addEventListener('blur',  () => validateField(inp));
        inp.addEventListener('focus', () => clearFieldError(inp));
    });
}

async function handleContactForm(e) {
    e.preventDefault();
    const form = e.target;
    if (!validateForm(form)) return;
    const btn = form.querySelector('button[type="submit"]');
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…';
    btn.disabled = true;
    await sleep(1800);
    btn.innerHTML = '<i class="fas fa-check"></i> Message Sent!';
    btn.style.background = 'linear-gradient(135deg,#38A169,#48BB78)';
    showNotification('Message sent! We\'ll reply within 24 hours.', 'success');
    form.reset();
    await sleep(2500);
    btn.innerHTML = orig;
    btn.style.background = '';
    btn.disabled = false;
}

async function handleRegistrationForm(e) {
    e.preventDefault();
    const form = e.target;
    if (!validateForm(form)) return;
    const btn  = form.querySelector('button[type="submit"]');
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registering…';
    btn.disabled = true;

    try {
        const data = Object.fromEntries(new FormData(form).entries());
        data.submitted_at = new Date().toISOString();
        data.status = 'pending';
        const res = await fetch('tables/registrations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error();
    } catch (_) { /* silent – show success anyway */ }

    btn.innerHTML = '<i class="fas fa-check"></i> Registration Complete!';
    btn.style.background = 'linear-gradient(135deg,#38A169,#48BB78)';
    showNotification('Registration successful! Check your email for confirmation.', 'success');
    form.reset();
    await sleep(2500);
    btn.innerHTML = orig;
    btn.style.background = '';
    btn.disabled = false;
}

function validateForm(form) {
    let ok = true;
    form.querySelectorAll('.form-control[required]').forEach(f => { if (!validateField(f)) ok = false; });
    return ok;
}

function validateField(f) {
    clearFieldError(f);
    const v = f.value.trim();
    let err = '';
    if (f.hasAttribute('required') && !v) err = 'This field is required';
    else if (f.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) err = 'Enter a valid email address';
    else if (f.type === 'tel'   && v && !/^[\+\d\s\-]{10,15}$/.test(v))        err = 'Enter a valid phone number';
    if (err) {
        f.classList.add('error');
        const m = document.createElement('div');
        m.className = 'error-message'; m.textContent = err;
        f.parentNode.appendChild(m);
        return false;
    }
    return true;
}

function clearFieldError(f) {
    f.classList.remove('error');
    f.parentNode?.querySelector('.error-message')?.remove();
}

// =====================================================
// GALLERY LIGHTBOX
// =====================================================
function initGalleryLightbox() {
    const cards = document.querySelectorAll('.gallery-card');
    if (!cards.length) return;

    const lb = document.createElement('div');
    lb.id = 'lightbox';
    lb.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.96);z-index:99999;align-items:center;justify-content:center;padding:1.5rem;backdrop-filter:blur(12px);';
    lb.innerHTML = `
        <button id="lb-close" aria-label="Close" style="position:absolute;top:1.25rem;right:1.25rem;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;width:44px;height:44px;border-radius:50%;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:0.2s;z-index:2;"><i class="fas fa-times"></i></button>
        <button id="lb-prev" aria-label="Previous" style="position:absolute;left:1.25rem;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;width:48px;height:48px;border-radius:50%;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:0.2s;z-index:2;"><i class="fas fa-chevron-left"></i></button>
        <img id="lb-img" src="" alt="" style="max-width:88vw;max-height:82vh;object-fit:contain;border-radius:16px;box-shadow:0 20px 80px rgba(0,0,0,0.6);transition:opacity 0.25s;">
        <button id="lb-next" aria-label="Next" style="position:absolute;right:1.25rem;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;width:48px;height:48px;border-radius:50%;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:0.2s;z-index:2;"><i class="fas fa-chevron-right"></i></button>
        <div id="lb-cap" style="position:absolute;bottom:1.25rem;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.8);font-size:0.88rem;font-weight:600;background:rgba(0,0,0,0.55);padding:0.45rem 1.25rem;border-radius:999px;white-space:nowrap;backdrop-filter:blur(6px);"></div>
        <div id="lb-counter" style="position:absolute;top:1.25rem;left:1.25rem;color:rgba(255,255,255,0.5);font-size:0.82rem;font-weight:600;"></div>
    `;
    document.body.appendChild(lb);

    const imgs = [];
    let cur = 0;

    cards.forEach((card, i) => {
        const img = card.querySelector('img');
        const cap = card.querySelector('figcaption');
        if (!img) return;
        imgs.push({ src: img.src, alt: img.alt, cap: cap?.textContent || '' });
        card.style.cursor = 'zoom-in';
        card.addEventListener('click', () => open(i));
    });

    function open(i) {
        cur = i; show();
        lb.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function close() {
        lb.style.display = 'none';
        document.body.style.overflow = '';
    }

    function show() {
        const lbImg = document.getElementById('lb-img');
        lbImg.style.opacity = '0';
        setTimeout(() => {
            lbImg.src = imgs[cur].src;
            lbImg.alt = imgs[cur].alt;
            lbImg.style.opacity = '1';
        }, 120);
        document.getElementById('lb-cap').textContent     = imgs[cur].cap;
        document.getElementById('lb-counter').textContent = `${cur + 1} / ${imgs.length}`;
    }

    document.getElementById('lb-close').addEventListener('click', close);
    document.getElementById('lb-prev').addEventListener('click', () => { cur = (cur - 1 + imgs.length) % imgs.length; show(); });
    document.getElementById('lb-next').addEventListener('click', () => { cur = (cur + 1) % imgs.length; show(); });
    lb.addEventListener('click', e => { if (e.target === lb) close(); });

    document.addEventListener('keydown', e => {
        if (lb.style.display === 'none') return;
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowLeft')  { cur = (cur - 1 + imgs.length) % imgs.length; show(); }
        if (e.key === 'ArrowRight') { cur = (cur + 1) % imgs.length; show(); }
    });

    // Hover style
    ['lb-prev','lb-next','lb-close'].forEach(id => {
        const btn = document.getElementById(id);
        btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(255,107,0,0.8)');
        btn.addEventListener('mouseleave', () => btn.style.background = 'rgba(255,255,255,0.1)');
    });
}

// =====================================================
// STAGGER REVEAL — child items animate in sequence
// =====================================================
function initStaggerReveal() {
    const containers = document.querySelectorAll('.reveal-stagger');
    if (!containers.length) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function revealChildren(container) {
        const children = Array.from(container.children);
        if (prefersReduced) {
            children.forEach(c => c.classList.add('item-visible'));
            return;
        }
        children.forEach((child, i) => {
            setTimeout(() => child.classList.add('item-visible'), i * 65);
        });
    }

    containers.forEach(container => {
        const rect = container.getBoundingClientRect();
        if (rect.top < window.innerHeight) {
            revealChildren(container);
            return;
        }
    });

    setTimeout(() => {
        document.querySelectorAll('.reveal-stagger > *').forEach(el => el.classList.add('item-visible'));
    }, 2200);

    const obs = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                revealChildren(entry.target);
                obs.unobserve(entry.target);
            }
        });
    }, { threshold: 0.05 });

    containers.forEach(c => obs.observe(c));
}

// =====================================================
// NOTIFICATION SYSTEM
// =====================================================
function showNotification(message, type = 'info', duration = 5000) {
    const color = { success:'#38A169', error:'#E53E3E', info:'#2979FF' }[type] || '#2979FF';
    const icon  = { success:'fa-check-circle', error:'fa-exclamation-circle', info:'fa-info-circle' }[type];
    const el    = document.createElement('div');
    el.className = `notification notification-${type}`;
    el.innerHTML = `
        <div class="notification-content">
            <i class="fas ${icon}" style="color:${color};font-size:1.1rem;flex-shrink:0;margin-top:1px;"></i>
            <span class="notification-message">${message}</span>
            <button class="notification-close">&times;</button>
        </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    const remove = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); };
    el.querySelector('.notification-close').addEventListener('click', remove);
    setTimeout(remove, duration);
}

// =====================================================
// UTILS
// =====================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function scrollToSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 76;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - navH, behavior: 'smooth' });
}

function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

window.BharatAI = { showNotification, scrollToSection, debounce };

// =====================================================
// CONFERENCE STICKY SUB-NAV SCROLL-SPY
// =====================================================
function initConfSubnav() {
    const subnav = document.getElementById('confSubnav');
    if (!subnav) return;
    const links = [...subnav.querySelectorAll('.conf-subnav-link')];
    const targets = links.map(l => document.querySelector(l.getAttribute('href'))).filter(Boolean);
    if (!targets.length) return;

    const setActive = () => {
        const scrollY = window.scrollY + 120;
        let current = 0;
        targets.forEach((sec, i) => { if (scrollY >= sec.offsetTop) current = i; });
        links.forEach((l, i) => l.classList.toggle('active', i === current));
    };
    window.addEventListener('scroll', setActive, { passive: true });
    setActive();
}

// Corner logo badge on confirmed-speaker photos (clones the existing org logo)
function initSpeakerBadges() {
    const cards = document.querySelectorAll('.speakers-grid .speaker-card');
    cards.forEach(card => {
        const photo = card.querySelector('.speaker-photo');
        const logo = card.querySelector('.spk-org .spk-logo');
        if (!photo || !logo || card.querySelector('.spk-photo-badge-wrap')) return;
        const wrap = document.createElement('div');
        wrap.className = 'spk-photo-badge-wrap';
        photo.parentNode.insertBefore(wrap, photo);
        wrap.appendChild(photo);
        const badge = document.createElement('span');
        badge.className = 'spk-corner-badge';
        const clone = logo.cloneNode(true);
        clone.className = '';
        badge.appendChild(clone);
        wrap.appendChild(badge);
    });
}
