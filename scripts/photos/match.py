# Match speakers against the event faces with AuraFace embeddings (pass 2 output).
# usage: match.py faces_dir refs_prefix img_dir repo out_dir [threshold] [margin] [--expand] [--sheets]
# - One person = every ref under the same normalised name (conference speaker + talk).
# - A face goes to the best person if score >= threshold and beats the runner-up by margin.
# - --expand: add each person's 3 surest event faces (score >= 0.55) as extra refs and match
#   again, which catches side-on and lower-angle shots of the same person.
# Writes out_dir/matches.json and QA sheets (site photo, then matched faces with scores;
# the weakest matches are shown last so wrong ones are easy to spot).
import sys, os, json, numpy as np
from PIL import Image, ImageDraw
FD, REFS, IMG, REPO, OUT = sys.argv[1:6]
nums = [a for a in sys.argv[6:] if not a.startswith('--')]
TH = float(nums[0]) if nums else 0.40
MARGIN = float(nums[1]) if len(nums) > 1 else 0.08
# A match must also score at least this against the person's own site photo, so the
# extra references from --expand cannot pull in a lookalike from the same stage.
ORIG_MIN = float(nums[2]) if len(nums) > 2 else 0.35
os.makedirs(OUT, exist_ok=True)
z = np.load(os.path.join(FD, 'faces.npz')); crops = [str(c) for c in z['crops']]; boxes = z['boxes']; pids = [str(p) for p in z['ids']]
at = {c: i for i, c in enumerate(crops)}
seen_names = set()
import glob
names, F = [], []
for f in sorted(glob.glob(os.path.join(FD, 'aura*.npz'))):
    if f.endswith('.tmp.npz'): continue
    with np.load(f) as a:
        for n, v in zip(a['names'], a['feats']):
            if str(n) not in at or str(n) in seen_names: continue
            seen_names.add(str(n)); names.append(str(n)); F.append(v)
F = np.array(F, dtype=np.float32)
R = np.load(REFS + '_aura.npy'); people = json.load(open(REFS + '.json', encoding='utf-8'))
SKIP = set(json.load(open(sys.argv[sys.argv.index('--skip') + 1]))) if '--skip' in sys.argv else set()
def key(n):
    n = n.replace('’', "'").replace('�', "'").lower().replace('.', ' ')
    return ' '.join(w for w in n.split() if w not in ('dr', 'mr', 'ms', 'mrs', 'prof', 'shri', 'smt', "hon'ble", 'hon', 'ble'))
groups = {}
for i, p in enumerate(people): groups.setdefault(key(p['name']), []).append(i)
gkeys = list(groups)
keep = [i for i, n in enumerate(names) if pids[at[n]] not in SKIP]

O = np.stack([(F[keep] @ R[groups[k]].T).max(1) for k in gkeys], 1)  # against site photos only
def assign(refsets):
    # refsets: list (per person) of arrays of ref vectors
    G = np.stack([(F[keep] @ rs.T).max(1) for rs in refsets], 1)
    best = G.argmax(1); bv = G.max(1)
    sec = np.partition(G, -2, axis=1)[:, -2]
    orig = O[np.arange(len(best)), best]
    ok = (bv >= TH) & (bv - sec >= MARGIN) & (orig >= ORIG_MIN)
    res = {}
    for j in np.where(ok)[0]:
        fi = keep[j]; k = gkeys[best[j]]; pid = pids[at[names[fi]]]; v = float(bv[j])
        d = res.setdefault(k, {})
        if v > d.get(pid, (0,))[0]: d[pid] = (v, fi, float(orig[j]))
    return res

refsets = [R[groups[k]] for k in gkeys]
res = assign(refsets)
if '--expand' in sys.argv:
    for gi, k in enumerate(gkeys):
        sure = sorted(res.get(k, {}).values(), key=lambda x: -x[0])
        extra = [F[fi] for v, fi, o in sure if v >= 0.55 and o >= ORIG_MIN + 0.10][:3]
        if extra: refsets[gi] = np.vstack([refsets[gi]] + extra)
    res = assign(refsets)

out = {}
for k, d in res.items():
    who = [people[i] for i in groups[k]]
    out[k] = {'name': who[0]['name'], 'refs': [{'kind': p['kind'], 'id': p['id']} for p in who],
              'photos': [[pid, round(v, 3), round(float(boxes[at[names[fi]]][2]), 4), round(float(boxes[at[names[fi]]][0] + boxes[at[names[fi]]][2] / 2), 3), round(float(boxes[at[names[fi]]][1] + boxes[at[names[fi]]][3] / 2), 3), round(o, 3)] for pid, (v, fi, o) in sorted(d.items(), key=lambda x: -x[1][0])]}
json.dump(out, open(os.path.join(OUT, 'matches.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
n = [len(v['photos']) for v in out.values()]
print('faces embedded', len(names), '| threshold', TH, 'margin', MARGIN, 'site-photo floor', ORIG_MIN, '| people matched', len(out), 'of', len(gkeys),
      '| photo matches', sum(n), 'median', int(np.median(n)) if n else 0, 'max', max(n) if n else 0)

if '--sheets' in sys.argv:
    C = 110; rows = sorted(out.items(), key=lambda x: x[1]['name'])
    for si in range(0, len(rows), 12):
        part = rows[si:si + 12]
        sheet = Image.new('RGB', (C * 12, (C + 16) * len(part)), 'white'); d = ImageDraw.Draw(sheet)
        for r, (k, v) in enumerate(part):
            y = r * (C + 16)
            p0 = people[groups[k][0]]
            try:
                im = Image.open(os.path.join(REPO, 'public' + p0['photo'])).convert('RGB'); im.thumbnail((C, C)); sheet.paste(im, (0, y))
            except Exception: pass
            d.text((2, y + C + 2), v['name'][:22], fill='black')
            ph = v['photos']
            pick = ph[:5] + ph[-6:] if len(ph) > 11 else ph
            for c, (pid, sc, *_rest) in enumerate(pick):
                fi = res[k][pid][1]; bx = boxes[at[names[fi]]]
                try:
                    im = Image.open(os.path.join(IMG, pid + '.jpg')); W, H = im.size
                    x, yy, w, h = bx[0] * W, bx[1] * H, bx[2] * W, bx[3] * H
                    pad = 0.35 * max(w, h)
                    cr = im.crop((int(x - pad), int(yy - pad), int(x + w + pad), int(yy + h + pad))).convert('RGB'); cr.thumbnail((C, C))
                    sheet.paste(cr, ((c + 1) * C + 4, y))
                    d.text(((c + 1) * C + 6, y + C + 2), f'{sc:.2f}/{_rest[-1]:.2f}' + (' n=' + str(len(ph)) if c == 0 else ''), fill='red' if (sc < TH + 0.05 or _rest[-1] < ORIG_MIN + 0.08) else 'black')
                except Exception: pass
        sheet.save(os.path.join(OUT, f'qa_{si // 12:02d}.jpg'), quality=82)
    print('sheets', (len(rows) + 11) // 12)
