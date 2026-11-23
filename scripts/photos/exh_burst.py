# Booth burst shots: the photographer took several frames of a booth within seconds, and the
# ones where the company's name is cut off or too small to read were missed by exh_match.py.
# A photo counts for a company when the same camera took it within WIN seconds of one of the
# company's booth photos AND it shows the same scene: ORB feature matches between the two
# photos that agree on one homography (INLIERS or more, at 1,000 px).
# Never: a stage or hall-camera speaker shot (hits.json "wall"), a photo that names another
# company at 6%+ and not this one, booth-checked.json "not_booth", or a "not_for" pair.
# usage: exh_burst.py booth.json hits.json index.json img_dir out.json [WIN] [INLIERS]
#        --folder folder.json [--speakers src/data/speaker-photos.json] [--checked booth-checked.json]
# - hits.json: from exh_match.py --hits. out.json: booth.json plus the burst rows
#   ([photo id, 0.0, 0.0]); out.json + '.added.json' lists what was added and from which photo,
#   for the eye check (any wrong one goes in booth-checked.json "not_for", then run again).
# Slow: about 10 minutes for 700 booth photos on this computer. Run it alone.
import sys, json, os, datetime, cv2, numpy as np
B, HITS, INDEX, IMG, OUT = sys.argv[1:6]
pos = [a for a in sys.argv[6:8] if not a.startswith('--')]
WIN = float(pos[0]) if len(pos) > 0 else 60
NIN = int(pos[1]) if len(pos) > 1 else 80
def arg(flag): return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else None
FOLDER = json.load(open(arg('--folder'))) if arg('--folder') else {}
SPK = set()
if arg('--speakers'):
    for person in json.load(open(arg('--speakers'), encoding='utf-8'))['people']: SPK.update(person['photos'])
CHK = json.load(open(arg('--checked'), encoding='utf-8')) if arg('--checked') else {}
NOT_BOOTH = {r['id'] for r in CHK.get('not_booth', [])}; IS_BOOTH = {r['id'] for r in CHK.get('booth', [])}
NOT_FOR = {(r['company'], r['id']) for r in CHK.get('not_for', [])}
BOOTH_WALK = {'booth', 'd1c4', 'd1c6', 'd2c5', 'd2c6'}
def hall_stage(q): return FOLDER.get(q) not in BOOTH_WALK and q in SPK and q not in IS_BOOTH
booth = json.load(open(B)); hits = json.load(open(HITS))
idx = json.load(open(INDEX, encoding='utf-8')); photos = idx['photos'] if isinstance(idx, dict) else idx
photos = [p for p in photos if p.get('modifiedTime')]
def ts(p): return datetime.datetime.fromisoformat(p['modifiedTime'].replace('Z', '+00:00')).timestamp()
byfolder = {}
for p in photos: byfolder.setdefault(p['parentId'], []).append((ts(p), p['id'], p.get('title', '')))
info = {p['id']: (p['parentId'], ts(p), p.get('title', '')) for p in photos}
orb = cv2.ORB_create(3000); bf = cv2.BFMatcher(cv2.NORM_HAMMING)
cache, pairs = {}, {}
def feat(pid):
    if pid not in cache:
        im = cv2.imread(os.path.join(IMG, pid + '.jpg'), cv2.IMREAD_GRAYSCALE)
        if im is None: cache[pid] = None
        else:
            s = 1000 / max(im.shape); im = cv2.resize(im, None, fx=s, fy=s) if s < 1 else im
            cache[pid] = orb.detectAndCompute(im, None)
        if len(cache) > 400: cache.pop(next(iter(cache)))
    return cache[pid]
def inliers(a, b):
    key = (a, b) if a < b else (b, a)
    if key in pairs: return pairs[key]
    fa, fb = feat(a), feat(b); n = 0
    if fa and fb and fa[1] is not None and fb[1] is not None:
        m = bf.knnMatch(fa[1], fb[1], k=2)
        good = [x[0] for x in m if len(x) == 2 and x[0].distance < 0.75 * x[1].distance]
        if len(good) >= 12:
            pa = np.float32([fa[0][g.queryIdx].pt for g in good]); pb = np.float32([fb[0][g.trainIdx].pt for g in good])
            H, mask = cv2.findHomography(pa, pb, cv2.RANSAC, 6.0)
            n = int(mask.sum()) if mask is not None else 0
    pairs[key] = n
    return n
added, log = {}, []
for key, rows in booth.items():
    have = {r[0] for r in rows}; add = {}
    for pid in list(have):
        if pid not in info: continue
        fid, t, _ = info[pid]
        for t2, q, title in byfolder.get(fid, []):
            if q in have or q in add or abs(t2 - t) > WIN: continue
            if q in NOT_BOOTH or (key, q) in NOT_FOR or hall_stage(q): continue
            h = hits.get(q)
            if h and h.get('wall'): continue
            if h and any(v >= 0.06 for k, v in h['c'].items() if k != key) and key not in h['c']: continue
            n = inliers(pid, q)
            if n >= NIN: add[q] = (n, pid)
    if add:
        added[key] = [[q, n, src] for q, (n, src) in sorted(add.items(), key=lambda x: -x[1][0])]
        rows.extend([[q, 0.0, 0.0] for q, n, src in added[key]])
        log.append(f"{key}: +{len(add)}")
json.dump(booth, open(OUT, 'w'))
json.dump(added, open(OUT + '.added.json', 'w'))
print(' | '.join(log)); print('companies with more', len(added), '| burst photos added', sum(len(v) for v in added.values()))
