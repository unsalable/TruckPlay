// Renders the UI offscreen (the same path the game gets) and saves PNG snapshots.
// usage: electron tools/snap.mjs --out <dir> [--w 1282 --h 721] [--query demo] [--shots "name:js;name:js"]
//                                [--jpeg 92 --size 276x162]
//   each shot runs its JS in the page, waits, then captures <dir>/<name>.png (or .jpg, scaled to
//   --size: the mod's icon and the Workshop preview are made this way)

import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TileServer } from '../../shared/pmtiles.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const here = path.dirname(fileURLToPath(import.meta.url));
const w = Number(args.w ?? 1282);
const h = Number(args.h ?? 721);
const out = path.resolve(args.out ?? '.');
const query = args.query ?? 'demo';
const settle = Number(args.wait ?? 900);
// Shots are separated by "|": "name@ms:js" — optional per-shot wait, e.g. to catch an animation mid-flight.
const shots = (args.shots ?? 'home:').split('|').filter(Boolean).map(s => {
  const i = s.indexOf(':');
  const [name, ms] = s.slice(0, i).split('@');
  return { name, js: s.slice(i + 1), wait: ms ? Number(ms) : undefined };
});

app.disableHardwareAcceleration = undefined;
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const safeName = n => n.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'shot';
setTimeout(() => {
  console.error('snap: timed out');
  app.exit(2);
}, 120_000);

app.whenReady().then(run).catch(e => {
  console.error(`snap: ${e.stack ?? e}`);
  app.exit(1);
});

async function run() {
  // Same bridge as the host (preload + IPC), minus the game: map data and an empty music library.
  const tiles = new TileServer(path.join(here, '..', '..', 'map', 'data'), 'tirplay://');
  ipcMain.on('tp:send', () => {});
  ipcMain.handle('tp:invoke', async (_e, channel, ...a) => {
    if (channel === 'map:get') return tiles.handle(String(a[0] ?? ''));
    if (channel === 'music:list') return [];
    if (channel === 'host:size') return { w, h };
    if (channel === 'media:state' || channel === 'wall:list' || channel === 'web:suggest') return [];
    if (channel === 'media:cmd') return true;
    throw new Error(`unknown channel ${channel}`);
  });
  const win = new BrowserWindow({
    width: w,
    height: h,
    show: false,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      webviewTag: true,
      preload: path.join(here, '..', 'src', 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      additionalArguments: ['--tp-osr', '--tp-demo'],
    },
  });
  win.webContents.on('console-message', e => {
    if (e.level === 'error' || e.level === 'warning') console.error(`ui ${e.level}: ${e.message}`);
  });
  win.webContents.setFrameRate(60);
  let last = null;
  win.webContents.on('paint', (_e, _dirty, image) => {
    last = image;
  });
  const file = path.join(here, '..', '..', 'ui', 'dist', 'index.html');
  await win.loadFile(file, { search: query });
  await new Promise(r => setTimeout(r, 1400));
  fs.mkdirSync(out, { recursive: true });
  for (const shot of shots) {
    if (shot.js) {
      try {
        await win.webContents.executeJavaScript(shot.js);
      } catch (e) {
        console.error(`shot ${shot.name}: ${e.message}`);
      }
    }
    await new Promise(r => setTimeout(r, shot.wait ?? settle));
    if (shot.wait === undefined) {
      win.webContents.invalidate();
      await new Promise(r => setTimeout(r, 120));
    }
    let img = last ?? (await win.webContents.capturePage());
    const name = safeName(shot.name);
    if (args.size) {
      const [sw, sh] = args.size.split('x').map(Number);
      img = img.resize({ width: sw, height: sh, quality: 'best' });
    }
    const jpeg = args.jpeg !== undefined;
    fs.writeFileSync(path.join(out, `${name}.${jpeg ? 'jpg' : 'png'}`), jpeg ? img.toJPEG(Number(args.jpeg) || 92) : img.toPNG());
    console.log(`${name}.${jpeg ? 'jpg' : 'png'} ${img.getSize().width}x${img.getSize().height}`);
  }
  app.exit(0);
}
