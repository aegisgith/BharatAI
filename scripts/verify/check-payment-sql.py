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
sqls = [s for s in json.load(open(dump, encoding='utf-8')) if 'payment_orders' in s or s.startswith('UPDATE attendees SET badge_type')]
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
PENDING = one(r'AS last_order')
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
print('\n%d FAILED' % fails if fails else '\nall payment SQL checks passed')
sys.exit(1 if fails else 0)
