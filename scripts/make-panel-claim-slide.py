#!/usr/bin/env python3
"""Draw the closing slide for a campus panel: the QR and code that claim attendance.

Nobody from the organiser takes attendance at another college, so the last slide
of the panel does it. A registrant scans the QR (or types the code into the app),
signs in with the email they registered with, and their certificate of
participation and "I attended" card unlock. The code must match the one stored in
app_settings (panel_claim_code:<slug>) by scripts/import-muni-panel.py --new-code.

Usage:
    python scripts/make-panel-claim-slide.py --panel djsanghvi-21sep --code 7K4M2P --out closing-slide.png

The PNG is 1920x1080, for a 16:9 projector. Keep it out of git and out of every
email until the panel is over: the code is the whole gate. Needs Pillow + qrcode.
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = 'https://bharataiinnovation.com/app'

PANELS = {
    'djsanghvi-21sep': {
        'title': 'AI and Employability',
        'subtitle': 'Opportunities, Challenges & the Future of Work',
        'host': 'Dwarkadas J. Sanghvi College of Engineering',
        'date': 'Monday, 21 September 2026',
        'closes': 'Wednesday 23 September, 11:59 PM',
        'logo': 'public/images/campus/djsanghvi-logo.png',
    },
    'jnu-30sep': {
        'title': 'AI and Employability',
        'subtitle': 'Opportunities, Challenges & the Future of Work',
        'host': 'Jawaharlal Nehru University',
        'date': 'Wednesday, 30 September 2026',
        'closes': 'Friday 2 October, 11:59 PM',
        'logo': '',
    },
}

INK1, INK2 = (10, 12, 27), (22, 27, 58)
SAFFRON, SAFFRON_LO, WHITE, MUTE, FAINT = (255, 107, 0), (255, 158, 77), (255, 255, 255), (154, 163, 191), (107, 117, 151)
GREEN = (0, 153, 108)


def font(size, bold=False):
    # Windows ships Arial; Segoe UI is nicer where present. The site's Montserrat
    # is not installed locally, so this is deliberately a system font.
    for name in (['segoeuib.ttf', 'arialbd.ttf'] if bold else ['segoeui.ttf', 'arial.ttf']):
        for d in (r'C:\Windows\Fonts', '/usr/share/fonts/truetype/msttcorefonts', '/Library/Fonts'):
            p = os.path.join(d, name)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def gradient(w, h):
    img = Image.new('RGB', (w, h), INK1)
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        for x in range(0, w, 4):
            u = 0.5 * t + 0.5 * (x / w)
            c = tuple(int(INK1[i] + (INK2[i] - INK1[i]) * u) for i in range(3))
            for dx in range(4):
                if x + dx < w:
                    px[x + dx, y] = c
    return img


def chip(img, logo_path, x, y, h):
    """A logo on a white rounded plate. Returns the plate's width."""
    logo = Image.open(logo_path).convert('RGBA')
    w = int(logo.width * (h / logo.height))
    pad = 18
    plate = Image.new('RGBA', (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(plate).rounded_rectangle((0, 0, plate.width - 1, plate.height - 1), radius=22, fill=WHITE)
    plate.alpha_composite(logo.resize((w, h), Image.LANCZOS), (pad, pad))
    img.alpha_composite(plate, (x, y))
    return plate.width


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--panel', required=True, choices=sorted(PANELS))
    ap.add_argument('--code', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    p = PANELS[a.panel]
    code = ''.join(ch for ch in a.code.upper() if ch.isalnum())
    if len(code) != 6:
        sys.exit('the code should be six characters')
    url = f'{APP}?panel={a.panel}&claim={code}'

    W, H = 1920, 1080
    img = gradient(W, H).convert('RGBA')
    d = ImageDraw.Draw(img)
    # tricolour bar
    d.rectangle((0, 0, W // 3, 10), fill=SAFFRON); d.rectangle((W // 3, 0, 2 * W // 3, 10), fill=WHITE); d.rectangle((2 * W // 3, 0, W, 10), fill=GREEN)

    # logos, top-left
    x = 80
    x += chip(img, os.path.join(ROOT, 'public/images/Bharat AI Innovation Logo.png'), x, 56, 74) + 22
    if p['logo'] and os.path.exists(os.path.join(ROOT, p['logo'])):
        chip(img, os.path.join(ROOT, p['logo']), x, 56, 74)

    # top-right: series + panel
    d.text((W - 80, 70), 'BHARAT AI INNOVATION  ·  PRE-EVENT PANEL DISCUSSION', font=font(26, True), fill=SAFFRON_LO, anchor='ra')
    d.text((W - 80, 112), p['title'] + '  ·  ' + p['date'], font=font(26), fill=MUTE, anchor='ra')

    # headline
    d.text((80, 230), 'Thank you for attending.', font=font(74, True), fill=WHITE)
    d.text((80, 330), 'Claim your certificate of participation before you leave.', font=font(36), fill=MUTE)

    # QR on a white tile
    import qrcode
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=12, border=2)
    qr.add_data(url); qr.make(fit=True)
    qim = qr.make_image(fill_color='#0A0C1B', back_color='white').convert('RGBA')
    qside = 470
    qim = qim.resize((qside, qside), Image.NEAREST)
    tile = Image.new('RGBA', (qside + 40, qside + 40), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle((0, 0, tile.width - 1, tile.height - 1), radius=28, fill=WHITE)
    tile.alpha_composite(qim, (20, 20))
    qx, qy = 80, 416
    img.alpha_composite(tile, (qx, qy))
    d.text((qx + tile.width // 2, qy + tile.height + 26), 'Scan with your phone camera', font=font(24), fill=FAINT, anchor='ma')

    # steps + code, right of the QR
    sx = qx + tile.width + 90
    steps = [
        ('1', 'Scan the QR, or open', 'bharataiinnovation.com/app'),
        ('2', 'Sign in with the email you registered with', ''),
        ('3', 'Your certificate and "I attended" card are ready', ''),
    ]
    y = 428
    for n, t1, t2 in steps:
        d.ellipse((sx, y + 2, sx + 44, y + 46), fill=SAFFRON)
        d.text((sx + 22, y + 24), n, font=font(26, True), fill=WHITE, anchor='mm')
        d.text((sx + 66, y + 4), t1, font=font(32), fill=WHITE)
        if t2:
            d.text((sx + 66, y + 46), t2, font=font(30, True), fill=SAFFRON_LO)
            y += 44
        y += 78

    # the code, large
    y += 10
    d.text((sx, y), 'If asked for a code, enter', font=font(26), fill=MUTE)
    y += 42
    shown = code[:3] + '  ' + code[3:]
    box_w, box_h = 520, 118
    d.rounded_rectangle((sx, y, sx + box_w, y + box_h), radius=22, outline=SAFFRON, width=4, fill=(255, 107, 0, 28))
    d.text((sx + box_w // 2, y + box_h // 2), shown, font=font(78, True), fill=WHITE, anchor='mm')
    d.text((sx, y + box_h + 16), f'Works until {p["closes"]}. One claim per registered email.', font=font(24), fill=FAINT)

    # footer
    d.line((80, H - 96, W - 80, H - 96), fill=(255, 255, 255, 30), width=2)
    d.text((80, H - 72), f'Hosted at {p["host"]}', font=font(24), fill=MUTE)
    d.text((W - 80, H - 72), 'Bharat AI Innovation 2026  ·  20–21 November  ·  World Trade Center, Mumbai  ·  bharataiinnovation.com', font=font(24), fill=MUTE, anchor='ra')

    img.convert('RGB').save(a.out, optimize=True)
    print('wrote', a.out)
    print('QR points at', url)


if __name__ == '__main__':
    main()
