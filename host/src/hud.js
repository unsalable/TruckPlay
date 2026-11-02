// The HUDs over the road: offscreen windows showing ui/dist/hud.html, their frames written to
// shared memory channels of their own that the plugin lays over the game's picture (see
// shared/protocol.md). Two kinds: the card over the road (top or bottom of the picture), and the
// windshield HUD, which the plugin places in the windshield and shows in the cab view only. The
// main UI decides what they say (ui/src/state/hud.ts); these windows only draw it, at the size it
// will have on the game's screen.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow } from 'electron';
import { FrameWriter, channel } from './frames.js';

const KINDS = {
  // The page's size in CSS pixels, the height of what it shows in the page, and that height on
  // the game's screen as a share of the screen's height.
  card: { page: { w: 620, h: 230 }, content: 112, share: { s: 0.085, m: 0.105, l: 0.13 }, query: '' },
  wind: { page: { w: 600, h: 200 }, content: 118, share: { s: 0.075, m: 0.09, l: 0.11 }, query: '?view=wind' },
};

// How far below the line of sight the windshield HUD's image sits, in degrees.
const DROP = { low: 9, mid: 6.5, high: 4 };

export class Hud {
  constructor({ kind = 'card', here, dev, log, send }) {
    this.kind = kind;
    this.spec = KINDS[kind];
    this.here = here;
    this.dev = dev;
    this.log = log;
    this.send = send; // a message to the plugin
    this.view = { w: 2560, h: 1440 };
    this.layout = { pos: 'top', size: 'm', wind: false, windHeight: 'mid', advisor: false };
    this.win = null;
    this.writer = null;
    this.visible = false;
  }

  start() {
    try {
      this.writer = new FrameWriter(channel(this.kind === 'wind' ? 'wind' : 'hud'));
    } catch (e) {
      this.log(`${this.kind}: shared memory failed: ${e.message}`);
      return;
    }
    const { w, h, zoom } = this.dims();
    this.win = new BrowserWindow({
      width: w,
      height: h,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        offscreen: true,
        preload: path.join(this.here, 'preload.cjs'),
        contextIsolation: true,
        sandbox: false,
        backgroundThrottling: false,
        zoomFactor: zoom,
      },
    });
    const wc = this.win.webContents;
    wc.setFrameRate(60);
    wc.on('paint', (_e, dirty, image) => this.writer?.write(image, dirty));
    wc.on('did-finish-load', () => wc.setZoomFactor(this.dims().zoom));
    wc.on('render-process-gone', (_e, d) => {
      this.log(`${this.kind} renderer gone (${d.reason}), reloading`);
      setTimeout(() => this.load(), 500);
    });
    wc.on('console-message', e => {
      if (e.level === 'error') this.log(`${this.kind} error: ${e.message}`);
    });
    this.load();
  }

  load() {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.dev) void this.win.loadURL(`http://localhost:5299/hud.html${this.spec.query}`);
    else void this.win.loadURL(`${pathToFileURL(path.join(this.here, '..', '..', 'ui', 'dist', 'hud.html')).href}${this.spec.query}`);
  }

  dims() {
    const { page, content, share } = this.spec;
    const shown = Math.max(60, this.view.h * (share[this.layout.size] ?? share.m));
    const zoom = shown / content;
    return { w: Math.round(page.w * zoom), h: Math.round(page.h * zoom), zoom };
  }

  resize() {
    if (!this.win || this.win.isDestroyed()) return;
    const { w, h, zoom } = this.dims();
    this.win.setContentSize(w, h);
    this.win.webContents.setZoomFactor(zoom);
    this.log(`${this.kind} ${w}x${h} (zoom ${zoom.toFixed(2)}) on a ${this.view.w}x${this.view.h} screen`);
  }

  /** The size of the game's picture, from the plugin. */
  setView(w, h) {
    if (!w || !h || (w === this.view.w && h === this.view.h)) return;
    this.view = { w, h };
    this.resize();
  }

  /** What the driver set (Settings): where the card goes and how big the HUDs are, the
   *  windshield HUD and the route advisor's panel. */
  setLayout({ pos, size, wind, windHeight, advisor } = {}) {
    const next = {
      pos: pos === 'bottom' ? 'bottom' : 'top',
      size: this.spec.share[size] ? size : 'm',
      wind: !!wind,
      windHeight: DROP[windHeight] ? windHeight : 'mid',
      advisor: !!advisor,
    };
    const resized = next.size !== this.layout.size;
    this.layout = next;
    if (resized) this.resize();
    this.sendCfg();
  }

  sendCfg() {
    // The card's window speaks for both (the plugin keeps one setting each).
    if (this.kind !== 'card') return;
    this.send({ t: 'hud', pos: this.layout.pos });
    this.send({ t: 'wind', on: this.layout.wind, drop: DROP[this.layout.windHeight] });
    this.send({ t: 'advisor', on: this.layout.advisor });
  }

  /** What the HUD shows now (from the UI). */
  frame(f) {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send('tp:hud', f);
    const shows = this.kind === 'wind' ? f?.on : f?.show;
    if (shows && !this.visible) {
      this.visible = true;
      this.writer?.setVisible(true);
    }
  }

  /** It has left (its exit animation is over): the plugin can stop drawing it. */
  idle() {
    if (!this.visible) return;
    this.visible = false;
    this.writer?.setVisible(false);
  }

  close() {
    try {
      this.writer?.setVisible(false);
      this.writer?.close();
    } catch {
      // closing at exit
    }
  }
}
