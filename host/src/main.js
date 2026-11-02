// TruckPlay host — the "phone" of this CarPlay. Renders the UI offscreen at the in-cab screen's
// texture size, hands every frame to the game plugin through shared memory, relays telemetry
// and turns the plugin's pointer/keyboard messages into input for the UI.
//
//   electron .            offscreen, for the game (default)
//   electron . --window   a normal window, for trying TruckPlay on the desktop
//   electron . --dev      load the Vite dev server instead of ui/dist
//   electron . --demo     demo drive instead of the game's telemetry
//   electron . --profile cab   separate settings and instance, for the test cab (plugin/test/testcab.cpp)

import { app, BrowserWindow, ipcMain, net, protocol, session } from 'electron';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FrameWriter } from './frames.js';
import { Hud } from './hud.js';
import { PluginLink } from './pipe.js';
import { InputInjector } from './input.js';
import { MusicLibrary } from './music.js';
import { MediaSessions } from './media.js';
import { WallpaperPhotos } from './wallpapers.js';
import { attachWebviews, suggest } from './web.js';
import { AdBlock } from './adblock.js';
import { latestSave, profileRoots, saveInfo } from './saves.js';
import { frameFor, screenFor } from './screens.js';
import { TileServer } from '../../shared/pmtiles.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WINDOW = process.argv.includes('--window');
const DEV = process.argv.includes('--dev');
const DEMO = process.argv.includes('--demo');
const PROFILE = (() => {
  const i = process.argv.indexOf('--profile');
  return i > 0 ? String(process.argv[i + 1] ?? '').replace(/[^\w-]/g, '') : '';
})();
const DEFAULT_SIZE = { w: 1282, h: 721 };

// A profile gets its own settings and its own single-instance lock, so the test cab's host can
// run while the game's host does.
if (PROFILE) app.setPath('userData', path.join(app.getPath('appData'), `tirplay-host-${PROFILE}`));

// The page is TruckPlay's own UI from disk; keep the host log for real problems.
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// TruckPlay's own radio and videos stay out of Windows' media sessions; those are what the Music
// app shows as "this PC", and TruckPlay would otherwise find itself there.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
protocol.registerSchemesAsPrivileged([
  { scheme: 'tpmedia', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } },
  { scheme: 'tpwall', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

// Another start (the game launched us again): if TruckPlay was updated since this host started,
// make way for the new version; otherwise carry on as we are.
const codeStamp = () => {
  try {
    return [path.join(here, 'main.js'), path.join(here, '..', '..', 'ui', 'dist', 'index.html')].map(f => fs.statSync(f).mtimeMs).join('|');
  } catch {
    return '';
  }
};
const startedStamp = codeStamp();
app.on('second-instance', () => {
  if (codeStamp() !== startedStamp) {
    log('updated since start: relaunching');
    app.relaunch();
    app.exit(0);
  }
});

const logFile = path.join(app.getPath('userData'), 'host.log');
// Launched by the game there is no console: the file comes first and nothing here may throw.
const log = (...a) => {
  const line = `${new Date().toISOString().slice(11, 23)} ${a.join(' ')}\n`;
  try {
    fs.appendFileSync(logFile, line);
  } catch {
    // nowhere left to report it
  }
  try {
    process.stdout.write(line);
  } catch {
    // no console attached
  }
};
process.on('uncaughtException', e => log(`uncaught: ${e?.stack ?? e}`));

let win = null;
let size = { ...DEFAULT_SIZE };
let frames = null;

function uiUrl() {
  const search = new URLSearchParams();
  if (DEMO) search.set('demo', '1');
  if (DEV) return `http://localhost:5299/?${search}`;
  const file = path.join(here, '..', '..', 'ui', 'dist', 'index.html');
  return `${pathToFileURL(file).href}?${search}`;
}

function setScreenSize(w, h) {
  if (!w || !h || (w === size.w && h === size.h)) return;
  size = { w, h };
  log(`screen ${w}x${h}`);
  win?.setContentSize(w, h);
}

function createWindow() {
  win = new BrowserWindow({
    width: size.w,
    height: size.h,
    useContentSize: true,
    show: WINDOW,
    resizable: WINDOW,
    title: 'TruckPlay',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      offscreen: !WINDOW,
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
      backgroundThrottling: false,
      additionalArguments: [WINDOW ? '--tp-window' : '--tp-osr', ...(DEMO ? ['--tp-demo'] : [])],
    },
  });

  if (!WINDOW) {
    win.webContents.setFrameRate(60);
    win.webContents.on('paint', (_event, dirty, image) => {
      frames?.write(image, dirty);
    });
  }
  attachWebviews(win.webContents, here);
  win.webContents.on('render-process-gone', (_e, d) => {
    log(`renderer gone (${d.reason}), reloading`);
    setTimeout(() => win?.loadURL(uiUrl()), 500);
  });
  win.webContents.on('console-message', e => {
    if (e.level === 'error' || e.level === 'warning') log(`ui ${e.level}: ${e.message}`);
  });
  win.loadURL(uiUrl());
}

app.whenReady().then(() => {
  log(`TruckPlay host ${app.getVersion()} — ${WINDOW ? 'window' : 'offscreen'}${DEV ? ', dev' : ''}${DEMO ? ', demo' : ''}`);

  const library = new MusicLibrary(
    [app.getPath('music'), path.join(app.getPath('documents'), 'Euro Truck Simulator 2', 'music')],
    path.join(app.getPath('userData'), 'covers'),
  );
  protocol.handle('tpmedia', req => {
    const file = library.resolve(req.url);
    if (!file) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).href, { headers: req.headers });
  });
  const documents = app.getPath('documents');
  const photos = new WallpaperPhotos(
    [
      { dir: path.join(documents, 'Euro Truck Simulator 2', 'screenshot'), source: 'ets2' },
      { dir: path.join(documents, 'American Truck Simulator', 'screenshot'), source: 'ets2' },
      { dir: app.getPath('pictures'), source: 'pictures' },
      { dir: path.join(app.getPath('pictures'), 'Wallpapers'), source: 'pictures' },
    ],
    path.join(app.getPath('userData'), 'wallpapers'),
  );
  protocol.handle('tpwall', req => photos.serve(req.url));

  // Web content opened from the in-car browser stays in the same view; no stray windows.
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(({ url }) => {
        contents.loadURL(url);
        return { action: 'deny' };
      });
    }
  });
  // Pages never get the browser's real full screen: it would stop reaching the offscreen window.
  // They go full screen inside themselves instead (webview-preload.cjs).
  const pages = session.fromPartition('persist:tirplay');
  pages.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  const adblock = new AdBlock(pages, app.getPath('userData'), log);
  // The pages' preload asks before a YouTube page starts whether to keep its ads out.
  ipcMain.on('tp:adblock', e => {
    e.returnValue = adblock.on;
  });

  if (!WINDOW) {
    try {
      frames = new FrameWriter();
      log('shared memory ready');
    } catch (e) {
      log(`shared memory failed: ${e.message}`);
    }
  }

  createWindow();
  let area = null; // UI rectangle inside the texture (null = whole texture)
  let screen = null; // the plugin's latest report of the cab screen's texture
  let fit = null; // the driver's own fit of the UI on a truck we have no measurements for
  let routing = false; // a live web page is on screen: the UI routes each pointer event
  const input = new InputInjector(
    () => win?.webContents,
    () => area ?? { x: 0, y: 0, w: size.w, h: size.h },
  );
  const toUi = (channel, msg) => {
    if (win && !win.isDestroyed()) win.webContents.send(`tp:${channel}`, msg);
  };
  // The plugin says hello and reports the screen once, on connect — possibly before the UI has
  // loaded. Keep the latest of each and replay them whenever the page (re)loads.
  const sticky = new Map();
  win.webContents.on('did-finish-load', () => {
    routing = false;
    for (const [channel, msg] of sticky) toUi(channel, msg);
  });

  // The UI fills the cab screen's texture, or the part of it the glass shows (see screens.js).
  function applyScreen() {
    if (!screen) return;
    const known = screenFor(screen.w, screen.h);
    const frame = frameFor(screen.w, screen.h, fit);
    log(`screen ${known?.id ?? 'unknown'} ${screen.w}x${screen.h}${frame ? ` frame ${JSON.stringify(frame)}` : ''}`);
    const screenMsg = { ...screen, screen: known?.id ?? null, frame, fitted: Boolean(frame && fit) };
    sticky.set('screen', screenMsg);
    toUi('screen', screenMsg);
    area = frame;
    // Pointer speed follows the shape of what is visible, not of the texture; the plugin also
    // needs that area to draw the pointer where the UI is.
    const shown = frame ?? { x: 0, y: 0, w: screen.w, h: screen.h };
    if (shown.w > 0 && shown.h > 0) {
      link.send({ t: 'cfg', aspect: shown.w / shown.h, fx: shown.x, fy: shown.y, fw: shown.w, fh: shown.h });
    }
  }

  // What the player owns and has marked on the game's map, from the newest save (the game saves
  // every few minutes while driving).
  const steamDir = (() => {
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true });
      return out.match(/SteamPath\s+REG_SZ\s+(.+)/)?.[1]?.trim();
    } catch {
      return undefined;
    }
  })();
  const saveRoots = profileRoots(app.getPath('documents'), steamDir ? [steamDir] : []);
  let saveSeen = 0;
  const readSave = () => {
    const latest = latestSave(saveRoots);
    if (!latest || latest.t === saveSeen) return;
    saveSeen = latest.t;
    try {
      const info = { ...saveInfo(latest.file), at: latest.t };
      sticky.set('save', info);
      toUi('save', info);
      log(`save: ${info.garages.length} garages owned, waypoints ahead: ${info.waypoints.length} single player, ${info.onlineWaypoints.length} multiplayer`);
    } catch (e) {
      log(`save: ${e.message}`);
    }
  };
  setTimeout(readSave, 2500);
  // The game writes an autosave every few minutes, also in a convoy: look often, read on change.
  setInterval(readSave, 8_000);


  const link = new PluginLink();
  // The HUD over the road (hud.js): only where there is a game picture to lay it over.
  const hud = WINDOW ? null : new Hud({ here, dev: DEV, log, send: m => link.send(m) });
  hud?.start();
  // The windshield HUD (hud.js too): the plugin shows it in the cab view only.
  const wind = WINDOW ? null : new Hud({ kind: 'wind', here, dev: DEV, log, send: m => link.send(m) });
  wind?.start();
  // Started for the game, the host leaves when the game does (a minute's grace for a restart);
  // the next game start brings a fresh one.
  let idleQuit = null;
  link.on('connected', () => {
    clearTimeout(idleQuit);
    log('plugin connected');
  });
  link.on('disconnected', () => {
    log('plugin disconnected');
    sticky.delete('hello');
    toUi('disconnected', {});
    if (!WINDOW && !PROFILE) {
      clearTimeout(idleQuit);
      idleQuit = setTimeout(() => {
        log('game closed: host closing');
        app.quit();
      }, 60_000);
    }
  });
  link.on('message', msg => {
    switch (msg.t) {
      case 'screen':
        screen = msg;
        if (msg.w > 0 && msg.h > 0) setScreenSize(msg.w, msg.h);
        applyScreen();
        break;
      case 'hello':
        sticky.set('hello', msg);
        toUi('hello', msg);
        hud?.sendCfg();
        break;
      case 'view':
        // The game's picture: the HUDs are sized to it.
        hud?.setView(msg.w, msg.h);
        wind?.setView(msg.w, msg.h);
        break;
      case 'ptr':
        if (routing) {
          // A web page is on screen: the UI says whether this event is its own or the page's.
          const p = input.point(msg);
          toUi('ptr', { ...msg, px: p.x, py: p.y });
        } else {
          input.pointer(msg);
          toUi('ptr', msg);
        }
        break;
      case 'key':
        if (msg.act === 'blur') toUi('key', msg);
        else input.key(msg);
        break;
      case 'stats':
        log(`stats ${JSON.stringify(msg)}`);
        break;
      case 'eval':
        // Test cab scripts drive the UI directly; never honoured in the game's own host.
        if (PROFILE && typeof msg.js === 'string') {
          win?.webContents.executeJavaScript(msg.js).catch(e => log(`eval: ${e.message}`));
        }
        break;
      case 'tel':
        toUi('tel', msg);
        break;
      default:
        toUi(msg.t, msg);
    }
  });

  // Map tiles and search data for the Maps app (map/data, filled by scripts/kur.ps1).
  const tiles = new TileServer(path.join(here, '..', '..', 'map', 'data'), 'tirplay://');

  // Spotify, Apple Music and the rest of what plays on the PC (plugin/media, built with the plugin).
  const media = new MediaSessions(path.join(here, '..', '..', 'plugin', 'build', 'truckplay-media.exe'), log);

  // The HUD's voice packs (scripts/voices.mjs makes them; ui/src/state/voice.ts plays them).
  const voicesDir = path.join(here, '..', '..', 'voices');
  const voicePacks = () => {
    const out = {};
    let dirs = [];
    try {
      dirs = fs.readdirSync(voicesDir, { withFileTypes: true }).filter(d => d.isDirectory());
    } catch {
      return out; // none installed
    }
    for (const d of dirs) {
      try {
        const info = JSON.parse(fs.readFileSync(path.join(voicesDir, d.name, 'pack.json'), 'utf8'));
        out[d.name] = { voice: String(info.voice ?? ''), provider: String(info.provider ?? '') };
      } catch {
        // half made: not offered
      }
    }
    return out;
  };
  media.on('message', msg => toUi('media', msg));

  ipcMain.on('tp:send', (_e, msg) => {
    // TruckPlay's own text field took the keyboard: keys go to the UI again, not to a page.
    if (msg?.t === 'typing' && msg.on && msg.src !== 'page') input.setKeyTarget(input.keyTarget, false);
    link.send(msg);
  });
  // A web page's text field took (or left) the focus: typed keys go straight to that page.
  ipcMain.on('tp:guest-edit', (e, on) => input.setKeyTarget(e.sender, Boolean(on)));
  // The UI's verdict on a pointer event while a web page is on screen.
  ipcMain.on('tp:route', (_e, msg) => {
    if (routing && msg && typeof msg.act === 'string') input.routed(msg);
  });
  ipcMain.handle('tp:invoke', async (_e, channel, ...args) => {
    switch (channel) {
      case 'music:list':
        return library.list();
      case 'host:size':
        return size;
      case 'ptr:route':
        // The pointer cannot reach a <webview>'s page through the offscreen window: while one
        // is on screen, the UI hit-tests every pointer event and the host delivers it.
        if (routing !== Boolean(args[0])) log(`pointer routing ${args[0] ? 'on' : 'off'}`);
        routing = Boolean(args[0]);
        if (!routing) input.leaveGuest();
        return routing;
      case 'screen:fit': {
        // The driver fitted the UI to this truck's glass by hand (generic screens only).
        const f = args[0];
        fit = f && [f.x, f.y, f.w, f.h].every(Number.isFinite) ? { x: f.x, y: f.y, w: f.w, h: f.h } : null;
        applyScreen();
        return true;
      }
      case 'map:get': {
        const r = await tiles.handle(String(args[0] ?? ''));
        if (r.error) log(`map ${args[0]}: ${r.error.message ?? r.error}`);
        return { status: r.status, type: r.type, body: r.body };
      }
      case 'media:state':
        return media.snapshot();
      case 'voice:packs':
        return voicePacks();
      case 'voice:clip': {
        // One phrase of an installed voice pack (voices/<lang>-<gender>/<phrase>.mp3).
        const [pack, key] = [String(args[0] ?? ''), String(args[1] ?? '')];
        if (!/^[a-z]{2}-(female|male)$/.test(pack) || !/^[a-z0-9.@]+$/i.test(key)) return null;
        try {
          return await fs.promises.readFile(path.join(voicesDir, pack, `${key}.mp3`));
        } catch {
          return null;
        }
      }
      case 'spotify:open':
        // Started minimized by the media helper (desktop or Microsoft Store version): no window in
        // front of the game. {ok:false} when it is not on this PC; the UI says so.
        return media.launch('spotify');
      case 'volume:report':
        media.reportVolumes();
        return true;
      case 'volume:set':
        media.volume(args[0], Array.isArray(args[1]) ? args[1] : []);
        return true;
      case 'media:cmd':
        media.command(args[0], args[1], args[2]);
        return true;
      case 'web:suggest':
        return suggest(args[0], args[1], args[2]);
      case 'hud:frame':
        hud?.frame(args[0]);
        return true;
      case 'hud:idle':
        hud?.idle();
        return true;
      case 'wind:frame':
        wind?.frame(args[0]);
        return true;
      case 'wind:idle':
        wind?.idle();
        return true;
      case 'hud:layout':
        hud?.setLayout(args[0]);
        wind?.setLayout(args[0]);
        return true;
      case 'adblock:set':
        await adblock.set(Boolean(args[0]));
        return adblock.active;
      case 'wall:list':
        return photos.list();
      default:
        throw new Error(`unknown channel ${channel}`);
    }
  });

  app.on('before-quit', () => {
    link.close();
    media.close();
    frames?.close();
    hud?.close();
    wind?.close();
  });
});

app.on('window-all-closed', () => app.quit());
