// The campus-panel suites (smoke-panel-answers.mjs, phone-test.cjs and the
// phone-harness.mjs it drives) need a panel that has not started: answers close
// at startsAt. From 30 Sep 2026 every panel in CAMPUS_PANELS was in the past and
// both suites stopped with "add a future one or this suite cannot run", which
// left "Are you coming?", the claim and the certificate untested until the next
// panel was booked.
//
// panelClock() picks the next panel that has not started. When there is none it
// picks the last one and says how far to move the clock back so that it is two
// days before that panel, the position the suites last passed from. Each process
// computes the same answer from src/index.tsx, so a harness and its suite agree
// without talking to each other.
//
// shiftClock(ms) moves this process's clock by ms and lets it keep running:
// Date.now() and new Date() both move, timers do not. Only the verify processes
// call it; nothing here reaches the worker that ships.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src', 'index.tsx');
const DAY = 24 * 60 * 60 * 1000;

function panelClock() {
  const src = fs.readFileSync(SRC, 'utf8');
  const panels = [...src.matchAll(/'([a-z0-9-]+)':\s*\{[\s\S]{0,80}?slug: '\1'[\s\S]*?startsAt: '([^']+)'/g)]
    .map(m => ({ slug: m[1], at: Date.parse(m[2]) }))
    .sort((a, b) => a.at - b.at);
  if (!panels.length) throw new Error('no campus panel in CAMPUS_PANELS');
  const now = Date.now();
  const next = panels.find(p => p.at > now);
  if (next) return { slug: next.slug, shiftMs: 0 };
  const last = panels[panels.length - 1];
  return { slug: last.slug, shiftMs: (last.at - 2 * DAY) - now };
}

function shiftClock(ms) {
  if (!ms) return;
  const Real = Date;
  class ShiftedDate extends Real {
    constructor(...args) { if (args.length) super(...args); else super(Real.now() + ms); }
    static now() { return Real.now() + ms; }
  }
  globalThis.Date = ShiftedDate;
}

module.exports = { panelClock, shiftClock };
