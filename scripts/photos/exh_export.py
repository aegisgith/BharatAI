# Write src/data/exhibitor-photos.json from exh_match.py's output and the Drive listing.
# usage: exh_export.py booth.json exhibitor-names.json index.json img_dir out.json
# - companies[key] = {name, ids (every exhibitors row of that company), photos, best}
#   photos: the six for the email first, then the rest in the order they were taken.
#   best: up to six for the email: landscape (two whole photos a row), the biggest name
#   first, no two from one camera within 30 seconds (burst shots look the same).
# - photos[id] = [day, 'HH:MM' IST] ('' when unknown: RAW files carry their upload time).
import sys, os, json, datetime
from PIL import Image
BOOTH, NAMES, INDEX, IMG, OUT = sys.argv[1:6]
m = json.load(open(BOOTH)); names = {r['key']: r for r in json.load(open(NAMES, encoding='utf-8'))}
idx = {f['id']: f for f in json.load(open(INDEX, encoding='utf-8'))}
D1 = {'1V0ANjyTnfBQ4TVs8ZDTKi_U-8OudEiJ_', '1dgfV1_9Aqx1Fkhm2WZDy5KxOVVlGTc0-', '1OR9Bhb5z0H0xRAcmoCxKUcRMlLzHFQxW', '1VDUlZkowzad0X6ra09cCTb8E0D-0AWGD',
      '1EFh2DitPNGNNtO2JZQ5C4fS70iyMsNHJ', '15xhVXrZIdPEo-RV5w3_i4vE7d5b9qY58', '1ifBcPbnczf6-SqECLwpj4pIofTymUbBz', '11DBmuc9CbsruhRFV_txuwgeXgtmmUZX6'}
IST = datetime.timedelta(hours=5, minutes=30)
def when(pid):
    f = idx.get(pid)
    if not f: return None
    return datetime.datetime.fromisoformat(f['modifiedTime'].replace('Z', '+00:00')) + IST
def meta(pid):
    f = idx.get(pid, {}); t = when(pid)
    day = '2026-11-20' if f.get('parentId') in D1 else '2026-11-21'
    hm = t.strftime('%H:%M') if (t and f.get('mimeType') == 'image/jpeg' and t.strftime('%Y-%m-%d') == day) else ''
    return [day, hm]
def landscape(pid):
    try:
        w, h = Image.open(os.path.join(IMG, pid + '.jpg')).size
        return w > h
    except Exception: return False
companies, photos = {}, {}
for key, rows in m.items():
    if key not in names: continue
    rows = [r for r in rows if r[0] in idx]
    if not rows: continue
    best, picked = [], []
    for pid, share, conf in rows:                      # biggest name first
        if len(best) == 6: break
        if not landscape(pid): continue
        t, cam = when(pid), idx[pid]['title'][:4]
        if any(c == cam and t and t2 and abs((t - t2).total_seconds()) < 30 for c, t2 in picked): continue
        best.append(pid); picked.append((cam, t))
    if len(best) % 2: best = best[:-1] if len(best) > 1 else best
    rest = sorted((r[0] for r in rows if r[0] not in best), key=lambda p: (meta(p)[0], when(p) or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)))
    companies[key] = {'name': names[key]['name'], 'ids': names[key]['ids'], 'photos': best + rest, 'best': best}
    for p in best + rest: photos[p] = meta(p)
json.dump({'rule': 'company name read in the photo (OCR): 6%+ of the photo for a booth, 20%+ where the stage logo wall shows', 'companies': companies, 'photos': photos},
          open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('companies', len(companies), '| photos', len(photos), '| album photos', sum(len(v['photos']) for v in companies.values()), '| bytes', os.path.getsize(OUT))
