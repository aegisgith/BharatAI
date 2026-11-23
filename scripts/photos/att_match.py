# Attendees' photos: match each checked-in attendee's app profile photo against every face
# in the event photos, stricter than for speakers (lookalikes among ~600 people, and a wrong
# match would show one attendee a stranger's photos).
# - Their face data is used in memory only for this run; nothing about it is written.
# - An attendee who is already a speaker or guest (same face as a speaker/guest reference)
#   is left out: they have that album.
# - A face is theirs only if it beats EVERY other person (speakers, guests and all other
#   attendees) by MARGIN and scores at least TH. Everyone registered with a profile photo is
#   matched, not only those the badge desk scanned (the organiser, 23 Nov: the queue was too
#   long to scan everyone), but someone with no check-in needs TH_NOT / SURE_NOT, so a
#   lookalike who stayed home does not take the photos of someone who came.
# - 'check': their best match is under SURE: Admin asks for a look before sending.
# usage: att_match.py models faces_dir refs_prefix img_dir att_dir out.json [TH] [MARGIN] [SURE]
import sys, os, glob, json, numpy as np, cv2, onnxruntime as ort
from PIL import Image
M, FD, REFS, IMG, AD, OUT = sys.argv[1:7]
TH = float(sys.argv[7]) if len(sys.argv) > 7 else 0.55
MARGIN = float(sys.argv[8]) if len(sys.argv) > 8 else 0.10
SURE = float(sys.argv[9]) if len(sys.argv) > 9 else 0.65
TH_NOT, SURE_NOT = TH + 0.04, SURE + 0.03
SAME = 0.55   # an attendee photo this close to a speaker/guest reference is that person
# Attendees never matched on their own (scripts/photos/att-skip.json, e.g. a speaker whose
# pass photo differs from their site photo): [{"id": 6, "why": "..."}].
SKIP = set()
if len(sys.argv) > 10 and os.path.exists(sys.argv[10]):
    SKIP = {int(x['id']) for x in json.load(open(sys.argv[10], encoding='utf-8'))}
PRIORITY = [('Speakers', ('Speaker', 'Exhibition Speaker')), ('VIP guests', ('VIP Pass', 'VIP Guest')),
            ('Delegates', ('Delegate Pass', 'Premium Delegate Pass')), ('Organisers', ('Organiser',)),
            ('Exhibitors', ('Exhibitor',)), ('Visitors and others', ())]
def group_of(p):
    for i, (g, passes) in enumerate(PRIORITY):
        if p in passes: return i
    return len(PRIORITY) - 1

det = cv2.FaceDetectorYN.create(os.path.join(M, 'yunet.onnx'), '', (320, 320), 0.6, 0.3, 50)
rec = cv2.FaceRecognizerSF.create(os.path.join(M, 'sface.onnx'), '')
o = ort.SessionOptions(); o.intra_op_num_threads = 6
sess = ort.InferenceSession(os.path.join(M, 'glintr100.onnx'), o, providers=['CPUExecutionProvider'])
inp = sess.get_inputs()[0].name
def aura(crops):
    x = np.stack([cv2.cvtColor(c, cv2.COLOR_BGR2RGB) for c in crops]).astype(np.float32)
    y = sess.run(None, {inp: ((x - 127.5) / 127.5).transpose(0, 3, 1, 2)})[0]
    return y / np.linalg.norm(y, axis=1, keepdims=True)

L = json.load(open(os.path.join(AD, 'list.json'), encoding='utf-8'))[0]['results']
people, crops, nofaces = [], [], 0
for x in L:
    try:
        im = cv2.cvtColor(np.array(Image.open(os.path.join(AD, 'avatars', '%d.img' % x['id'])).convert('RGB')), cv2.COLOR_RGB2BGR)
    except Exception:
        nofaces += 1; continue
    h, w = im.shape[:2]
    if max(h, w) < 400: s = 400 / max(h, w); im = cv2.resize(im, None, fx=s, fy=s); h, w = im.shape[:2]
    if max(h, w) > 1600: s = 1600 / max(h, w); im = cv2.resize(im, None, fx=s, fy=s); h, w = im.shape[:2]
    det.setInputSize((w, h)); _, fs = det.detect(im)
    if fs is None or not len(fs): nofaces += 1; continue
    fb = max(fs, key=lambda r: r[2] * r[3])
    if fb[2] < 40: nofaces += 1; continue
    crops.append(rec.alignCrop(im, fb))
    people.append({'id': x['id'], 'pass': x.get('pass') or '', 'days': sorted(set((x.get('days') or '').split(',')) - {''})})
A = np.concatenate([aura(crops[i:i + 32]) for i in range(0, len(crops), 32)]) if crops else np.zeros((0, 512), np.float32)
del crops
print('attendee photos with a usable face', len(people), '| no face or unreadable', nofaces, flush=True)

# Speakers and guests (the same references as their albums), grouped by person.
R = np.load(REFS + '_aura.npy'); rp = json.load(open(REFS + '.json', encoding='utf-8'))
def key(n):
    n = n.replace('’', "'").replace('�', "'").lower().replace('.', ' ')
    return ' '.join(w for w in n.split() if w not in ('dr', 'mr', 'ms', 'mrs', 'prof', 'shri', 'smt', "hon'ble", 'hon', 'ble'))
groups = {}
for i, p in enumerate(rp): groups.setdefault(key(p['name']), []).append(i)
G = list(groups.values())
same = (A @ R.T).max(1) if len(A) else np.zeros(0)
keep = [i for i in range(len(people)) if same[i] < SAME and people[i]['id'] not in SKIP]
print('left out as already a speaker or guest', len(people) - len(keep), flush=True)

# Every event face.
with np.load(os.path.join(FD, 'faces.npz')) as z:
    crops_n = [str(c) for c in z['crops']]; boxes = z['boxes']; pids = [str(p) for p in z['ids']]
at = {c: i for i, c in enumerate(crops_n)}
names, F = [], []
for f in sorted(glob.glob(os.path.join(FD, 'aura*.npz'))):
    if f.endswith('.tmp.npz'): continue
    with np.load(f) as a:
        for n, v in zip(a['names'], a['feats']):
            n = str(n)
            if n in at and n not in names: names.append(n); F.append(v)
F = np.array(F, dtype=np.float32)
idx = json.load(open(os.path.join(os.path.dirname(REFS), 'index.json')))
D1 = {'1V0ANjyTnfBQ4TVs8ZDTKi_U-8OudEiJ_', '1dgfV1_9Aqx1Fkhm2WZDy5KxOVVlGTc0-', '1OR9Bhb5z0H0xRAcmoCxKUcRMlLzHFQxW', '1VDUlZkowzad0X6ra09cCTb8E0D-0AWGD',
      '1EFh2DitPNGNNtO2JZQ5C4fS70iyMsNHJ', '15xhVXrZIdPEo-RV5w3_i4vE7d5b9qY58', '1ifBcPbnczf6-SqECLwpj4pIofTymUbBz', '11DBmuc9CbsruhRFV_txuwgeXgtmmUZX6', '1p7m4-kNxNIt2w1nG5MzeT1Td5UmQtljs'}
dayof = {f['id']: ('2026-11-20' if f['parentId'] in D1 else '2026-11-21') for f in idx}

S_sp = np.stack([(F @ R[g].T).max(1) for g in G], 1)          # faces x speakers/guests
S_at = F @ A[keep].T                                          # faces x attendees
S = np.concatenate([S_sp, S_at], 1)
best = S.argmax(1); bv = S.max(1); sec = np.partition(S, -2, axis=1)[:, -2]
nsp = S_sp.shape[1]
albums = {}
for fi in np.where((best >= nsp) & (bv >= TH) & (bv - sec >= MARGIN))[0]:
    p = people[keep[best[fi] - nsp]]; pid = pids[at[names[fi]]]
    if not p['days'] and bv[fi] < TH_NOT: continue               # no check-in: stricter
    b = boxes[at[names[fi]]]
    a = albums.setdefault('a%d' % p['id'], {'pass': p['pass'], 'group': group_of(p['pass']), 'came': bool(p['days']), 'photos': {}})
    if bv[fi] > a['photos'].get(pid, [0])[0]:
        a['photos'][pid] = [float(bv[fi]), float(b[0] + b[2] / 2), float(b[1] + b[3] / 2), float(b[2])]
# --burst speaker_matches.json: also add the shots where someone faces away, from burst
# shots. A face joins attendee X only when the same camera took a photo within BWIN seconds
# that X is surely in, this face looks like X's face in THAT photo (same light and clothes)
# by BSIM and beats everyone else's nearby faces (speakers' too) by BGAP, it still scores
# BORIG against X's pass photo, and it looks no more like any speaker or guest. Faces already
# given to anyone are never moved. The added rows keep their pass-photo score, so they rank
# last and never decide 'check'.
if '--burst' in sys.argv:
    import datetime, collections
    BSIM, BGAP, BWIN, BORIG = 0.62, 0.10, 90, TH - 0.13
    SPM = json.load(open(sys.argv[sys.argv.index('--burst') + 1], encoding='utf-8'))
    meta = {f['id']: f for f in idx}
    def when(pid):
        f = meta.get(pid)
        if not f or f['mimeType'] != 'image/jpeg': return None
        return datetime.datetime.fromisoformat(f['modifiedTime'].replace('Z', '+00:00')).timestamp()
    def cam(pid): return meta[pid]['title'][:4] if pid in meta else ''
    fpid = [pids[at[n]] for n in names]; fbox = [boxes[at[n]] for n in names]
    byphoto = collections.defaultdict(list)
    for i, p in enumerate(fpid): byphoto[p].append(i)
    def face_at(pid, cx, cy):
        c = byphoto.get(pid, [])
        return min(c, key=lambda i: (fbox[i][0] + fbox[i][2] / 2 - cx) ** 2 + (fbox[i][1] + fbox[i][3] / 2 - cy) ** 2) if c else None
    taken, bycam = set(), collections.defaultdict(list)
    def mark(label, pid, cx, cy):
        fi = face_at(pid, cx, cy)
        if fi is None: return
        taken.add(fi); t = when(pid)
        if t is not None: bycam[cam(pid)].append((t, label, fi))
    for k, v in SPM.items():
        for r in v['photos']: mark('s:' + k, r[0], r[3], r[4])
    for k, a in albums.items():
        for pid, v in a['photos'].items(): mark(k, pid, v[1], v[2])
    col = {'a%d' % people[keep[j]]['id']: j for j in range(len(keep))}
    added = 0
    for fi in range(len(names)):
        if fi in taken: continue
        pid = fpid[fi]; t = when(pid)
        if t is None: continue
        near = [(lab, f2) for (t2, lab, f2) in bycam.get(cam(pid), []) if abs(t2 - t) <= BWIN and fpid[f2] != pid]
        if not near: continue
        sims = collections.defaultdict(float)
        for lab, f2 in near: sims[lab] = max(sims[lab], float(F[fi] @ F[f2]))
        ranked = sorted(sims.items(), key=lambda x: -x[1])
        lab, s = ranked[0]; s2 = ranked[1][1] if len(ranked) > 1 else 0.0
        if lab.startswith('s:') or s < BSIM or s - s2 < BGAP or pid in albums[lab]['photos']: continue
        own = float(S_at[fi, col[lab]])
        if own < BORIG or S_sp[fi].max() >= max(0.45, own): continue
        if any(f3 != fi and f3 not in taken and max(float(F[f3] @ F[f2]) for l2, f2 in near if l2 == lab) >= BSIM for f3 in byphoto[pid]): continue
        b = fbox[fi]
        albums[lab]['photos'][pid] = [own, float(b[0] + b[2] / 2), float(b[1] + b[3] / 2), float(b[2])]
        added += 1
    print('burst shots added', added, flush=True)
out = {}
for k, a in albums.items():
    ph = sorted(a['photos'].items(), key=lambda x: -x[1][0])
    out[k] = {'pass': a['pass'], 'group': a['group'], 'came': a['came'], 'check': ph[0][1][0] < (SURE if a['came'] else SURE_NOT),
              'photos': [[pid, round(v[0], 3), round(v[1], 3), round(v[2], 3), round(v[3], 4)] for pid, v in ph]}
json.dump({'th': TH, 'margin': MARGIN, 'sure': SURE, 'groups': [g for g, _ in PRIORITY], 'albums': out}, open(OUT, 'w'))
n = [len(v['photos']) for v in out.values()]
by = {}
for v in out.values(): by.setdefault(PRIORITY[v['group']][0], [0, 0]); by[PRIORITY[v['group']][0]][0] += 1; by[PRIORITY[v['group']][0]][1] += int(v['check'])
print('attendees found', len(out), 'of', len(keep), '| photos per person median', int(np.median(n)) if n else 0, 'max', max(n) if n else 0)
print('by group (found, to look at):', by)
