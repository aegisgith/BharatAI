# Write src/data/speaker-photos.json from matches.json + the Drive listing.
# usage: export.py matches.json index.json img_dir out.json
# - photos[id] = [day, 'HH:MM' (IST, '' if unknown), upright 0/1, raw 0/1]
#   day comes from the Day 1 / Day 2 folder; the time from Drive's modifiedTime, which is the
#   shooting time for the JPGs (the RAW files carry their upload time, so no time for them).
# - best: six photos for the email: in-person shots first (a score of 0.80+ is usually the
#   stage screen showing their own website photo), bigger faces first, no two from the same
#   camera within 30 seconds (burst shots).
import sys, os, json, datetime
from PIL import Image
MATCHES, INDEX, IMG, OUT = sys.argv[1:5]
D1 = {'1V0ANjyTnfBQ4TVs8ZDTKi_U-8OudEiJ_', '1dgfV1_9Aqx1Fkhm2WZDy5KxOVVlGTc0-', '1OR9Bhb5z0H0xRAcmoCxKUcRMlLzHFQxW', '1VDUlZkowzad0X6ra09cCTb8E0D-0AWGD',
      '1EFh2DitPNGNNtO2JZQ5C4fS70iyMsNHJ', '15xhVXrZIdPEo-RV5w3_i4vE7d5b9qY58', '1ifBcPbnczf6-SqECLwpj4pIofTymUbBz', '11DBmuc9CbsruhRFV_txuwgeXgtmmUZX6', '1p7m4-kNxNIt2w1nG5MzeT1Td5UmQtljs'}
D2 = {'1J4a_KGkSIZMSvUiXR-q_MuhPxBwSKZ79', '1CJvSSGP7c6X-XqNTgbyGDxW_U49DCnR_', '1fJtR1QM3McNdNz3WoI5pZsqFlmBxnYMI', '1nhSIPJVsoOwiglte29AdOtXnFKDdnhQb',
      '1qGy6q9VFbJFZf6eW856-S92ktnDJxQik', '1x-3dnGf--HD03wovnMWwd4jT02tjnml7', '1qFNmlUNpLR42ow9loldAChOd-IXm0IUt'}
IST = datetime.timedelta(hours=5, minutes=30)
idx = {f['id']: f for f in json.load(open(INDEX))}
M = json.load(open(MATCHES, encoding='utf-8'))

def meta(pid):
    f = idx[pid]
    day = '2026-11-20' if f['parentId'] in D1 else '2026-11-21' if f['parentId'] in D2 else ''
    t = datetime.datetime.fromisoformat(f['modifiedTime'].replace('Z', '+00:00')) + IST
    raw = 1 if f['mimeType'] == 'image/cr3' else 0
    hm = t.strftime('%H:%M') if (t.strftime('%Y-%m-%d') == day and not raw) else ''
    try:
        w, h = Image.open(os.path.join(IMG, pid + '.jpg')).size
    except Exception:
        w, h = 3, 2
    return [day, hm, 1 if h > w else 0, raw], (f['parentId'], t)

photos, people = {}, []
for k, v in sorted(M.items(), key=lambda x: x[1]['name']):
    ids = [p for p in v['photos'] if p[0] in idx]
    if not ids: continue
    for p in ids:
        if p[0] not in photos: photos[p[0]] = meta(p[0])
    # Landscape first in the email (two whole photos a row), then score and face size.
    inperson = sorted([p for p in ids if p[-1] < 0.80], key=lambda p: -(p[1] + 2.0 * min(p[2], 0.12) - 0.25 * photos[p[0]][0][2]))
    screen = sorted([p for p in ids if p[-1] >= 0.80], key=lambda p: -p[-1])
    best, taken = [], []
    for p in inperson + screen:
        folder, t = photos[p[0]][1]
        if any(folder == f2 and abs((t - t2).total_seconds()) < 30 for f2, t2 in taken): continue
        best.append(p[0]); taken.append((folder, t))
    # The email shows two whole photos a row: landscape ones only (upright ones only when
    # there are fewer than two landscape), an even number, at most six.
    wide = [i for i in best if not photos[i][0][2]]
    best = (wide if len(wide) >= 2 else best)[:6]
    if len(best) > 1 and len(best) % 2: best = best[:-1]
    sp = [r['id'] for r in v['refs'] if r['kind'] == 'speaker']
    tk = [r['id'] for r in v['refs'] if r['kind'] == 'talk']
    people.append({'key': ('s%d' % sp[0]) if sp else ('t%d' % tk[0]), 'name': v['name'], 'speakers': sp, 'talks': tk,
                   'photos': [p[0] for p in ids], 'best': best,
                   # Where their face is in each photo (percent across, down), so the page's
                   # square thumbnails keep them in view.
                   'focus': {p[0]: [round(p[3] * 100), round(p[4] * 100)] for p in ids if len(p) >= 5},
                   # No in-person photo scores 0.60 against their site photo: the matches may be
                   # lookalikes, so Admin asks for a look at the preview before sending.
                   'check': max([p[-1] for p in ids if p[-1] < 0.80], default=0) < 0.60})
out = {'generated': datetime.date.today().strftime('%d %b %Y').lstrip('0'),
       'folder': 'https://drive.google.com/drive/folders/19Ii5MnQLA2adUxH4LDPikF2GUcvRuOeJ',
       'photos': {k: v[0] for k, v in photos.items()}, 'people': people}
json.dump(out, open(OUT, 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, separators=(',', ':'))
print('people', len(people), 'photos', len(photos), 'bytes', os.path.getsize(OUT))
