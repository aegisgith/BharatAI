"""Regenerates src/data/site-photo-fingerprints.json.

The avatar upload refuses a photo whose fingerprint matches a people-photo already
on the website (a speaker portrait, a gallery shot, a hero background), so that
saving one and uploading it as your own pass photo does not work. This lists those
fingerprints. It is committed rather than built: Cloudflare's build has no browser.

RE-RUN IT WHEN SITE PHOTOS CHANGE (a new speaker, a new gallery batch):
    python scripts/gen-site-photo-fingerprints.py
Needs Python Playwright with Chromium (pip install playwright; playwright install chromium).

It loads public/js/photo-fingerprint.js - the file /app uses - into Chromium and runs
the same squareCanvas + fromCanvas on every image, so the list and the app cannot
compute a fingerprint differently. Logos, icons, org logos and pass artwork are left
out: they are not people, and the person check refuses them anyway.
"""
import base64, glob, json, os
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, 'src', 'data', 'site-photo-fingerprints.json')
MIME = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif'}
SKIP_WORDS = ('logo', 'icon', 'favicon', 'apple-touch', 'og-image', 'badge', 'qr')
SKIP_DIRS = ('org-logos', 'passes')

paths = []
for pat in ('public/images/*.*', 'public/images/**/*.*', 'public/img/*.*', 'public/img/**/*.*'):
    paths += glob.glob(os.path.join(REPO, pat), recursive=True)
files = []
for p in sorted(set(paths)):
    rel = os.path.relpath(p, REPO).replace('\\', '/')
    low = rel.lower()
    if os.path.splitext(low)[1] not in MIME: continue
    if any('/%s/' % d in low for d in SKIP_DIRS): continue
    if any(w in os.path.basename(low) for w in SKIP_WORDS): continue
    files.append((rel, p))

JS = open(os.path.join(REPO, 'public', 'js', 'photo-fingerprint.js'), encoding='utf-8').read()
entries, seen = [], set()
with sync_playwright() as pw:
    browser = pw.chromium.launch(args=['--no-sandbox'])
    page = browser.new_page()
    page.goto('about:blank')
    page.add_script_tag(content=JS)
    for rel, p in files:
        src = 'data:%s;base64,%s' % (MIME[os.path.splitext(p)[1].lower()], base64.b64encode(open(p, 'rb').read()).decode())
        try:
            fp = page.evaluate("""(s) => new Promise((res, rej) => { const i = new Image();
                i.onload = () => res(BhaiPhotoFingerprint.fromCanvas(BhaiPhotoFingerprint.squareCanvas(i, 400)));
                i.onerror = () => rej(new Error('decode')); i.src = s; })""", src)
        except Exception as e:
            print('skipped (could not decode):', rel, str(e)[:60]); continue
        if fp in seen: continue          # the same image saved twice (jpg + webp, two folders)
        seen.add(fp)
        entries.append({'file': rel, 'fp': fp})
    browser.close()

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(entries, f, indent=0, separators=(',', ':'))
    f.write('\n')
print('wrote %d fingerprints from %d images -> %s' % (len(entries), len(files), os.path.relpath(OUT, REPO)))
