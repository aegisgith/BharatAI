"""Exhibitor teams from the organisers' booking sheet (11 Nov 2026).

Reads the "Innovation Talk Speakers" tab of the workbook "Bharat AI Exhibition booth
2026" (exported from Google Sheets as .xlsx) and writes:

  <out>.sql         for the organiser to run on production D1, AFTER migration 0050:
                    the exhibitors that have no row yet, each SPOC's login (no
                    password: the "add your team" email signs them in), the booth type
                    and the SPOC's name for the email, and the people the sheet already
                    names, so the SPOC only fills the gaps. Safe to run twice.
  <out>-review.txt  what was read, what was left out and why, for the organiser.

Neither file belongs in the repository: both carry people's emails and mobiles.

    python scripts/gen-team-import.py "<workbook.xlsx>" "<out folder>" ["<owners.json>"]
    python scripts/gen-team-import.py --check "<out>.sql"   # runs it twice on a scratch copy

The SPOC column on that tab says "it will not go on portal and get no pass": the SPOC
gets the login, and a pass only by adding themselves to the team (organiser, 11 Nov).
"""
import json
import os
import re
import sqlite3
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Sheet company -> (exhibitors.id in production on 11 Nov 2026, or None for a new row,
# the name a new row is given: the exhibitor wall's name). None as the whole value
# leaves the company out, with the reason in SKIP.
COMPANIES = {
    'Jade Global': (35, None),
    'Assessfy Learning Innovations Pvt. Ltd.': (39, None),
    'Joget INC': (23, None),            # 34 'Joget' and 40 'JOGET' are duplicates; 23 has the stand
    'Intangles': (3, None),
    'Minsitry of Tribal Affairs': (24, None),
    'LightMetrics': (None, 'LightMetrics'),
    'Image Infosystem': (4, None),
    'CGI': (5, None),
    'Dysosphere Pvt Ltd': (None, 'Dysosphere'),
    'Algo Analytics': (6, None),
    'Seem Fintech & Sustainability Pvt Ltd': (7, None),
    'COSMICA TELEMATICS PRIVATE LIMITED': (8, None),
    'Harrier Information Systems Pvt. Ltd.': (25, None),
    'Ai Vie Insights Private Limited': (9, None),
    'NoBroker Technologies Solutions Private Limited': (10, None),
    'Valuenable pvt ltd': (None, 'ValuEnable'),
    'Saranyu Technologies': (11, None),
    'kadeep.ai': (26, None),            # 33 'KaDeep Technologies' is a duplicate
    'Asmadiya': (12, None),
    'Info Science Labs': (None, 'Info Science Labs'),
    'Info Science Labs (Old - 86)': (None, 'Info Science Labs'),
    'Evoke Technologies': (27, None),
    'Vassar Lab': (None, 'Vassar Labs'),
    'Envista Cyber Defence': (28, None),
    'Paisani Technology Services': (13, None),
    'RedFerns Tech Private Limited': (29, None),
    'Xtant Tech': (None, 'Xtant Tech'),
    'ORANJE AI PRIVATE LIMITED': (14, None),
    'EURYS infosystemS private limited': (15, None),
    'Daten Intelligenz Software, AIGyan Technologies': (16, None),
    'Wyn Labs': (17, None),
    'Trust3 AI': (None, 'Trust3 AI'),
    'Origins AI': (19, None),           # 37 'OriginLabs AI Private Limited' is a duplicate
    'Kirusa Inc': (20, None),
    'Phoebetal Technologies Pvt Ltd': (30, None),
    'Zanopy AI': (21, None),
    'ary-soft': (31, None),             # 36 'ArySoft Global' is a duplicate
    'Joyvibe': (None, 'JoyVibe'),
    'Aria Telecom Solutions Pvt. Ltd': (None, 'Aria Telecom'),
    'P99SOFT': (None, 'P99Soft'),
    'CloudCarne': (None, 'Cloud Crane'),
    'Oli AI': (38, None),
    'Teenage Works': (None, 'Teenage Works'),
    'Gupshup.io (Old - 85)': (None, 'Gupshup'),   # spaces are collapsed when the sheet is read
    'FTA GLOBAL': (None, 'FTA Global'),
    'Nu10 Technologies India Pvt. Ltd.': (None, 'Nu10 Technologies'),
    'Rightangle.co.in': (None, 'Rightangle Technologies'),
    'OneVio': (None, 'OneVio'),
}
SKIP = {
    'Indigloo Software Pvt Ltd': 'dropped by the organiser on 28 Oct 2026; still on the sheet with no details',
    'EDU VANTAGE PRIVATE LIMITED': 'no contact person or email on the sheet',
}
# The sheet's "Type of Booth" -> the floor plan's type_key ('standard' is the
# Accelerator Booth, 'accelerator' the Enterprise Booth).
TYPES = {
    'startup pod': ('pod', 'Startup Pod', '1.5m x 1.5m'), 'explorer booth': ('explorer', 'Explorer Booth', '2m x 2m'),
    'innovator': ('innovator', 'Innovator Booth', '3m x 2m'), 'innovator booth': ('innovator', 'Innovator Booth', '3m x 2m'),
    'accelerator': ('standard', 'Accelerator Booth', '3m x 3m'), 'enterprise booth': ('accelerator', 'Enterprise Booth', '4m x 2m'),
    'premium enterprise': ('premium', 'Premium Enterprise Booth', '5m x 2m'),
    'flagship pavillion': ('enterprise', 'Flagship Pavilion', '6m x 2m'), 'flagship pavilion': ('enterprise', 'Flagship Pavilion', '6m x 2m'),
    'mega pavilion': ('mega', 'Mega Pavilion', '7m x 7.7m'),
}
# Who at Bharat AI Innovation looks after each exhibitor (the sheet's "Kitty") and where
# exhibitors email their artwork, with register@ in CC. The names and addresses come from a
# JSON file kept OUTSIDE the repository ({"Tushar": {"name": ..., "email": ...}}), passed as
# the third argument; without it the email names the contact by the sheet's first name.
OWNERS = {}
PUBLIC_MAIL = {'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'rediffmail.com', 'tuta.com', 'icloud.com'}
EMAIL_RE = re.compile(r'^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$')


def cell(v):
    if v is None:
        return ''
    if isinstance(v, float):
        v = int(v) if v.is_integer() else v
    s = str(v).replace('�', '–').replace('\n', ' ').strip()
    return re.sub(r'\s+', ' ', s)


def first_email(s):
    for part in re.split(r'[\s/,;]+', s or ''):
        if EMAIL_RE.match(part):
            return part.lower()
    return ''


def nice(name):
    name = re.sub(r'^(mr|mrs|ms|shri)\.?\s+', '', name.strip(), flags=re.I)
    return ' '.join(w[:1].upper() + w[1:] if w.islower() else w for w in name.split())


def split_name(name):
    parts = nice(name).split()
    if len(parts) <= 1:
        return (parts[0] if parts else ''), ''
    return ' '.join(parts[:-1]), parts[-1]


def last(name):
    p = nice(name).lower().split()
    return p[-1] if p else ''


def sq(v):
    return "'" + str(v).replace("'", "''") + "'"


def name_key(name):
    n = nice(re.sub(r'\(.*?\)', '', name)).lower()
    if n.startswith('dr'):
        n = re.sub(r'^dr\.?\s*', '', n)
    return re.sub(r'[^a-z]', '', n)


def read(xlsx):
    import openpyxl
    ws = next(w for w in openpyxl.load_workbook(xlsx, data_only=True).worksheets if w.title.startswith('Innovation Talk'))
    out, cur = [], None
    for r in ws.iter_rows(min_row=2, max_row=ws.max_row):
        v = [cell(c.value) for c in r[:21]]
        if not any(v):
            continue
        sr, btype, booth, company, g, h, i, kitty, spk, m, role, desig, status, photos, t, u = (v[0], v[1], v[4], v[5], v[6], v[7], v[8], v[10], v[11], v[12], v[13], v[14], v[16], v[17], v[19], v[20])
        if company:
            cur = company
        if not cur:
            continue
        # Two rows (Nu10, Rightangle) carry the owner one column over, under Presenter Photos.
        if not kitty and photos in OWNERS:
            kitty = photos
        out.append(dict(sr=sr, owner=kitty, btype=btype, booth=booth, company=cur, spoc=g, spoc_email=h, phone=i, speaker=spk, rep=m, role=role, designation=desig, status=status, email=t, mobile=u))
    return out


def build(xlsx):
    rows = read(xlsx)
    photos = {}
    talks = json.load(open(os.path.join(ROOT, 'scripts', 'data', 'innovation-talks.json'), encoding='utf-8'))
    talks = talks if isinstance(talks, list) else next(iter(talks.values()))
    for t in talks:
        if t.get('slug') and os.path.exists(os.path.join(ROOT, 'public', 'images', 'talks', t['slug'] + '.webp')):
            photos[name_key(t['name'])] = '/images/talks/' + t['slug'] + '.webp'
    review = []
    companies = {}
    for r in rows:
        key = r['company']
        if key in SKIP:
            continue
        if key not in COMPANIES:
            review.append(f"NOT MAPPED, left out: {key!r} (add it to COMPANIES in this script)")
            continue
        ex_id, new_name = COMPANIES[key]
        ck = ex_id if ex_id else new_name
        c = companies.setdefault(ck, dict(ex_id=ex_id, name=new_name, sheet_names=set(), spoc='', spoc_email='', owner='', types=set(), booths=set(), rows=[], numbers=set()))
        c['sheet_names'].add(key)
        if r['sr']:
            if not c['owner'] and r['owner'] and r['owner'].upper() != 'NA':
                c['owner'] = nice(r['owner'])
            if not c['spoc'] and r['spoc']:
                c['spoc'], c['spoc_email'] = nice(r['spoc']), first_email(r['spoc_email'])
            t = TYPES.get(r['btype'].lower())
            if t:
                c['types'].add(t)
            if r['booth']:
                c['booths'].add(r['booth'])
        c['rows'].append(r)
    for k, reason in SKIP.items():
        review.append(f"LEFT OUT: {k}: {reason}")

    owner_of_domain = {}
    for c in companies.values():
        d = c['spoc_email'].split('@')[-1]
        if d and d not in PUBLIC_MAIL:
            owner_of_domain.setdefault(d, set()).add(c['name'] or c['ex_id'])

    for ck, c in companies.items():
        label = c['name'] or sorted(c['sheet_names'])[0]
        seen, people = set(), []
        for r in c['rows']:
            rep = r['rep']
            if re.search(r'share the details|tomorrow', rep, re.I):
                rep = ''
            person = rep or (r['spoc'] if (r['role'] or not r['sr']) else '')
            if not person:
                continue
            email = first_email(r['email'])
            mobile = r['mobile']
            same_as_spoc_col = r['spoc'] and last(person) == last(r['spoc'])
            if not email and same_as_spoc_col:
                email, mobile = first_email(r['spoc_email']), mobile or r['phone']
            if not email and c['spoc'] and nice(person).split()[0].lower() == c['spoc'].split()[0].lower():
                email = c['spoc_email']
            dom = email.split('@')[-1] if email else ''
            own = c['spoc_email'].split('@')[-1] if c['spoc_email'] else ''
            if dom and dom not in PUBLIC_MAIL and dom != own and owner_of_domain.get(dom) and label not in owner_of_domain[dom]:
                review.append(f"{label}: {nice(person)} left out: their email {email} belongs to {', '.join(map(str, owner_of_domain[dom]))} (sheet copy error?)")
                continue
            role = r['role'].lower()
            spk = 'speaker' in role or (not role and r['speaker'].lower() == 'yes')
            booth = 'exhibitor' in role or 'panelist' in role or (not role and r['speaker'].lower() not in ('yes',))
            if not role and r['speaker'].lower().startswith('not interested'):
                review.append(f"{label}: {nice(person)} left out: listed without a role and the company is not interested in the talk")
                continue
            if not spk and not booth:
                booth = True
            k = name_key(person)
            if k in seen:
                continue
            seen.add(k)
            if email and any(p['email'] == email for p in people):
                review.append(f"{label}: {nice(person)}: email {email} is also given for another person on the same team; left empty for them to fill")
                email = ''
            desig = re.sub(r'^\((.*)\)$', r'\1', r['designation']).strip()
            if not email and not desig:
                review.append(f"{label}: {nice(person)} left out: no email and no designation on the sheet")
                continue
            fn, ln = split_name(person)
            mob = re.sub(r'[^\d+ ]', '', str(mobile)).strip()
            if len(re.sub(r'\D', '', mob)) < 10:
                mob = ''
            people.append(dict(first=fn, last=ln, designation=desig, email=email, mobile=mob, speaker=int(spk), booth=int(booth), photo=photos.get(k, '')))
        c['people'] = people
        if not c['spoc_email']:
            m = next((p for p in people if c['spoc'] and p['first'].split()[0].lower() == c['spoc'].split()[0].lower() and p['email']), None)
            if m:
                c['spoc_email'] = m['email']
                review.append(f"{label}: no SPOC email on the sheet; using {m['first']} {m['last']}'s ({m['email']}) as the contact login")
            else:
                review.append(f"{label}: no SPOC email on the sheet: no login is made and nobody can be emailed. Add one to the sheet and re-run.")
        if len(c['types']) != 1:
            review.append(f"{label}: booth type unclear on the sheet ({', '.join(sorted(t[1] for t in c['types'])) or 'none'}); the number of passes waits for you on the Teams screen")
        elif next(iter(c['types']))[0] == 'premium':
            review.append(f"{label}: Premium Enterprise Booth is not priced on /exhibition, so it has no number of passes yet. Set it on the Teams screen.")
    return companies, review


def sql_for(companies):
    out = [f"-- Exhibitor teams from the booking sheet, generated {date.today().isoformat()} by scripts/gen-team-import.py.",
           '-- Run AFTER migrations/0050_exhibitor_team.sql. Safe to run twice: nothing already there is overwritten,',
           "-- except each exhibitor's booth details and contact name in exhibitor_team_settings (the sheet's own data).",
           '-- Contains personal data (emails, mobiles): do not commit it.', '']
    for ck, c in sorted(companies.items(), key=lambda kv: str(kv[1]['name'] or kv[1]['ex_id'])):
        name = c['name']
        ex = str(c['ex_id']) if c['ex_id'] else f"(SELECT id FROM exhibitors WHERE event_id = 1 AND lower(trim(company_name)) = lower({sq(name)}) ORDER BY id LIMIT 1)"
        label = name or sorted(c['sheet_names'])[0]
        out.append(f"-- {label}: booth {', '.join(sorted(c['booths'])) or '?'}, {len(c['people'])} people from the sheet")
        if not c['ex_id']:
            booth_no = ', '.join(sorted(c['booths'], key=lambda b: float(b) if re.match(r'^[\d.]+$', b) else 0))
            out.append(f"INSERT INTO exhibitors (event_id, company_name, contact_email, booth_number, description) SELECT 1, {sq(name)}, {sq(c['spoc_email'])}, {sq(booth_no)}, '' "
                       f"WHERE NOT EXISTS (SELECT 1 FROM exhibitors WHERE event_id = 1 AND lower(trim(company_name)) = lower({sq(name)}));")
        if c['spoc_email']:
            e = c['spoc_email']
            out.append(f"UPDATE exhibitors SET contact_email = {sq(e)} WHERE id = {ex} AND trim(ifnull(contact_email, '')) = '';")
            out.append(f"INSERT INTO mp_companies (company_name, email, password_hash, exhibitor_id) SELECT company_name, {sq(e)}, '', id FROM exhibitors WHERE id = {ex} "
                       f"AND NOT EXISTS (SELECT 1 FROM mp_companies WHERE lower(trim(email)) = {sq(e)});")
            out.append(f"UPDATE mp_companies SET exhibitor_id = {ex} WHERE lower(trim(email)) = {sq(e)} AND ifnull(role, 'company') <> 'admin' AND {ex} IS NOT NULL;")
        t = next(iter(c['types'])) if len(c['types']) == 1 else ('', '', '')
        n = max(1, len(c['booths'])) if t[0] else 1
        out.append(f"INSERT INTO exhibitor_team_settings (exhibitor_id, booth_type, booth_name, booth_dim, booths, contact_name, owner_name, owner_email) SELECT {ex}, {sq(t[0])}, {sq(t[1])}, {sq(t[2])}, {n}, {sq(c['spoc'])}, {sq(OWNERS.get(c['owner'], {}).get('name') or c['owner'])}, {sq(OWNERS.get(c['owner'], {}).get('email', ''))} WHERE {ex} IS NOT NULL "
                   f"ON CONFLICT(exhibitor_id) DO UPDATE SET booth_type = excluded.booth_type, booth_name = excluded.booth_name, booth_dim = excluded.booth_dim, booths = excluded.booths, contact_name = excluded.contact_name, owner_name = excluded.owner_name, owner_email = CASE WHEN excluded.owner_email <> '' THEN excluded.owner_email ELSE exhibitor_team_settings.owner_email END, updated_at = CURRENT_TIMESTAMP;")
        for p in c['people']:
            guard = (f"NOT EXISTS (SELECT 1 FROM exhibitor_team WHERE event_id = 1 AND email = {sq(p['email'])})" if p['email'] else
                     f"NOT EXISTS (SELECT 1 FROM exhibitor_team WHERE exhibitor_id = {ex} AND email = '' AND lower(first_name) = lower({sq(p['first'])}) AND lower(last_name) = lower({sq(p['last'])}))")
            out.append(f"INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, last_name, designation, company, email, mobile, photo_url, at_booth, speaker, added_by) "
                       f"SELECT 1, id, {sq(p['first'])}, {sq(p['last'])}, {sq(p['designation'])}, company_name, {sq(p['email'])}, {sq(p['mobile'])}, {sq(p['photo'])}, {p['booth']}, {p['speaker']}, 'sheet' "
                       f"FROM exhibitors WHERE id = {ex} AND {guard};")
        out.append('')
    return '\n'.join(out) + '\n'


def check(sql_path):
    """Runs the file twice on a scratch database shaped like production, with the awkward rows seeded."""
    db = sqlite3.connect(':memory:')
    db.executescript(open(os.path.join(ROOT, 'scripts', 'verify', 'prod-schema.sql'), encoding='utf-8').read())
    db.executescript(open(os.path.join(ROOT, 'migrations', '0050_exhibitor_team.sql'), encoding='utf-8').read())
    db.execute("INSERT INTO events (id, title, start_date, end_date) VALUES (1, 'B', '2026-11-20', '2026-11-21')")
    for ex_id, _ in [v for v in COMPANIES.values() if v[0]]:
        db.execute("INSERT OR IGNORE INTO exhibitors (id, event_id, company_name, contact_email) VALUES (?, 1, ?, '')", (ex_id, f'Existing {ex_id}'))
    for dup in (33, 34, 36, 37, 40):
        db.execute("INSERT OR IGNORE INTO exhibitors (id, event_id, company_name, contact_email) VALUES (?, 1, ?, '')", (dup, f'Duplicate {dup}'))
    # An account already there in mixed case, linked to a duplicate row; and the admin.
    db.execute("INSERT INTO mp_companies (company_name, email, password_hash, exhibitor_id) VALUES ('Joget dup', 'Anoop.Nair@joget.com', '', 34)")
    db.execute("INSERT INTO mp_companies (company_name, email, password_hash, role) VALUES ('Admin', 'admin@bharataiinnovation.com', 'x', 'admin')")
    # A team member already added by their contact, with their own designation.
    db.execute("INSERT INTO exhibitor_team (event_id, exhibitor_id, first_name, designation, email, added_by) VALUES (1, 23, 'Sarah', 'Typed by the SPOC', 'sarah.abraham@joget.com', 'spoc')")
    db.execute("INSERT INTO events (id, title, start_date, end_date) VALUES (2, 'Delhi', '2027-07-29', '2027-07-30')")
    sql = open(sql_path, encoding='utf-8').read()
    db.executescript(sql)
    first = [db.execute(q).fetchone()[0] for q in ('SELECT COUNT(*) FROM exhibitors', 'SELECT COUNT(*) FROM mp_companies', 'SELECT COUNT(*) FROM exhibitor_team', 'SELECT COUNT(*) FROM exhibitor_team_settings')]
    db.executescript(sql)
    second = [db.execute(q).fetchone()[0] for q in ('SELECT COUNT(*) FROM exhibitors', 'SELECT COUNT(*) FROM mp_companies', 'SELECT COUNT(*) FROM exhibitor_team', 'SELECT COUNT(*) FROM exhibitor_team_settings')]
    fails = 0

    def ok(name, cond, detail=''):
        nonlocal fails
        print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else f'  <- {detail}'))
        fails += 0 if cond else 1
    ok('the second run adds nothing', first == second, f'{first} then {second}')
    ok('no second login for a mixed-case address that was already there', db.execute("SELECT COUNT(*) FROM mp_companies WHERE lower(email) = 'anoop.nair@joget.com'").fetchone()[0] == 1)
    ok('that login now points at the exhibitor with the stand, not the duplicate', db.execute("SELECT exhibitor_id FROM mp_companies WHERE lower(email) = 'anoop.nair@joget.com'").fetchone()[0] == 23)
    ok('the admin account is untouched', db.execute("SELECT exhibitor_id FROM mp_companies WHERE role = 'admin'").fetchone()[0] is None)
    ok('a person the SPOC already typed is not overwritten', db.execute("SELECT designation FROM exhibitor_team WHERE email = 'sarah.abraham@joget.com'").fetchone()[0] == 'Typed by the SPOC')
    ok('every team row belongs to a real exhibitor of event 1', db.execute('SELECT COUNT(*) FROM exhibitor_team t LEFT JOIN exhibitors e ON e.id = t.exhibitor_id WHERE e.id IS NULL OR e.event_id <> 1').fetchone()[0] == 0)
    ok('no exhibitor row was made twice', db.execute('SELECT COUNT(*) FROM (SELECT lower(company_name) n, COUNT(*) c FROM exhibitors GROUP BY n HAVING c > 1)').fetchone()[0] == 0)
    ok('no email on two teams', db.execute("SELECT COUNT(*) FROM (SELECT email, COUNT(*) c FROM exhibitor_team WHERE email <> '' GROUP BY email HAVING c > 1)").fetchone()[0] == 0)
    ok('every login made belongs to an exhibitor', db.execute("SELECT COUNT(*) FROM mp_companies WHERE role <> 'admin' AND exhibitor_id IS NULL").fetchone()[0] == 0)
    ok('nothing written to the Delhi event', db.execute('SELECT COUNT(*) FROM exhibitor_team WHERE event_id <> 1').fetchone()[0] == 0)
    print(f"exhibitors {second[0]}, logins {second[1]}, people {second[2]}, booth rows {second[3]}")
    return fails


def main():
    if sys.argv[1:2] == ['--check']:
        sys.exit(1 if check(sys.argv[2]) else 0)
    xlsx, out_dir = sys.argv[1], sys.argv[2]
    if len(sys.argv) > 3:
        OWNERS.update(json.load(open(sys.argv[3], encoding='utf-8')))
    companies, review = build(xlsx)
    stem = os.path.join(out_dir, f'exhibitor-teams-import-{date.today().isoformat()}')
    open(stem + '.sql', 'w', encoding='utf-8').write(sql_for(companies))
    lines = [f'Exhibitor teams from the sheet, {date.today().isoformat()}', '']
    for ck, c in sorted(companies.items(), key=lambda kv: str(kv[1]['name'] or kv[1]['ex_id'])):
        label = c['name'] or sorted(c['sheet_names'])[0]
        t = next(iter(c['types']))[1] if len(c['types']) == 1 else '?'
        lines.append(f"{label} [{'new row' if not c['ex_id'] else 'id ' + str(c['ex_id'])}] {t} x{max(1, len(c['booths']))}, contact {c['spoc'] or '?'} <{c['spoc_email'] or 'no email'}>, our side: {OWNERS.get(c['owner'], {}).get('name') or c['owner'] or '?'} <{OWNERS.get(c['owner'], {}).get('email') or 'no email'}>")
        for p in c['people']:
            roles = ' + '.join(x for x, on in (('booth', p['booth']), ('stage', p['speaker'])) if on)
            lines.append(f"    {p['first']} {p['last']} | {p['designation'] or '(no designation)'} | {p['email'] or '(no email)'} | {roles}{' | photo from the site' if p['photo'] else ''}")
    lines += ['', 'To look at:'] + ['  - ' + r for r in review]
    open(stem + '-review.txt', 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print(stem + '.sql')
    print(stem + '-review.txt')
    print(f"{len(companies)} exhibitors, {sum(len(c['people']) for c in companies.values())} people, {len(review)} notes")


if __name__ == '__main__':
    main()
