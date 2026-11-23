# Check sheets for the attendee matches: their app photo, then each matched face (score),
# weakest last; 'check' people marked. usage: att_qa.py albums.json img_dir att_dir out_dir
import sys, os, json
from PIL import Image, ImageDraw
AL, IMG, AD, OUT = sys.argv[1:5]
os.makedirs(OUT, exist_ok=True)
A = json.load(open(AL))['albums']
rows = sorted(A.items(), key=lambda x: (x[1]['group'], x[1]['check'], -len(x[1]['photos'])))
C = 100
for si in range(0, len(rows), 14):
    part = rows[si:si + 14]
    sheet = Image.new('RGB', (C * 12, (C + 14) * len(part)), 'white'); d = ImageDraw.Draw(sheet)
    for r, (k, v) in enumerate(part):
        y = r * (C + 14)
        try:
            im = Image.open(os.path.join(AD, 'avatars', k[1:] + '.img')).convert('RGB'); im.thumbnail((C, C)); sheet.paste(im, (0, y))
        except Exception: pass
        d.text((2, y + C + 1), f"{k} g{v['group']}{' CHECK' if v['check'] else ''}", fill='red' if v['check'] else 'black')
        ph = v['photos']; pick = ph[:6] + ph[-5:] if len(ph) > 11 else ph
        for c, (pid, sc, cx, cy, w) in enumerate(pick):
            try:
                im = Image.open(os.path.join(IMG, pid + '.jpg')); W, H = im.size
                fw = w * W; x = cx * W; yy = cy * H; pad = 1.0 * fw
                cr = im.crop((int(x - pad), int(yy - pad), int(x + pad), int(yy + pad))).convert('RGB'); cr.thumbnail((C, C))
                sheet.paste(cr, ((c + 1) * C + 4, y)); d.text(((c + 1) * C + 6, y + C + 1), f'{sc:.2f}', fill='black')
            except Exception: pass
    sheet.save(os.path.join(OUT, f'att_{si // 14:02d}.jpg'), quality=80)
print('sheets', (len(rows) + 13) // 14)
