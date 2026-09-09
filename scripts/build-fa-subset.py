#!/usr/bin/env python3
"""Build the self-hosted Font Awesome subset that public/css/fa-subset.css serves.

Why this exists: the pages used to pull 360 KB of Font Awesome from jsdelivr on
every load. public/sw.js deliberately ignores cross-origin requests (a CDN blip
must never poison the offline cache), so when the venue WiFi drops, every icon
on the site disappears at once. Self-hosting moves the files onto our origin,
where the service worker's existing stale-while-revalidate branch already covers
them; subsetting them to the ~250 glyphs we actually draw makes that cheap.

Run it after adding or removing any fa- icon anywhere in the repo:

    python scripts/build-fa-subset.py            # rebuild css + woff2
    python scripts/build-fa-subset.py --check    # verify, touch nothing

--check is the guard rail. An icon that was never subsetted renders as a blank
box, not an error, so nothing else in the stack will tell you it broke.

Requires fontTools (pip install fonttools brotli) and network access on the
first run; the upstream sources are cached under node_modules/.cache/.
"""

import glob
import gzip
import os
import re
import subprocess
import sys
import urllib.request

from fontTools.ttLib import TTFont

FA_VERSION = '6.4.0'
CDN = f'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@{FA_VERSION}'

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'node_modules', '.cache', f'fontawesome-{FA_VERSION}')
CSS_OUT = os.path.join(ROOT, 'public', 'css', 'fa-subset.css')
FONT_DIR = os.path.join(ROOT, 'public', 'webfonts')

BS = chr(92)  # backslash, kept out of the f-strings below

# Every face we ship, and the .ttf it is cut from. Subset from the .ttf and NOT
# the .woff2: 6.4.0's shipped fa-regular-400.woff2 is malformed for fontTools
# ("extra bytes at the end of 'head' table") and pyftsubset aborts on it.
FACES = ('fa-solid-900', 'fa-brands-400', 'fa-regular-400')

# FA's utility classes: styling, animation and sizing, not glyphs. They share the
# fa- prefix so the token sweep picks them up; none of them has a codepoint.
MOD = {
    'fa-solid', 'fa-regular', 'fa-brands', 'fa-light', 'fa-thin', 'fa-duotone',
    'fa-sharp', 'fa-classic', 'fa-lg', 'fa-sm', 'fa-xs', 'fa-xl', 'fa-2xs',
    'fa-fw', 'fa-ul', 'fa-li', 'fa-border', 'fa-pull-left', 'fa-pull-right',
    'fa-spin', 'fa-pulse', 'fa-inverse', 'fa-stack', 'fa-stack-1x', 'fa-stack-2x',
    'fa-beat', 'fa-fade', 'fa-bounce', 'fa-shake', 'fa-flip', 'fa-spin-pulse',
    'fa-spin-reverse', 'fa-beat-fade', 'fa-rotate-by', 'fa-swap-opacity',
    'fa-sr-only', 'fa-sr-only-focusable',
    'fa-rotate-90', 'fa-rotate-180', 'fa-rotate-270',
    'fa-flip-horizontal', 'fa-flip-vertical', 'fa-flip-both',
}
MOD |= {f'fa-{n}x' for n in range(2, 11)}

# Names no text search can see, because nothing in the repo ever spells them out.
# Drop one of these and you lose an icon with no build error to warn you.
EXTRA = {
    'fa-sort-up', 'fa-sort-down',                # index.tsx  'fas fa-sort-' + dir
    'fa-sort-amount-up', 'fa-sort-amount-down',  # index.tsx  'fas fa-sort-amount-' + dir
    'fa-sun', 'fa-moon',                         # sessionSection()/renderSection() pass 'sun'/'moon'
    'fa-exclamation-circle', 'fa-check-circle',  # toast() splits the name across a ternary
    # booth_types.icon lives in D1, so it reaches the page without passing
    # through any source file. These eight are the values production holds.
    'fa-gem', 'fa-seedling', 'fa-store', 'fa-building',
    'fa-compass', 'fa-crown', 'fa-lightbulb', 'fa-rocket',
}

# The repo's only `far` usage: the hollow half of the rating stars in the
# marketplace dashboard reviews table. Without it they render filled.
REGULAR = ['fa-star']


def fetch(rel, dest):
    """Cache one upstream file. Nothing here changes between builds."""
    if not os.path.exists(dest):
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with urllib.request.urlopen(f'{CDN}/{rel}', timeout=60) as r, open(dest, 'wb') as f:
            f.write(r.read())
    return dest


def sources():
    css = {n: fetch(f'css/{n}.min.css', os.path.join(CACHE, f'{n}.min.css'))
           for n in ('all', 'brands')}
    ttf = {n: fetch(f'webfonts/{n}.ttf', os.path.join(CACHE, f'{n}.ttf')) for n in FACES}
    woff = {n: fetch(f'webfonts/{n}.woff2', os.path.join(CACHE, f'{n}.woff2')) for n in FACES}
    return css, ttf, woff


def codepoints(path):
    """name -> hex codepoint, read straight out of FA's own stylesheet."""
    css = open(path, encoding='utf-8').read()
    out = {}
    for m in re.finditer(r'((?:\.fa-[a-z0-9-]+:{1,2}before\s*,?\s*)+)\{content:"([^"]+)"\}', css):
        code = m.group(2).replace(BS, '').strip()
        if re.fullmatch(r'[0-9a-fA-F]{2,5}', code):
            for n in re.findall(r'\.(fa-[a-z0-9-]+):{1,2}before', m.group(1)):
                out[n] = code.lower()
    return out


def allowlist(all_cp, brands_cp):
    """Every icon name any page can emit, split by face.

    A FLAT token sweep on purpose. Parsing class="..." attributes looks tidier
    and silently loses fa-exchange-alt, fa-percent and fa-right-to-bracket,
    which are assembled into class strings an attribute parser never sees.
    Face assignment then needs no parsing at all: a name is a brand icon iff
    brands.min.css defines it.
    """
    src = ([os.path.join(ROOT, 'src', 'index.tsx')]
           + glob.glob(os.path.join(ROOT, 'src', 'routes', '*.ts'))
           + glob.glob(os.path.join(ROOT, 'public', '*.html'))
           + glob.glob(os.path.join(ROOT, 'public', 'js', '*.js'))
           + glob.glob(os.path.join(ROOT, 'public', 'static', '*.js'))
           + glob.glob(os.path.join(ROOT, 'public', 'static', '*.css'))
           + glob.glob(os.path.join(ROOT, 'public', 'css', 'style.css'))
           + glob.glob(os.path.join(ROOT, 'public', 'css', 'campus-panel.css'))
           + glob.glob(os.path.join(ROOT, 'migrations', '*.sql'))
           + [os.path.join(ROOT, 'seed.sql')])
    tok = re.compile(r'\bfa-[a-z0-9]+(?:-[a-z0-9]+)*')
    found = set()
    for f in src:
        if os.path.exists(f):
            found |= set(tok.findall(open(f, encoding='utf-8', errors='replace').read()))

    cand = (found - MOD) | EXTRA
    # Fragments like 'fa-sort-amount' (the literal prefix of a concatenation)
    # are not icons. Reported, then dropped.
    unknown = sorted(n for n in cand if n not in all_cp)
    names = sorted(n for n in cand if n in all_cp)
    brands = sorted(n for n in names if n in brands_cp)
    solid = sorted(n for n in names if n not in brands_cp)
    return names, solid, brands, unknown, len(found)


def stylesheet(all_cp, names):
    # The Font Awesome Free license (SIL OFL 1.1 / CC BY 4.0 / MIT) requires the
    # attribution to travel with the files once we self-host them. Keep it.
    head = (
        f'/*! Font Awesome Free {FA_VERSION} subset - fontawesome.com - @fontawesome\n'
        ' *  License: SIL OFL 1.1 (fonts), CC BY 4.0 (icons), MIT (code)\n'
        ' *  Generated by scripts/build-fa-subset.py - DO NOT EDIT BY HAND. */\n'
        # No ?v= on the font URLs, unlike the stylesheet link: public/sw.js
        # precaches these exact paths, and a query string would make the
        # precached entry miss the request the browser actually sends.
        '@font-face{font-family:"Font Awesome 6 Free";font-style:normal;font-weight:900;'
        'font-display:block;src:url(/webfonts/fa-solid-900.woff2) format("woff2")}'
        '@font-face{font-family:"Font Awesome 6 Free";font-style:normal;font-weight:400;'
        'font-display:block;src:url(/webfonts/fa-regular-400.woff2) format("woff2")}'
        '@font-face{font-family:"Font Awesome 6 Brands";font-style:normal;font-weight:400;'
        'font-display:block;src:url(/webfonts/fa-brands-400.woff2) format("woff2")}'
        '.fa,.fa-brands,.fa-regular,.fa-solid,.fab,.far,.fas{-moz-osx-font-smoothing:grayscale;'
        '-webkit-font-smoothing:antialiased;display:var(--fa-display,inline-block);'
        'font-style:normal;font-variant:normal;line-height:1;text-rendering:auto}'
        '.fa,.fa-solid,.fas{font-family:"Font Awesome 6 Free";font-weight:900}'
        '.fa-regular,.far{font-family:"Font Awesome 6 Free";font-weight:400}'
        '.fa-brands,.fab{font-family:"Font Awesome 6 Brands";font-weight:400}'
        # fa-spin is the only animation the repo uses (35 sites, all spinners).
        '.fa-spin{-webkit-animation-name:fa-spin;animation-name:fa-spin;'
        '-webkit-animation-duration:var(--fa-animation-duration,2s);'
        'animation-duration:var(--fa-animation-duration,2s);'
        '-webkit-animation-iteration-count:var(--fa-animation-iteration-count,infinite);'
        'animation-iteration-count:var(--fa-animation-iteration-count,infinite);'
        '-webkit-animation-timing-function:var(--fa-animation-timing,linear);'
        'animation-timing-function:var(--fa-animation-timing,linear)}'
        '@media (prefers-reduced-motion:reduce){.fa-spin{-webkit-animation-delay:-1ms;'
        'animation-delay:-1ms;-webkit-animation-duration:1ms;animation-duration:1ms;'
        '-webkit-animation-iteration-count:1;animation-iteration-count:1}}'
        '@keyframes fa-spin{0%{-webkit-transform:rotate(0deg);transform:rotate(0deg)}'
        'to{-webkit-transform:rotate(1turn);transform:rotate(1turn)}}'
    )
    groups = {}
    for n in names:
        groups.setdefault(all_cp[n], []).append(n)
    body = ''.join(','.join(f'.{n}::before' for n in v) + '{content:"' + BS + k + '"}'
                   for k, v in sorted(groups.items()))
    return head + body


def build():
    css_src, ttf, woff = sources()
    all_cp = codepoints(css_src['all'])
    brands_cp = set(codepoints(css_src['brands']))
    names, solid, brands, unknown, swept = allowlist(all_cp, brands_cp)

    print(f'tokens swept          : {swept}')
    print(f'not real FA icons     : {unknown}  <- concatenation fragments, ignored')
    print(f'allowlist             : {len(names)}  '
          f'(solid {len(solid)} / brands {len(brands)} / regular {len(REGULAR)})')
    print(f'brand icons           : {brands}')

    os.makedirs(FONT_DIR, exist_ok=True)
    before = after = 0
    for face, group in (('fa-solid-900', solid), ('fa-brands-400', brands),
                        ('fa-regular-400', REGULAR)):
        codes = sorted({all_cp[n] for n in group})
        out = os.path.join(FONT_DIR, f'{face}.woff2')
        r = subprocess.run(
            [sys.executable, '-m', 'fontTools.subset', ttf[face],
             '--unicodes=' + ','.join('U+' + c.upper() for c in codes),
             '--flavor=woff2', '--layout-features=', '--no-hinting',
             '--output-file=' + out],
            capture_output=True, text=True)
        assert r.returncode == 0, r.stderr[-800:]
        a, b = os.path.getsize(woff[face]), os.path.getsize(out)
        before += a
        after += b
        cmap = TTFont(out).getBestCmap()
        lost = [n for n in group if int(all_cp[n], 16) not in cmap]
        assert not lost, f'{face}: subset dropped {lost}'
        print(f'{face:16s} {a:>8,} -> {b:>7,}   {len(group):>3} names / {len(codes):>3} glyphs')
    print(f'{"FONT TOTAL":16s} {before:>8,} -> {after:>7,}   '
          f'(-{before - after:,} B, -{100 * (before - after) / before:.1f}%)')

    out = stylesheet(all_cp, names)
    os.makedirs(os.path.dirname(CSS_OUT), exist_ok=True)
    open(CSS_OUT, 'w', encoding='utf-8', newline='\n').write(out)
    raw = out.encode()
    orig = os.path.getsize(css_src['all'])
    print(f'{"fa-subset.css":16s} {orig:>8,} -> {len(raw):>7,}   '
          f'({len(gzip.compress(raw, 9)):,} gzip)')


def check():
    """Fail loudly if any icon the repo can emit has no glyph to draw."""
    css_src, ttf, woff = sources()
    all_cp = codepoints(css_src['all'])
    brands_cp = set(codepoints(css_src['brands']))
    names, solid, brands, _unknown, _ = allowlist(all_cp, brands_cp)

    if not os.path.exists(CSS_OUT):
        sys.exit('FAIL: public/css/fa-subset.css is missing - run without --check')
    css = open(CSS_OUT, encoding='utf-8').read()
    ruled = {m[1] for m in re.finditer(r'\.(fa-[a-z0-9-]+)::before', css)}

    cmaps = {}
    for face in FACES:
        p = os.path.join(FONT_DIR, f'{face}.woff2')
        if not os.path.exists(p):
            sys.exit(f'FAIL: public/webfonts/{face}.woff2 is missing')
        cmaps[face] = TTFont(p).getBestCmap()

    fail = []
    for face, group in (('fa-solid-900', solid), ('fa-brands-400', brands),
                        ('fa-regular-400', REGULAR)):
        for n in group:
            if n not in ruled:
                fail.append(f'{n}: no ::before rule in fa-subset.css')
            elif int(all_cp[n], 16) not in cmaps[face]:
                fail.append(f'{n}: U+{all_cp[n].upper()} missing from {face}.woff2')

    # And the other direction: a rule pointing at a codepoint no face carries
    # would draw a blank box just as effectively.
    for m in re.finditer(r'((?:\.fa-[a-z0-9-]+::before,?)+)\{content:"' + BS * 2 + r'([0-9a-f]{2,5})"\}', css):
        cp = int(m.group(2), 16)
        if not any(cp in c for c in cmaps.values()):
            fail.append(f'{m.group(1)}: U+{m.group(2).upper()} has no glyph in any face')

    print(f'{len(names)} icon names / {len(ruled)} css rules / '
          f'{sum(len(c) for c in cmaps.values())} glyphs')
    if fail:
        print('FAIL')
        for f in fail:
            print(' ', f)
        sys.exit(1)
    print('PASS - every icon the repo can emit resolves to a glyph')


if __name__ == '__main__':
    check() if '--check' in sys.argv else build()
