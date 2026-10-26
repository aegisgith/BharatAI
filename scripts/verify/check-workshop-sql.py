#!/usr/bin/env python3
"""Migration 0049 and every workshop-seat statement the worker issues, on a real SQLite engine.

smoke-workshops.mjs runs the routes against a stand-in database that only imitates
the SQL, so a statement that SQLite would reject, or a seat limit that counts the
wrong rows, would pass there. This runs the worker's own statements:

    npm run build
    DUMP_SQL=ws.json node scripts/verify/smoke-workshops.mjs
    python scripts/verify/check-workshop-sql.py . ws.json

(PowerShell: $env:DUMP_SQL = 'ws.json' before the node line.) It proves the
migration applies twice, that the last seat goes to exactly one person, that a
switch never counts the chooser twice or leaves two seats, and that the admin
lists pick the right people. Nothing here touches production.
"""
import json, os, re, sqlite3, sys

repo, dump = sys.argv[1], sys.argv[2]
sqls = json.load(open(dump, encoding='utf-8'))
db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
fails = 0


def check(name, ok, detail=''):
    global fails
    print(('PASS  ' if ok else 'FAIL  ') + name + ('' if ok else '  <- ' + str(detail)))
    if not ok:
        fails += 1


def find(pattern):
    hits = [s for s in sqls if re.search(pattern, re.sub(r'\s+', ' ', s))]
    if len(hits) != 1:
        raise SystemExit('expected one statement matching %r, found %d' % (pattern, len(hits)))
    return hits[0]


# The tables the statements touch besides 0049's own, as production has them.
db.executescript("""
CREATE TABLE attendees (id INTEGER PRIMARY KEY, event_id INTEGER, name TEXT, email TEXT, mobile TEXT, company TEXT,
  job_title TEXT, badge_type TEXT, payment_status TEXT);
CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
""")
migration = open(os.path.join(repo, 'migrations', '0049_workshop_seats.sql'), encoding='utf-8').read()
db.executescript(migration)
db.executescript(migration)
rows = db.execute('SELECT slug, title, capacity, starts_at FROM workshops ORDER BY sort_order').fetchall()
check('0049 applies twice and seeds the two workshops once, 100 seats, time to be announced',
      [r['slug'] for r in rows] == ['cxo-guide', 'fde-workshop'] and all(r['capacity'] == 100 and r['starts_at'] is None for r in rows),
      [dict(r) for r in rows])
check('the CXO title keeps its typographic apostrophe', '’' in rows[0]['title'], rows[0]['title'])

TAKE = find(r'^INSERT INTO workshop_seats')
LIST = find(r'FROM workshops w WHERE w\.event_id = 1 ORDER BY')
MINE = find(r'^SELECT workshop_id FROM workshop_seats WHERE event_id = 1 AND attendee_id = \?$')
SEATS = find(r'FROM workshop_seats s JOIN attendees a ON a\.id = s\.attendee_id')
UNCHOSEN = find(r'AND a\.id NOT IN \(SELECT attendee_id FROM workshop_seats')
UPDATE = find(r'^UPDATE workshops SET starts_at = \?')
DELETE = find(r'^DELETE FROM workshop_seats WHERE event_id = 1 AND attendee_id = \?$')
CUTOFF = find(r"^INSERT INTO app_settings .*'workshop_choice_closes'")
DOOR = find(r'^SELECT w\.title FROM workshop_seats s JOIN workshops w')

people = [
    (1, 1, 'Asha', 'Premium Delegate Pass', 'paid'), (2, 1, 'Bela', 'VIP Pass', 'paid'), (3, 1, 'Chitra', 'Premium Delegate Pass', 'paid'),
    (4, 1, 'Dev', 'Premium Delegate Pass', 'pending'), (5, 1, 'Esha', 'Delegate Pass', 'paid'), (6, 2, 'Farah', 'VIP Pass', 'paid'),
    (7, 1, 'Gita', 'VIP Pass', 'waived'), (8, 1, 'Hari', 'VIP Pass', None), (9, 1, 'Ira', 'VIP Pass', 'refunded'),
]
for p in people:
    db.execute('INSERT INTO attendees (id, event_id, name, email, badge_type, payment_status) VALUES (?, ?, ?, ?, ?, ?)',
               (p[0], p[1], p[2], p[2].lower() + '@x.com', p[3], p[4]))
w1, w2 = [r['id'] for r in db.execute('SELECT id FROM workshops ORDER BY sort_order')]


def take(aid, wid, by='attendee'):
    return db.execute(TAKE, (aid, wid, by, wid, aid, wid)).rowcount


def seat(aid):
    r = db.execute(MINE, (aid,)).fetchone()
    return r['workshop_id'] if r else None


def taken(wid):
    return db.execute('SELECT COUNT(*) FROM workshop_seats WHERE workshop_id = ?', (wid,)).fetchone()[0]


db.execute(UPDATE, (None, None, None, 2, 1, w1))
check('admin can set a workshop to 2 seats', db.execute('SELECT capacity FROM workshops WHERE id = ?', (w1,)).fetchone()[0] == 2)
check('the first seat is taken', take(1, w1) == 1 and seat(1) == w1)
check('the second seat is taken', take(2, w1) == 1 and seat(2) == w1)
check('the third is refused: the statement writes nothing when full', take(3, w1) == 0 and seat(3) is None and taken(w1) == 2)
check('choosing your own full workshop again does not count you twice', take(1, w1) == 1 and seat(1) == w1 and taken(w1) == 2)
check('a switch moves the one row: still one seat each', take(1, w2) == 1 and seat(1) == w2 and taken(w1) == 1
      and db.execute('SELECT COUNT(*) FROM workshop_seats WHERE attendee_id = 1').fetchone()[0] == 1)
check('the freed seat can be taken by the next person', take(3, w1) == 1 and seat(3) == w1 and taken(w1) == 2)
check('nobody switches into a full workshop, and their seat stays put', take(1, w1) == 0 and seat(1) == w2)
check('a workshop that does not exist takes nobody', take(5, 999) == 0 and seat(5) is None)
check('an admin placement records who did it', take(7, w2, 'admin:organiser') == 1
      and db.execute('SELECT chosen_by FROM workshop_seats WHERE attendee_id = 7').fetchone()[0] == 'admin:organiser')
check('a seat in another event is a different seat', db.execute(
    "INSERT INTO workshop_seats (event_id, attendee_id, workshop_id) VALUES (2, 1, ?)", (w1,)).rowcount == 1 and seat(1) == w2)
db.execute('DELETE FROM workshop_seats WHERE event_id = 2')

listed = {r['id']: dict(r) for r in db.execute(LIST).fetchall()}
check('the list counts the seats taken per workshop', listed[w1]['taken'] == 2 and listed[w2]['taken'] == 2, listed)

roster = [dict(r) for r in db.execute(SEATS).fetchall()]
check('the admin roster joins each seat to its person', sorted((r['name'], r['workshop_id']) for r in roster)
      == sorted([('Asha', w2), ('Bela', w1), ('Chitra', w1), ('Gita', w2)]), roster)

TIERS = ['Premium Delegate Pass', 'VIP Pass']
waiting = [r['name'] for r in db.execute(UNCHOSEN, TIERS).fetchall()]
check('not chosen yet: paid or unset Premium/VIP in event 1 only; not pending, refunded, Delegate or event 2',
      waiting == ['Hari'], waiting)

check('the door scan finds the title', db.execute(DOOR, (3,)).fetchone()[0].startswith('Data Science'))
check('and nothing for someone without a seat', db.execute(DOOR, (5,)).fetchone() is None)

db.execute(DELETE, (2,))
check('admin removes a seat', seat(2) is None and taken(w1) == 1)

db.execute(CUTOFF, ('2026-11-18 23:59',))
db.execute(CUTOFF, ('2026-11-19 10:00',))
check('the cut-off is written, and a second write replaces it',
      db.execute("SELECT value FROM app_settings WHERE key = 'workshop_choice_closes'").fetchone()[0] == '2026-11-19 10:00')

db.execute(UPDATE, ('2026-11-21 14:00', '2026-11-21 15:00', 'Kalam Theatre', 100, 0, w2))
r = db.execute('SELECT starts_at, ends_at, room, capacity, is_open FROM workshops WHERE id = ?', (w2,)).fetchone()
check('admin sets the slot, room, seats and closes it', tuple(r) == ('2026-11-21 14:00', '2026-11-21 15:00', 'Kalam Theatre', 100, 0), tuple(r))

for s in sqls:
    if not re.search(r'workshop|app_settings', s):
        continue
    try:
        db.execute('EXPLAIN ' + s, [None] * s.count('?'))
    except sqlite3.Error as e:
        check('statement compiles: ' + re.sub(r'\s+', ' ', s)[:70], False, e)

print('\n' + ('%d workshop SQL check(s) failed' % fails if fails else 'all workshop SQL checks passed'))
sys.exit(1 if fails else 0)
