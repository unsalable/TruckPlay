// Runs inside every page the in-car browser, YouTube and YouTube Music open. Tells the UI when a
// text field on the page takes the focus (so the plugin hands it the keyboard), what colour the
// page wants its surroundings to be (Safari tints its bar the same way), which way the page
// scrolls (the bar tucks away while reading) and what the page is playing. Also:
//  • full screen happens inside the page: a page in the browser's real full screen stops reaching
//    the offscreen window (the cab screen would freeze), so the element asked to go full screen
//    fills the page instead, and the UI gives the page the whole screen;
//  • with ad blocking on, YouTube's player is handed responses without ads, and an ad that still
//    slips through is skipped.
const { contextBridge, ipcRenderer } = require('electron');

const TEXT_INPUT = /^(text|search|email|url|tel|password|number|)$/i;
const editable = el =>
  Boolean(el) &&
  (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_INPUT.test(el.type || '')));

let editing = false;
function report() {
  const now = editable(document.activeElement);
  if (now === editing) return;
  editing = now;
  ipcRenderer.sendToHost('tp-edit', now); // TruckPlay's UI: ask the plugin for the keyboard
  ipcRenderer.send('tp:guest-edit', now); // the host: send the typed keys to this page
}
window.addEventListener('focusin', report, true);
window.addEventListener('focusout', () => setTimeout(report, 0), true);

function theme() {
  const meta = document.querySelector('meta[name="theme-color"]');
  ipcRenderer.sendToHost('tp-theme', meta?.content || '');
}
window.addEventListener('DOMContentLoaded', theme);

let lastY = 0;
let lastSent = 0;
window.addEventListener(
  'scroll',
  () => {
    const now = Date.now();
    if (now - lastSent < 90) return;
    const y = window.scrollY;
    if (Math.abs(y - lastY) < 12) return;
    ipcRenderer.sendToHost('tp-scroll', y > lastY ? 'down' : 'up', y);
    lastY = y;
    lastSent = now;
  },
  { passive: true, capture: true },
);

// Right click opens nothing in a page (a browser menu has no place on a cab screen).
window.addEventListener('contextmenu', e => e.preventDefault(), true);

// ---------- full screen inside the page ----------

// Runs in the page's own world, before its scripts.
function fullscreenInPage() {
  let current = null;
  const style = document.createElement('style');
  style.textContent =
    '[data-tp-fullscreen]{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;' +
    'max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;transform:none!important;' +
    'z-index:2147483647!important;background:#000!important}' +
    '[data-tp-fullscreen] video, video[data-tp-fullscreen]{object-fit:contain!important}' +
    // The player's video fills it whatever size the site last gave it (a site sizes it for its own
    // layout, which a page moved to another place or size may not have caught up with yet).
    '[data-tp-fullscreen] video{position:absolute!important;left:0!important;top:0!important;' +
    'width:100%!important;height:100%!important;margin:0!important;transform:none!important}' +
    'html[data-tp-fullscreen-page], html[data-tp-fullscreen-page] body{overflow:hidden!important}';
  const changed = el => {
    queueMicrotask(() => {
      for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
        el.dispatchEvent(new Event(type, { bubbles: true }));
      }
      window.dispatchEvent(new Event('resize'));
    });
  };
  const enter = el => {
    if (!(el instanceof Element)) return Promise.reject(new TypeError('not an element'));
    if (current === el) return Promise.resolve();
    if (current) current.removeAttribute('data-tp-fullscreen');
    current = el;
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
    el.setAttribute('data-tp-fullscreen', '');
    document.documentElement.setAttribute('data-tp-fullscreen-page', '');
    window.postMessage({ tpFullscreen: true }, '*');
    changed(el);
    return Promise.resolve();
  };
  const exit = () => {
    const el = current;
    if (!el) return Promise.resolve();
    current = null;
    el.removeAttribute('data-tp-fullscreen');
    document.documentElement.removeAttribute('data-tp-fullscreen-page');
    window.postMessage({ tpFullscreen: false }, '*');
    changed(el);
    return Promise.resolve();
  };
  const define = (proto, name, get) => Object.defineProperty(proto, name, { get, configurable: true });
  Element.prototype.requestFullscreen = function () {
    return enter(this);
  };
  Element.prototype.webkitRequestFullscreen = Element.prototype.webkitRequestFullScreen = function () {
    enter(this);
  };
  HTMLVideoElement.prototype.webkitEnterFullscreen = HTMLVideoElement.prototype.webkitEnterFullScreen = function () {
    enter(this);
  };
  Document.prototype.exitFullscreen = exit;
  Document.prototype.webkitExitFullscreen = Document.prototype.webkitCancelFullScreen = function () {
    exit();
  };
  define(Document.prototype, 'fullscreenElement', () => current);
  define(Document.prototype, 'webkitFullscreenElement', () => current);
  define(Document.prototype, 'webkitCurrentFullScreenElement', () => current);
  define(Document.prototype, 'fullscreenEnabled', () => true);
  define(Document.prototype, 'webkitFullscreenEnabled', () => true);
  define(Document.prototype, 'webkitIsFullScreen', () => Boolean(current));
  define(Document.prototype, 'fullscreen', () => Boolean(current));
  // Mobile players lock the screen to landscape on the way in; there is nothing to rotate here.
  if (window.screen?.orientation) window.screen.orientation.lock = () => Promise.resolve();
}

try {
  contextBridge.executeInMainWorld({ func: fullscreenInPage });
} catch {
  // Not available: the page keeps the browser's own full screen.
}
window.addEventListener('message', e => {
  if (e.source === window && e.data && typeof e.data.tpFullscreen === 'boolean') {
    ipcRenderer.sendToHost('tp-fullscreen', e.data.tpFullscreen);
  }
});

// ---------- YouTube without ads ----------

function youtubeWithoutAds() {
  const AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams', 'adBreakParams'];
  const prune = o => {
    if (!o || typeof o !== 'object') return o;
    for (const k of AD_KEYS) if (k in o) delete o[k];
    if (o.playerResponse && typeof o.playerResponse === 'object') prune(o.playerResponse);
    return o;
  };
  const parse = JSON.parse;
  JSON.parse = function (...args) {
    return prune(parse.apply(this, args));
  };
  const json = Response.prototype.json;
  Response.prototype.json = function (...args) {
    return json.apply(this, args).then(prune);
  };
  let initial;
  Object.defineProperty(window, 'ytInitialPlayerResponse', {
    configurable: true,
    get: () => initial,
    set: v => {
      initial = prune(v);
    },
  });
  // Whatever still gets through: skip it, or fast-forward through it silently.
  const style = document.createElement('style');
  style.textContent =
    'ytm-promoted-sparkles-web-renderer,ytm-promoted-video-renderer,ytm-companion-ad-renderer,ad-slot-renderer,' +
    'ytm-ad-slot-renderer,ytd-ad-slot-renderer,#player-ads,.video-ads,.ytp-ad-module,ytm-promoted-sparkles-text-search-renderer,' +
    'ytmusic-mealbar-promo-renderer,ytm-mealbar-promo-renderer{display:none!important}';
  const addStyle = () => (document.head || document.documentElement).appendChild(style);
  if (document.documentElement) addStyle();
  else document.addEventListener('DOMContentLoaded', addStyle);
  setInterval(() => {
    const skip = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytm-skip-ad-button');
    if (skip) skip.click();
    const player = document.querySelector('.ad-showing, .ad-interrupting');
    const video = player?.querySelector('video') ?? (player ? document.querySelector('video') : null);
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      video.muted = true;
      video.playbackRate = 16;
      if (video.currentTime < video.duration - 0.2) video.currentTime = video.duration - 0.1;
    }
  }, 300);
}

if (/(^|\.)youtube\.com$/.test(location.hostname)) {
  let adblock = true;
  try {
    adblock = ipcRenderer.sendSync('tp:adblock') !== false;
  } catch {
    // keep the default
  }
  if (adblock) {
    try {
      contextBridge.executeInMainWorld({ func: youtubeWithoutAds });
    } catch {
      // the network filters still apply
    }
  }
}

// ---------- what the page is playing ----------

// The UI shows a page's song or video in Now Playing and on the dashboard, from the page's media
// session (YouTube Music fills it in, so do most players) and its media element.
let lastMedia = '';
function media() {
  const el = [...document.querySelectorAll('video, audio')].find(m => !m.paused && m.readyState > 1) ?? document.querySelector('video, audio');
  const md = navigator.mediaSession?.metadata;
  const art = md?.artwork?.length ? md.artwork[md.artwork.length - 1].src : '';
  const state = {
    title: md?.title || '',
    artist: md?.artist || '',
    album: md?.album || '',
    art,
    playing: Boolean(el && !el.paused && !el.ended),
    pos: el ? el.currentTime : 0,
    dur: el && Number.isFinite(el.duration) ? el.duration : 0,
  };
  const key = JSON.stringify({ ...state, pos: Math.round(state.pos) });
  if (key === lastMedia) return;
  lastMedia = key;
  ipcRenderer.sendToHost('tp-media', state);
}
setInterval(media, 1000);
for (const type of ['play', 'pause', 'ended', 'loadedmetadata']) document.addEventListener(type, () => setTimeout(media, 50), true);
