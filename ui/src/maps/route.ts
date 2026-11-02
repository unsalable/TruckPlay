// The blue line: the drive from the truck to the target (maps/targets.ts: the job's destination
// or the end of the route marked on the game's map, through its waypoints), trimmed as the truck
// eats it up. The game keeps its live route to itself, so this is TruckPlay's own reading of the
// road ahead; if the truck leaves it, the drive is planned again from where the truck is.
//
// Planned over the game's own road graph (nav.ts, in navWorker.ts) when map/data/graph.bin is
// there — that drive also carries the turns for the HUD — else over the map tiles' roads
// (routeWorker.ts), which draws a line but knows no turns.

import { createStore } from '../state/store';
import { connection, telemetry } from '../state/telemetry';
import demoRoute from '../state/demoRoute.json';
import { gameToLngLat, lngLatToGame, type LngLat } from './projection';
import { target as navTarget } from './targets';
import { load, loadTileBytes } from './source';
import { lngLatToTile } from './mvt';
import { truckHeading, type Maneuver } from './nav';
import type { RouteRequest, RouteResponse } from './routeWorker';
import type { NavRequest, NavResponse } from './navWorker';

/** A drive planned over the game's road graph: its turns, and where along it the truck is. */
export interface NavDrive {
  /** The line in game metres (x, z pairs) and the metres covered at each point. */
  world: Float32Array;
  cum: Float32Array;
  length: number;
  /** Seconds of driving, at the usual speeds. */
  time: number;
  maneuvers: Maneuver[];
}

export interface RouteState {
  line: LngLat[] | null;
  /** Index of the route point the truck has most recently passed. */
  progress: number;
  planning: boolean;
  /** Present when the drive came from the road graph. */
  nav: NavDrive | null;
  /** Game metres of `nav` already behind the truck. */
  along: number;
}

export const route = createStore<RouteState>({ line: null, progress: 0, planning: false, nav: null, along: 0 });

const M_LAT = 110_574;
const dist = (a: LngLat, b: LngLat) =>
  Math.hypot((a[0] - b[0]) * 111_320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180), (a[1] - b[1]) * M_LAT);

/* ---- the road graph -------------------------------------------------------------------------- */

let nav: Worker | null = null;
let navReady: Promise<boolean> | null = null;
let navSeq = 0;

function startGraph(): Promise<boolean> {
  navReady ??= (async () => {
    try {
      const r = await load('data/graph.bin');
      if (r.status !== 200 || !r.body) return false;
      const buf = r.body.buffer.slice(r.body.byteOffset, r.body.byteOffset + r.body.byteLength) as ArrayBuffer;
      nav = new Worker(new URL('./navWorker.ts', import.meta.url), { type: 'module' });
      const w = nav;
      return await new Promise<boolean>(resolve => {
        const onMessage = (e: MessageEvent<NavResponse>) => {
          if (e.data.type !== 'ready' && e.data.type !== 'error') return;
          w.removeEventListener('message', onMessage);
          if (e.data.type === 'error') console.warn(`road graph: ${e.data.error}`);
          resolve(e.data.type === 'ready');
        };
        w.addEventListener('message', onMessage);
        w.addEventListener('error', () => resolve(false));
        w.postMessage({ type: 'graph', buf } satisfies NavRequest, [buf]);
      });
    } catch {
      return false;
    }
  })();
  return navReady;
}

async function planDrive(x: number, z: number, heading: number, to: LngLat, via: LngLat[] = []): Promise<(NavDrive & { line: LngLat[] }) | null> {
  if (!(await startGraph()) || !nav) return null;
  const [tx, tz] = lngLatToGame(to[0], to[1]);
  const id = ++navSeq;
  const w = nav;
  const res = await new Promise<NavResponse & { type: 'route' }>(resolve => {
    const onMessage = (e: MessageEvent<NavResponse>) => {
      if (e.data.type !== 'route' || e.data.id !== id) return;
      w.removeEventListener('message', onMessage);
      resolve(e.data);
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'route', id, x, z, heading, tx, tz, via: via.map(p => lngLatToGame(p[0], p[1])) } satisfies NavRequest);
  });
  if (res.error) console.warn(`directions: ${res.error}`);
  return res.route;
}

/* ---- the map tiles' roads (no graph) --------------------------------------------------------- */

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;

async function runPlan(req: RouteRequest): Promise<LngLat[] | null> {
  if (!workerBroken) {
    try {
      worker ??= new Worker(new URL('./routeWorker.ts', import.meta.url), { type: 'module' });
      const w = worker;
      return await new Promise<LngLat[] | null>((resolve, reject) => {
        const done = () => {
          w.removeEventListener('message', onMessage);
          w.removeEventListener('error', onError);
        };
        const onMessage = (e: MessageEvent<RouteResponse>) => {
          if (e.data.id !== req.id) return;
          done();
          resolve(e.data.route);
        };
        const onError = (e: ErrorEvent) => {
          done();
          reject(e);
        };
        w.addEventListener('message', onMessage);
        w.addEventListener('error', onError);
        w.postMessage(req);
      });
    } catch {
      workerBroken = true;
      worker?.terminate();
      worker = null;
    }
  }
  const { plan } = await import('./routeWorker');
  return plan(req);
}

/** Plans from `from` to `to`, reading tiles at the most detailed zoom a trip of this size allows. */
async function planRoute(from: LngLat, to: LngLat): Promise<LngLat[] | null> {
  const span = Math.max(Math.abs(from[0] - to[0]), Math.abs(from[1] - to[1]));
  let z = 8;
  const pad = 0.3 + span * 0.08;
  const west = Math.min(from[0], to[0]) - pad;
  const east = Math.max(from[0], to[0]) + pad;
  const south = Math.min(from[1], to[1]) - pad;
  const north = Math.max(from[1], to[1]) + pad;
  let x0: number, y0: number, x1: number, y1: number;
  for (;;) {
    [x0, y0] = lngLatToTile(west, north, z);
    [x1, y1] = lngLatToTile(east, south, z);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 120 || z <= 5) break;
    z--;
  }
  const jobs: Array<Promise<{ z: number; x: number; y: number; buf: ArrayBuffer } | null>> = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) jobs.push(loadTileBytes('ets2', z, x, y).then(buf => (buf ? { z, x, y, buf } : null)));
  }
  const tiles = (await Promise.all(jobs)).filter(t => t !== null);
  if (!tiles.length) return null;
  return runPlan({ id: ++seq, tiles, from, to });
}

/* ---- following the drive --------------------------------------------------------------------- */

function truckLngLat(): LngLat | null {
  const p = telemetry.get().truck.pos;
  return p.x || p.z ? gameToLngLat(p.x, p.z) : null;
}

/** Where along `line` the truck is: the nearest point near the last known progress. */
function locate(line: LngLat[], at: LngLat, from: number): { index: number; off: number } {
  let best = { index: from, off: Infinity };
  const lo = Math.max(0, from - 30);
  const hi = Math.min(line.length - 1, from + 600);
  for (let i = lo; i <= hi; i++) {
    const d = dist(line[i], at);
    if (d < best.off) best = { index: i, off: d };
  }
  if (best.off > 5000) {
    for (let i = 0; i < line.length; i++) {
      const d = dist(line[i], at);
      if (d < best.off) best = { index: i, off: d };
    }
  }
  return best;
}

/**
 * Where along a graph drive the truck at (x, z) is: the segment it is on (searched near the last
 * known one), the game metres covered, and how far off the line it is.
 */
export function locateOnDrive(d: NavDrive, x: number, z: number, from: number): { index: number; along: number; off: number } {
  const w = d.world;
  const n = w.length / 2;
  let best = { index: Math.min(from, n - 1), along: d.cum[Math.min(from, n - 1)] ?? 0, off: Infinity };
  const scan = (lo: number, hi: number) => {
    for (let i = lo; i < hi; i++) {
      const ax = w[2 * i], az = w[2 * i + 1], bx = w[2 * i + 2], bz = w[2 * i + 3];
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
      const off = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (off < best.off) best = { index: i, along: d.cum[i] + Math.sqrt(len2) * t, off };
    }
  };
  scan(Math.max(0, from - 20), Math.min(n - 1, from + 400));
  if (best.off > 300) scan(0, n - 1);
  return best;
}

let started = false;

/** Keeps `route` in step with the target: plans when one appears, follows the truck. */
export function startRouting() {
  if (started) return;
  started = true;
  void startGraph();
  let target = '';
  let lastPlan = 0;
  let offSince = 0;

  const replan = async (to: LngLat, via: LngLat[], key: string) => {
    const t = telemetry.get().truck.pos;
    const from = truckLngLat();
    if (!from) return;
    lastPlan = performance.now();
    route.patch({ planning: true });
    const demo = connection.get().state === 'demo';
    const drive = await planDrive(t.x, t.z, truckHeading(t.h), to, via);
    if (target !== key) return; // the target changed meanwhile
    if (drive) {
      const { line, ...rest } = drive;
      const at = locateOnDrive(rest, t.x, t.z, 0);
      route.set({ line, progress: at.index, planning: false, nav: rest, along: at.along });
      return;
    }
    // No graph (or no way found on it): the map tiles' roads.
    const line = demo && navTarget.get()?.by === 'job' ? (demoRoute.points as Array<[number, number]>).map(([x, z]) => gameToLngLat(x, z)) : await planRoute(from, to);
    if (target !== key) return;
    route.set({ line, progress: line ? locate(line, from, 0).index : 0, planning: false, nav: null, along: 0 });
  };

  const check = () => {
    const dst = navTarget.get();
    const key = dst ? [dst.at, ...dst.via].map(p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(';') : '';
    if (key !== target) {
      target = key;
      offSince = 0;
      if (!key || !dst) route.set({ line: null, progress: 0, planning: false, nav: null, along: 0 });
      else void replan(dst.at, dst.via, key);
      return;
    }
    const r = route.get();
    const t = telemetry.get().truck.pos;
    if (!r.line || r.planning || !(t.x || t.z)) return;
    const now = performance.now();
    let off: boolean;
    if (r.nav) {
      const at = locateOnDrive(r.nav, t.x, t.z, r.progress);
      if (at.index !== r.progress || Math.abs(at.along - r.along) > 0.5) route.patch({ progress: at.index, along: at.along });
      off = at.off > 25; // game metres: a lane or two beside the line is still on it
    } else {
      const at = truckLngLat()!;
      const { index, off: d } = locate(r.line, at, r.progress);
      if (index !== r.progress) route.patch({ progress: index });
      off = d > 900; // about 45 m in the game
    }
    // Off the line for a few seconds: plan again from here.
    if (off && connection.get().state !== 'demo') {
      offSince ||= now;
      if (now - offSince > (r.nav ? 2500 : 4000) && now - lastPlan > (r.nav ? 6000 : 20_000) && dst) {
        offSince = 0;
        void replan(dst.at, dst.via, key);
      }
    } else offSince = 0;
  };

  navTarget.subscribe(check);
  // Progress along a graph drive feeds the HUD's countdown: check often.
  setInterval(check, 200);
}

// Handle for development snapshots: plan any trip and time it.
Object.assign(window, { __tpRoute: { planRoute, planDrive, startGraph, route, target: navTarget } });
