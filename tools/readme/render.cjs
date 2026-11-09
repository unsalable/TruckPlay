// Renders one of the README's designed pictures (an HTML page in this folder) to a PNG, at twice
// its CSS size, with Electron's own offscreen Chromium (the same engine the UI runs in):
//
//   electron tools/readme/render.cjs <page.html> <out.png> <css width> <css height> [transparent]
//
// "transparent" keeps the page's background see-through (a button that sits on GitHub's light and
// dark page alike). tools/readme/build.py runs it for every page.

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SCALE = 2;
const args = process.argv.slice(process.argv.findIndex(a => a.endsWith('render.cjs')) + 1);
const [page, out, cssW, cssH, mode] = args;
const w = Number(cssW);
const h = Number(cssH);
const transparent = mode === 'transparent';

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-gpu-vsync');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: w * SCALE,
    height: h * SCALE,
    useContentSize: true,
    enableLargerThanScreen: true,
    frame: false,
    transparent,
    backgroundColor: transparent ? '#00000000' : '#000000',
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(30);
  // A window larger than the screen keeps its size only when asked again after it exists.
  win.setContentSize(w * SCALE, h * SCALE);
  await win.loadFile(path.resolve(page));
  win.webContents.setZoomFactor(SCALE);
  // Fonts, pictures and one more frame, then the picture.
  await win.webContents.executeJavaScript(
    'Promise.all([document.fonts.ready, ...[...document.images].map(i => i.decode().catch(() => {}))]).then(() => new Promise(r => setTimeout(r, 600)))',
  );
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  const s = img.getSize();
  console.log(`${path.basename(out)} ${s.width}x${s.height}`);
  app.quit();
});
