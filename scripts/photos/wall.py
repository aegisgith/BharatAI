# Faces that are pictures, not people: a speaker's portrait on the LED wall, the stage
# screen, a standee or a poster. The organiser, 23 Nov 2026: "save the rule: don't match
# with the wall, and even if you do, match with the real person in the hall, stage, room".
# These faces are then left out of matching (match.py / burst.py --wall-faces), so where the
# real person is also in the photo, the matcher finds THEM instead of their portrait.
#
# A screen or standee shows the speaker's own website photo, so the copy scores far higher
# against that photo than a real face in the room does:
#  1. a row of portrait cards (the panel's line-up on the screen): this face and at least
#     two others at the same height and size each score ROW+ against a DIFFERENT speaker's
#     site photo, and real people are clearly lower in the same photo;
#  2. a near copy: COPY+ against the site photo, the face small in the frame (a real
#     close-up is big) and real people lower in the photo, for people whose reference IS
#     their site photo.
# A single small portrait the rules miss (Akhil Gupta's, Abhay Tewari's) goes in
# wrong-matches.json with "WALL" in its reason, after a look.
# usage: wall.py faces_dir refs_prefix repo out.json [ROW] [COPY]
# out.json: [[photo id, cx, cy, w, rule, person, score], ...]
import sys, os, glob, json, numpy as np
FD, REFS, REPO, OUT = sys.argv[1:5]
ROW = float(sys.argv[5]) if len(sys.argv) > 5 else 0.70
COPY = float(sys.argv[6]) if len(sys.argv) > 6 else 0.86
z = np.load(os.path.join(FD, 'faces.npz')); crops = [str(c) for c in z['crops']]; boxes = z['boxes']; pids = [str(p) for p in z['ids']]
at = {c: i for i, c in enumerate(crops)}
names, F, seen = [], [], set()
for f in sorted(glob.glob(os.path.join(FD, 'aura*.npz'))):
    if f.endswith('.tmp.npz'): continue
    with np.load(f) as a:
        for n, v in zip(a['names'], a['feats']):
            n = str(n)
            if n not in at or n in seen: continue
            seen.add(n); names.append(n); F.append(v)
F = np.array(F, dtype=np.float32)
R = np.load(REFS + '_aura.npy'); people = json.load(open(REFS + '.json', encoding='utf-8'))
OVR = os.path.join(REPO, 'scripts', 'photos', 'ref-photos')
# Only website photos can be on the screen; guests' and replaced references are event or
# pass photos, which a real face matches closely anyway.
site = [i for i, p in enumerate(people) if p['kind'] in ('speaker', 'talk') and not os.path.exists(os.path.join(OVR, f"{p['kind']}-{p['id']}.jpg"))]
def key(n):
    n = n.replace('’', "'").replace('�', "'").lower().replace('.', ' ')
    return ' '.join(w for w in n.split() if w not in ('dr', 'mr', 'ms', 'mrs', 'prof', 'shri', 'smt', "hon'ble", 'hon', 'ble'))
who = [key(people[i]['name']) for i in site]
S = F @ R[site].T
best = S.argmax(1); bv = S.max(1)
byphoto = {}
for fi, n in enumerate(names): byphoto.setdefault(pids[at[n]], []).append(fi)
def geo(fi):
    b = boxes[at[names[fi]]]; return float(b[0] + b[2] / 2), float(b[1] + b[3] / 2), float(b[2])
out = []
for pid, fs in byphoto.items():
    for fi in fs:
        if bv[fi] < min(ROW, COPY): continue
        cx, cy, w = geo(fi); me = who[best[fi]]
        mates = set()
        for g in fs:
            if g == fi or bv[g] < ROW or who[best[g]] == me: continue
            gx, gy, gw = geo(g)
            if abs(gy - cy) <= 0.06 and 0.6 <= gw / max(w, 1e-6) <= 1.6: mates.add(who[best[g]])
        # A row of portrait cards hangs on the screen ABOVE the panel: real people sit or
        # stand clearly lower in the same photo. A group photo of people standing in a line
        # has nobody below them, so it is never taken for a screen.
        below = any(geo(g)[1] - cy >= 0.15 and geo(g)[2] >= 0.8 * w for g in fs if g != fi)
        rule = 'row' if (bv[fi] >= ROW and len(mates) >= 2 and below) else 'copy' if (bv[fi] >= COPY and w < 0.06 and below) else ''
        if rule: out.append([pid, round(cx, 4), round(cy, 4), round(w, 4), rule, me, round(float(bv[fi]), 3)])
json.dump(out, open(OUT, 'w'), indent=0)
from collections import Counter
print('wall faces', len(out), '| photos', len({o[0] for o in out}), '| by rule', dict(Counter(o[4] for o in out)))
