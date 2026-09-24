#!/usr/bin/env python3
"""Check a generated panel import before it is run against production.

    python scripts/verify/check-import-sql.py <import.sql> [--panel jnu-30sep]

Runs the file against a scratch SQLite database shaped like production (the
attendees and panel_registrations columns the import touches, with the same
unique keys), then runs it a second time. Proves that every statement parses,
that each lead gets one attendee row and one panel row, that somebody already in
the database keeps their own details and conference place, that nobody is added
to the conference count, and that applying the file twice changes nothing.

Its sibling <import>.consent.sql is applied too when it is next to the file.
Nothing here touches production: it reads the .sql file and writes only in memory.
"""
import argparse
import os
import re
import sqlite3
import sys

SCHEMA = """
CREATE TABLE attendees (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
  company TEXT, job_title TEXT, bio TEXT, avatar_url TEXT, interests TEXT, linkedin_url TEXT, twitter_url TEXT,
  website_url TEXT, role TEXT NOT NULL DEFAULT 'attendee', badge_type TEXT DEFAULT 'general',
  is_online INTEGER DEFAULT 0, last_seen TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  mobile TEXT, city TEXT, country TEXT, industry TEXT, lunch_inclusion TEXT, payment_status TEXT,
  registration_source TEXT, registration_date TEXT, main_event INTEGER NOT NULL DEFAULT 1,
  main_event_answered_at DATETIME, marketing_consent INTEGER, unsubscribed_at DATETIME,
  UNIQUE(event_id, email));
CREATE TABLE panel_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, attendee_id INTEGER NOT NULL, panel_slug TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'page', external_ref TEXT, registered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmation_sent_at DATETIME, confirmation_error TEXT, claimed_at DATETIME, claim_attempts INTEGER NOT NULL DEFAULT 0,
  last_claim_attempt_at DATETIME, certificate_downloaded_at DATETIME, card_downloaded_at DATETIME,
  rsvp_status TEXT, rsvp_at DATETIME, reminder_sent_at DATETIME, reminder_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(attendee_id, panel_slug), FOREIGN KEY (attendee_id) REFERENCES attendees(id));
"""

fails = []


def check(label, ok, detail=''):
    print(('PASS  ' if ok else 'FAIL  ') + label + ('' if ok else '   ' + str(detail)))
    if not ok:
        fails.append(label)


def statements(path):
    if not path or not os.path.exists(path):
        return []
    lines = [l.strip() for l in open(path, encoding='utf-8').read().split('\n')]
    return [l for l in lines if l and not l.startswith('--')]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('sql')
    ap.add_argument('--panel', help='expected panel slug; taken from the file when left out')
    a = ap.parse_args()

    main_sql = statements(a.sql)
    consent_sql = statements(re.sub(r'\.sql$', '', a.sql) + '.consent.sql')
    att = [s for s in main_sql if 'INTO attendees' in s]
    pan = [s for s in main_sql if 'INTO panel_registrations' in s]
    slugs = set(re.findall(r"SELECT id, '([^']+)'", ' '.join(pan)))
    panel = a.panel or (sorted(slugs)[0] if len(slugs) == 1 else None)

    check('the file has statements', bool(main_sql), a.sql)
    check('every line is one complete statement', all(s.endswith(';') for s in main_sql),
          [s[:60] for s in main_sql if not s.endswith(';')][:3])
    check('quotes balance on every line', all(s.count("'") % 2 == 0 for s in main_sql),
          [s[:80] for s in main_sql if s.count("'") % 2][:3])
    check('inserts cannot overwrite an existing row', all(s.startswith('INSERT OR IGNORE INTO') for s in main_sql),
          [s[:60] for s in main_sql if not s.startswith('INSERT OR IGNORE INTO')][:3])
    check('one attendee insert and one panel insert per lead', len(att) == len(pan) and len(att) > 0, f'{len(att)} / {len(pan)}')
    check('one panel only', len(slugs) == 1, slugs)
    if panel:
        check(f'every panel row is {panel}', all(f"'{panel}'" in s for s in pan))
        check(f'every attendee row is tagged campus:{panel}', all(f"'campus:{panel}'" in s for s in att))

    db = sqlite3.connect(':memory:')
    db.executescript(SCHEMA)
    known = re.search(r"VALUES \(\d+, '[^']*', '([^']+)'", att[0])
    known = known.group(1) if known else None
    if known:
        db.execute("INSERT INTO attendees (event_id, name, email, company, registration_source, main_event, marketing_consent) "
                   "VALUES (1, 'Already Registered', ?, 'Their Company', 'website', 1, 1)", (known,))
    db.commit()

    try:
        for s in main_sql + consent_sql:
            db.execute(s)
        db.commit()
        check('the whole file runs', True)
    except sqlite3.Error as e:
        check('the whole file runs', False, e)
        print('\n%d FAILED' % len(fails))
        return 1

    n_pan = db.execute('SELECT COUNT(*) FROM panel_registrations WHERE panel_slug = ?', (panel,)).fetchone()[0]
    check('one panel row per lead', n_pan == len(pan), n_pan)
    check('no lead gets two panel rows', db.execute(
        'SELECT COUNT(*) FROM (SELECT attendee_id FROM panel_registrations WHERE panel_slug = ? GROUP BY 1 HAVING COUNT(*) > 1)',
        (panel,)).fetchone()[0] == 0)
    check('nobody is added to the conference count', db.execute(
        "SELECT COUNT(*) FROM attendees WHERE registration_source LIKE 'campus:%' AND main_event <> 0").fetchone()[0] == 0)
    if known:
        row = db.execute('SELECT name, company, registration_source, main_event FROM attendees WHERE email = ?', (known,)).fetchone()
        check('a person already in the database keeps their details and conference place',
              row == ('Already Registered', 'Their Company', 'website', 1), row)
        check('they are not duplicated', db.execute('SELECT COUNT(*) FROM attendees WHERE email = ?', (known,)).fetchone()[0] == 1)

    before = (db.execute('SELECT COUNT(*) FROM attendees').fetchone()[0],
              db.execute('SELECT COUNT(*) FROM panel_registrations').fetchone()[0])
    for s in main_sql + consent_sql:
        db.execute(s)
    db.commit()
    after = (db.execute('SELECT COUNT(*) FROM attendees').fetchone()[0],
             db.execute('SELECT COUNT(*) FROM panel_registrations').fetchone()[0])
    check('running the file twice adds nothing', before == after, f'{before} then {after}')

    print('\n%s  (%d leads, panel %s)' % ('ALL CHECKS PASSED' if not fails else '%d FAILED: %s' % (len(fails), fails),
                                          len(att), panel))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
