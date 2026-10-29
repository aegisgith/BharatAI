// Shared by smoke-payments.mjs and pay-harness.mjs: a stand-in D1 that keeps just
// enough state for the checkout routes, and the gateway's side of the wire, played
// by Node's own crypto the way CCAvenue's kits write it (AES-128-CBC, key = MD5 of
// the working key, IV 00..0f, hex). Nothing here is a real credential.
import crypto from 'node:crypto';

export const KEY = '0123456789ABCDEF0123456789ABCDEF';   // shaped like a working key, not one
export const SECRETS = { CCAVENUE_MERCHANT_ID: '9900001', CCAVENUE_ACCESS_CODE: 'AVSM00KE00TE00ST00', CCAVENUE_WORKING_KEY: KEY };
const IV = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
const kitKey = (k) => crypto.createHash('md5').update(k).digest();
export const kitEncrypt = (plain, k = KEY) => { const c = crypto.createCipheriv('aes-128-cbc', kitKey(k), IV); return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('hex'); };
export const kitDecrypt = (hex, k = KEY) => { const d = crypto.createDecipheriv('aes-128-cbc', kitKey(k), IV); return Buffer.concat([d.update(Buffer.from(hex, 'hex')), d.final()]).toString('utf8'); };

export const sessionCookie = (secret, id) => { const exp = Math.floor(Date.now() / 1000) + 3600; const b = `${id}.${exp}`; return 'bai_session=' + b + '.' + crypto.createHmac('sha256', secret).update(b).digest('hex'); };
export const staffCookie = (secret, id) => { const exp = Math.floor(Date.now() / 1000) + 3600; return 'bhai_staff=' + id + '.' + exp + '.' + crypto.createHmac('sha256', secret).update('staff:' + id + '.' + exp).digest('hex'); };
export const orderSig =(secret, orderId, paise) => crypto.createHmac('sha256', secret).update('pay-order:' + orderId + ':' + paise).digest('hex').slice(0, 32);

// An answer shaped like the gateway's own: key=value pairs, values as they are.
export const gatewayAnswer = (secret, o, over = {}) => {
  const f = {
    order_id: o.order_id, tracking_id: '115023456789', bank_ref_no: '428713', order_status: 'Success', failure_message: '',
    payment_mode: 'Net Banking', card_name: 'AvenuesTest', status_code: 'null', status_message: 'Y', currency: 'INR',
    amount: (o.amount_paise / 100).toFixed(2), billing_name: 'Asha Rao', billing_address: 'Kukreja Centre', billing_city: 'Mumbai',
    billing_state: 'MH', billing_zip: '400614', billing_country: 'India', billing_tel: '9820012345', billing_email: 'a@example.com',
    merchant_param1: orderSig(secret, o.order_id, o.amount_paise), merchant_param2: o.pass_type, merchant_param3: '', vault: 'N',
    discount_value: '0.0', mer_amount: (o.amount_paise / 100).toFixed(2), retry: 'N', response_code: '0', trans_date: '04/10/2026 12:11:33', ...over,
  };
  return Object.entries(f).map(([k, v]) => k + '=' + v).join('&');
};

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export function makePayDb() {
  const state = { table: true, settings: {}, attendees: {}, orders: [], invoices: [], audits: [], attendeeUpdates: [], sqls: [], recent: null, staff: {},
    leadsTable: true, leads: [], ipCount: null, loginTokens: true, campaigns: [], recipients: [] };
  // The two audience rules, as the SQL has them (STUDENT_RANK_SQL, SENIOR_RANK_SQL).
  // check-payment-sql.py runs the real SQL; this only has to agree for the fixtures.
  const norm = (t) => ' ' + String(t || '').toLowerCase().replace(/[.,-]/g, ' ') + ' ';
  const isStudent = (t) => /student|scholar|trainee|graduand| interns? /.test(norm(t));
  const isSenior = (t) => /founder|chief|president|director|chairman|chairperson|managing| (ceo|cto|cio|coo|cfo|cmo|cxo|cdo|md|vp|avp|svp|evp|head|partner|owner|dean|professor|principal) /.test(norm(t));
  const FREE = /^((visitor|general)( pass)?)?$/i;
  const byEmail = (email) => Object.values(state.attendees).find(a => a.email === email) || null;
  const person = (id, over = {}) => (state.attendees[id] = {
    id, event_id: 1, name: 'Asha Rao', email: `a${id}@example.com`, mobile: '+91 98200 12345', city: 'Mumbai', company: 'Acme', job_title: 'CTO',
    badge_type: 'Visitor Pass', payment_status: 'paid', main_event: 0, ...over,
  });
  const DB = {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async first() {
          state.sqls.push(sql);
          if (/SELECT id FROM payment_orders LIMIT 1/.test(sql)) { if (!state.table) throw new Error('no such table: payment_orders'); return null; }
          if (/SELECT value FROM app_settings WHERE key = \?/.test(sql)) return args[0] in state.settings ? { value: state.settings[args[0]] } : null;
          if (/SELECT COUNT\(\*\) AS n FROM payment_orders WHERE attendee_id = \?/.test(sql)) return { n: state.recent ?? state.orders.filter(o => o.attendee_id === args[0]).length };
          if (/SELECT \* FROM payment_orders WHERE order_id = \?/.test(sql)) { const o = state.orders.find(x => x.order_id === args[0]); return o ? { ...o } : null; }
          if (/SELECT id FROM checkout_leads LIMIT 1/.test(sql)) { if (!state.leadsTable) throw new Error('no such table: checkout_leads'); return null; }
          if (/SELECT COUNT\(\*\) AS n FROM checkout_leads WHERE ip = \?/.test(sql)) return { n: state.ipCount ?? state.leads.filter(l => l.ip === args[0]).length };
          if (/SELECT \* FROM checkout_leads WHERE id = \?/.test(sql)) { const l = state.leads.find(x => x.id === Number(args[0])); return l ? { ...l } : null; }
          if (/FROM sqlite_master WHERE type='table' AND name='login_tokens'/.test(sql)) return state.loginTokens ? { name: 'login_tokens' } : null;
          if (/SELECT id FROM attendees WHERE event_id = \? AND email = \?/.test(sql)) { const a = byEmail(args[1]); return a ? { id: a.id } : null; }
          if (/SELECT \* FROM attendees WHERE event_id = \? AND email = \?/.test(sql)) { const a = byEmail(args[1]); return a ? { ...a } : null; }
          if (/SELECT \* FROM campaigns WHERE id = \?/.test(sql)) { const k = state.campaigns.find(x => x.id === Number(args[0])); return k ? { ...k } : null; }
          if (/SELECT COUNT\(\*\) AS n FROM campaign_recipients WHERE campaign_id = \? AND status IN \('pending','sending'\)/.test(sql)) return { n: state.recipients.filter(x => x.campaign_id === Number(args[0]) && ['pending', 'sending'].includes(x.status)).length };
          if (/FROM staff WHERE id = \?/.test(sql)) return state.staff[Number(args[0])] || null;
          if (/FROM attendees WHERE id = \?/.test(sql)) { const a = state.attendees[Number(args[0])]; return a ? { ...a } : null; }
          // Invoices, as issueInvoice and autoInvoiceForOrder read them.
          if (/^SELECT id FROM invoices WHERE order_ref = \?/.test(sql)) { const i = state.invoices.find(x => x.order_ref === args[0]); return i ? { id: i.id } : null; }
          if (/SELECT MAX\(CAST\(substr\(invoice_no, \?\) AS INTEGER\)\) AS n FROM invoices WHERE substr\(invoice_no, 1, \?\) = \?/.test(sql)) {
            const ns = state.invoices.filter(i => String(i.invoice_no || '').slice(0, args[1]) === args[2]).map(i => parseInt(String(i.invoice_no).slice(args[0] - 1), 10) || 0);
            return { n: ns.length ? Math.max(...ns) : null };
          }
          if (/^SELECT \* FROM invoices WHERE id = \?/.test(sql)) { const i = state.invoices.find(x => x.id === Number(args[0])); return i ? { ...i } : null; }
          return null;
        },
        async all() {
          state.sqls.push(sql);
          if (/PRAGMA table_info\(attendees\)/.test(sql)) return { results: ['id', 'event_id', 'name', 'email', 'badge_type', 'payment_status', 'payment_amount', 'main_event', 'main_event_answered_at', 'unsubscribed_at', 'marketing_consent', 'created_at'].map(name => ({ name })) };
          // "Didn't finish paying": registered, paid tier, still pending.
          if (/FROM attendees a(?: LEFT JOIN checkout_leads l[^\n]*)?\s+WHERE a\.event_id = 1 AND a\.badge_type IN/.test(sql)) {
            const joined = /LEFT JOIN checkout_leads l/.test(sql);
            return { results: Object.values(state.attendees).filter(a => args.includes(a.badge_type) && a.payment_status === 'pending').map(a => {
              const last = state.orders.filter(o => o.attendee_id === a.id).slice(-1)[0];
              const l = joined ? state.leads.find(x => x.email === a.email) : null;
              return { id: a.id, name: a.name, email: a.email, mobile: a.mobile, company: a.company, badge_type: a.badge_type, created_at: a.created_at || now(),
                unsubscribed_at: a.unsubscribed_at || null, marketing_consent: a.marketing_consent ?? null,
                ...(/AS last_order/.test(sql) ? { last_order: last ? `${last.order_id}|${last.status}|${last.created_at}|${last.responded_at || ''}` : null } : {}),
                ...(joined ? { reminded_at: l ? l.reminded_at : null, reminder_count: l ? l.reminder_count : null, reminder_error: l ? l.reminder_error : null } : {}) };
            }) };
          }
          // The upgrade campaign's audiences: conference Visitors, not unsubscribed,
          // senior or student, and on no upgrade campaign yet.
          if (/badge_type = 'Visitor Pass'/.test(sql) && /campaign_recipients cr JOIN campaigns cp/.test(sql)) {
            const senior = /% principal %/.test(sql);
            const onOne = new Set(state.recipients.filter(x => ['pending', 'sending', 'sent'].includes(x.status) && (state.campaigns.find(k => k.id === x.campaign_id) || {}).kind === 'upgrade').map(x => x.attendee_id));
            return { results: Object.values(state.attendees).filter(a => a.email && a.badge_type === 'Visitor Pass' && Number(a.main_event) === 1
              && !a.unsubscribed_at && String(a.marketing_consent ?? '') !== '0' && !onOne.has(a.id)
              && (senior ? isSenior(a.job_title) && !isStudent(a.job_title) : isStudent(a.job_title)))
              .sort((x, y) => x.id - y.id).map(a => ({ id: a.id, name: a.name, email: a.email })) };
          }
          // The upgrade panel's view of each audience's campaigns: held, sent, left.
          if (/FROM campaign_recipients cr JOIN campaigns cp ON cp\.id = cr\.campaign_id/.test(sql) && /GROUP BY cp\.audience, cp\.status/.test(sql)) {
            const groups = {};
            for (const x of state.recipients) {
              const k = state.campaigns.find(y => y.id === x.campaign_id);
              if (!k || k.kind !== 'upgrade') continue;
              const g = groups[k.audience + '|' + k.status] || (groups[k.audience + '|' + k.status] = { audience: k.audience, status: k.status, total: 0, sent: 0, left_to_send: 0 });
              g.total++;
              if (x.status === 'sent') g.sent++;
              if (['pending', 'sending'].includes(x.status)) g.left_to_send++;
            }
            return { results: Object.values(groups) };
          }
          // The minute clock's list of campaigns to move on (tickCampaigns).
          if (/^SELECT id FROM campaigns WHERE status = 'running' ORDER BY id$/.test(sql)) {
            return { results: state.campaigns.filter(k => k.status === 'running').map(k => ({ id: k.id })) };
          }
          if (/SELECT \* FROM campaign_recipients WHERE campaign_id = \? AND status = 'pending' ORDER BY id LIMIT \?/.test(sql)) {
            return { results: state.recipients.filter(x => x.campaign_id === Number(args[0]) && x.status === 'pending').slice(0, Number(args[1])).map(x => ({ ...x })) };
          }
          // Leads: a form closed before Proceed, with no registration or only a free one.
          if (/FROM checkout_leads l LEFT JOIN attendees a/.test(sql)) {
            return { results: state.leads.filter(l => l.page !== 'reminder').filter(l => { const a = byEmail(l.email); return !a || FREE.test(String(a.badge_type || '').trim()); }).map(l => {
              const a = byEmail(l.email);
              const last = a ? state.orders.filter(o => o.attendee_id === a.id).slice(-1)[0] : null;
              return { ...l, attendee_id: a ? a.id : null, registered_badge: a ? a.badge_type : null, unsubscribed_at: a ? a.unsubscribed_at || null : null, marketing_consent: a ? a.marketing_consent ?? null : null,
                ...(/AS last_order/.test(sql) ? { last_order: last ? `${last.order_id}|${last.status}|${last.created_at}|${last.responded_at || ''}` : null } : {}) };
            }) };
          }
          if (/PRAGMA table_info\(staff\)/.test(sql)) return { results: ['id', 'name', 'username', 'active', 'role'].map(name => ({ name })) };
          if (/^SELECT key, value FROM app_settings$/.test(sql)) return { results: Object.entries(state.settings).map(([key, value]) => ({ key, value })) };
          if (/FROM payment_orders o JOIN attendees a/.test(sql)) {
            return { results: state.orders.filter(o => o.status === 'paid' && !state.invoices.some(i => i.order_ref === o.order_id && !String(i.invoice_no).startsWith('RCT/'))).map(o => {
              const a = state.attendees[o.attendee_id];
              return { order_id: o.order_id, tracking_id: o.tracking_id, amount_paise: o.amount_paise, pass_type: o.pass_type, paid_at: o.paid_at, payment_mode: o.payment_mode, id: a.id, name: a.name, email: a.email, company: a.company, mobile: a.mobile };
            }) };
          }
          if (/FROM attendees a\s+WHERE a\.badge_type IN/.test(sql)) {
            return { results: Object.values(state.attendees).filter(a => args.includes(a.badge_type) && a.payment_status === 'pending').map(a => {
              const last = state.orders.filter(o => o.attendee_id === a.id).slice(-1)[0];
              return { id: a.id, name: a.name, email: a.email, company: a.company, mobile: a.mobile, badge_type: a.badge_type, created_at: 'x', invoices: 0,
                ...(/AS last_order/.test(sql) ? { last_order: last ? `${last.order_id}|${last.status}|${last.created_at}` : null } : {}) };
            }) };
          }
          return { results: [] };
        },
        async run() {
          state.sqls.push(sql);
          if (/INSERT INTO payment_orders/.test(sql)) {
            const [order_id, attendee_id, event_id, pass_type, previous_badge, base_paise, gst_paise, amount_paise] = args;
            state.orders.push({ id: state.orders.length + 1, order_id, attendee_id, event_id, pass_type, previous_badge, base_paise, gst_paise, amount_paise, status: 'created', created_at: now(), paid_at: null });
            return { meta: { changes: 1, last_row_id: state.orders.length } };
          }
          if (/UPDATE payment_orders\s+SET status = \?/.test(sql)) {
            const [status, tracking_id, bank_ref_no, payment_mode, card_name, gateway_status, status_message, gateway_amount, , orderId] = args;
            const o = state.orders.find(x => x.order_id === orderId);
            if (!o || o.status === 'paid') return { meta: { changes: 0 } };
            Object.assign(o, { status, tracking_id, bank_ref_no, payment_mode, card_name, gateway_status, status_message, gateway_amount, responded_at: now(), paid_at: status === 'paid' ? now() : o.paid_at });
            return { meta: { changes: 1 } };
          }
          if (/^UPDATE attendees SET badge_type = \?/.test(sql)) {
            const id = args[args.length - 1];
            state.attendeeUpdates.push({ sql, args });
            const a = state.attendees[id];
            a.badge_type = args[0];
            if (/payment_status = 'paid'/.test(sql)) a.payment_status = 'paid';
            if (/payment_amount = \?/.test(sql)) a.payment_amount = args[1];
            if (/main_event = 1/.test(sql)) a.main_event = 1;
            return { meta: { changes: 1 } };
          }
          // Bulk email campaigns (0028), as the campaign routes use them.
          if (/^INSERT INTO campaigns \(kind, title, ref_id, audience, status, total, created_by\)/.test(sql)) {
            const [kind, title, ref_id, audience, status, total, created_by] = args;
            const id = state.campaigns.length + 1;
            state.campaigns.push({ id, kind, title, ref_id, audience, status, total, sent: 0, failed: 0, created_by, created_at: now(), finished_at: null });
            return { meta: { changes: 1, last_row_id: id } };
          }
          if (/^\s*INSERT INTO campaign_recipients \(campaign_id, attendee_id, email, name\) VALUES/.test(sql)) {
            for (let i = 0; i < args.length; i += 4) state.recipients.push({ id: state.recipients.length + 1, campaign_id: Number(args[i]), attendee_id: args[i + 1], email: args[i + 2], name: args[i + 3], status: 'pending', error: null, sent_at: null });
            return { meta: { changes: args.length / 4 } };
          }
          {
            const m = /^UPDATE campaign_recipients SET status = '(sending|pending|skipped|sent|failed)'/.exec(sql);
            if (m && /WHERE id = \?/.test(sql)) {
              const id = args[args.length - 1];
              const x = state.recipients.find(y => y.id === Number(id));
              if (!x || (/AND status = 'pending'/.test(sql) && x.status !== 'pending')) return { meta: { changes: 0 } };
              x.status = m[1];
              if (/error = \?/.test(sql)) x.error = args[0];
              if (m[1] === 'sent') { x.sent_at = now(); x.error = null; }
              return { meta: { changes: 1 } };
            }
          }
          if (/^UPDATE campaigns SET sent = sent \+ \?, failed = failed \+ \?/.test(sql)) {
            const k = state.campaigns.find(x => x.id === Number(args[2]));
            if (k) { k.sent += args[0]; k.failed += args[1]; }
            return { meta: { changes: k ? 1 : 0 } };
          }
          if (/^UPDATE campaigns SET status = 'done'/.test(sql)) {
            const k = state.campaigns.find(x => x.id === Number(args[0]));
            if (k) { k.status = 'done'; k.finished_at = k.finished_at || now(); }
            return { meta: { changes: k ? 1 : 0 } };
          }
          // The shared send slot (claimSendSlot): one email per gap, across every paced send.
          if (/^INSERT OR IGNORE INTO app_settings \(key, value\) VALUES \(\?, '1970-01-01T00:00:00.000Z'\)/.test(sql)) {
            if (!(args[0] in state.settings)) state.settings[args[0]] = '1970-01-01T00:00:00.000Z';
            return { meta: { changes: 1 } };
          }
          if (/^UPDATE app_settings SET value = \?, updated_at = CURRENT_TIMESTAMP WHERE key = \? AND value <= \?/.test(sql)) {
            const [value, key, cutoff] = args;
            if (String(state.settings[key] || '') <= String(cutoff)) { state.settings[key] = value; return { meta: { changes: 1 } }; }
            return { meta: { changes: 0 } };
          }
          // A registration through the real /api/events/:id/attendees/register.
          if (/^INSERT INTO attendees \(event_id, name, email, company, job_title, bio, interests, linkedin_url, mobile, city, industry, lunch_inclusion, badge_type, payment_status/.test(sql)) {
            const [event_id, name, email, company, job_title, , , , mobile, city, industry, , badge_type, payment_status, registration_source] = args;
            const id = Math.max(499, ...Object.keys(state.attendees).map(Number)) + 1;
            state.attendees[id] = { id, event_id: Number(event_id), name, email, company, job_title, mobile, city, industry, badge_type, payment_status, registration_source, main_event: 1, created_at: now() };
            return { meta: { changes: 1, last_row_id: id } };
          }
          // /api/external/register names no payment_status, so the row takes the
          // column's default, which is 'paid' (0015), as production does.
          if (/^INSERT INTO attendees \(\s+event_id, name, email, company, job_title, mobile, badge_type,/.test(sql)) {
            const [event_id, name, email, company, job_title, mobile, badge_type, , industry, city] = args;
            const id = Math.max(499, ...Object.keys(state.attendees).map(Number)) + 1;
            state.attendees[id] = { id, event_id: Number(event_id), name, email, company, job_title, mobile, city, industry, badge_type, payment_status: 'paid', registration_source: 'website', main_event: 1, created_at: now() };
            return { meta: { changes: 1, last_row_id: id } };
          }
          {
            const m = /^UPDATE attendees SET payment_status = '(pending|paid)' WHERE id = \?$/.exec(sql);
            if (m) {
              const a = state.attendees[args[0]];
              if (a) a.payment_status = m[1];
              return { meta: { changes: a ? 1 : 0 } };
            }
          }
          // The buyer's GST details (billing:<id>) and the invoice counter. Other
          // settings writes keep falling through, as they always have here.
          if (/^INSERT INTO app_settings \(key, value, updated_at\) VALUES \(\?, \?, datetime\('now'\)\) ON CONFLICT/.test(sql) && /^(billing:|pay_remind_auto$|cron_last_tick$)/.test(String(args[0]))) {
            state.settings[args[0]] = args[1];
            return { meta: { changes: 1 } };
          }
          if (/^DELETE FROM app_settings WHERE key = \?$/.test(sql)) { delete state.settings[args[0]]; return { meta: { changes: 1 } }; }
          { const m = /^INSERT INTO app_settings \(key, value, updated_at\) VALUES \('(inv|rcpt)_next_number', \?/.exec(sql); if (m) { state.settings[m[1] + '_next_number'] = args[0]; return { meta: { changes: 1 } }; } }
          if (/^INSERT INTO invoices \(invoice_no,/.test(sql)) {
            const [invoice_no, attendee_id, buyer_name, buyer_email, buyer_company, buyer_gstin, buyer_address, buyer_phone, item_desc, order_ref, payment_ref, paid_at, gst_rate,
              taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, place_of_supply] = args;
            if (state.invoices.some(i => i.invoice_no === invoice_no)) throw new Error('UNIQUE constraint failed: invoices.invoice_no');
            const id = state.invoices.length + 1;
            state.invoices.push({ id, invoice_no, attendee_id, buyer_name, buyer_email, buyer_company, buyer_gstin, buyer_address, buyer_phone, item_desc, order_ref, payment_ref, paid_at, gst_rate,
              taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, place_of_supply, emailed_at: null, created_at: now() });
            return { meta: { changes: 1, last_row_id: id } };
          }
          if (/^UPDATE invoices SET attendee_id = \? WHERE id = \?/.test(sql)) { const i = state.invoices.find(x => x.id === Number(args[1])); if (i) i.attendee_id = args[0]; return { meta: { changes: i ? 1 : 0 } }; }
          if (/^UPDATE invoices SET emailed_at = datetime\('now'\) WHERE id = \?/.test(sql)) { const i = state.invoices.find(x => x.id === Number(args[0])); if (i) i.emailed_at = now(); return { meta: { changes: i ? 1 : 0 } }; }
          if (/^INSERT INTO checkout_leads \(event_id, email, name, mobile,/.test(sql)) {
            const [email, name, mobile, company, job_title, city, industry, pass_type, page, ip] = args;
            const l = state.leads.find(x => x.email === email);
            const given = { name, mobile, company, job_title, city, industry };
            if (l) {
              for (const [k, v] of Object.entries(given)) if (v) l[k] = v;
              Object.assign(l, { pass_type, page, updated_at: now() });
            } else {
              state.leads.push({ id: state.leads.length + 1, event_id: 1, email, ...given, pass_type, page, ip, created_at: now(), updated_at: now(), reminded_at: null, reminder_count: 0, reminder_error: null });
            }
            return { meta: { changes: 1 } };
          }
          // The reminder's claim (sendPayReminder): it lands only while nobody holds
          // one, or for "again" once the last is a day old; changes says who won.
          if (/^INSERT INTO checkout_leads \(event_id, email, name, pass_type, page, reminded_at, reminder_error\)/.test(sql)) {
            const [email, name, pass_type, again] = args;
            state.claims = (state.claims || 0) + 1;
            const l = state.leads.find(x => x.email === email);
            if (!l) { state.leads.push({ id: state.leads.length + 1, event_id: 1, email, name, pass_type, page: 'reminder', created_at: now(), updated_at: now(), reminded_at: now(), reminder_count: 0, reminder_error: 'sending' }); return { meta: { changes: 1 } }; }
            const old = !l.reminded_at || (Number(again) === 1 && Date.parse(l.reminded_at.replace(' ', 'T') + 'Z') < Date.now() - 24 * 3600000);
            if (!old) return { meta: { changes: 0 } };
            Object.assign(l, { reminded_at: now(), reminder_error: 'sending' });
            return { meta: { changes: 1 } };
          }
          if (/^UPDATE checkout_leads SET reminder_count = reminder_count \+ 1, reminder_error = NULL WHERE event_id = 1 AND email = \?$/.test(sql)) {
            const l = state.leads.find(x => x.email === args[0]);
            if (l) Object.assign(l, { reminder_count: l.reminder_count + 1, reminder_error: null });
            return { meta: { changes: l ? 1 : 0 } };
          }
          if (/^UPDATE checkout_leads SET reminded_at = \?, reminder_error = \? WHERE event_id = 1 AND email = \?$/.test(sql)) {
            const l = state.leads.find(x => x.email === args[2]);
            if (l) Object.assign(l, { reminded_at: args[0], reminder_error: args[1] });
            return { meta: { changes: l ? 1 : 0 } };
          }
          if (/INSERT INTO admin_audit/.test(sql)) { state.audits.push({ action: args[2], entity_id: args[4], detail: args[5] }); return { meta: { changes: 1 } }; }
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
    async batch(list) { return Promise.all(list.map(s => s.run())); },
  };
  return { state, person, DB };
}
