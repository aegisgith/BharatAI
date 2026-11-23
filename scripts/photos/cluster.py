# Group the clear faces that matched no speaker into same-person clusters (AuraFace),
# biggest first, and draw a sheet: one row per cluster, a few of its faces, so a person
# (a guest not on the programme) can be picked out by eye.
# usage: cluster.py faces_dir refs_prefix img_dir out_dir [min_px] [same] [rows]
import sys, os, glob, json, numpy as np
from PIL import Image, ImageDraw
FD, REFS, IMG, OUT = sys.argv[1:5]
MINPX = float(sys.argv[5]) if len(sys.argv) > 5 else 56
SAME = float(sys.argv[6]) if len(sys.argv) > 6 else 0.55
ROWS = int(sys.argv[7]) if len(sys.argv) > 7 else 40
os.makedirs(OUT, exist_ok=True)
with np.load(os.path.join(FD, 'faces.npz')) as z:
    crops = [str(c) for c in z['crops']]; boxes = z['boxes']; pids = [str(p) for p in z['ids']]
at = {c: i for i, c in enumerate(crops)}
names, F = [], []
for f in sorted(glob.glob(os.path.join(FD, 'aura*.npz'))):
    if f.endswith('.tmp.npz'): continue
    with np.load(f) as a:
        for n, v in zip(a['names'], a['feats']):
            n = str(n)
            if n in at and n not in names: names.append(n); F.append(v)
F = np.array(F, dtype=np.float32)
R = np.load(REFS + '_aura.npy')
best = (F @ R.T).max(1)
w = np.array([boxes[at[n]][2] * 1600 for n in names])
cand = np.where((best < 0.45) & (w >= MINPX))[0]          # clear faces no speaker is near
print('unmatched clear faces', len(cand))
C = F[cand]
# Greedy clustering: biggest groups first.
left = np.ones(len(cand), bool); clusters = []
S = C @ C.T
while left.any():
    deg = ((S >= SAME) & left[None, :] & left[:, None]).sum(1) * left
    i = int(deg.argmax())
    if deg[i] < 3: break
    members = np.where((S[i] >= SAME) & left)[0]
    clusters.append([int(cand[m]) for m in members]); left[members] = False
clusters.sort(key=lambda c: -len(c))
json.dump([[names[i] for i in c] for c in clusters], open(os.path.join(OUT, 'clusters.json'), 'w'))
print('clusters of 3+', len(clusters), 'sizes', [len(c) for c in clusters[:ROWS]])
Cw = 100; per = 8
for si in range(0, min(len(clusters), ROWS), 20):
    part = clusters[si:si + 20]
    sheet = Image.new('RGB', (Cw * (per + 1), (Cw + 14) * len(part)), 'white'); d = ImageDraw.Draw(sheet)
    for r, c in enumerate(part):
        y = r * (Cw + 14)
        d.text((4, y + 40), f'#{si + r}  n={len(c)}', fill='black')
        for k, fi in enumerate(c[:per]):
            n = names[fi]; bx = boxes[at[n]]; pid = pids[at[n]]
            try:
                im = Image.open(os.path.join(IMG, pid + '.jpg')); W, H = im.size
                x, yy, ww, hh = bx[0] * W, bx[1] * H, bx[2] * W, bx[3] * H; pad = 0.45 * max(ww, hh)
                cr = im.crop((int(x - pad), int(yy - pad), int(x + ww + pad), int(yy + hh + pad))).convert('RGB'); cr.thumbnail((Cw, Cw))
                sheet.paste(cr, ((k + 1) * Cw, y))
            except Exception: pass
    sheet.save(os.path.join(OUT, f'clusters_{si // 20:02d}.jpg'), quality=82)
