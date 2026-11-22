# Pass 2: AuraFace (glintr100, ArcFace R100, Apache-2.0) embeddings for the straightened
# face crops from pass 1 that are big enough to recognise, and for the speaker refs.
# Runs in the venv with onnxruntime 1.19. Resumable: keeps what it already embedded.
# usage: embed.py models_dir faces_dir refs_prefix [min_px]
import sys, os, glob, json, time, numpy as np, cv2, onnxruntime as ort
M, FD, REFS = sys.argv[1], sys.argv[2], sys.argv[3]
MINPX = float(sys.argv[4]) if len(sys.argv) > 4 else 40
o = ort.SessionOptions(); o.intra_op_num_threads = int(os.environ.get('ORT_THREADS', '6'))
sess = ort.InferenceSession(os.path.join(M, 'glintr100.onnx'), o, providers=['CPUExecutionProvider'])
inp = sess.get_inputs()[0].name

def embed(paths):
    x = np.stack([cv2.cvtColor(cv2.imread(p), cv2.COLOR_BGR2RGB) for p in paths]).astype(np.float32)
    x = ((x - 127.5) / 127.5).transpose(0, 3, 1, 2)
    y = sess.run(None, {inp: x})[0]
    return (y / np.linalg.norm(y, axis=1, keepdims=True)).astype(np.float32)

# refs
people = json.load(open(REFS + '.json', encoding='utf-8'))
R = np.concatenate([embed([p['crop'] for p in people[i:i + 32]]) for i in range(0, len(people), 32)])
np.save(REFS + '_aura.npy', R)
print('refs', len(R), flush=True)

with np.load(os.path.join(FD, 'faces.npz')) as z:  # closed again: pass 1 may be replacing it
    crops, boxes = z['crops'], z['boxes']
want = [str(c) for c, b in zip(crops, boxes) if b[2] * 1600 >= MINPX]
# Each run writes its own file (AURA_OUT, default aura.npz) and skips faces that any
# aura*.npz in the folder already has, so two runs can overlap without clashing.
out = os.path.join(FD, os.environ.get('AURA_OUT', 'aura.npz'))
names, feats = [], []
if os.path.exists(out):
    with np.load(out) as a: names, feats = list(a['names']), list(a['feats'])
have = set(names)
for f in glob.glob(os.path.join(FD, 'aura*.npz')):
    if f.endswith('.tmp.npz') or os.path.abspath(f) == os.path.abspath(out): continue
    with np.load(f) as a: have.update(str(n) for n in a['names'])
todo = [c for c in want if c not in have]
print('faces in pass 1', len(crops), '| big enough', len(want), '| to embed', len(todo), flush=True)
t = time.time()
def save():
    np.savez(out + '.tmp.npz', names=np.array(names), feats=np.array(feats, dtype=np.float32).reshape(-1, 512)); os.replace(out + '.tmp.npz', out)
for i in range(0, len(todo), 32):
    chunk = todo[i:i + 32]
    f = embed([os.path.join(FD, 'crops', c) for c in chunk])
    names.extend(chunk); feats.extend(list(f))
    if (i // 32) % 20 == 0:
        save(); print(i + len(chunk), len(todo), 'secs', round(time.time() - t), flush=True)
save()
print('embedded', len(names), 'secs', round(time.time() - t), flush=True)
