#!/usr/bin/env python3
"""Turn a LinkedIn Lead Gen Form export into SQL for one campus panel.

LinkedIn exports one row per lead: First name, Last name, Email address, Company
name, Job title, Country/Region, created_date/created_time, and the consent
question "The event organizer may use the above information to send
communications about their offerings" as TRUE/FALSE. There is no phone number
and no city.

The file is comma-separated in UTF-8 when downloaded from LinkedIn, and
tab-separated in Windows-1252 once it has been through Excel (which also turns
event_id and form_id into 7.50339E+18). Both are read here; the delimiter is
sniffed from the header line, so pass the file as it came.

Watch the form id, not the file name: there have been two live forms both named
"Registration form for Pre-Event of Bharat AI Innovation", so two exports with
the same name can be different audiences. --exclude-file skips leads that are
already in another export, which is how to import only what a newer download
added.

Each lead becomes an attendee row tagged campus:<slug> with main_event = 0 - a
panel registrant, NOT a conference registrant until they answer the question in
the email or the app (0041) - plus a panel_registrations row with source
'linkedin' and the lead id in external_ref. The marketing consent goes into
attendees.marketing_consent when that column exists (0042): a FALSE there must
keep the person out of every non-transactional campaign.

Safe to re-run: every insert is INSERT OR IGNORE on the email.

Usage:
    python scripts/import-linkedin-panel.py --file "leads.csv" --panel jnu-30sep --out import-linkedin.sql
    python scripts/import-linkedin-panel.py --file "new.csv" --exclude-file "imported.csv" --panel jnu-30sep --out top-up.sql
Then, run by the organiser:
    npx wrangler d1 execute bharatai-production --remote --file=import-linkedin.sql
    npx wrangler d1 execute bharatai-production --remote --file=import-linkedin.consent.sql
"""
import argparse
import collections
import csv
import datetime as dt
import io
import os
import re
import sys

EVENT_ID = 1
DISPOSABLE = ('dd2car.com', 'mailinator.com', 'tempmail', '10minutemail', 'guerrillamail', 'yopmail', 'trashmail')
PANELS = ('djsanghvi-21sep', 'jnu-30sep')


def q(v):
    return "'" + str(v).replace("'", "''") + "'"


def tidy(s):
    s = re.sub(r'\s+', ' ', str(s or '')).strip().strip('"')
    if s and (s.isupper() or s.islower()):
        s = ' '.join(w.capitalize() for w in s.split(' '))
    return s


def read_rows(path):
    """LinkedIn's own download is comma-separated UTF-8; an Excel round-trip makes it
    tab-separated Windows-1252. Sniff the header line rather than assuming either."""
    raw = open(path, 'rb').read()
    try:
        text = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        text = raw.decode('cp1252', errors='replace')
    head = text.split('\n', 1)[0]
    delim = '\t' if head.count('\t') >= head.count(',') else ','
    return delim, list(csv.DictReader(io.StringIO(text), delimiter=delim))


def clean_email(v):
    return re.sub(r'[\s"]+', '', str(v or '')).lower().rstrip('.')


def parse_when(date_s, time_s):
    """LinkedIn writes dates two ways in one file: 09-10-2026 and 9/13/2026, both M-D-Y."""
    d = None
    for fmt in ('%m-%d-%Y', '%m/%d/%Y', '%Y-%m-%d'):
        try:
            d = dt.datetime.strptime(date_s.strip(), fmt).date()
            break
        except ValueError:
            pass
    if not d:
        return dt.date.today().isoformat() + ' 00:00:00'
    t = '00:00:00'
    m = re.search(r'(\d{1,2}):(\d{2})\s*(AM|PM)', time_s or '', re.I)
    if m:
        h, mi, ap = int(m.group(1)), int(m.group(2)), m.group(3).upper()
        h = h % 12 + (12 if ap == 'PM' else 0)
        t = f'{h:02d}:{mi:02d}:00'
    return f'{d.isoformat()} {t}'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--tsv', '--csv', '--file', dest='tsv', required=True,
                    help='the export as LinkedIn wrote it; comma or tab separated')
    ap.add_argument('--panel', required=True, choices=PANELS)
    ap.add_argument('--out', required=True)
    ap.add_argument('--drop-email', action='append', default=[])
    ap.add_argument('--exclude-file', action='append', default=[],
                    help='another export whose leads are already imported; repeatable')
    a = ap.parse_args()

    delim, rows = read_rows(a.tsv)
    consent_col = next((k for k in rows[0].keys() if 'organizer may use' in k.lower()), None)
    drop = {e.strip().lower() for e in a.drop_email}
    already = {}
    for path in a.exclude_file:
        for r in read_rows(path)[1]:
            e = clean_email(r.get('Email address'))
            if e:
                already.setdefault(e, os.path.basename(path))
    forms = sorted({(r.get('form_id') or '').strip() for r in rows})
    print(f'{a.tsv}\n  separator {"tab" if delim == chr(9) else "comma"}, {len(rows)} leads, form id {", ".join(forms) or "(none)"}')
    if already:
        print(f'  excluding {len(already)} lead(s) listed in {len(a.exclude_file)} earlier export(s)')

    kept, dropped, seen = [], [], set()
    for r in rows:
        email = clean_email(r.get('Email address'))
        name = tidy((r.get('First name') or '') + ' ' + (r.get('Last name') or ''))
        why = ''
        if str(r.get('test_lead', '')).upper() == 'TRUE':
            why = 'LinkedIn test lead'
        elif not re.match(r'^[^@\s]+@[^@\s]+\.[a-z]{2,}$', email):
            why = 'malformed email'
        elif email in already:
            why = 'already in ' + already[email]
        elif email in drop:
            why = 'dropped by --drop-email'
        elif any(d in email for d in DISPOSABLE):
            why = 'disposable email'
        elif email in seen:
            why = 'duplicate email'
        elif not name:
            why = 'no name'
        if why:
            dropped.append((email or '(blank)', name, why))
            continue
        seen.add(email)
        consent = None
        if consent_col:
            v = str(r.get(consent_col, '')).strip().upper()
            consent = 1 if v == 'TRUE' else 0 if v == 'FALSE' else None
        kept.append(dict(
            name=name, email=email,
            company=tidy(r.get('Company name')), job=tidy(r.get('Job title')),
            country=tidy(r.get('Country/Region')) or 'India',
            when=parse_when(r.get('created_date', ''), r.get('created_time', '')),
            lead_id=(r.get('lead_id') or '').strip(), consent=consent,
        ))

    lines = [
        f'-- LinkedIn lead-gen import: {a.panel}, {len(kept)} people from {a.tsv}',
        f'-- Generated {dt.datetime.now():%Y-%m-%d %H:%M}. Safe to re-run: every insert is OR IGNORE on the email.',
        '',
    ]
    for p in kept:
        lines.append(
            'INSERT OR IGNORE INTO attendees (event_id, name, email, company, job_title, bio, interests, linkedin_url, mobile, city, country, industry, lunch_inclusion, role, badge_type, payment_status, registration_source, registration_date, is_online, main_event) VALUES ('
            + ', '.join([str(EVENT_ID), q(p['name']), q(p['email']), q(p['company']), q(p['job']), "''", "''", "''", "''", "''",
                         q(p['country']), "''", "'No'", "'attendee'", "'Visitor Pass'", "'paid'",
                         q('campus:' + a.panel), q(p['when']), '0', '0'])
            + ');'
        )
        ref = 'linkedin:' + p['lead_id'] + (';consent=' + ('yes' if p['consent'] == 1 else 'no') if p['consent'] is not None else '')
        lines.append(
            f"INSERT OR IGNORE INTO panel_registrations (attendee_id, panel_slug, source, external_ref, registered_at) "
            f"SELECT id, {q(a.panel)}, 'linkedin', {q(ref)}, {q(p['when'])} "
            f"FROM attendees WHERE event_id = {EVENT_ID} AND lower(email) = {q(p['email'])} ORDER BY id LIMIT 1;"
        )
    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')

    # Marketing consent goes to its own file: it needs migration 0042, and a D1
    # batch is all-or-nothing, so one failing UPDATE would roll back every insert.
    consent_path = re.sub(r'\.sql$', '', a.out) + '.consent.sql'
    with open(consent_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('-- Marketing consent from the LinkedIn form (needs migration 0042). Never overwrites an unsubscribe.\n')
        for p in kept:
            if p['consent'] is None:
                continue
            f.write(f"UPDATE attendees SET marketing_consent = {p['consent']} WHERE event_id = {EVENT_ID} AND lower(email) = {q(p['email'])} AND unsubscribed_at IS NULL;\n")

    print(f'leads in export: {len(rows)}   kept: {len(kept)}   left out: {len(dropped)}')
    by_reason = collections.Counter(why for _, _, why in dropped)
    for why, n in by_reason.most_common():
        print(f'  left out ({n}): {why}')
        for e, nm, w in [d for d in dropped if d[2] == why][:8]:
            print(f'      {e}  ({nm})')
        if n > 8:
            print(f'      ... and {n - 8} more')
    c = collections.Counter(p['consent'] for p in kept)
    print(f'marketing consent: yes {c.get(1, 0)}, no {c.get(0, 0)}, unanswered {c.get(None, 0)}')
    print(f'wrote {a.out}  ({2 * len(kept)} inserts)')
    print(f'wrote {consent_path}  ({sum(1 for p in kept if p["consent"] is not None)} consent updates; apply after migration 0042)')


if __name__ == '__main__':
    sys.exit(main())
