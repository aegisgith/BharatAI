# Pass 1: find every face in the event photos (YuNet), straighten it to the standard
# 112x112 ArcFace layout (FaceRecognizerSF.alignCrop uses the ArcFace 5-point template),
# save that crop, and score it with SFace (fast). Pass 2 (embed.py) runs AuraFace on the
# crops worth a closer look. Biometric data stays on this machine. Resumable.
# usage: faces.py models_dir img_dir out_dir [limit]
import sys, os, glob, json, numpy as np, cv2, time, multiprocessing as mp
M, IMG, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
LIMIT = int(sys.argv[4]) if len(sys.argv) > 4 else 0
WORKERS = int(os.environ.get('FACE_WORKERS', '2'))
MAXW = 1600
CROPS = os.path.join(OUT, 'crops')

def init():
    global det, rec
    cv2.setNumThreads(2)
    det = cv2.FaceDetectorYN.create(os.path.join(M, 'yunet.onnx'), '', (320, 320), 0.75, 0.3, 5000)
    rec = cv2.FaceRecognizerSF.create(os.path.join(M, 'sface.onnx'), '')

def work(path):
    pid = os.path.basename(path)[:-4]
    try:
        im = cv2.imread(path)
        if im is None: return pid, [], 'unreadable'
        h, w = im.shape[:2]
        if w > MAXW:
            s = MAXW / w; im = cv2.resize(im, (MAXW, int(h * s)), interpolation=cv2.INTER_AREA); h, w = im.shape[:2]
        det.setInputSize((w, h))
        _, fs = det.detect(im)
        res = []
        if fs is not None:
            for j, f in enumerate(fs):
                if f[2] < 24 or f[3] < 24: continue  # too small to recognise
                crop = rec.alignCrop(im, f)
                feat = rec.feature(crop).flatten().astype(np.float32)
                name = f'{pid}_{j}.jpg'
                cv2.imwrite(os.path.join(CROPS, name), crop, [cv2.IMWRITE_JPEG_QUALITY, 95])
                res.append((name, [f[0] / w, f[1] / h, f[2] / w, f[3] / h, float(f[14])], feat))
        return pid, res, ''
    except Exception as e:
        return pid, [], str(e)[:80]

if __name__ == '__main__':
    os.makedirs(CROPS, exist_ok=True)
    files = sorted(glob.glob(os.path.join(IMG, '*.jpg')))
    if LIMIT: files = files[:LIMIT]
    npz = os.path.join(OUT, 'faces.npz')
    ids, crops, boxes, feats, seen = [], [], [], [], set()
    if os.path.exists(npz):
        with np.load(npz, allow_pickle=False) as z:  # closed again: Windows cannot replace an open file
            ids, crops, boxes, feats = list(z['ids']), list(z['crops']), list(z['boxes']), list(z['feats'])
            seen = set(z['done'].tolist())
    todo = [f for f in files if os.path.basename(f)[:-4] not in seen]
    print('todo', len(todo), 'already', len(seen), flush=True)
    t = time.time(); errs = 0
    def save():
        tmp = npz + '.tmp.npz'
        np.savez_compressed(tmp, ids=np.array(ids), crops=np.array(crops), boxes=np.array(boxes, dtype=np.float32).reshape(-1, 5),
                            feats=np.array(feats, dtype=np.float32).reshape(-1, 128), done=np.array(sorted(seen)))
        os.replace(tmp, npz)
    with mp.Pool(WORKERS, initializer=init) as pool:
        for i, (pid, res, err) in enumerate(pool.imap_unordered(work, todo, chunksize=2)):
            if err: errs += 1; print('err', pid, err, flush=True); continue
            seen.add(pid)
            for name, b, f in res: ids.append(pid); crops.append(name); boxes.append(b); feats.append(f)
            if i % 200 == 0:
                print(i, len(todo), 'faces', len(ids), 'secs', round(time.time() - t), flush=True)
                save()
    save()
    print('photos', len(seen), 'faces', len(ids), 'errors', errs, 'secs', round(time.time() - t), flush=True)
