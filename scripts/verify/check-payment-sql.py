#!/usr/bin/env python3
"""Migration 0045 and every payment statement the worker issues, on a real SQLite engine.

The smoke suite runs against a stand-in database that pattern-matches SQL, so a
typo in a statement would pass there and fail in production. This closes that gap:
the suite writes down each statement the worker actually sent, and this runs them.

    npm run build
    DUMP_SQL=sqls.json node scripts/verify/smoke-payments.mjs
    python scripts/verify/check-payment-sql.py . sqls.json

(PowerShell: $env:DUMP_SQL = 'sqls.json' before the node line.) Run it after
changing any SQL in the ONLINE PAYMENTS block of src/index.tsx or the migration.
It proves the migration applies twice, that a paid order can never be changed by a
later answer, that the hourly cap counts one hour, and that raising an invoice is
what takes a payment off the "paid online" list. Nothing here touches production.
"""
import json, re, sqlite3, sys, os
repo, dump = sys.argv[1], sys.argv[2]
db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
db.executescript("""
CREATE TABLE attendees (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
  company TEXT, mobile TEXT, city TEXT, badge_type TEXT DEFAULT 'general', payment_status TEXT, payment_amount TEXT,
  main_event INTEGER NOT NULL DEFAULT 1, main_event_answered_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  unsubscribed_at DATETIME, marketing_consent INTEGER, job_title TEXT, industry TEXT,
  UNIQUE(event_id, email));
CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME);
CREATE TABLE admin_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, actor_kind TEXT, action TEXT, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT, user_agent TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
""")
db.executescript(open(os.path.join(repo, 'migrations', '0021_invoices.sql'), encoding='utf-8').read())
fails = 0
def check(label, ok, detail=''):
    global fails
    print(('PASS  ' if ok else 'FAIL  ') + label + ('' if ok else '   ' + str(detail)))
    if not ok: fails += 1

mig = open(os.path.join(repo, 'migrations', '0045_payment_orders.sql'), encoding='utf-8').read()
db.executescript(mig)
check('0045 applies', db.execute("SELECT COUNT(*) FROM sqlite_master WHERE name = 'payment_orders'").fetchone()[0] == 1)
try:
    db.executescript(mig); again = True
except Exception as e:
    again = str(e)
check('0045 applies a second time without error', again is True, again)
idx = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'payment_orders' AND name LIKE 'idx_%'")]
check('both indexes exist once', sorted(idx) == ['idx_payment_orders_attendee', 'idx_payment_orders_status'], idx)

# every statement the worker issued in the smoke run, prepared by the real engine
mig46 = open(os.path.join(repo, 'migrations', '0046_checkout_leads.sql'), encoding='utf-8').read()
db.executescript(mig46)
try:
    db.executescript(mig46); again46 = True
except Exception as e:
    again46 = str(e)
check('0046 applies, and a second time without error', again46 is True and db.execute("SELECT COUNT(*) FROM sqlite_master WHERE name IN ('checkout_leads', 'idx_checkout_leads_ip')").fetchone()[0] == 2, again46)

db.executescript(open(os.path.join(repo, 'migrations', '0028_campaigns.sql'), encoding='utf-8').read())
sqls = [s for s in json.load(open(dump, encoding='utf-8')) if 'payment_orders' in s or 'checkout_leads' in s or s.startswith('UPDATE attendees SET badge_type') or 'campaign_recipients cr JOIN campaigns cp' in s]
bad = []
for s in sqls:
    try:
        db.execute('EXPLAIN ' + s, [None] * s.count('?'))
    except Exception as e:
        bad.append((str(e), s[:90]))
check('all %d payment statements prepare on SQLite' % len(sqls), not bad and len(sqls) >= 7, bad)

def one(pat):
    hit = [s for s in sqls if re.search(pat, s)]
    assert len(hit) == 1, (pat, len(hit))
    return hit[0]
INSERT = one(r'^INSERT INTO payment_orders')
UPDATE = one(r'^UPDATE payment_orders')
COUNT = one(r'SELECT COUNT\(\*\) AS n FROM payment_orders')
PENDING = one(r'AS last_order[\s\S]*FROM attendees a\s+WHERE a\.badge_type IN')
PAIDON = one(r'FROM payment_orders o JOIN attendees a')
SETTLE = one(r'^UPDATE attendees SET badge_type')

db.execute("INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status, main_event) VALUES (1, 1, 'Asha', 'a@x.com', 'Visitor Pass', 'paid', 0)")
db.execute("INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status) VALUES (4, 1, 'Vik', 'v@x.com', 'VIP Pass', 'pending')")
db.execute(INSERT, ['BAI1-AAAAAAAAAAAA', 1, 1, 'Delegate Pass', 'Visitor Pass', 499900, 89982, 589882])
db.execute(INSERT, ['BAI4-BBBBBBBBBBBB', 4, 1, 'VIP Pass', 'VIP Pass', 1499900, 269982, 1769882])
row = db.execute("SELECT * FROM payment_orders WHERE order_id = 'BAI1-AAAAAAAAAAAA'").fetchone()
check('a new order starts as created, in INR, with a UTC stamp', row['status'] == 'created' and row['currency'] == 'INR' and re.match(r'^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$', row['created_at']) is not None, dict(row))
try:
    db.execute(INSERT, ['BAI1-AAAAAAAAAAAA', 1, 1, 'Delegate Pass', '', 1, 1, 2]); dup = False
except sqlite3.IntegrityError:
    dup = True
check('an order number cannot be used twice', dup)
check('the hourly cap counts this hour only', db.execute(COUNT, [1]).fetchone()['n'] == 1)
db.execute("UPDATE payment_orders SET created_at = datetime('now', '-2 hours') WHERE order_id = 'BAI4-BBBBBBBBBBBB'")
check('an order from two hours ago is outside the cap', db.execute(COUNT, [4]).fetchone()['n'] == 0)

fail_args = ['failed', 'null', 'null', 'Credit Card', 'Visa', 'Failure', 'Declined', '17698.82', 'failed', 'BAI4-BBBBBBBBBBBB']
c = db.execute(UPDATE, fail_args)
r4 = db.execute("SELECT * FROM payment_orders WHERE order_id = 'BAI4-BBBBBBBBBBBB'").fetchone()
check('a failure is recorded without a paid_at', c.rowcount == 1 and r4['status'] == 'failed' and r4['paid_at'] is None and r4['responded_at'] is not None, dict(r4))
paid_args = ['paid', '115023456789', '428713', 'Net Banking', 'AvenuesTest', 'Success', 'Y', '5898.82', 'paid', 'BAI1-AAAAAAAAAAAA']
c = db.execute(UPDATE, paid_args)
r1 = db.execute("SELECT * FROM payment_orders WHERE order_id = 'BAI1-AAAAAAAAAAAA'").fetchone()
check('a success is recorded with a paid_at', c.rowcount == 1 and r1['status'] == 'paid' and r1['paid_at'] is not None and r1['tracking_id'] == '115023456789', dict(r1))
c = db.execute(UPDATE, paid_args)
check('the same success again changes no row', c.rowcount == 0)
c = db.execute(UPDATE, ['failed', 'x', 'x', 'x', 'x', 'Failure', 'late', '5898.82', 'failed', 'BAI1-AAAAAAAAAAAA'])
check('a later failure cannot undo a paid order', c.rowcount == 0 and db.execute("SELECT status FROM payment_orders WHERE order_id = 'BAI1-AAAAAAAAAAAA'").fetchone()[0] == 'paid')
c = db.execute(UPDATE, ['paid', '115099999999', '1', 'UPI', 'UPI', 'Success', 'Y', '17698.82', 'paid', 'BAI4-BBBBBBBBBBBB'])
check('a failed order can still be paid by a later success', c.rowcount == 1)
db.execute(UPDATE.replace("'paid' THEN", "'paid' THEN"), ['failed', 'x', 'x', 'x', 'x', 'Failure', 'late', '1', 'failed', 'BAI4-BBBBBBBBBBBB'])
check('and then it too is final', db.execute("SELECT status FROM payment_orders WHERE order_id = 'BAI4-BBBBBBBBBBBB'").fetchone()[0] == 'paid')

n = SETTLE.count('?')
db.execute(SETTLE, (['Delegate Pass', '5898.82', 1] if n == 3 else ['Delegate Pass', 1]))
a1 = db.execute('SELECT * FROM attendees WHERE id = 1').fetchone()
check('settling sets the badge, paid, the amount and the conference yes', a1['badge_type'] == 'Delegate Pass' and a1['payment_status'] == 'paid' and a1['payment_amount'] == '5898.82' and a1['main_event'] == 1 and a1['main_event_answered_at'] is not None, dict(a1))

pend = [dict(r) for r in db.execute(PENDING, ['Delegate Pass', 'VIP Pass', 'Academic Pass'])]
check('the pending list carries the latest attempt as order|status|time', len(pend) == 1 and pend[0]['id'] == 4 and pend[0]['last_order'].startswith('BAI4-BBBBBBBBBBBB|paid|'), pend)
po = [dict(r) for r in db.execute(PAIDON)]
check('paid online lists both paid orders with the attendee id', sorted(r['order_id'] for r in po) == ['BAI1-AAAAAAAAAAAA', 'BAI4-BBBBBBBBBBBB'] and {r['id'] for r in po} == {1, 4}, po)
db.execute("INSERT INTO invoices (invoice_no, buyer_name, buyer_email, item_desc, order_ref, taxable_paise, total_paise) VALUES ('AKT/26-27/900', 'Asha', 'a@x.com', 'Delegate Pass', 'BAI1-AAAAAAAAAAAA', 499900, 589882)")
po = [r['order_id'] for r in db.execute(PAIDON)]
check('an invoice with that order_ref takes it off the list', po == ['BAI4-BBBBBBBBBBBB'], po)
# ---- checkout follow-up (0046) ----
CAPTURE = one(r'^INSERT INTO checkout_leads \(event_id, email, name, mobile,')
RECORD = one(r'^INSERT INTO checkout_leads \(event_id, email, name, pass_type, page, reminded_at')
IPCOUNT = one(r'SELECT COUNT\(\*\) AS n FROM checkout_leads WHERE ip = \?')
WAITING = one(r'LEFT JOIN checkout_leads l ON l.event_id = a.event_id')
LEADS = one(r'FROM checkout_leads l LEFT JOIN attendees a')

def lead(email, name='', mobile='', company='', job='', city='', industry='', pass_type='Delegate Pass', page='register', ip='203.0.113.7'):
    db.execute(CAPTURE, [email, name, mobile, company, job, city, industry, pass_type, page, ip])
def L(email):
    r = db.execute('SELECT * FROM checkout_leads WHERE email = ?', [email]).fetchone()
    return dict(r) if r else None

lead('meera@x.com', name='Meera', mobile='9820011111', company='Lead Co')
lead('meera@x.com', name='', city='Pune', pass_type='VIP Pass')
m = L('meera@x.com')
check('a later keystroke adds to a lead and an empty field wipes nothing', m['name'] == 'Meera' and m['mobile'] == '9820011111' and m['city'] == 'Pune' and m['pass_type'] == 'VIP Pass' and db.execute('SELECT COUNT(*) FROM checkout_leads').fetchone()[0] == 1, m)
check('the per-address cap counts new rows from the last hour', db.execute(IPCOUNT, ['203.0.113.7']).fetchone()['n'] == 1)
db.execute("UPDATE checkout_leads SET created_at = datetime('now', '-2 hours') WHERE email = 'meera@x.com'")
check('and not older ones', db.execute(IPCOUNT, ['203.0.113.7']).fetchone()['n'] == 0)

db.execute(RECORD, ['meera@x.com', 'Meera', 'VIP Pass', 0, 0, 'Email service is not configured'])
m = L('meera@x.com')
check('a failed reminder records the error and not a send', m['reminded_at'] is None and m['reminder_count'] == 0 and m['reminder_error'].startswith('Email service') and m['page'] == 'register', m)
db.execute(RECORD, ['meera@x.com', 'Meera', 'VIP Pass', 1, 1, None])
m = L('meera@x.com')
check('a sent reminder records the time, counts it, and clears the error', m['reminded_at'] is not None and m['reminder_count'] == 1 and m['reminder_error'] is None and m['page'] == 'register', m)
db.execute(RECORD, ['meera@x.com', 'Meera', 'VIP Pass', 0, 0, 'later failure'])
check('a later failure keeps the earlier send on record', L('meera@x.com')['reminded_at'] is not None and L('meera@x.com')['reminder_count'] == 1)

# Who is waiting: id 4 is a pending VIP from earlier in this file. Add the rest.
db.execute("INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status) VALUES (30, 1, 'Pending D', 'pd@x.com', 'Delegate Pass', 'pending')")
db.execute("INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status) VALUES (31, 1, 'Paid D', 'paid@x.com', 'Delegate Pass', 'paid')")
db.execute("INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status) VALUES (32, 1, 'Visitor V', 'vis@x.com', 'Visitor Pass', 'paid')")
db.execute("INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status) VALUES (33, 1, 'Speaker S', 'spk@x.com', 'Speaker', 'waived')")
db.execute("INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status) VALUES (34, 2, 'Other Event', 'other@x.com', 'Delegate Pass', 'pending')")
db.execute(RECORD, ['pd@x.com', 'Pending D', 'Delegate Pass', 1, 1, None])
for e in ['paid@x.com', 'vis@x.com', 'spk@x.com', 'nobody@x.com']:
    lead(e, name=e.split('@')[0])
n = WAITING.count('?')
waiting = {r['id']: dict(r) for r in db.execute(WAITING, ['Delegate Pass', 'VIP Pass', 'Academic Pass'][:n])}
check('registered and still pending: exactly the event 1 pending paid passes', sorted(waiting) == [4, 30], sorted(waiting))
check('their reminder state comes along from checkout_leads', waiting[30]['reminder_count'] == 1 and waiting[30]['reminded_at'] is not None and waiting[4]['reminded_at'] is None, waiting)
check('and their latest online attempt', waiting[4]['last_order'].startswith('BAI4-'), waiting[4].get('last_order'))
leads = sorted(r['email'] for r in db.execute(LEADS))
check('leads: nobody registered, or a free pass holder; never a paid pass, a speaker or a reminder-only row', leads == ['meera@x.com', 'nobody@x.com', 'vis@x.com'], leads)
vis = [dict(r) for r in db.execute(LEADS) if r['email'] == 'vis@x.com'][0]
check('a Visitor lead carries their registration, so the reminder signs them in', vis['attendee_id'] == 32 and vis['registered_badge'] == 'Visitor Pass', vis)

# ---- the upgrade campaign's two audiences (on 0028's campaigns tables) ----
SENIOR_Q = one(r"badge_type = 'Visitor Pass'[\s\S]*% principal %[\s\S]*campaign_recipients cr JOIN campaigns cp")
STUDENT_Q = [s for s in sqls if "badge_type = 'Visitor Pass'" in s and 'campaign_recipients cr JOIN campaigns cp' in s and '% principal %' not in s]
check('both audience queries were captured from the worker', len(STUDENT_Q) == 1, len(STUDENT_Q))
people = [
    (100, 1, 'Visitor Pass', 1, 'Co-Founder & CEO', None, None),
    (101, 1, 'Visitor Pass', 1, 'Director, Data Platforms', None, None),
    (102, 1, 'Visitor Pass', 1, 'B.Tech Student', None, None),
    (103, 1, 'Visitor Pass', 1, 'Data Analyst', None, None),
    (104, 1, 'Visitor Pass', 1, 'VP Engineering', '2026-09-01 10:00:00', None),   # unsubscribed
    (105, 1, 'Visitor Pass', 0, 'Head of Department', None, None),                # campus panel only
    (106, 1, 'Delegate Pass', 1, 'CEO', None, None),                              # already paid tier
    (107, 1, 'Visitor Pass', 1, 'Research Intern', None, None),
    (108, 1, 'Visitor Pass', 1, 'Principal Engineer', None, None),
    (109, 1, 'Visitor Pass', 1, 'CTO', None, 0),                                  # said no to email
    (110, 1, 'Visitor Pass', 1, 'Managing Partner', None, None),                  # already sent an upgrade
    (111, 2, 'Visitor Pass', 1, 'Founder', None, None),                           # another event
    (112, 1, 'Visitor Pass', 1, 'Founder', None, None),                           # only on a notify campaign
]
for (i, ev, badge, me, title, unsub, consent) in people:
    db.execute('INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status, main_event, job_title, unsubscribed_at, marketing_consent) VALUES (?,?,?,?,?,?,?,?,?,?)',
               [i, ev, 'P%d' % i, 'p%d@x.com' % i, badge, 'paid', me, title, unsub, consent])
db.execute("INSERT INTO campaigns (id, kind, title, audience, status, total) VALUES (1, 'upgrade', 'u', 'senior', 'done', 1)")
db.execute("INSERT INTO campaign_recipients (campaign_id, attendee_id, email, name, status) VALUES (1, 110, 'p110@x.com', 'P110', 'sent')")
db.execute("INSERT INTO campaigns (id, kind, title, audience, status, total) VALUES (2, 'notify', 'n', 'all', 'done', 1)")
db.execute("INSERT INTO campaign_recipients (campaign_id, attendee_id, email, name, status) VALUES (2, 112, 'p112@x.com', 'P112', 'sent')")
senior = sorted(r['id'] for r in db.execute(SENIOR_Q, [1] * SENIOR_Q.count('?')) if r['id'] >= 100)
students = sorted(r['id'] for r in db.execute(STUDENT_Q[0], [1] * STUDENT_Q[0].count('?')) if r['id'] >= 100)
check('senior audience: Visitors with senior titles, event 1, conference, mailable, never sent an upgrade', senior == [100, 101, 108, 112], senior)
check('student audience: students and interns, same rules', students == [102, 107], students)
check('the two audiences never overlap, so nobody gets both offers', not set(senior) & set(students))
db.execute("INSERT INTO campaign_recipients (campaign_id, attendee_id, email, name, status) VALUES (1, 100, 'p100@x.com', 'P100', 'pending')")
senior2 = sorted(r['id'] for r in db.execute(SENIOR_Q, [1] * SENIOR_Q.count('?')) if r['id'] >= 100)
check('someone queued on a run still in progress is not queued again', 100 not in senior2, senior2)
db.execute("UPDATE campaign_recipients SET status = 'failed' WHERE attendee_id = 100 AND campaign_id = 1")
senior3 = sorted(r['id'] for r in db.execute(SENIOR_Q, [1] * SENIOR_Q.count('?')) if r['id'] >= 100)
check('a send that failed can be tried again in a later run', 100 in senior3, senior3)

print('\n%d FAILED' % fails if fails else '\nall payment SQL checks passed')
sys.exit(1 if fails else 0)
