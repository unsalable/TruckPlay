"""The installer's typeface: Inter, as TruckPlay's UI uses it, cut down to what the installer shows.

The UI ships Inter as two variable woff2 files split by script (ui/node_modules/@fontsource-variable/
inter: latin, latin-ext; Turkish needs both). This makes three static TrueType fonts (400, 600, 700)
with both halves merged and only the Latin letters, punctuation and arrows kept (~40 KB each), named
"TruckPlay Inter" so DirectWrite finds them by family and weight.

    python installer/fonts/make-fonts.py      (needs: pip install fonttools brotli)
"""
import os
import sys
import tempfile

from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(ROOT, 'ui', 'node_modules', '@fontsource-variable', 'inter', 'files')
PARTS = ['inter-latin-wght-normal.woff2', 'inter-latin-ext-wght-normal.woff2']
WEIGHTS = {400: 'Regular', 600: 'SemiBold', 700: 'Bold'}
FAMILY = 'TruckPlay Inter'
# Basic Latin, Latin-1, Latin Extended-A (ğ ı İ ş), general punctuation, arrows, minus, check mark.
UNICODES = (
    list(range(0x20, 0x7F))
    + list(range(0xA0, 0x180))
    + list(range(0x2010, 0x2028))
    + [0x2030, 0x2039, 0x203A, 0x2044, 0x20AC, 0x2122, 0x2190, 0x2192, 0x2193, 0x2191, 0x2212, 0x2713]
)


def rename(font, weight):
    style = WEIGHTS[weight]
    # Family by weight, the way DirectWrite groups static fonts: one family, three weights.
    names = {
        1: FAMILY,
        2: 'Regular' if weight == 400 else ('Bold' if weight == 700 else 'Regular'),
        3: f'{FAMILY} {style}',
        4: f'{FAMILY} {style}',
        6: f'TruckPlayInter-{style}',
        16: FAMILY,
        17: style,
    }
    if weight == 600:
        names[1] = f'{FAMILY} SemiBold'
    name = font['name']
    name.names = [n for n in name.names if n.nameID not in names and n.nameID not in (25,)]
    for nid, text in names.items():
        name.setName(text, nid, 3, 1, 0x409)
    os2 = font['OS/2']
    os2.usWeightClass = weight
    bold = weight == 700
    os2.fsSelection = (os2.fsSelection & ~0b1100001) | (0b100000 if bold else 0b1000000)
    font['head'].macStyle = 1 if bold else 0


def main():
    with tempfile.TemporaryDirectory() as tmp:
        for weight in WEIGHTS:
            parts = []
            for i, part in enumerate(PARTS):
                font = TTFont(os.path.join(SRC, part))
                font = instancer.instantiateVariableFont(font, {'wght': weight})
                font.flavor = None
                path = os.path.join(tmp, f'{weight}-{i}.ttf')
                font.save(path)
                parts.append(path)
            merged = Merger().merge(parts)
            options = subset.Options()
            options.layout_features = ['kern', 'liga', 'calt', 'ccmp', 'locl', 'mark', 'mkmk', 'cv11', 'ss03', 'case', 'tnum']
            options.name_IDs = ['*']
            options.notdef_outline = True
            options.drop_tables += ['STAT', 'fvar', 'gvar', 'avar', 'HVAR', 'MVAR']
            sub = subset.Subsetter(options)
            sub.populate(unicodes=UNICODES)
            sub.subset(merged)
            rename(merged, weight)
            out = os.path.join(HERE, f'Inter-{WEIGHTS[weight]}.ttf')
            merged.save(out)
            cmap = merged.getBestCmap()
            missing = [hex(u) for u in (0x11F, 0x131, 0x130, 0x15F, 0x15E, 0xE7, 0xF6, 0xFC, 0x2026, 0x203A) if u not in cmap]
            print(f'{out}: {os.path.getsize(out)} bytes, {len(cmap)} characters, missing: {missing or "none"}')


if __name__ == '__main__':
    sys.exit(main())
