// Talks to the TruckPlay host (Electron preload exposes window.tirplay). Without a host, as in a
// plain browser during development, the demo drive stands in for the game.

import { connection, emitGameEvent, telemetry, type GameEvent, type Telemetry } from './telemetry';
import { startDemo, stopDemo } from './demo';
import { display, pointer, settings, split, type DisplayInfo } from './ui';
import { gameSave, type GameSave } from './save';

export interface ScreenInfo {
  w: number;
  h: number;
  layout?: string;
}

export interface HostBridge {
  on(channel: string, cb: (msg: any) => void): () => void;
  /** Forwarded to the game plugin. */
  send(msg: Record<string, unknown>): void;
  /** Request/response with the host process (music library, media sessions…). */
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  /** A pointer event's destination while a web page is on screen (see routeToPages). */
  route?(msg: Record<string, unknown>): void;
  info: { version: string; mode: 'osr' | 'window'; demo?: boolean };
}

declare global {
  interface Window {
    tirplay?: HostBridge;
  }
}

export const host: HostBridge | undefined = window.tirplay;

export function sendToPlugin(msg: Record<string, unknown>) {
  host?.send(msg);
}

export function startBridge() {
  pushAdblock();
  settings.subscribe(pushAdblock);
  if (host) {
    host.on('display', (d: DisplayInfo) => display.set(d));
    pushDisplay();
    settings.subscribe(pushDisplay);
  }
  const params = new URLSearchParams(location.search);
  const demo = !host || params.has('demo') || Boolean(host.info.demo);
  // The screen, pointer and keyboard come from the plugin even when the drive is a demo (test cab).
  if (host) listenToPlugin(host, demo);
  if (demo) {
    startDemo();
    return;
  }
  connection.set({ state: 'waiting' });
  let lastTel = 0;
  host!.on('tel', (t: Telemetry) => {
    lastTel = performance.now();
    if (connection.get().state !== 'live') connection.set({ ...connection.get(), state: 'live' });
    telemetry.set(t);
  });
  host!.on('ev', (e: GameEvent) => emitGameEvent(e));

  // The host may run before the game; fall back to showing the waiting state rather than stale data.
  window.setInterval(() => {
    if (connection.get().state === 'live' && performance.now() - lastTel > 3000) connection.set({ state: 'waiting' });
  }, 1000);
  stopDemo();
}

function listenToPlugin(h: HostBridge, demo: boolean) {
  h.on('hello', (m: { plugin?: string; sdk?: string; pointer?: boolean }) => {
    pointer.patch({ native: Boolean(m.pointer) });
    if (!demo) connection.set({ state: 'live', plugin: m.plugin, sdk: m.sdk });
    pushConfig(true);
  });
  h.on('disconnected', () => {
    pointer.patch({ native: false, visible: false, down: false });
    if (!demo) connection.set({ state: 'waiting' });
  });
  h.on('ptr', (p: PointerMsg) => {
    if (p.act === 'enter') pointer.patch({ visible: true });
    if (p.act === 'leave') pointer.patch({ visible: false, down: false });
    if (p.px !== undefined) routePointer(h, p);
  });
  h.on('save', (m: GameSave) =>
    gameSave.set({ garages: m.garages ?? [], hq: m.hq ?? '', waypoints: m.waypoints ?? [], onlineWaypoints: m.onlineWaypoints ?? [], at: m.at ?? 0 }),
  );
  // The plugin stopped capturing the keyboard (the game lost focus): leave the text field.
  h.on('key', (k: { act: string }) => {
    if (k.act === 'blur') (document.activeElement as HTMLElement | null)?.blur();
  });
  settings.subscribe(() => pushConfig());
}

// The plugin's part of the settings (its keys and the pointer's speed): sent when they change, not
// on every settings change (dragging the volume would send dozens a second).
let cfgSent = '';
function pushConfig(force = false) {
  const s = settings.get();
  const cfg = { t: 'cfg', holdVk: s.holdVk, zoomVk: s.zoomVk, sens: s.sens };
  const on = s.advisorScreen || split.get().on;
  const key = JSON.stringify(cfg) + on;
  if (!force && key === cfgSent) return;
  cfgSent = key;
  sendToPlugin(cfg);
  // The route advisor's TruckPlay panel (F3): a copy of the screen (or split screen's own part), or clear.
  sendToPlugin({ t: 'advisor', on });
}

// The resolution the host draws the UI at (Settings > Screen and keys).
let displaySent: string | null = null;
function pushDisplay() {
  const v = settings.get().screenScale ?? 'auto';
  if (!host || String(v) === displaySent) return;
  displaySent = String(v);
  void host
    .invoke('display:scale', v)
    .then((d: DisplayInfo) => d && display.set(d))
    .catch(() => {});
}

// The host keeps ads out of web pages while the setting is on.
let adblockSent: boolean | null = null;
function pushAdblock() {
  const on = settings.get().adblock;
  if (!host || on === adblockSent) return;
  adblockSent = on;
  void host.invoke('adblock:set', on).catch(() => {});
}

// ---------- pointer routing for web pages ----------

interface PointerMsg {
  act: string;
  x: number;
  y: number;
  b?: number;
  dy?: number;
  /** Set while routing: the event's page position (texture pixels). */
  px?: number;
  py?: number;
}

let livePages = 0;

/**
 * A <webview> page is on screen (on) or gone. The offscreen host cannot pass the mouse on to such
 * pages; while any is shown, the host hands every pointer event to us to route.
 */
export function routeToPages(on: boolean) {
  livePages = Math.max(0, livePages + (on ? 1 : -1));
  void host?.invoke('ptr:route', livePages > 0).catch(() => {});
}

type Route = { target: number | 'ui'; ox: number; oy: number };
let held: Route | null = null; // a press stays with what it started on until it is released

function routeFor(x: number, y: number): Route {
  const el = document.elementFromPoint(x, y) as (HTMLElement & { getWebContentsId?: () => number }) | null;
  if (el?.tagName === 'WEBVIEW' && el.getWebContentsId) {
    try {
      const r = el.getBoundingClientRect();
      return { target: el.getWebContentsId(), ox: r.left, oy: r.top };
    } catch {
      // not attached yet
    }
  }
  return { target: 'ui', ox: 0, oy: 0 };
}

function routePointer(h: HostBridge, p: PointerMsg) {
  const route = held ?? routeFor(p.px!, p.py!);
  if (p.act === 'down') held = route;
  // A press on a page never reaches the UI's own listeners: say so, for popovers that close on it.
  if (p.act === 'down' && route.target !== 'ui') window.dispatchEvent(new Event('tp-page-press'));
  if (p.act === 'up' || p.act === 'leave') held = null;
  h.route?.({ act: p.act, x: p.x, y: p.y, b: p.b, dy: p.dy, ...route });
}
