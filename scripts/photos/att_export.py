# Write src/data/attendee-photos.json from att_match.py's albums.json. Attendee ids and
# Drive ids only: no names, no emails, no face data (the site reads names from D1).
# usage: att_export.py albums.json index.json img_dir out.json
import sys, os, json, datetime
from PIL import Image
AL, INDEX, IMG, OUT = sys.argv[1:5]
D1 = {'1V0ANjyTnfBQ4TVs8ZDTKi_U-8OudEiJ_', '1dgfV1_9Aqx1Fkhm2WZDy5KxOVVlGTc0-', '1OR9Bhb5z0H0xRAcmoCxKUcRMlLzHFQxW', '1VDUlZkowzad0X6ra09cCTb8E0D-0AWGD',
      '1EFh2DitPNGNNtO2JZQ5C4fS70iyMsNHJ', '15xhVXrZIdPEo-RV5w3_i4vE7d5b9qY58', '1ifBcPbnczf6-SqECLwpj4pIofTymUbBz', '11DBmuc9CbsruhRFV_txuwgeXgtmmUZX6', '1p7m4-kNxNIt2w1nG5MzeT1Td5UmQtljs'}
IST = datetime.timedelta(hours=5, minutes=30)
idx = {f['id']: f for f in json.load(open(INDEX))}
A = json.load(open(AL))
meta = {}
def m(pid):
    if pid in meta: return meta[pid]
    f = idx[pid]; day = '2026-11-20' if f['parentId'] in D1 else '2026-11-21'
    t = datetime.datetime.fromisoformat(f['modifiedTime'].replace('Z', '+00:00')) + IST
    raw = 1 if f['mimeType'] == 'image/cr3' else 0
    try: w, h = Image.open(os.path.join(IMG, pid + '.jpg')).size
    except Exception: w, h = 3, 2
    meta[pid] = [day, t.strftime('%H:%M') if (t.strftime('%Y-%m-%d') == day and not raw) else '', 1 if h > w else 0, raw, f['parentId'], t]
    return meta[pid]
albums = {}
for k, v in A['albums'].items():
    ph = [p for p in v['photos'] if p[0] in idx]
    if not ph: continue
    best, taken = [], []
    for p in sorted(ph, key=lambda p: -(p[1] + 2.0 * min(p[4], 0.12) - 0.25 * m(p[0])[2])):
        mm = m(p[0])
        if any(mm[4] == f2 and abs((mm[5] - t2).total_seconds()) < 30 for f2, t2 in taken): continue
        best.append(p[0]); taken.append((mm[4], mm[5]))
    wide = [i for i in best if not meta[i][2]]
    best = (wide if len(wide) >= 2 else best)[:6]
    if len(best) > 1 and len(best) % 2: best = best[:-1]
    albums[k] = {'group': v['group'], 'came': v['came'], 'check': v['check'], 'photos': [p[0] for p in ph], 'best': best,
                 'focus': {p[0]: [round(p[2] * 100), round(p[3] * 100)] for p in ph}}
out = {'generated': datetime.date.today().strftime('%d %b %Y').lstrip('0'), 'groups': A['groups'],
       'rule': {'th': A['th'], 'margin': A['margin'], 'sure': A['sure']},
       'photos': {k: v[:4] for k, v in meta.items()}, 'albums': albums}
json.dump(out, open(OUT, 'w', encoding='utf-8', newline='\n'), separators=(',', ':'))
print('albums', len(albums), 'photos', len(meta), 'bytes', os.path.getsize(OUT))
