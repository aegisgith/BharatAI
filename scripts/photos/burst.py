# Add the photos a person is in but faces away in, using burst shots instead of a lower
# threshold. A face is added to person k only when the same camera took a photo of k within
# WINDOW seconds that k is already surely matched in, and this face looks like k's face in
# THAT photo (same light, same clothes, same angle) by at least SIM, beating every other
# person's nearby faces by GAP. Faces already given to anyone are never moved.
# usage: burst.py faces_dir refs_prefix index.json base_matches.json out_dir [SIM] [GAP] [WINDOW] [ORIG_MIN] [--drop wrong-matches.json] [--not-faces attendee_albums.json att-skip.json]
# Writes out_dir/matches.json in match.py's format; the new rows keep their site-photo score
# (low), so they rank last in the email and are never used to name anyone in a photo.
import sys, os, json, glob, datetime, collections, numpy as np
FD, REFS, INDEX, BASE, OUT = sys.argv[1:6]
SIM = float(sys.argv[6]) if len(sys.argv) > 6 else 0.55
GAP = float(sys.argv[7]) if len(sys.argv) > 7 else 0.10
WINDOW = float(sys.argv[8]) if len(sys.argv) > 8 else 90
ORIG_MIN = float(sys.argv[9]) if len(sys.argv) > 9 else 0.20
os.makedirs(OUT, exist_ok=True)

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
fpid = [pids[at[n]] for n in names]
fbox = [boxes[at[n]] for n in names]
byphoto = collections.defaultdict(list)
for i, p in enumerate(fpid): byphoto[p].append(i)

idx = {f['id']: f for f in json.load(open(INDEX, encoding='utf-8'))}
def when(pid):
    f = idx.get(pid)
    if not f or f['mimeType'] != 'image/jpeg': return None  # RAW files carry their upload time
    return datetime.datetime.fromisoformat(f['modifiedTime'].replace('Z', '+00:00')).timestamp()
def cam(pid): return idx[pid]['title'][:4] if pid in idx else ''

R = np.load(REFS + '_aura.npy'); people = json.load(open(REFS + '.json', encoding='utf-8'))
def key(n):
    n = n.replace('’', "'").replace('�', "'").lower().replace('.', ' ')
    return ' '.join(w for w in n.split() if w not in ('dr', 'mr', 'ms', 'mrs', 'prof', 'shri', 'smt', "hon'ble", 'hon', 'ble'))
groups = {}
for i, p in enumerate(people): groups.setdefault(key(p['name']), []).append(i)

base = json.load(open(BASE, encoding='utf-8'))
# Matches a person looked at and found wrong (scripts/photos/wrong-matches.json): removed from
# the base first, so no burst shot is ever added from them.
DROP = [] if '--drop' not in sys.argv else json.load(open(sys.argv[sys.argv.index('--drop') + 1], encoding='utf-8'))
for d in DROP:
    for k, v in base.items():
        if key(v['name']) == d['person'] or k == d['person']:
            v['photos'] = [r for r in v['photos'] if r[0] != d['photo']]
base = {k: v for k, v in base.items() if v['photos']}
O_ALL = None
# The face each sure match is: the face in that photo nearest the matched box centre.
sure = collections.defaultdict(list)   # person -> [(face, time, cam)]
taken = set()
for k, v in base.items():
    for row in v['photos']:
        pid, cx, cy = row[0], row[3], row[4]
        cand = byphoto.get(pid, [])
        if not cand: continue
        fi = min(cand, key=lambda i: (fbox[i][0] + fbox[i][2] / 2 - cx) ** 2 + (fbox[i][1] + fbox[i][3] / 2 - cy) ** 2)
        taken.add(fi)
        t = when(pid)
        if t is not None: sure[k].append((fi, t, cam(pid)))
have = {k: {r[0] for r in v['photos']} for k, v in base.items()}

# Sure faces by camera, time-sorted, for the window look-up.
bycam = collections.defaultdict(list)
for k, lst in sure.items():
    for fi, t, c in lst: bycam[c].append((t, k, fi))
for c in bycam: bycam[c].sort()

# --not-faces attendee_albums.json [att-skip.json]: a face an attendee's pass photo already
# claims is never added to a speaker (the same rule as match.py's).
NOT = set()
if '--not-faces' in sys.argv:
    _i = sys.argv.index('--not-faces')
    _alb = json.load(open(sys.argv[_i + 1]))['albums']
    _skip = set()
    if len(sys.argv) > _i + 2 and not sys.argv[_i + 2].startswith('--') and os.path.exists(sys.argv[_i + 2]):
        _skip = {'a%d' % int(x['id']) for x in json.load(open(sys.argv[_i + 2], encoding='utf-8'))}
    for _k, _v in _alb.items():
        if _k in _skip: continue
        for _r in _v['photos']:
            for _fi in byphoto.get(_r[0], []):
                if abs(fbox[_fi][0] + fbox[_fi][2] / 2 - _r[2]) < 0.03 and abs(fbox[_fi][1] + fbox[_fi][3] / 2 - _r[3]) < 0.03: NOT.add(_fi)
out = json.loads(json.dumps(base))
added = collections.Counter(); considered = 0
for fi in range(len(names)):
    if fi in taken or fi in NOT: continue
    pid = fpid[fi]; t = when(pid)
    if t is None: continue
    near = [(k, f2) for (t2, k, f2) in bycam.get(cam(pid), []) if abs(t2 - t) <= WINDOW and fpid[f2] != pid]
    if not near: continue
    considered += 1
    best = collections.defaultdict(float)
    for k, f2 in near:
        s = float(F[fi] @ F[f2])
        if s > best[k]: best[k] = s
    ranked = sorted(best.items(), key=lambda x: -x[1])
    k, s = ranked[0]
    s2 = ranked[1][1] if len(ranked) > 1 else 0.0
    if s < SIM or s - s2 < GAP or pid in have.get(k, ()): continue
    refs = R[groups[key(base[k]['name'])]] if key(base[k]['name']) in groups else None
    o = float((refs @ F[fi]).max()) if refs is not None else 0.0
    if o < ORIG_MIN: continue
    # Looks more like someone else's site photo (0.45+): leave it alone.
    if O_ALL is None: O_ALL = R @ F.T
    other = [O_ALL[i, fi] for g, ii in groups.items() if g != key(base[k]['name']) for i in ii]
    if other and max(other) >= 0.45 and max(other) > o: continue
    # Another face in this same photo also points at k: keep neither (crowded frame).
    clash = False
    for f3 in byphoto[pid]:
        if f3 == fi or f3 in taken: continue
        bs = max((float(F[f3] @ F[f2]) for kk, f2 in near if kk == k), default=0)
        if bs >= SIM: clash = True
    if clash: continue
    have.setdefault(k, set()).add(pid)
    b = fbox[fi]
    out[k]['photos'].append([pid, round(o, 3), round(float(b[2]), 4), round(float(b[0] + b[2] / 2), 3), round(float(b[1] + b[3] / 2), 3), round(o, 3), round(s, 3)])
    added[k] += 1
# QA copy: score = the burst similarity, so the sheets show why each face was added.
qa = {k: dict(v, photos=[[r[0], r[6]] + r[2:6] if len(r) > 6 else r for r in v['photos']]) for k, v in out.items()}
json.dump(qa, open(os.path.join(OUT, 'matches_qa.json'), 'w', encoding='utf-8'), ensure_ascii=False)
# keep match.py's row shape: [pid, score, w, cx, cy, orig] (burst similarity dropped)
for k in out:
    out[k]['photos'] = [r[:6] for r in out[k]['photos']]
json.dump(out, open(os.path.join(OUT, 'matches.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('faces considered', considered, '| SIM', SIM, 'GAP', GAP, 'WINDOW', WINDOW, '| people with additions', len(added), '| photos added', sum(added.values()))
print(added.most_common(15))
