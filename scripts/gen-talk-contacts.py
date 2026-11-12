"""The Innovation Talk speakers' own email and mobile, for the app (12 Nov 2026).

Reads the organisers' booth workbook ("Bharat AI Exhibition booth 2026", tab
"Innovation Talk Speakers": one row per person, the company named on its first row;
columns Representative Name, Role/pass, Email, Mobile) and writes an SQL file that
puts each speaker's email and mobile on their talk in D1 innovation_talks (migration
0052). Talks are matched to scripts/data/innovation-talks.json by name (a first name
there may be a full name in the sheet, within the same company).

    python scripts/gen-talk-contacts.py "<booth workbook.xlsx>" "<folder OUTSIDE the repo>"

The SQL carries personal data, so the folder must be outside the repository. It fills
only empty boxes (an email or mobile typed in Admin is never replaced) and is safe to
run twice. The organiser runs it after 0052:
    npx wrangler d1 execute bharatai-production --remote --file=<that folder>/innovation-talk-contacts.sql
Download the workbook with the Google Drive connector (export as xlsx). Nothing here
prints an email or a mobile.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIST = os.path.join(ROOT, 'scripts', 'data', 'innovation-talks.json')
EMAIL = re.compile(r'^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>.]{2,}$')


def clean(v):
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return re.sub(r'\s+', ' ', str(v)).strip()


def key(n):
    n = re.sub(r'^\s*(dr|mr|mrs|ms|prof|shri|smt)\.?\s+', '', str(n), flags=re.I)
    return re.sub(r'[^a-z]', '', re.sub(r'\(.*?\)', '', n).lower())


def company_key(c):
    return re.sub(r'[^a-z0-9]', '', re.sub(r'\b(pvt|private|ltd|limited|llp|inc)\b', ' ', str(c).lower()))


def mobile(v):
    d = re.sub(r'\D', '', str(v))
    if len(d) == 12 and d.startswith('91'):
        d = d[2:]
    return '+91 ' + d[:5] + ' ' + d[5:] if len(d) == 10 and d[0] in '6789' else ''


def sq(s):
    return str(s).replace("'", "''")


def read_people(book):
    import openpyxl
    ws = openpyxl.load_workbook(book, data_only=True)['Innovation Talk Speakers']
    rows = list(ws.iter_rows(values_only=True))
    head = [clean(h).lower() for h in rows[0]]

    def col(prefix):
        for i, h in enumerate(head):
            if h.startswith(prefix.lower()):
                return i
        raise SystemExit(f'the tab has no column starting "{prefix}": {head}')
    c_company, c_speaker, c_name, c_role = col('Company Name'), col('Speaker'), col('Representative Name'), col('Role/pass')
    c_email, c_mobile = col('Email'), col('Mobile')
    people, company = [], ''
    for r in rows[1:]:
        r = list(r) + [None] * (len(head) - len(r))
        company = clean(r[c_company]) or company
        name = clean(r[c_name])
        role, flag = clean(r[c_role]).lower(), clean(r[c_speaker]).lower()
        if name and ('speaker' in role or flag == 'yes'):
            # clean() first: the sheet stores a mobile as a number (9820012345.0).
            people.append({'company': company, 'name': name, 'email': clean(r[c_email]).lower(), 'mobile': mobile(clean(r[c_mobile]))})
    return people


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    book, out_dir = sys.argv[1], os.path.abspath(sys.argv[2])
    if os.path.commonpath([out_dir, ROOT]) == ROOT:
        raise SystemExit('Refusing to write personal data inside the repository: choose a folder outside it.')
    os.makedirs(out_dir, exist_ok=True)
    people = read_people(book)
    talks = json.load(open(LIST, encoding='utf-8'))

    def find(t):
        k = key(t['name'])
        hit = [p for p in people if key(p['name']) == k]
        if not hit:
            hit = [p for p in people if company_key(p['company']).startswith(company_key(t['company'])[:5])
                   and (key(p['name']).startswith(k) or k.startswith(key(p['name'])))]
        return hit[0] if hit and len({key(h['name']) for h in hit}) == 1 else None

    lines = ["-- Innovation Talk speakers' own email and mobile, from the booth workbook (tab",
             '-- "Innovation Talk Speakers"), written by scripts/gen-talk-contacts.py.',
             '-- PERSONAL DATA: never commit this file. Needs migration 0052.',
             '-- Fills only empty boxes; safe to run twice.', '']
    emails, mobiles, missing = [], [], []
    for t in talks:
        p = find(t)
        if not p:
            missing.append(t['name'])
            continue
        where = f"event_id = 1 AND speaker_name = '{sq(t['name'])}'"
        if p['email'] and EMAIL.match(p['email']):
            lines.append(f"UPDATE innovation_talks SET speaker_email = '{sq(p['email'])}' WHERE {where} AND trim(ifnull(speaker_email, '')) = '';")
            emails.append(t['name'])
        if p['mobile']:
            lines.append(f"UPDATE innovation_talks SET speaker_phone = '{sq(p['mobile'])}' WHERE {where} AND trim(ifnull(speaker_phone, '')) = '';")
            mobiles.append(t['name'])
    lines += ['', "SELECT COUNT(*) AS talks, SUM(trim(ifnull(speaker_email, '')) <> '') AS with_email, "
              "SUM(trim(ifnull(speaker_phone, '')) <> '') AS with_mobile FROM innovation_talks WHERE event_id = 1;", '']
    out = os.path.join(out_dir, 'innovation-talk-contacts.sql')
    open(out, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
    print(out)
    print(f'{len(emails)} talks get the speaker\'s own email, {len(mobiles)} a mobile, of {len(talks)}')
    print('not in the tab as a speaker:', ', '.join(missing) or 'none')


if __name__ == '__main__':
    main()
