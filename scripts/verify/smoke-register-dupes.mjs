// Built-worker checks for one person, one registration (28 Oct 2026): an email or a
// mobile already on the list cannot make a second attendee.
// Run after `npm run build`:  node scripts/verify/smoke-register-dupes.mjs
const worker = (await import(new URL('../../dist/_worker.js?' + Date.now(), import.meta.url).href)).default;

const rows = [];
const audits = [];
const DB = {
  prepare(sql) {
    let args = [];
    const q = {
      bind(...a) { args = a; return q; },
      async first() {
        if (/SELECT id FROM attendees WHERE event_id = \? AND email = \?/.test(sql)) {
          const a = rows.find(r => String(r.event_id) === String(args[0]) && r.email === args[1]); return a ? { id: a.id } : null;
        }
        if (/SELECT \* FROM attendees WHERE event_id = \? AND email = \?/.test(sql)) {
          const a = rows.find(r => String(r.event_id) === String(args[0]) && r.email === args[1]); return a ? { ...a } : null;
        }
        if (/SELECT \* FROM attendees WHERE id = \?/.test(sql)) { const a = rows.find(r => r.id === Number(args[0])); return a ? { ...a } : null; }
        return null;
      },
      async all() {
        if (/SELECT email, mobile FROM attendees WHERE event_id = \?/.test(sql)) {
          return { results: rows.filter(r => String(r.event_id) === String(args[0]) && r.mobile).map(r => ({ email: r.email, mobile: r.mobile })) };
        }
        return { results: [] };
      },
      async run() {
        if (/^INSERT INTO attendees/.test(sql)) {
          const cols = sql.match(/\(([^)]*)\)/)[1].split(',').map(s => s.trim());
          const row = {}; let i = 0;
          for (const col of cols) { if (/datetime|^1$/.test(col)) continue; row[col] = args[i++]; }
          row.event_id = args[0]; row.name = args[1]; row.email = args[2];
          if (rows.some(r => String(r.event_id) === String(row.event_id) && r.email === row.email)) throw new Error('UNIQUE constraint failed: attendees.event_id, attendees.email');
          row.id = rows.length + 1;
          row.mobile = /external/.test(sql) ? args[5] : (cols.includes('mobile') ? args[cols.indexOf('mobile')] : '');
          rows.push(row);
          return { meta: { last_row_id: row.id, changes: 1 } };
        }
        if (/INSERT INTO admin_audit/.test(sql)) audits.push(args);
        return { meta: { changes: 0 } };
      },
    };
    return q;
  },
  async batch(stmts) { return Promise.all(stmts.map(s => s.run())); },
};
const env = new Proxy({ ADMIN_SECRET: 'smoke-admin', SESSION_SECRET: 'smoke-session', DB }, { get: (t, k) => (k in t ? t[k] : undefined) });
const ctx = { waitUntil() {}, passThroughOnException() {} };
const post = async (path, body) => {
  const res = await worker.fetch(new Request('https://bharataiinnovation.com' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};
const reg = (over) => post('/api/events/1/attendees/register', { name: 'Asha Rao', company: 'Rao Labs', job_title: 'Founder', city: 'Pune', industry: 'Software & SaaS', badge_type: 'Visitor Pass', ...over });
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  <- ' + d)); if (!ok) fails++; };

let r = await reg({ email: 'asha.rao@gmail.com', mobile: '+91 98200 15151' });
check('a first registration goes through', r.status === 201 && rows.length === 1, r.status + ' ' + r.text);

for (const mobile of ['9820015151', '09820015151', '+91-98200-15151', '919820015151']) {
  const before = rows.length;
  r = await reg({ name: 'Asha R', email: 'asha.work@rao.in', mobile });
  check('the same mobile under a new email is refused: ' + mobile, r.status === 409 && rows.length === before && r.json?.code === 'mobile_registered', r.status + ' ' + r.text);
}
check('the refusal says so in plain words and masks the email that holds it', /already registered with as•••@gmail\.com/.test(r.json?.error || '') && r.json?.message === r.json?.error && !r.text.includes('asha.rao@gmail.com'), r.text);
check('the refusal is in the audit log', audits.length >= 1, String(audits.length));

r = await reg({ email: 'ASHA.RAO@gmail.com ', mobile: '9999911111' });
check('the same email in other case is not a second attendee', rows.length === 1 && r.status !== 201, r.status + ' ' + r.text);

r = await reg({ email: 'asha.rao@gmail.com' });
check('a returning app re-posting its own email (no mobile) is not refused as a duplicate mobile', r.json?.code !== 'mobile_registered', r.status + ' ' + r.text);

r = await reg({ name: 'Ravi Kumar', email: 'ravi@kumar.in', mobile: '9820015152' });
check('a different mobile registers normally', r.status === 201 && rows.length === 2, r.status + ' ' + r.text);

r = await post('/api/external/register', { first_name: 'Asha', last_name: 'R', email: 'asha.alt@rao.in', phone: '98200 15151', organization: 'Rao Labs', job_title: 'Founder', industry: 'Software & SaaS', city: 'Pune' });
check('the external route refuses the same mobile too', r.status === 409 && r.json?.code === 'mobile_registered' && rows.length === 2, r.status + ' ' + r.text);

r = await post('/api/external/register', { first_name: 'Meera', last_name: 'S', email: 'meera@s.in', phone: '9811122233', organization: 'S Co', job_title: 'CTO', industry: 'Software & SaaS', city: 'Delhi' });
check('the external route still registers a new mobile', r.status === 201 && rows.length === 3, r.status + ' ' + r.text);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
