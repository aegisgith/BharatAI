# Read the printed text in every event photo (RapidOCR, onnxruntime), for finding exhibitors'
# booths by their company name. Output: ocr.json {drive id: [[text, confidence, share of the
# photo's width the text spans], ...]}. Resumable; 3 workers.
# usage: ocr.py img_dir out.json [workers] [order.json]
import sys, os, glob, json, time, multiprocessing as mp
IMG, OUT = sys.argv[1], sys.argv[2]
WORKERS = int(sys.argv[3]) if len(sys.argv) > 3 else 3
W = 1280

def init():
    global ocr, cv2
    import cv2 as _cv2
    cv2 = _cv2
    cv2.setNumThreads(1)
    from rapidocr_onnxruntime import RapidOCR
    ocr = RapidOCR(intra_op_num_threads=2)

def work(path):
    pid = os.path.basename(path)[:-4]
    try:
        im = cv2.imread(path)
        h, w = im.shape[:2]
        im = cv2.resize(im, (W, int(h * W / w)))
        res, _ = ocr(im, use_cls=False)
        out = []
        for box, text, conf in (res or []):
            xs = [p[0] for p in box]
            out.append([text, round(float(conf), 3), round((max(xs) - min(xs)) / W, 3)])
        return pid, out
    except Exception as e:
        return pid, None

if __name__ == '__main__':
    done = json.load(open(OUT)) if os.path.exists(OUT) else {}
    files = [f for f in sorted(glob.glob(os.path.join(IMG, '*.jpg'))) if os.path.basename(f)[:-4] not in done]
    if len(sys.argv) > 4:  # optional priority order: a JSON list of photo ids, read first
        rank = {p: i for i, p in enumerate(json.load(open(sys.argv[4])))}
        files.sort(key=lambda f: rank.get(os.path.basename(f)[:-4], 10 ** 9))
    print('todo', len(files), 'done', len(done), flush=True)
    t = time.time()
    with mp.Pool(WORKERS, initializer=init) as pool:
        for i, (pid, out) in enumerate(pool.imap(work, files, chunksize=2)):
            if out is not None: done[pid] = out
            if i % 100 == 0:
                json.dump(done, open(OUT + '.tmp', 'w')); os.replace(OUT + '.tmp', OUT)
                print(i, len(files), 'secs', round(time.time() - t), flush=True)
    json.dump(done, open(OUT + '.tmp', 'w')); os.replace(OUT + '.tmp', OUT)
    print('finished', len(done), 'secs', round(time.time() - t), flush=True)
