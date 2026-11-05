// The pass prices are dated: the standard price until the end of 5 Nov 2026
// (IST), the late price from 6 Nov. The worker reads the day from the clock, and
// several suites state the standard figures (5,898.82 for a Delegate Pass and so
// on). From 6 Nov those suites would fail for a reason that is in no one's code.
//
// standardPriceClock() moves this process's clock back by whole days so that it
// is 5 Nov 2026 in India, at the same time of day. Every relative time in a suite
// (five minutes ago, an hour old, 9am to 9pm) holds as before, and the worker,
// loaded in the same process, charges the standard price. Before 6 Nov it does
// nothing. The late prices have their own checks, which pin the clock themselves
// (smoke-payments.mjs "dated prices", and the upgrade suites through
// upgrade-world.mjs).
//
// Call it first, before anything reads the time:
//   import { standardPriceClock } from './price-clock.mjs';
//   standardPriceClock();
export const PRICE_DEADLINE_IST = '2026-11-05';

export function standardPriceClock() {
  const Real = Date;
  const istDay = new Real(Real.now() + 19800000).toISOString().slice(0, 10);
  const days = Math.round((Real.parse(istDay + 'T00:00:00Z') - Real.parse(PRICE_DEADLINE_IST + 'T00:00:00Z')) / 86400000);
  if (days <= 0) return 0;
  const off = -days * 86400000;
  globalThis.Date = class extends Real {
    constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); }
    static now() { return Real.now() + off; }
  };
  return days;
}
