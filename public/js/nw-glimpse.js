// Shared by /networking and /register (14 Nov 2026). Moved here from networking.html, unchanged.
// "How it works" (#who-is-coming): fills the app screen from the app, plays
// its five steps (find, connect, book a meeting, message, share), draws the
// "I'm attending" card with the app's own renderer, and a tap anywhere on the
// phone opens "Want to meet ...?". Text is set with textContent, never as
// HTML: names, titles and cities are typed by registrants.
(function () {
    var section = document.getElementById('who-is-coming');
    var list = document.getElementById('nw-grid');
    var screen = document.getElementById('nw-screen');
    var scroller = document.getElementById('nw-scroll');
    var steps = document.getElementById('nw-steps');
    var dialog = document.getElementById('nw-dialog');
    if (!section || !list || !screen || !window.fetch) { if (section) section.hidden = true; return; }
    var STEP_MS = [5000, 4500, 5500, 5000, 6500];
    var STEP_TAB = ['network', 'network', 'network', 'inbox', 'dashboard'];
    var featured = null;
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }
    function icon(name) {
        var i = el('i', 'fas ' + name);
        i.setAttribute('aria-hidden', 'true');
        return i;
    }
    function photo(p, cls, size, eager) {
        var img = el('img', cls);
        img.src = p.photo;
        img.alt = '';
        img.width = size;
        img.height = size;
        img.loading = eager ? 'eager' : 'lazy';
        img.decoding = 'async';
        return img;
    }
    // "Dr. Asha Rao" is Asha in a message, not Dr.
    function firstName(name) {
        var parts = String(name || '').split(' ');
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] && !/\.$/.test(parts[i]) && !/^(dr|mr|mrs|ms|prof|ca|er|shri|smt)$/i.test(parts[i])) return parts[i];
        }
        return parts[0] || '';
    }
    function roleLine(p) { return [p.title, p.company].filter(Boolean).join(' · '); }
    function openWho(p) {
        if (!dialog || typeof dialog.showModal !== 'function') { window.location.href = '/register#delegate'; return; }
        var ava = document.getElementById('nw-d-ava');
        ava.innerHTML = '';
        if (p && p.photo) ava.appendChild(photo(p, '', 72)); else ava.appendChild(icon('fa-lock'));
        document.getElementById('nw-d-title').textContent = p && p.name ? 'Want to meet ' + firstName(p.name) + '?' : 'Want to meet this person?';
        document.getElementById('nw-d-who').textContent = p ? (p.name ? p.name : p.title) : '';
        var where = p ? (p.name ? roleLine(p) : [p.industry, p.city].filter(Boolean).join(' · ')) : '';
        var w = document.getElementById('nw-d-where');
        w.textContent = where;
        w.hidden = !where;
        document.getElementById('nw-d-text').textContent = p && p.name
            ? 'Get a Delegate Pass to connect, message and book a meeting with ' + firstName(p.name) + ' in the Bharat AI Connect app.'
            : 'Register to see their name and company in the Bharat AI Connect app.';
        dialog.showModal();
    }
    // The app's directory card, for somebody who shared their card.
    // The first few faces are on screen at once; the rest load as they scroll in.
    function personCard(p, i) {
        var b = el('button', 'nw-pc');
        b.type = 'button';
        var top = el('span', 'nw-pc-top');
        top.appendChild(photo(p, 'nw-pc-ava', 46, i < 4));
        var txt = el('span', 'nw-pc-txt');
        txt.appendChild(el('span', 'nw-pc-name', p.name));
        if (roleLine(p)) txt.appendChild(el('span', 'nw-pc-role', roleLine(p)));
        top.appendChild(txt);
        b.appendChild(top);
        var acts = el('span', 'nw-pc-acts');
        var prof = el('span', 'nw-a nw-a-prof'); prof.appendChild(icon('fa-user')); prof.appendChild(document.createTextNode('Profile'));
        var conn = el('span', 'nw-a nw-a-conn');
        var idle = el('span', 's-idle'); idle.appendChild(icon('fa-plus')); idle.appendChild(document.createTextNode(' Connect'));
        var sent = el('span', 's-sent'); sent.appendChild(icon('fa-check')); sent.appendChild(document.createTextNode(' Requested'));
        conn.appendChild(idle); conn.appendChild(sent);
        var msg = el('span', 'nw-a nw-a-msg'); msg.appendChild(icon('fa-comment'));
        var meet = el('span', 'nw-a nw-a-meet'); meet.appendChild(icon('fa-calendar-plus'));
        acts.appendChild(prof); acts.appendChild(conn); acts.appendChild(msg); acts.appendChild(meet);
        b.appendChild(acts);
        b.setAttribute('aria-label', p.name + (roleLine(p) ? ', ' + roleLine(p) : '') + '. Meet them');
        b.addEventListener('click', function (e) { e.stopPropagation(); openWho(p); });
        return b;
    }
    // The app's locked card: a lock for a face, a grey bar for the name.
    function lockedCard(p) {
        var b = el('button', 'nw-lc');
        b.type = 'button';
        var top = el('span', 'nw-lc-top');
        var ava = el('span', 'nw-lc-ava');
        ava.appendChild(icon('fa-lock'));
        top.appendChild(ava);
        var txt = el('span', 'nw-lc-txt');
        txt.appendChild(el('span', 'nw-lc-bar'));
        txt.appendChild(el('span', 'nw-lc-title', p.title));
        var meta = [p.industry, p.city].filter(Boolean).join(' · ');
        if (meta) txt.appendChild(el('span', 'nw-lc-meta', meta));
        top.appendChild(txt);
        b.appendChild(top);
        if (p.goals && p.goals.length) {
            var g = el('span', 'nw-lc-goals');
            p.goals.forEach(function (x) { g.appendChild(el('span', '', 'Here to: ' + x)); });
            b.appendChild(g);
        }
        var s = el('span', 'nw-lc-btn');
        s.appendChild(icon('fa-lock'));
        s.appendChild(document.createTextNode('See who this is'));
        b.appendChild(s);
        b.setAttribute('aria-label', [p.title, p.industry, p.city].filter(Boolean).join(', ') + '. See who this is');
        b.addEventListener('click', function (e) { e.stopPropagation(); openWho(p); });
        return b;
    }
    // The meeting, the chat and the share screen are about the first person.
    function fillDemo(p) {
        var with_ = document.getElementById('nw-sh-with');
        var head = document.getElementById('nw-ch-head');
        var who = p.name || p.title;
        with_.innerHTML = '';
        if (p.photo) with_.appendChild(photo(p, '', 22));
        with_.appendChild(document.createTextNode('With ' + who));
        head.innerHTML = '';
        if (p.photo) head.appendChild(photo(p, '', 34));
        var t = el('span');
        t.appendChild(el('b', '', who));
        if (p.company || p.industry) t.appendChild(el('small', '', p.company || p.industry));
        head.appendChild(t);
        document.getElementById('nw-bub').textContent = 'Hi' + (p.name ? ' ' + firstName(p.name) : '') +
            ', I am coming to Bharat AI Innovation and would value 30 minutes with you. Does 20 Nov at 11:30 work?';
    }
    // "I'm attending" cards, drawn by the app's own renderer: the script is
    // loaded once, and each person's card is drawn once and used by both the
    // phone's last step and the band of cards under the steps.
    var rendererReady = null, cards = {};
    function renderer() {
        if (!rendererReady) rendererReady = new Promise(function (ok, no) {
            if (window.BhaiSocialCard) return ok(window.BhaiSocialCard);
            var s = document.createElement('script');
            s.src = '/js/social-card.js?v=20261102';
            s.onload = function () { if (window.BhaiSocialCard) ok(window.BhaiSocialCard); else no(new Error('renderer')); };
            s.onerror = function () { no(new Error('renderer')); };
            document.head.appendChild(s);
        });
        return rendererReady;
    }
    function cardFor(p) {
        if (!p || !p.name || !p.photo) return Promise.reject(new Error('no photo'));
        if (!cards[p.photo]) {
            cards[p.photo] = renderer().then(function (R) {
                return R.render({ name: p.name, job_title: p.title, company: p.company, avatar_url: p.photo }, { size: 'square', companyLogo: '' });
            }).then(function (res) {
                // A card whose photo did not load is a letter in a circle: not shown.
                if (!res || res.photoFailed || !res.hasPhoto) throw new Error('photo');
                return res.dataUrl;
            });
        }
        return cards[p.photo];
    }
    var cardDrawn = false;
    function drawCard() {
        if (cardDrawn || !featured) return;
        cardDrawn = true;
        var wait = document.getElementById('nw-card-wait');
        var img = document.getElementById('nw-card-img');
        cardFor(featured).then(function (url) {
            img.src = url;
            img.alt = 'The I’m attending card ' + featured.name + ' made in the app';
            img.hidden = false;
            wait.hidden = true;
        }).catch(function () { wait.textContent = 'Your card is made in the app, from your photo.'; });
    }
    // The band under the steps: up to three real cards, drawn one after another
    // once the band is near the screen. It stays hidden if none can be drawn.
    function fillCards(people) {
        var band = document.getElementById('nw-cards');
        var row = document.getElementById('nw-cards-row');
        var who = people.filter(function (p) { return p.name && p.photo; }).slice(0, 3);
        if (!band || !row || !who.length) return;
        band.hidden = false;
        var slots = who.map(function () { var s = el('div', 'nw-cardslot'); row.appendChild(s); return s; });
        var started = false;
        function start() {
            if (started) return;
            started = true;
            var chain = Promise.resolve(), shown = 0;
            who.forEach(function (p, i) {
                chain = chain.then(function () { return cardFor(p); }).then(function (url) {
                    var img = el('img');
                    img.src = url;
                    img.alt = 'The I’m attending card ' + p.name + ' made in the app';
                    img.width = 1080;
                    img.height = 1080;
                    slots[i].appendChild(img);
                    shown++;
                }, function () { slots[i].parentNode.removeChild(slots[i]); });
            });
            chain.then(function () { if (!shown) band.hidden = true; });
        }
        if ('IntersectionObserver' in window) {
            var io = new IntersectionObserver(function (es) {
                if (es[0].isIntersecting) { io.disconnect(); start(); }
            }, { rootMargin: '300px' });
            io.observe(band);
        } else start();
    }
    // Playing the steps: on its own while the section is on screen, never
    // for anyone who asked their device for less motion; a tap on a step
    // shows that step and carries on from there.
    var current = 1, timer = null, onScreen = false;
    var still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var buttons = steps ? [].slice.call(steps.querySelectorAll('button[data-step]')) : [];
    function show(n) {
        current = n;
        screen.setAttribute('data-step', String(n));
        if (n <= 2 && scroller) scroller.scrollTop = 0;
        var feat = list.querySelector('.nw-feat');
        if (feat) feat.classList.toggle('nw-sent', n >= 2);
        [].forEach.call(screen.querySelectorAll('.nw-tab'), function (t) { t.classList.toggle('on', t.getAttribute('data-tab') === STEP_TAB[n - 1]); });
        buttons.forEach(function (b) {
            var on = Number(b.getAttribute('data-step')) === n;
            b.classList.toggle('on', on);
            b.classList.remove('nw-run');
            if (on) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
        });
        var label = buttons[n - 1] ? buttons[n - 1].querySelector('b').firstChild.textContent.trim() : '';
        var now = document.getElementById('nw-now');
        if (now) { now.textContent = 'Step ' + n + ' of 5 · '; now.appendChild(el('span', '', label)); }
        if (n === 5 || n === 4) drawCard();
        schedule();
    }
    function schedule() {
        clearTimeout(timer);
        if (still || !onScreen) return;
        var b = buttons[current - 1];
        if (b) { b.style.setProperty('--nw-dur', STEP_MS[current - 1] + 'ms'); void b.offsetWidth; b.classList.add('nw-run'); }
        timer = setTimeout(function () { show(current % 5 + 1); }, STEP_MS[current - 1]);
    }
    buttons.forEach(function (b) {
        b.addEventListener('click', function () { show(Number(b.getAttribute('data-step'))); });
    });
    screen.addEventListener('click', function () { openWho(featured); });
    if (dialog) {
        // A tap on the dark area around the box closes it, like the close button.
        dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
    }
    fetch('/api/events/1/glimpse', { credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
            var people = (d && Array.isArray(d.people)) ? d.people : [];
            // 14 Nov 2026 (organiser): only people with a photo, from companies (the server leaves
            // out academics), so the locked cards are not drawn.
            var locked = [];
            if (people.length < 4) { section.hidden = true; return; }
            list.innerHTML = '';
            list.removeAttribute('aria-busy');
            people.forEach(function (p, i) {
                var c = personCard(p, i);
                if (i === 0) c.classList.add('nw-feat');
                list.appendChild(c);
            });
            locked.forEach(function (p) { list.appendChild(lockedCard(p)); });
            if (!people.length) {
                // Nobody named today: the demo runs on the first locked card.
                var first = list.querySelector('.nw-lc');
                if (first) first.classList.add('nw-feat');
            }
            featured = people[0] || locked[0];
            fillDemo(featured);
            fillCards(people);
            // The Industry chips are the industries on today's list.
            var seen = [], chips = document.getElementById('nw-industries');
            people.concat(locked).forEach(function (p) { if (p.industry && seen.indexOf(p.industry) < 0) seen.push(p.industry); });
            if (chips && seen.length) {
                chips.innerHTML = '';
                seen.slice(0, 4).forEach(function (x) { chips.appendChild(el('span', '', x)); });
            }
            if ('IntersectionObserver' in window) {
                new IntersectionObserver(function (es) {
                    var was = onScreen;
                    onScreen = es[0].isIntersecting;
                    if (onScreen && !was) schedule(); else if (!onScreen) clearTimeout(timer);
                }, { threshold: 0.35 }).observe(screen);
            } else { onScreen = true; schedule(); }
        })
        .catch(function () { section.hidden = true; });
})();
