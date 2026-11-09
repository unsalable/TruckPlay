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
import { MapFeed } from './mapfeed.js';
import { checkMod } from './modcheck.js';
import { Lyrics } from './lyrics.js';
import { PluginLink } from './pipe.js';
import { InputInjector } from './input.js';
import { MusicLibrary } from './music.js';
import { MediaSessions } from './media.js';
import { WallpaperPhotos } from './wallpapers.js';
import { attachWebviews, suggest, zoomWebviews } from './web.js';
import { AdBlock } from './adblock.js';
import { latestSave, profileRoots, saveInfo } from './saves.js';
import { frameFor, reloadScreens, screenFor } from './screens.js';
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
let size = { ...DEFAULT_SIZE }; // the cab screen's texture: the UI's layout, in CSS pixels
let frames = null;

// The resolution the UI is drawn at: the cab screen's own size times `scale`, the page zoomed by
// as much so its layout stays the same and only gains pixels (sharper in the big view and the F3
// panel; the plugin scales it down for the cab screen). 1x unless the driver picks more ('auto' is
// 1x: more pixels cost frames on most machines).
const displayFile = path.join(app.getPath('userData'), 'display.json');
const MAX_FRAME = 2600; // frames.js / plugin frames.h
let display = (() => {
  try {
    const d = JSON.parse(fs.readFileSync(displayFile, 'utf8'));
    return { scale: d.scale === 'auto' || [1, 1.5, 2].includes(d.scale) ? d.scale : 'auto' };
  } catch {
    return { scale: 'auto' };
  }
})();
let gameView = { w: 0, h: 0 }; // the game's picture, from the plugin
let gameViewSeen = 0;

// Split screen (the Split app): the F3 panel gets a part of its own, beside the cab screen's in the
// same page (CSS pixels), so a page can move between the two without reloading.
let split = { on: false, w: 0, h: 0 };
// Tells the plugin where the two parts are (frame pixels); set once the plugin link exists.
let sendLayout = () => {};

function scaleNow() {
  if (WINDOW) return 1;
  let s = display.scale === 'auto' ? 1 : display.scale;
  s = Math.min(s, MAX_FRAME / (size.w + (split.on ? split.w : 0)), MAX_FRAME / Math.max(size.h, split.on ? split.h : 0));
  return Math.max(1, s);
}

function uiUrl() {
  const search = new URLSearchParams();
  if (DEMO) search.set('demo', '1');
  if (DEV) return `http://localhost:5299/?${search}`;
  const file = path.join(here, '..', '..', 'ui', 'dist', 'index.html');
  return `${pathToFileURL(file).href}?${search}`;
}

let drawnAt = { w: 0, h: 0, scale: 0 };

/** Sizes the offscreen window to the screen times the resolution, the page zoomed to match. */
function applyDisplay() {
  if (!win || win.isDestroyed()) return;
  const scale = scaleNow();
  const w = Math.round((size.w + (split.on ? split.w : 0)) * scale);
  const h = Math.round(size.h * scale);
  if (w !== drawnAt.w || h !== drawnAt.h) win.setContentSize(w, h);
  if (scale !== drawnAt.scale) {
    win.webContents.setZoomFactor(scale);
    zoomWebviews(win.webContents, scale);
    // More pixels a frame, fewer frames: the copy into the game stays about as heavy.
    if (!WINDOW) win.webContents.setFrameRate(scale >= 2 ? 30 : scale > 1 ? 45 : 60);
  }
  if (w !== drawnAt.w || h !== drawnAt.h || scale !== drawnAt.scale) log(`drawn at ${w}x${h} (${scale}x, ${display.scale}${split.on ? ', split' : ''})`);
  drawnAt = { w, h, scale };
  win.webContents.send('tp:display', { setting: display.scale, scale, w: Math.round(size.w * scale), h, game: gameView });
  sendLayout();
}

function setScreenSize(w, h) {
  if (!w || !h || (w === size.w && h === size.h)) return;
  size = { w, h };
  log(`screen ${w}x${h}`);
  applyDisplay();
}

function createWindow() {
  const scale = scaleNow();
  win = new BrowserWindow({
    width: Math.round(size.w * scale),
    height: Math.round(size.h * scale),
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
      zoomFactor: scale,
      additionalArguments: [WINDOW ? '--tp-window' : '--tp-osr', ...(DEMO ? ['--tp-demo'] : [])],
    },
  });

  if (!WINDOW) {
    win.webContents.setFrameRate(60);
    win.webContents.on('paint', (_event, dirty, image) => {
      frames?.write(image, dirty);
    });
  }
  attachWebviews(win.webContents, here, () => drawnAt.scale || 1);
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
    () => drawnAt.scale || 1,
  );
  const toUi = (channel, msg) => {
    if (win && !win.isDestroyed()) win.webContents.send(`tp:${channel}`, msg);
  };
  // The plugin says hello and reports the screen once, on connect — possibly before the UI has
  // loaded. Keep the latest of each and replay them whenever the page (re)loads.
  const sticky = new Map();
  win.webContents.on('did-finish-load', () => {
    routing = false;
    // A reload may leave the page at its default zoom: the resolution again.
    drawnAt = { ...drawnAt, scale: 0 };
    applyDisplay();
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
  sendLayout = () => {
    const s = drawnAt.scale || 1;
    const main = { x: 0, y: 0, w: Math.round(size.w * s), h: Math.round(size.h * s) };
    const panel = split.on ? { x: main.w, y: 0, w: Math.round(split.w * s), h: Math.round(split.h * s) } : null;
    link.send({ t: 'layout', main, panel });
  };
  // The game's own GPS map (mapfeed.js): read while the UI shows it. `feedWant` is what the UI
  // asked the plugin for, sent again when the plugin reconnects.
  const mapFeed = new MapFeed(log);
  let feedWant = { on: false };
  let feedTimer = null;
  const setFeed = want => {
    feedWant = want?.on ? { on: true, w: Number(want.w) || 640, h: Number(want.h) || 480, zoom: Number(want.zoom) || 1, lift: Number(want.lift) || 0 } : { on: false };
    link.send({ t: 'mapfeed', ...feedWant });
    if (feedWant.on && !feedTimer) {
      feedTimer = setInterval(() => {
        const frame = mapFeed.read();
        if (frame) toUi('mapfeed', frame);
      }, 1000 / 30);
    } else if (!feedWant.on && feedTimer) {
      clearInterval(feedTimer);
      feedTimer = null;
    }
  };

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
    sticky.delete('mapfeed:status');
    toUi('disconnected', {});
    toUi('mapfeed:status', { ready: false });
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
        // A game update leaves a mod made for the old version out: make it for this one.
        checkMod({
          root: path.join(here, '..', '..'),
          gameVersion: msg.gameVersion,
          gameDir: msg.gameDir,
          documents: app.getPath('documents'),
          log,
          done: version => {
            reloadScreens();
            toUi('ev', { id: 'truckplay.mod', a: { version } });
          },
        });
        if (feedWant.on) link.send({ t: 'mapfeed', ...feedWant });
        sendLayout();
        break;
      case 'mapfeed':
        // Whether the game's map is coming (the plugin has seen the game draw it lately).
        sticky.set('mapfeed:status', msg);
        toUi('mapfeed:status', msg);
        break;
      case 'view':
        // The game's picture: what 'auto' resolution follows (once it settles).
        if (msg.w > 0 && msg.h > 0 && (msg.w !== gameView.w || msg.h !== gameView.h)) {
          gameView = { w: msg.w, h: msg.h };
          clearTimeout(gameViewSeen);
          gameViewSeen = setTimeout(applyDisplay, 1500);
        }
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

  media.on('message', msg => toUi('media', msg));
  // Lyrics for what plays (lyrics.js), kept on disk.
  const lyrics = new Lyrics(path.join(app.getPath('userData'), 'lyrics'), log);

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
      case 'split:set': {
        // The Split app: {on, w, h} (the F3 panel's part, CSS pixels).
        const v = args[0] ?? {};
        const on = Boolean(v.on) && v.w > 0 && v.h > 0;
        split = on ? { on, w: Math.round(v.w), h: Math.round(v.h) } : { on: false, w: 0, h: 0 };
        log(`split ${on ? `on (F3 panel ${split.w}x${split.h})` : 'off'}`);
        applyDisplay();
        return { ...split, main: { w: size.w, h: size.h } };
      }
      case 'display:scale': {
        // Settings > Resolution: 'auto', 1, 1.5 or 2.
        const v = args[0];
        if (v === 'auto' || [1, 1.5, 2].includes(v)) {
          if (v !== display.scale) {
            display = { scale: v };
            try {
              fs.writeFileSync(displayFile, JSON.stringify(display));
            } catch (e) {
              log(`display: ${e.message}`);
            }
          }
          applyDisplay();
        }
        return { setting: display.scale, scale: drawnAt.scale, w: drawnAt.w, h: drawnAt.h, game: gameView };
      }
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
      case 'lyrics:get':
        return lyrics.get(args[0]);
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
      case 'mapfeed:want':
        setFeed(args[0]);
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
    clearInterval(feedTimer);
    mapFeed.close();
  });
});

app.on('window-all-closed', () => app.quit());
