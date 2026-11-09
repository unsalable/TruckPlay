"""Builds the README's pictures (docs/img) from the test cab's captures.

  1. plugin/build/testcab.exe --marker 1282x794 --advisor --baremap <a map dump> --script plugin/test/readme-shots.txt
     (the host saves the UI, drawn at 2x, into %APPDATA%/tirplay-host-cab/captures)
  2. python tools/readme/build.py            (python tools/readme/build.py --installer: only the
     installer's two pictures, drawn by the installer itself: installer/, cargo build --release)

The designed pictures (hero, steps, button, split) are HTML pages in this folder, drawn by
Electron's own Chromium (render.cjs); the screenshots get rounded corners. Everything is written as
WebP (photos) and PNG (the button), small enough for a README. Needs Python 3 with Pillow, and
npm install in host/ and ui/ (Electron, the Inter font).
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WORK = HERE / 'work'
OUT = ROOT / 'docs' / 'img'
CAPTURES = Path(os.environ.get('APPDATA', '')) / 'tirplay-host-cab' / 'captures'
ELECTRON = ROOT / 'host' / 'node_modules' / 'electron' / 'dist' / 'electron.exe'

# Screenshot pictures: capture name -> (file, width in pixels).
SHOTS = {
    'maps-dark': 1280,
    'home-light': 1280,
    'nowplaying-dark': 1280,
    'apps-dark': 1280,
    'truck-dark': 1280,
    'job-dark': 1280,
}


def render(page, out, w, h, transparent=False):
    args = [str(ELECTRON), str(HERE / 'render.cjs'), str(HERE / page), str(out), str(w), str(h)]
    if transparent:
        args.append('transparent')
    subprocess.run(args, check=True, cwd=ROOT)


def rounded(im, radius, border=True):
    """The picture with round corners (outside them see-through) and a faint light edge, so a dark
    screenshot still stands apart on GitHub's dark page."""
    im = im.convert('RGBA')
    w, h = im.size
    scale = 4  # the mask drawn larger and shrunk: smooth corners
    mask = Image.new('L', (w * scale, h * scale), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w * scale - 1, h * scale - 1), radius * scale, fill=255)
    mask = mask.resize((w, h), Image.LANCZOS)
    if border:
        edge = Image.new('L', (w * scale, h * scale), 0)
        ImageDraw.Draw(edge).rounded_rectangle((0, 0, w * scale - 1, h * scale - 1), radius * scale, outline=255, width=2 * scale)
        edge = edge.resize((w, h), Image.LANCZOS)
        white = Image.new('RGBA', (w, h), (255, 255, 255, 255))
        im = Image.composite(Image.blend(im, white, 0.16), im, edge)
    im.putalpha(Image.composite(mask, Image.new('L', (w, h), 0), mask))
    return im


def save_webp(im, path, quality=86):
    im.save(path, 'WEBP', quality=quality, method=6)
    print(f'{path.relative_to(ROOT)}  {im.size[0]}x{im.size[1]}  {path.stat().st_size // 1024} KB')


def installer_pictures():
    """The installer's window (installer/, Rust) as it draws itself (--render, 2x), welcome and done,
    rounded like a window on Windows 11. No version in the corner: it would date them."""
    exe = ROOT / 'installer' / 'target' / 'release' / 'truckplay-setup.exe'
    out = WORK / 'installer'
    env = {**os.environ, 'TRUCKPLAY_SETUP_LANG': 'tr', 'TRUCKPLAY_SETUP_RENDER_VERSION': ''}
    subprocess.run([str(exe), '--render', str(out)], check=True, env=env)
    for name, shot in [('kurulum', 'tr-1-welcome'), ('kurulum-bitti', 'tr-6-done')]:
        im = Image.open(out / f'{shot}.png')
        save_webp(rounded(im, 24), OUT / f'{name}.webp', 90)


def main():
    WORK.mkdir(exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    if '--installer' in sys.argv:
        installer_pictures()
        return
    if CAPTURES.exists():
        for f in CAPTURES.glob('*.png'):
            shutil.copy2(f, WORK / f.name)
    missing = [n for n in [*SHOTS, 'home-dark', 'maps-light', 'split-dark'] if not (WORK / f'{n}.png').exists()]
    if missing:
        sys.exit(f'missing captures: {", ".join(missing)} (run the test cab script first)')

    # Split screen: the cab screen's part and the F3 panel's part of the one wide frame.
    split = Image.open(WORK / 'split-dark.png')
    sw, sh = split.size
    cab_w = round(sw * 1282 / (1282 + 642))
    split.crop((0, 0, cab_w, sh)).save(WORK / 'split-cab.png')
    split.crop((cab_w, 0, sw, round(sh * 559 / 794))).save(WORK / 'split-panel.png')

    # The designed pictures, at 2x.
    for page, name, w, h in [('hero.html', 'hero', 1600, 800), ('steps.html', 'steps', 1600, 500), ('split.html', 'split', 1600, 760)]:
        png = WORK / f'out-{name}.png'
        render(page, png, w, h)
        im = Image.open(png).convert('RGBA')
        im = im.resize((im.width * 5 // 8, im.height * 5 // 8), Image.LANCZOS)  # 2000 wide
        save_webp(im, OUT / f'{name}.webp', 88)

    png = WORK / 'out-button.png'
    render('button.html', png, 560, 136, transparent=True)
    im = Image.open(png).convert('RGBA')
    im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
    im.save(OUT / 'indir.png', optimize=True)
    print(f'docs/img/indir.png  {im.size[0]}x{im.size[1]}  {(OUT / "indir.png").stat().st_size // 1024} KB')

    # The screenshots, rounded.
    for name, width in SHOTS.items():
        im = Image.open(WORK / f'{name}.png')
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        save_webp(rounded(im, round(width * 0.028)), OUT / f'{name}.webp')

    installer_pictures()


if __name__ == '__main__':
    main()
