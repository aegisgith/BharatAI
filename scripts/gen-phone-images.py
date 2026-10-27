#!/usr/bin/env python3
"""Phone-sized copies of the site's heaviest pictures, and the small icons.

Why: the 900px logo PNG (37 KB) was shown at 44-80px on every page and doubled
as the favicon; two report covers and the campus panel photo were sent at
130-165 KB each to phones that show them at a third of that width; twenty
speaker-organisation icons came from Google's favicon service, which bounces
each one through a second server.

Writes (the originals stay where they are: the pass renderer, the social card,
the emails and the og: tags still use the full logo and the full photos):
  public/images/logo-nav.webp                       400px-wide logo for <img> tags
  public/images/favicon-64.png, public/favicon.ico  from icon-192.png
  public/images/campus-djsanghvi-21sep-panel-v5-1200.webp
  public/images/reports/{djsce,jnu}-cover.webp      same 720px, re-encoded
  public/images/org-logos/favicon-<domain>.png      the speaker-organisation icons

Run again after replacing one of the originals:  python scripts/gen-phone-images.py
"""
import io
import os
import sys
import urllib.request

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
IMG = os.path.join(ROOT, 'public', 'images')

# The speaker cards on the home page show the organisation's icon next to the
# name. These are the domains the page used to ask Google for.
ORG_DOMAINS = [
    'kotak.com', 'dspim.com', 'accenture.com', 'atos.net', 'decimalpointanalytics.com',
    'pwc.com', 'google.com', 'capgemini.com', 'comviva.com', 'alkemlabs.com', 'godigit.com',
    'hindujahospital.com', 'cipla.com', 'axismaxlife.com', 'canarahsbclife.com', 'myvi.in',
    'nobroker.in', 'microsoft.com', 'sunpharma.com', 'npci.org.in',
]


def save(im, path, **kw):
    im.save(path, **kw)
    print(f'  {os.path.relpath(path, ROOT)}  {os.path.getsize(path) // 1024} KB  {im.size[0]}x{im.size[1]}')


def main():
    print('[gen-phone-images]')
    logo = Image.open(os.path.join(IMG, 'Bharat AI Innovation Logo.png')).convert('RGBA')
    w = 400
    small = logo.resize((w, round(logo.height * w / logo.width)), Image.LANCZOS)
    save(small, os.path.join(IMG, 'logo-nav.webp'), format='WEBP', quality=88, method=6)

    icon = Image.open(os.path.join(IMG, 'icon-192.png')).convert('RGBA')
    save(icon.resize((64, 64), Image.LANCZOS), os.path.join(IMG, 'favicon-64.png'), format='PNG', optimize=True)
    save(icon, os.path.join(ROOT, 'public', 'favicon.ico'), format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])

    panel = Image.open(os.path.join(IMG, 'campus-djsanghvi-21sep-panel-v5.jpg')).convert('RGB')
    w = 1200
    save(panel.resize((w, round(panel.height * w / panel.width)), Image.LANCZOS),
         os.path.join(IMG, 'campus-djsanghvi-21sep-panel-v5-1200.webp'), format='WEBP', quality=80, method=6)

    for name in ('djsce-cover', 'jnu-cover'):
        cover = Image.open(os.path.join(IMG, 'reports', name + '.jpg')).convert('RGB')
        save(cover, os.path.join(IMG, 'reports', name + '.webp'), format='WEBP', quality=80, method=6)

    failed = []
    for domain in ORG_DOMAINS:
        url = f'https://www.google.com/s2/favicons?sz=64&domain={domain}'
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            data = urllib.request.urlopen(req, timeout=20).read()
            im = Image.open(io.BytesIO(data))
            im.load()
            if min(im.size) < 16:
                raise ValueError(f'too small: {im.size}')
            save(im.convert('RGBA'), os.path.join(IMG, 'org-logos', f'favicon-{domain}.png'), format='PNG', optimize=True)
        except Exception as e:  # keep going: a page may keep Google's URL for the one that failed
            failed.append(domain)
            print(f'  FAILED {domain}: {e}')
    if failed:
        print('[gen-phone-images] not fetched: ' + ', '.join(failed))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
