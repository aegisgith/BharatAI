# Booth photos by company name: find each exhibitor's name in the text read from the event
# photos (ocr.py), so an exhibitor gets the photos their booth, banner or screen is in even
# when none of their people's faces were matched.
# usage: exh_match.py ocr.json exhibitor-names.json folder.json img_dir out.json [--report]
# - exhibitor-names.json: one row a company (its exhibitor ids, and the words that mean it).
# - A line of text counts when it holds one of those words (whole word for "exact" rows such
#   as CGI; one wrong letter allowed for words of 7+ letters) with OCR confidence 0.55+.
# - "backdrop" companies (IDFC FIRST Bank, Aegis, Gupshup) are printed on every stage
#   backdrop, so for them only the booth-camera folder counts.
# - The stage's side walls carry every exhibitor's logo, so a photo naming 3+ companies is a
#   stage or a wide hall shot: there a company counts only if its name spans 20% of the photo
#   (their own talk slide), elsewhere 6% (their booth fascia, standee or screen). Widths are
#   taken against the photo's long side, so a portrait podium shot does not inflate them.
# - A photo that shows the stage's own words (IDFC FIRST Bank, Graham Bell, World Trade
#   Center, "specialised tracks") is a stage shot too, even when only one logo was read:
#   the podium and the screen's partner strip sit beside the logo wall. Same 20% rule.
# - out.json: {company key: [[photo id, share of the photo's long side the name spans, conf]...]}
#   biggest name first.
import sys, json, re
OCR, NAMES, FOLDER, IMG, OUT = sys.argv[1:6]
import os, collections
from PIL import Image
ocr = json.load(open(OCR)); names = json.load(open(NAMES, encoding='utf-8')); folder = json.load(open(FOLDER))
def norm(s): return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()
def near(word, text):
    # word inside text with at most one substituted letter (same length window)
    n = len(word)
    for i in range(len(text) - n + 1):
        if sum(1 for a, b in zip(word, text[i:i + n]) if a != b) <= 1: return True
    return False
def hit(row, t):
    sq = t.replace(' ', '')
    for w in row['say']:
        w = norm(w)
        if row.get('exact'):
            if re.search(r'(^| )' + re.escape(w) + r'( |$)', t): return True
            continue
        if w in t or w.replace(' ', '') in sq: return True
        if len(w.replace(' ', '')) >= 7 and near(w.replace(' ', ''), sq): return True
    return False
out = {}
for row in names:
    got = {}
    for pid, lines in ocr.items():
        if row.get('backdrop') and folder.get(pid) != 'booth': continue
        for text, conf, share in lines:
            if conf < 0.55: continue
            if hit(row, norm(text)):
                if share > got.get(pid, (0, 0))[0]: got[pid] = (share, conf)
    if got: out[row['key']] = got
STAGE = re.compile(r'idfc|first\s*bank|graham\s*bell|world\s*trade|trade\s*cent|specialised\s*tracks', re.I)
def stage(pid): return any(c >= 0.5 and STAGE.search(t) for t, c, s in ocr.get(pid, []))
# Per photo: how many companies, and the portrait correction.
per = collections.defaultdict(int)
for got in out.values():
    for p in got: per[p] += 1
def aspect(pid):
    try:
        w, h = Image.open(os.path.join(IMG, pid + '.jpg')).size
        return w / max(w, h)
    except Exception: return 1.0
asp = {p: aspect(p) for p in per}
final = {}
BACKDROP = {r['key']: bool(r.get('backdrop')) for r in names}
for k, got in out.items():
    keep = []
    for p, (s, c) in got.items():
        s = s * asp[p]
        # A backdrop company is only looked for in the booth-camera folder, and its own name
        # is one of the stage's words (IDFC), so the stage-words test is not for it.
        if s >= (0.20 if (per[p] >= 3 or (stage(p) and not BACKDROP.get(k))) else 0.06): keep.append([p, round(s, 3), c])
    if keep: final[k] = sorted(keep, key=lambda x: -x[1])
out = final
json.dump(out, open(OUT, 'w'))
print('photos read', len(ocr), '| companies', len(names), '| with a photo', len(out), '| photos', sum(len(v) for v in out.values()))
if '--report' in sys.argv:
    for row in names:
        v = out.get(row['key'], [])
        print(f"{row['name'][:34]:34s} {len(v):4d}", ' big:', sum(1 for x in v if x[1] >= 0.08))
