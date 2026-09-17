#!/usr/bin/env python3
"""Turn a mUni Campus "Registered Candidates" export into SQL for one campus panel.

Why a script and not the admin bulk upload: that upload writes no
registration_source and defaults every row to a Delegate badge, which would put a
few hundred students into the conference list as paying delegates. This writes
each person tagged campus:<slug> with main_event = 0 - registered for the panel,
NOT for the conference until they answer the question in the email or the app
(0041) - and adds a panel_registrations row (0040) with source 'muni'.

Safe to run again on a fresh export: both inserts are INSERT OR IGNORE keyed on
the email, so a person already in the database keeps their row - and keeps their
original registration_source if they came to us first through the website - and
only gains the panel row.

Usage:
    python scripts/import-muni-panel.py --xls "Registered_Candidates.xls" --panel djsanghvi-21sep --out import.sql
    python scripts/import-muni-panel.py ... --new-code            # also writes <out>.claim-code.sql and prints the code
    python scripts/import-muni-panel.py ... --code 7K4M2P         # reuse a code already on a slide
    python scripts/import-muni-panel.py ... --drop-email x@y.com  # leave a row out (repeatable)

Then, after `npx wrangler login`:
    npx wrangler d1 execute bharatai-production --remote --file=import.sql
    npx wrangler d1 execute bharatai-production --remote --file=import.claim-code.sql

The claim code goes in its own file on purpose: re-running the import must never
rotate a code that is already printed on the closing slide.

mUni's .xls is an OLE file that trips xlrd's directory parser ("Workbook corruption").
The Workbook stream itself is fine, so it is pulled out with olefile and handed to
xlrd as raw bytes. Needs: pip install xlrd olefile
"""
import argparse
import collections
import datetime as dt
import re
import secrets
import sys

EVENT_ID = 1
INDUSTRY = 'Education & Academia'   # must be a member of INDUSTRIES in src/index.tsx

# Six characters from an alphabet with no I, O, 0 or 1 - nothing to mis-read off
# a projector. Matches normalisePanelCode() in src/index.tsx, which upper-cases
# and strips separators before comparing.
CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

DISPOSABLE = ('dd2car.com', 'mailinator.com', 'tempmail', '10minutemail', 'guerrillamail', 'yopmail', 'trashmail')
TYPO_DOMAINS = {'gnail.com': 'gmail.com', 'gmial.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmal.com': 'gmail.com',
                'yahho.com': 'yahoo.com', 'hotmial.com': 'hotmail.com', 'outlok.com': 'outlook.com'}

HOSTS = {
    'djsanghvi-21sep': {
        'canonical': 'Dwarkadas J. Sanghvi College of Engineering',
        # lowercase-letters-only forms that mean the host college
        'match': re.compile(r'sanghvi|sanghavi|sangvi|shangvi|shanghvi|^djsce|^djs$|^djscemumbai$|jivanlal'),
    },
    'jnu-30sep': {
        'canonical': 'Jawaharlal Nehru University',
        'match': re.compile(r'jawaharlalnehru|^jnu'),
    },
}


def read_rows(path):
    import olefile
    import xlrd
    ole = olefile.OleFileIO(path)
    name = 'Workbook' if ole.exists('Workbook') else 'Book'
    book = xlrd.open_workbook(file_contents=ole.openstream(name).read())
    sh = book.sheet_by_index(0)
    hdr = [str(sh.cell_value(0, c)).strip() for c in range(sh.ncols)]
    rows = []
    for r in range(1, sh.nrows):
        d = {}
        for c, h in enumerate(hdr):
            v = sh.cell_value(r, c)
            if isinstance(v, float) and v.is_integer():
                v = str(int(v))
            d[h] = str(v).strip()
        rows.append(d)
    return rows


def q(v):
    """SQL literal."""
    return "'" + str(v).replace("'", "''") + "'"


def tidy_name(s):
    s = re.sub(r'\s+', ' ', s).strip()
    if not s:
        return s
    if s.isupper() or s.islower():
        s = ' '.join(w.capitalize() if not w.startswith(('Mc', 'Mac')) else w for w in s.split(' '))
    return s


def tidy_title(s):
    s = re.sub(r'\s+', ' ', s).strip()
    return s.title() if s.isupper() or s.islower() else s


def parse_date(s):
    for fmt in ('%b %d, %Y', '%d %b %Y', '%Y-%m-%d', '%d/%m/%Y'):
        try:
            return dt.datetime.strptime(s.strip(), fmt).strftime('%Y-%m-%d')
        except ValueError:
            pass
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--xls', required=True)
    ap.add_argument('--panel', required=True, choices=sorted(HOSTS))
    ap.add_argument('--out', required=True, help='SQL file to write')
    ap.add_argument('--code', help='claim code to store (six characters)')
    ap.add_argument('--new-code', action='store_true', help='generate a claim code')
    ap.add_argument('--drop-email', action='append', default=[], help='leave this address out')
    a = ap.parse_args()

    host = HOSTS[a.panel]
    slug = a.panel
    rows = read_rows(a.xls)
    drop = {e.strip().lower() for e in a.drop_email}

    kept, dropped, warnings = [], [], []
    seen = set()
    for r in rows:
        email = r.get('Email Id', '').strip().lower().rstrip('.')
        first, last = r.get('First Name', ''), r.get('Last Name', '')
        name = tidy_name(first + ' ' + last)
        mobile = re.sub(r'\D', '', r.get('Mobile No', ''))
        why = ''
        if not email or not re.match(r'^[^@\s]+@[^@\s]+\.[a-z]{2,}$', email):
            why = 'malformed email'
        elif email in drop:
            why = 'dropped by --drop-email'
        elif any(d in email for d in DISPOSABLE):
            why = 'disposable email'
        elif re.match(r'^(\d)\1{9}$|^0909|^1234567890$|^0000', mobile):
            why = 'placeholder mobile'
        elif email in seen:
            why = 'duplicate email'
        elif not name.strip():
            why = 'no name'
        if why:
            dropped.append((email or '(blank)', name, why))
            continue
        seen.add(email)
        dom = email.split('@')[-1]
        if dom in TYPO_DOMAINS:
            warnings.append(f'{email}: looks like a typo for @{TYPO_DOMAINS[dom]} - mail to it will bounce; not changed')

        college = re.sub(r'\s+', ' ', r.get('College', '')).strip()
        letters = re.sub(r'[^a-z]', '', college.lower())
        if letters and host['match'].search(letters):
            college = host['canonical']
        elif college.isupper() or college.islower():
            college = college.title()
        job = tidy_title(r.get('Designation', '')) or 'Student'
        city = tidy_title(r.get('City', ''))
        year = r.get('Passing Year', '')
        bio = f'Class of {year}' if year.isdigit() and 2024 <= int(year) <= 2031 else ''
        reg = parse_date(r.get('Registration Date', '')) or dt.date.today().isoformat()
        kept.append(dict(name=name, email=email, mobile=mobile, college=college, job=job,
                         city=city, bio=bio, reg=reg))

    lines = [
        f'-- Campus panel import: {slug}, {len(kept)} people from {a.xls}',
        f'-- Generated {dt.datetime.now():%Y-%m-%d %H:%M}. Safe to re-run: every insert is OR IGNORE on the email.',
        '',
    ]
    for p in kept:
        lines.append(
            'INSERT OR IGNORE INTO attendees (event_id, name, email, company, job_title, bio, interests, linkedin_url, mobile, city, country, industry, lunch_inclusion, role, badge_type, payment_status, registration_source, registration_date, is_online) VALUES ('
            + ', '.join([str(EVENT_ID), q(p['name']), q(p['email']), q(p['college']), q(p['job']), q(p['bio']), "''", "''",
                         q(p['mobile']), q(p['city']), "'India'", q(INDUSTRY), "'No'", "'attendee'", "'Visitor Pass'", "'paid'",
                         q('campus:' + slug), q(p['reg'] + ' 00:00:00'), '0'])
            + ');'
        )
        lines.append(
            f"INSERT OR IGNORE INTO panel_registrations (attendee_id, panel_slug, source, external_ref, registered_at) "
            f"SELECT id, {q(slug)}, 'muni', {q('muni:' + p['reg'])}, {q(p['reg'] + ' 00:00:00')} "
            f"FROM attendees WHERE event_id = {EVENT_ID} AND lower(email) = {q(p['email'])};"
        )
    # Panel-only until they say yes to November (0041). Guarded on
    # main_event_answered_at so a re-run never undoes an answer already given.
    lines.append('')
    lines.append("UPDATE attendees SET main_event = 0 WHERE registration_source LIKE 'campus:%' AND main_event_answered_at IS NULL;")
    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')

    code = None
    if a.code or a.new_code:
        code = re.sub(r'[^A-Z0-9]', '', (a.code or '').upper()) or ''.join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        code_path = re.sub(r'\.sql$', '', a.out) + '.claim-code.sql'
        with open(code_path, 'w', encoding='utf-8', newline='\n') as f:
            f.write(f"-- Claim code for {slug}. Apply once; never re-apply after the slide is printed.\n")
            f.write(f"INSERT INTO app_settings (key, value, updated_at) VALUES ({q('panel_claim_code:' + slug)}, {q(code)}, CURRENT_TIMESTAMP)\n"
                    f"  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;\n")

    # ---- report ----
    print(f'rows in export: {len(rows)}   kept: {len(kept)}   left out: {len(dropped)}')
    for e, n, why in dropped:
        print(f'  left out: {e}  ({n})  - {why}')
    for w in warnings:
        print(f'  warning:  {w}')
    colleges = collections.Counter(p['college'] for p in kept)
    print(f'{host["canonical"]}: {colleges.get(host["canonical"], 0)}; other colleges: {len(kept) - colleges.get(host["canonical"], 0)}; blank: {colleges.get("", 0)}')
    print(f'wrote {a.out}  ({2 * len(kept)} statements)')
    if code:
        print(f'wrote {code_path}')
        print(f'CLAIM CODE for {slug}: {code}   (put this on the closing slide; do not commit it)')


if __name__ == '__main__':
    sys.exit(main())
