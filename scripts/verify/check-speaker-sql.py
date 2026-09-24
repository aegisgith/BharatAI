"""Attack scripts/sql/speaker-delegate-passes.sql against a scratch database shaped like production.

    python scripts/verify/check-speaker-sql.py [path/to/another.sql]

Run it again whenever that file changes, and again before the organiser runs it
against production with the speakers' addresses filled in.

Nothing here touches production: it reads the .sql file and works in memory.
"""
import sqlite3, sys, os

SQL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sql', 'speaker-delegate-passes.sql')
if len(sys.argv) > 1:
    SQL = sys.argv[1]  # or attack another one-off file the same way

SCHEMA = """
CREATE TABLE attendees (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
  company TEXT, job_title TEXT, bio TEXT, avatar_url TEXT, interests TEXT, linkedin_url TEXT, twitter_url TEXT,
  website_url TEXT, role TEXT NOT NULL DEFAULT 'attendee', badge_type TEXT DEFAULT 'general',
  is_online INTEGER DEFAULT 0, last_seen TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  mobile TEXT, city TEXT, country TEXT, industry TEXT, lunch_inclusion TEXT, payment_status TEXT,
  registration_source TEXT, registration_date TEXT, main_event INTEGER NOT NULL DEFAULT 1,
  marketing_consent INTEGER, unsubscribed_at DATETIME,
  UNIQUE(event_id, email));
CREATE TABLE speakers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, slug TEXT, name TEXT, role TEXT,
  organisation TEXT, bio TEXT, linkedin_url TEXT, email TEXT, is_published INTEGER DEFAULT 1);
"""

fails = []


def check(label, ok, detail=''):
    print(('PASS  ' if ok else 'FAIL  ') + label + ('' if ok else '   ' + str(detail)))
    if not ok:
        fails.append(label)


def fresh(speakers, attendees=()):
    db = sqlite3.connect(':memory:')
    db.executescript(SCHEMA)
    for s in speakers:
        db.execute("INSERT INTO speakers (event_id, slug, name, role, organisation, bio, linkedin_url, email, is_published) "
                   "VALUES (?,?,?,?,?,?,?,?,?)", s)
    for a in attendees:
        db.execute("INSERT INTO attendees (event_id, name, email, badge_type, role, main_event, payment_status, company) "
                   "VALUES (?,?,?,?,?,?,?,?)", a)
    db.commit()
    return db


def run(db):
    db.executescript(open(SQL, encoding='utf-8').read())
    db.commit()


# (event_id, slug, name, role, organisation, bio, linkedin, email, is_published)
SPEAKERS = [
    (1, 'asha-rao', 'Asha Rao', 'Chief Data Officer', 'Acme', 'bio', 'li', 'asha@acme.com', 1),
    (1, 'minister-x', 'Hon Someone', 'Union Minister for Electronics', 'GoI', '', '', 'minister@gov.in', 1),
    (1, 'k-k-singh', 'K K Singh', 'Director General', 'Agency', '', '', 'kk@gov.in', 1),
    (1, 'praveen-pardeshi', 'Praveen Pardeshi', 'Adviser', 'State', '', '', 'pp@gov.in', 1),
    (1, 'unpublished', 'Not Yet', 'CTO', 'Beta', '', '', 'hidden@beta.com', 0),
    (1, 'no-email', 'No Address', 'CEO', 'Gamma', '', '', '   ', 1),
    (1, 'mixed-case', 'Case Person', 'VP', 'Delta', '', '', '  MiXeD@Delta.com ', 1),
    (1, 'already-vip', 'Paid Vip', 'Founder', 'Epsilon', '', '', 'vip@epsilon.com', 1),
    (1, 'free-visitor', 'Free Visitor', 'Head of AI', 'Zeta', '', '', 'visitor@zeta.com', 1),
    (1, 'jury-role', 'Jury Person', 'Partner', 'Eta', '', '', 'jury@eta.com', 1),
    (1, 'panel-student', 'Panel Person', 'Lecturer', 'Theta', '', '', 'panel@theta.com', 1),
]
# (event_id, name, email, badge_type, role, main_event, payment_status, company)
ATTENDEES = [
    (1, 'Paid Vip', 'vip@epsilon.com', 'VIP Pass', 'attendee', 1, 'paid', 'Epsilon'),
    (1, 'Free Visitor', 'visitor@zeta.com', 'Visitor Pass', 'attendee', 1, 'paid', 'Zeta'),
    (1, 'Jury Person', 'jury@eta.com', 'Visitor Pass', 'jury', 1, 'paid', 'Eta'),
    (1, 'Panel Person', 'panel@theta.com', 'Visitor Pass', 'attendee', 0, 'paid', 'Theta'),
    (1, 'Case Person', 'mixed@delta.com', 'Visitor Pass', 'attendee', 1, 'paid', 'Delta'),
    (1, 'Minister Self', 'minister@gov.in', 'Visitor Pass', 'attendee', 1, 'paid', 'GoI'),
]

db = fresh(SPEAKERS, ATTENDEES)
run(db)
q = lambda sql, *a: db.execute(sql, a).fetchone()

check('a published speaker with an email gets a pass',
      q("SELECT COUNT(*) FROM attendees WHERE email='asha@acme.com' AND badge_type='Speaker' AND main_event=1 AND payment_status='waived' AND registration_source='speaker'")[0] == 1)
check('a minister gets no pass', q("SELECT COUNT(*) FROM attendees WHERE email='minister@gov.in' AND badge_type='Speaker'")[0] == 0)
check('a minister who registered themselves is left alone',
      q("SELECT badge_type, main_event FROM attendees WHERE email='minister@gov.in'") == ('Visitor Pass', 1))
check('the two named officials get no pass', q("SELECT COUNT(*) FROM attendees WHERE email IN ('kk@gov.in','pp@gov.in')")[0] == 0)
check('an unpublished speaker gets no pass', q("SELECT COUNT(*) FROM attendees WHERE email='hidden@beta.com'")[0] == 0)
check('a speaker with a blank email gets no pass', q("SELECT COUNT(*) FROM attendees WHERE trim(email)=''")[0] == 0)
check('a mixed-case address does not create a second row',
      q("SELECT COUNT(*) FROM attendees WHERE lower(trim(email))='mixed@delta.com'")[0] == 1)
check('the mixed-case person is raised, not duplicated',
      q("SELECT badge_type FROM attendees WHERE lower(trim(email))='mixed@delta.com'")[0] == 'Speaker')
check('a paid VIP keeps their pass and payment', q("SELECT badge_type, payment_status FROM attendees WHERE email='vip@epsilon.com'") == ('VIP Pass', 'paid'))
check('a free Visitor is raised to Speaker', q("SELECT badge_type, role, main_event FROM attendees WHERE email='visitor@zeta.com'") == ('Speaker', 'Speaker', 1))
check('an existing role that is not attendee is kept', q("SELECT badge_type, role FROM attendees WHERE email='jury@eta.com'") == ('Speaker', 'jury'))
check('a panel-only person becomes a conference registrant', q("SELECT badge_type, main_event FROM attendees WHERE email='panel@theta.com'") == ('Speaker', 1))
check('nobody else is touched', q("SELECT COUNT(*) FROM attendees WHERE badge_type='Speaker'")[0] == 5,
      q("SELECT COUNT(*) FROM attendees WHERE badge_type='Speaker'")[0])

before = q("SELECT COUNT(*) FROM attendees")[0]
run(db)
check('running it twice changes nothing', q("SELECT COUNT(*) FROM attendees")[0] == before, (before, q("SELECT COUNT(*) FROM attendees")[0]))

# An email added later: exactly that one new pass.
db.execute("UPDATE speakers SET email='later@iota.com' WHERE slug='no-email'")
db.commit()
run(db)
check('an address added later creates exactly one more pass', q("SELECT COUNT(*) FROM attendees")[0] == before + 1)

# Two published speakers sharing one address: does the file survive it?
db2 = fresh([
    (1, 'one', 'Person One', 'CTO', 'Shared Co', '', '', 'desk@shared.com', 1),
    (1, 'two', 'Person Two', 'CEO', 'Shared Co', '', '', 'DESK@shared.com', 1),
    (1, 'three', 'Person Three', 'COO', 'Other', '', '', 'three@other.com', 1),
])
try:
    run(db2)
    shared_ok = True
    err = ''
except sqlite3.Error as e:
    shared_ok = False
    err = str(e)
check('two speakers sharing one address do not abort the whole file', shared_ok, err)
if shared_ok:
    check('the shared address yields one pass', db2.execute("SELECT COUNT(*) FROM attendees WHERE lower(email)='desk@shared.com'").fetchone()[0] == 1)
    check('the unrelated speaker still gets theirs', db2.execute("SELECT COUNT(*) FROM attendees WHERE email='three@other.com'").fetchone()[0] == 1)
else:
    check('the unrelated speaker still gets theirs', db2.execute("SELECT COUNT(*) FROM attendees WHERE email='three@other.com'").fetchone()[0] == 1,
          'nothing was inserted: the whole statement rolled back')

# A second event: does the raise reach across events?
db3 = fresh([(1, 'cross', 'Cross Person', 'CTO', 'Kappa', '', '', 'cross@kappa.com', 1)],
            [(1, 'Cross Person', 'cross@kappa.com', 'Visitor Pass', 'attendee', 1, 'paid', 'Kappa'),
             (2, 'Cross Person', 'cross@kappa.com', 'Visitor Pass', 'attendee', 1, 'paid', 'Kappa')])
run(db3)
other = db3.execute("SELECT badge_type FROM attendees WHERE event_id=2").fetchone()[0]
check('a Visitor at another event is not raised by this file', other == 'Visitor Pass', other)

# A minister sharing a desk address with a colleague must not become the one picked,
# and must not block the colleague's pass.
db4 = fresh([
    (1, 'min-share', 'Hon Minister', 'Minister of State for IT', 'GoI', '', '', 'desk@office.gov', 1),
    (1, 'aide-share', 'Senior Aide', 'Director of Technology', 'GoI', '', '', 'DESK@office.gov', 1),
])
run(db4)
rows4 = db4.execute("SELECT name, badge_type FROM attendees WHERE lower(trim(email))='desk@office.gov'").fetchall()
check('a minister sharing an address neither takes the pass nor blocks it',
      len(rows4) == 1 and rows4[0][0] == 'Senior Aide', rows4)
before4 = db4.execute('SELECT COUNT(*) FROM attendees').fetchone()[0]
run(db4)
check('still nothing added on a second run with a shared address',
      db4.execute('SELECT COUNT(*) FROM attendees').fetchone()[0] == before4)

print('\n' + ('ALL CHECKS PASSED' if not fails else '%d FAILED: %s' % (len(fails), fails)))
sys.exit(1 if fails else 0)
