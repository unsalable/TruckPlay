// Directions over the game's own road graph (map/build-graph.mjs → map/data/graph.bin): the roads
// and junctions of the player's map, joined where the game's GPS joins them. Plans the fastest
// drive from the truck (where it is and which way it faces) to a destination, and reads the
// turns off the junctions it passes: which way, how sharp, which roundabout exit, where a
// motorway is left — the HUD's and the voice's instructions.
//
// Distances here are the game world's own metres (the truck covers them at the speed the
// speedometer shows), not the map's stretched kilometres.

import { gameToLngLat, isUkSector, type LngLat } from './projection';

/* ---- the graph --------------------------------------------------------------------------------- */

export interface Graph {
  nodeX: Float32Array;
  nodeZ: Float32Array;
  nodeHeading: Float32Array;
  nodeFwd: Int32Array;
  nodeBwd: Int32Array;
  roadA: Int32Array;
  roadB: Int32Array;
  roadLength: Float32Array;
  roadInfo: Uint32Array;
  typeNodeStart: Int32Array;
  typeCurveStart: Int32Array;
  typeLinkStart: Int32Array;
  typeNodes: Float32Array;
  typeCurves: Float32Array;
  typeLinks: Int32Array;
  typeLinkLength: Float32Array;
  typeLinkCurves: Uint16Array;
  typeFlags: Uint8Array;
  prefabType: Int32Array;
  prefabX: Float32Array;
  prefabZ: Float32Array;
  prefabAngle: Float32Array;
  prefabNodeStart: Int32Array;
  prefabNodes: Int32Array;
  ferryA: Int32Array;
  ferryB: Int32Array;
  ferryTime: Float32Array;
  ferryKm: Float32Array;
  ferryTrain: Uint32Array;
  ferryNames: Array<[string, string]>;
  /** Each junction kind's descriptor file (prefab2/…/x.ppd). */
  typeFiles: string[];
  /** Turn of each junction link, degrees, + to the right. */
  linkTurn: Float32Array;
  /** Road and junction indices by 250 m map cell. */
  roadCells: Map<number, number[]>;
  prefabCells: Map<number, number[]>;
  /** Ferry and train lines leaving each terminal junction. */
  ferriesAt: Map<number, number[]>;
  nodes: number;
  roads: number;
}

const CELL = 250;
const cellKey = (cx: number, cz: number) => (cx + 1024) * 2048 + (cz + 1024);

const ARRAYS = { Float32Array, Int32Array, Uint32Array, Uint16Array, Uint8Array };

export function readGraph(buf: ArrayBuffer): Graph {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x31475054) throw new Error('not a TruckPlay road graph');
  const jsonLength = dv.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jsonLength))) as {
    counts: { nodes: number; roads: number; prefabs: number; types: number; ferries: number };
    ferryNames: Array<[string, string]>;
    typeFiles?: string[];
    sections: Record<string, [number, number, keyof typeof ARRAYS]>;
  };
  const base = 8 + jsonLength;
  const sec = <T,>(name: string): T => {
    const [offset, length, type] = meta.sections[name];
    return new ARRAYS[type](buf, base + offset, length) as T;
  };
  const g = {
    nodeX: sec<Float32Array>('nodeX'),
    nodeZ: sec<Float32Array>('nodeZ'),
    nodeHeading: sec<Float32Array>('nodeHeading'),
    nodeFwd: sec<Int32Array>('nodeFwd'),
    nodeBwd: sec<Int32Array>('nodeBwd'),
    roadA: sec<Int32Array>('roadA'),
    roadB: sec<Int32Array>('roadB'),
    roadLength: sec<Float32Array>('roadLength'),
    roadInfo: sec<Uint32Array>('roadInfo'),
    typeNodeStart: sec<Int32Array>('typeNodeStart'),
    typeCurveStart: sec<Int32Array>('typeCurveStart'),
    typeLinkStart: sec<Int32Array>('typeLinkStart'),
    typeNodes: sec<Float32Array>('typeNodes'),
    typeCurves: sec<Float32Array>('typeCurves'),
    typeLinks: sec<Int32Array>('typeLinks'),
    typeLinkLength: sec<Float32Array>('typeLinkLength'),
    typeLinkCurves: sec<Uint16Array>('typeLinkCurves'),
    typeFlags: sec<Uint8Array>('typeFlags'),
    prefabType: sec<Int32Array>('prefabType'),
    prefabX: sec<Float32Array>('prefabX'),
    prefabZ: sec<Float32Array>('prefabZ'),
    prefabAngle: sec<Float32Array>('prefabAngle'),
    prefabNodeStart: sec<Int32Array>('prefabNodeStart'),
    prefabNodes: sec<Int32Array>('prefabNodes'),
    ferryA: sec<Int32Array>('ferryA'),
    ferryB: sec<Int32Array>('ferryB'),
    ferryTime: sec<Float32Array>('ferryTime'),
    ferryKm: sec<Float32Array>('ferryKm'),
    ferryTrain: sec<Uint32Array>('ferryTrain'),
    ferryNames: meta.ferryNames,
    typeFiles: meta.typeFiles ?? [],
    nodes: meta.counts.nodes,
    roads: meta.counts.roads,
  } as Graph;

  // Each link's turn, from the heading its first curve starts in to the one its last curve ends in.
  const links = g.typeLinkLength.length;
  g.linkTurn = new Float32Array(links);
  for (let t = 0; t + 1 < g.typeLinkStart.length; t++) {
    const c0 = g.typeCurveStart[t];
    for (let l = g.typeLinkStart[t]; l < g.typeLinkStart[t + 1]; l++) {
      const first = g.typeLinks[4 * l + 2];
      const n = g.typeLinks[4 * l + 3];
      if (!n) continue;
      const a = c0 + g.typeLinkCurves[first];
      const b = c0 + g.typeLinkCurves[first + n - 1];
      g.linkTurn[l] = degrees(g.typeCurves[7 * b + 5] - g.typeCurves[7 * a + 4]);
    }
  }

  g.roadCells = new Map();
  for (let r = 0; r < g.roads; r++) {
    const a = g.roadA[r];
    const b = g.roadB[r];
    const pad = Math.max(20, g.roadLength[r] * 0.3);
    addToCells(g.roadCells, r, Math.min(g.nodeX[a], g.nodeX[b]) - pad, Math.min(g.nodeZ[a], g.nodeZ[b]) - pad, Math.max(g.nodeX[a], g.nodeX[b]) + pad, Math.max(g.nodeZ[a], g.nodeZ[b]) + pad);
  }
  g.prefabCells = new Map();
  for (let j = 0; j < g.prefabType.length; j++) {
    let x0 = g.prefabX[j], z0 = g.prefabZ[j], x1 = x0, z1 = z0;
    for (let k = g.prefabNodeStart[j]; k < g.prefabNodeStart[j + 1]; k++) {
      const n = g.prefabNodes[k];
      if (n < 0) continue;
      x0 = Math.min(x0, g.nodeX[n]);
      z0 = Math.min(z0, g.nodeZ[n]);
      x1 = Math.max(x1, g.nodeX[n]);
      z1 = Math.max(z1, g.nodeZ[n]);
    }
    addToCells(g.prefabCells, j, x0 - 30, z0 - 30, x1 + 30, z1 + 30);
  }
  g.ferriesAt = new Map();
  for (let f = 0; f < g.ferryA.length; f++) {
    for (const [from, to] of [[g.ferryA[f], g.ferryB[f]], [g.ferryB[f], g.ferryA[f]]] as const) {
      if (!g.ferriesAt.has(from)) g.ferriesAt.set(from, []);
      g.ferriesAt.get(from)!.push(to === g.ferryB[f] ? f : -(f + 1));
    }
  }
  return g;
}

function addToCells(cells: Map<number, number[]>, id: number, x0: number, z0: number, x1: number, z1: number) {
  for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
    for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
      const k = cellKey(cx, cz);
      const list = cells.get(k);
      if (list) list.push(id);
      else cells.set(k, [id]);
    }
  }
}

function near(cells: Map<number, number[]>, x: number, z: number, radius: number): Set<number> {
  const out = new Set<number>();
  for (let cx = Math.floor((x - radius) / CELL); cx <= Math.floor((x + radius) / CELL); cx++) {
    for (let cz = Math.floor((z - radius) / CELL); cz <= Math.floor((z + radius) / CELL); cz++) {
      for (const id of cells.get(cellKey(cx, cz)) ?? []) out.add(id);
    }
  }
  return out;
}

const degrees = (rad: number) => {
  let d = (rad * 180) / Math.PI;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
};

/* ---- geometry ---------------------------------------------------------------------------------- */

const lanesFwd = (info: number) => info & 15;
const lanesBack = (info: number) => (info >> 4) & 15;
export const roadClass = (info: number) => (info >> 8) & 15;
const secretRoad = (info: number) => (info & (1 << 12)) !== 0;

/** A Hermite curve from (ax, az) heading ha to (bx, bz) heading hb, as SCS draws roads and lanes. */
function hermite(out: number[], ax: number, az: number, ha: number, bx: number, bz: number, hb: number, steps: number, skipFirst: boolean) {
  const len = Math.hypot(bx - ax, bz - az);
  const tax = Math.cos(ha) * len, taz = Math.sin(ha) * len;
  const tbx = Math.cos(hb) * len, tbz = Math.sin(hb) * len;
  for (let i = skipFirst ? 1 : 0; i <= steps; i++) {
    const t = i / steps;
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    out.push(h00 * ax + h10 * tax + h01 * bx + h11 * tbx, h00 * az + h10 * taz + h01 * bz + h11 * tbz);
  }
}

/** A road's centre line from start to end node, as flat [x, z, …]. */
function roadPoints(g: Graph, r: number): number[] {
  const a = g.roadA[r], b = g.roadB[r];
  const out: number[] = [];
  const steps = Math.max(1, Math.min(48, Math.ceil(g.roadLength[r] / 12)));
  hermite(out, g.nodeX[a], g.nodeZ[a], g.nodeHeading[a], g.nodeX[b], g.nodeZ[b], g.nodeHeading[b], steps, false);
  return out;
}

/** A junction link's lane, on the map, as flat [x, z, …]. */
function linkPoints(g: Graph, j: number, l: number): number[] {
  const t = g.prefabType[j];
  const c0 = g.typeCurveStart[t];
  const ang = g.prefabAngle[j];
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const px = g.prefabX[j], pz = g.prefabZ[j];
  const first = g.typeLinks[4 * l + 2];
  const n = g.typeLinks[4 * l + 3];
  const local: number[] = [];
  for (let k = 0; k < n; k++) {
    const c = 7 * (c0 + g.typeLinkCurves[first + k]);
    const tc = g.typeCurves;
    const steps = Math.max(1, Math.min(24, Math.ceil(tc[c + 6] / 8)));
    hermite(local, tc[c], tc[c + 1], tc[c + 4], tc[c + 2], tc[c + 3], tc[c + 5], steps, k > 0);
  }
  const out = new Array<number>(local.length);
  for (let i = 0; i < local.length; i += 2) {
    out[i] = px + cos * local[i] - sin * local[i + 1];
    out[i + 1] = pz + sin * local[i] + cos * local[i + 1];
  }
  // Lanes run beside the road's centre line, which is what roads are drawn on: pin the lane's
  // ends to the junction's nodes and spread the shift along it, so the line does not jog.
  const ns = g.prefabNodeStart[j];
  const a = g.prefabNodes[ns + g.typeLinks[4 * l]];
  const b = g.prefabNodes[ns + g.typeLinks[4 * l + 1]];
  if (a >= 0 && b >= 0 && out.length >= 4 && a !== b) {
    const ax = g.nodeX[a] - out[0], az = g.nodeZ[a] - out[1];
    const bx = g.nodeX[b] - out[out.length - 2], bz = g.nodeZ[b] - out[out.length - 1];
    // Only a lane's width or so; anything bigger means the ends are not where we think.
    if (Math.hypot(ax, az) < 12 && Math.hypot(bx, bz) < 12) {
      const total = polyLength(out) || 1;
      const frac: number[] = [0];
      for (let i = 2, done = 0; i < out.length; i += 2) {
        done += Math.hypot(out[i] - out[i - 2], out[i + 1] - out[i - 1]);
        frac.push(done / total);
      }
      for (let i = 0; i < out.length; i += 2) {
        const f = frac[i / 2];
        out[i] += ax * (1 - f) + bx * f;
        out[i + 1] += az * (1 - f) + bz * f;
      }
    }
  }
  return out;
}

/** The nearest point of a polyline: segment index, the point, distance, along-length and heading. */
function nearest(pts: number[], x: number, z: number) {
  let best = { i: 0, px: pts[0], pz: pts[1], d: Infinity, along: 0, heading: 0 };
  let along = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const len = Math.sqrt(len2);
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { i, px, pz, d, along: along + len * t, heading: Math.atan2(dz, dx) };
    along += len;
  }
  return best;
}

const polyLength = (pts: number[]) => {
  let s = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) s += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  return s;
};

/* ---- costs ------------------------------------------------------------------------------------- */

// Seconds per metre: trucks on each class of road, slowly through junctions.
const SPEED = [22.2, 18.1, 12.5, 6.9, 5.6]; // motorway 80, expressway 65, local 45, slow 25, minor 20 km/h
const JUNCTION = 9.7; // 35 km/h
const MAX_SPEED = 25;

function roadCost(g: Graph, r: number): number {
  const info = g.roadInfo[r];
  return (g.roadLength[r] / SPEED[Math.min(4, roadClass(info))]) * (secretRoad(info) ? 1.3 : 1);
}

function linkCost(g: Graph, l: number, leftHand: boolean): number {
  const turn = leftHand ? -g.linkTurn[l] : g.linkTurn[l];
  let penalty = 0;
  if (Math.abs(turn) > 150) penalty = 120; // turning back
  else if (turn < -45) penalty = 7; // across the oncoming lanes
  else if (turn > 45) penalty = 2;
  return g.typeLinkLength[l] / JUNCTION + penalty;
}

// Game minutes on board → real seconds at the game's usual time scale, plus the wait to board.
const ferryCost = (g: Graph, f: number) => (g.ferryTime[f] * 60) / 19 + 600;

/* ---- search ------------------------------------------------------------------------------------ */

// A search state is a node and the side it is left by: node * 2 (into its forward item) or
// node * 2 + 1 (into its backward item).
const KIND_ROAD = 1, KIND_LINK = 2, KIND_FERRY = 3;

class Heap {
  keys = new Float64Array(1024);
  vals = new Int32Array(1024);
  size = 0;
  push(k: number, v: number) {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      keys.set(this.keys);
      const vals = new Int32Array(this.size * 2);
      vals.set(this.vals);
      this.keys = keys;
      this.vals = vals;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= k) break;
      this.keys[i] = this.keys[p];
      this.vals[i] = this.vals[p];
      i = p;
    }
    this.keys[i] = k;
    this.vals[i] = v;
  }
  pop(): number {
    const top = this.vals[0];
    const k = this.keys[--this.size];
    const v = this.vals[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= k) break;
      this.keys[i] = this.keys[c];
      this.vals[i] = this.vals[c];
      i = c;
    }
    this.keys[i] = k;
    this.vals[i] = v;
    return top;
  }
}

interface SearchArrays {
  stamp: Uint32Array;
  cost: Float64Array;
  prev: Int32Array;
  kind: Uint8Array;
  id: Int32Array;
  sub: Int32Array;
  gen: number;
}
const searches = new WeakMap<Graph, SearchArrays>();
function arrays(g: Graph): SearchArrays {
  let s = searches.get(g);
  if (!s) {
    const n = g.nodes * 2;
    s = { stamp: new Uint32Array(n), cost: new Float64Array(n), prev: new Int32Array(n), kind: new Uint8Array(n), id: new Int32Array(n), sub: new Int32Array(n), gen: 0 };
    searches.set(g, s);
  }
  s.gen++;
  return s;
}

/** Where the drive begins: the state reached, its cost, and the way there from the truck. */
interface Start {
  state: number;
  cost: number;
  pts: number[];
  score: number;
}

/** Ways the drive could begin, best first: the roads and junction lanes near the truck, each way
 *  it could be driven, scored by distance and by how well it matches the truck's heading. */
function snapStarts(g: Graph, x: number, z: number, heading: number): Start[] {
  const all: Start[] = [];
  const consider = (state: number, cost: number, pts: number[], d: number, dir: number) => {
    const align = Math.cos(heading - dir);
    // Facing the other way costs a turn; the search will find a way round if there is one.
    all.push({ state, cost: cost + (align < 0 ? 90 : 0), pts, score: d + 25 * (1 - align) + (align < 0.2 ? 200 : 0) });
  };
  for (const r of near(g.roadCells, x, z, 60)) {
    const pts = roadPoints(g, r);
    const n = nearest(pts, x, z);
    if (n.d > 60) continue;
    const total = polyLength(pts);
    const info = g.roadInfo[r];
    const speed = SPEED[Math.min(4, roadClass(info))];
    if (lanesFwd(info)) {
      const rest = [n.px, n.pz, ...pts.slice(n.i + 2)];
      consider(g.roadB[r] * 2, (total - n.along) / speed, rest, n.d, n.heading);
    }
    if (lanesBack(info)) {
      const back: number[] = [n.px, n.pz];
      for (let i = n.i; i >= 0; i -= 2) back.push(pts[i], pts[i + 1]);
      consider(g.roadA[r] * 2 + 1, n.along / speed, back, n.d, n.heading + Math.PI);
    }
  }
  for (const j of near(g.prefabCells, x, z, 60)) {
    const t = g.prefabType[j];
    const ns = g.prefabNodeStart[j];
    const ref = -(j + 1);
    for (let l = g.typeLinkStart[t]; l < g.typeLinkStart[t + 1]; l++) {
      const m = g.prefabNodes[ns + g.typeLinks[4 * l + 1]];
      if (m < 0) continue;
      const pts = linkPoints(g, j, l);
      const n = nearest(pts, x, z);
      if (n.d > 30) continue;
      const rest = [n.px, n.pz, ...pts.slice(n.i + 2)];
      consider(m * 2 + (g.nodeFwd[m] === ref ? 1 : 0), (polyLength(pts) - n.along) / JUNCTION, rest, n.d, n.heading);
    }
  }
  // One start per state, the best scored.
  const seen = new Set<number>();
  return all
    .sort((a, b) => a.score - b.score)
    .filter(s => !seen.has(s.state) && seen.add(s.state))
    .slice(0, 12);
}

/** Up to eight graph nodes near the destination, with what the last stretch to it costs. */
function goals(g: Graph, x: number, z: number): Map<number, number> {
  const found = new Map<number, number>();
  for (const radius of [150, 600, 2500]) {
    for (const r of near(g.roadCells, x, z, radius)) {
      for (const n of [g.roadA[r], g.roadB[r]]) {
        const d = Math.hypot(g.nodeX[n] - x, g.nodeZ[n] - z);
        if (d <= radius) found.set(n, d);
      }
    }
    if (found.size) break;
  }
  const out = new Map<number, number>();
  for (const [n, d] of [...found].sort((a, b) => a[1] - b[1]).slice(0, 8)) out.set(n, d / 6);
  return out;
}

/* ---- rings --------------------------------------------------------------------------------------- */

// Many roundabouts are not one junction but a ring of short curved roads joined by small joints
// at each arm. A junction is on such a ring if, leaving it the way that keeps furthest to the
// ring's side (left where traffic keeps right) with only gentle bends, the drive comes back to it
// within a ring's length. City blocks also come back, but with square corners and over a longer
// way round.
const rings = new WeakMap<Graph, Map<number, boolean>>();
const RING_LENGTH = 260;

export function onRing(g: Graph, j: number): boolean {
  let cache = rings.get(g);
  if (!cache) rings.set(g, (cache = new Map()));
  const known = cache.get(j);
  if (known !== undefined) return known;
  const leftHand = isUkSector(g.prefabX[j], g.prefabZ[j]);
  let found = false;
  const count = g.prefabNodeStart[j + 1] - g.prefabNodeStart[j];
  for (let first = 0; first < count && !found; first++) {
    let at = j;
    let entry = first;
    let length = 0;
    for (let step = 0; step < 16 && length < RING_LENGTH; step++) {
      const t = g.prefabType[at];
      let best = -1;
      let bestTurn = Infinity;
      for (let k = g.typeLinkStart[t]; k < g.typeLinkStart[t + 1]; k++) {
        if (g.typeLinks[4 * k] !== entry) continue;
        const turn = leftHand ? -g.linkTurn[k] : g.linkTurn[k];
        if (Math.abs(turn) <= 150 && turn < bestTurn) {
          bestTurn = turn;
          best = k;
        }
      }
      // A ring bends gently at its joints.
      if (best < 0 || bestTurn < -65) break;
      length += g.typeLinkLength[best];
      const ref = -(at + 1);
      let node = g.prefabNodes[g.prefabNodeStart[at] + g.typeLinks[4 * best + 1]];
      if (node < 0) break;
      let dir = g.nodeFwd[node] === ref ? 1 : 0;
      let next = dir === 0 ? g.nodeFwd[node] : g.nodeBwd[node];
      // Along the ring's roads to its next joint.
      for (let hops = 0; next > 0 && hops < 24 && length < RING_LENGTH; hops++) {
        const r = next - 1;
        length += g.roadLength[r];
        if (g.roadA[r] === node) {
          node = g.roadB[r];
          dir = 0;
        } else {
          node = g.roadA[r];
          dir = 1;
        }
        next = dir === 0 ? g.nodeFwd[node] : g.nodeBwd[node];
      }
      if (next >= 0 || length >= RING_LENGTH) break;
      at = -next - 1;
      if (at === j) {
        found = step >= 1;
        break;
      }
      entry = -1;
      for (let k = g.prefabNodeStart[at]; k < g.prefabNodeStart[at + 1]; k++) {
        if (g.prefabNodes[k] === node) {
          entry = k - g.prefabNodeStart[at];
          break;
        }
      }
      if (entry < 0) break;
    }
  }
  cache.set(j, found);
  return found;
}

/* ---- directions -------------------------------------------------------------------------------- */

export type ManeuverType = 'turn' | 'slight' | 'sharp' | 'uturn' | 'keep' | 'exit' | 'roundabout' | 'ferry' | 'train' | 'arrive';

export interface Maneuver {
  type: ManeuverType;
  side: 'left' | 'right' | '';
  /** Metres from the start of the drive to where the manoeuvre begins. */
  at: number;
  /** Index of that point in the route's line. */
  index: number;
  /** Roundabout exit, counted from 1. */
  exit?: number;
  /** Driving on the left (Great Britain): roundabouts run clockwise. */
  leftHand?: boolean;
  /** Turn, degrees, + right. */
  angle: number;
  /** Ferry or train: where it goes. */
  to?: string;
  /** The class of road the manoeuvre leads onto (0 motorway … 4 minor), -1 unknown. */
  onto: number;
}

export interface NavRoute {
  /** The drive, on the map. */
  line: LngLat[];
  /** The same in game metres (x, z pairs). */
  world: Float32Array;
  /** Metres from the start at each point. */
  cum: Float32Array;
  length: number;
  /** Seconds of driving, at the class speeds. */
  time: number;
  maneuvers: Maneuver[];
  /** Searched states, for the curious. */
  visited: number;
}

/** The road an exit node leads onto, leaving `node` by `dir`: its class and lanes that way. */
function roadBeyond(g: Graph, node: number, dir: number): { cls: number; lanes: number } | null {
  const ref = dir === 0 ? g.nodeFwd[node] : g.nodeBwd[node];
  if (ref <= 0) return null;
  const info = g.roadInfo[ref - 1];
  return { cls: roadClass(info), lanes: g.roadA[ref - 1] === node ? lanesFwd(info) : lanesBack(info) };
}

/** The fastest drive from (x, z) facing `heading` (radians, map: x east, z south) to (tx, tz). */
export function findRoute(g: Graph, x: number, z: number, heading: number, tx: number, tz: number): NavRoute | null {
  const starts = snapStarts(g, x, z, heading);
  if (!starts.length) return null;
  const target = goals(g, tx, tz);
  if (!target.size) return null;
  const s = arrays(g);
  const heap = new Heap();
  const h = (state: number) => Math.hypot(g.nodeX[state >> 1] - tx, g.nodeZ[state >> 1] - tz) / MAX_SPEED;
  const reach = (state: number, cost: number, from: number, kind: number, id: number, sub: number) => {
    if (s.stamp[state] === s.gen && s.cost[state] <= cost) return;
    s.stamp[state] = s.gen;
    s.cost[state] = cost;
    s.prev[state] = from;
    s.kind[state] = kind;
    s.id[state] = id;
    s.sub[state] = sub;
    heap.push(cost + h(state), state);
  };
  // Every likely start at once: the search settles which one the drive really begins from (a
  // worse match to the truck's position and heading costs a little extra).
  for (const st of starts) reach(st.state, st.cost + st.score / 5, -1, 0, 0, 0);
  let found = -1;
  let visited = 0;
  while (heap.size) {
    const state = heap.pop();
    const cost = s.cost[state];
    visited++;
    const node = state >> 1;
    const extra = target.get(node);
    if (extra !== undefined) {
      found = state;
      break;
    }
    if (visited > 3_000_000) break;
    const dir = state & 1;
    const ref = dir === 0 ? g.nodeFwd[node] : g.nodeBwd[node];
    if (ref > 0) {
      const r = ref - 1;
      const info = g.roadInfo[r];
      if (g.roadA[r] === node && dir === 0) {
        if (lanesFwd(info)) reach(g.roadB[r] * 2, cost + roadCost(g, r), state, KIND_ROAD, r, 0);
      } else if (g.roadB[r] === node && dir === 1) {
        if (lanesBack(info)) reach(g.roadA[r] * 2 + 1, cost + roadCost(g, r), state, KIND_ROAD, r, 1);
      }
    } else if (ref < 0) {
      const j = -ref - 1;
      const t = g.prefabType[j];
      const ns = g.prefabNodeStart[j];
      const ne = g.prefabNodeStart[j + 1];
      let i = -1;
      for (let k = ns; k < ne; k++) {
        if (g.prefabNodes[k] === node) {
          i = k - ns;
          break;
        }
      }
      if (i < 0) continue;
      const leftHand = isUkSector(g.nodeX[node], g.nodeZ[node]);
      for (let l = g.typeLinkStart[t]; l < g.typeLinkStart[t + 1]; l++) {
        if (g.typeLinks[4 * l] !== i) continue;
        const m = g.prefabNodes[ns + g.typeLinks[4 * l + 1]];
        if (m < 0) continue;
        reach(m * 2 + (g.nodeFwd[m] === ref ? 1 : 0), cost + linkCost(g, l, leftHand), state, KIND_LINK, j, l);
      }
      for (const f of g.ferriesAt.get(j) ?? []) {
        const line = f >= 0 ? f : -f - 1;
        const other = f >= 0 ? g.ferryB[line] : g.ferryA[line];
        const oref = -(other + 1);
        // Off the boat at any of the other terminal's road-side nodes.
        for (let k = g.prefabNodeStart[other]; k < g.prefabNodeStart[other + 1]; k++) {
          const m = g.prefabNodes[k];
          if (m < 0) continue;
          const away = g.nodeFwd[m] === oref ? 1 : 0;
          if ((away === 0 ? g.nodeFwd[m] : g.nodeBwd[m]) === 0) continue;
          reach(m * 2 + away, cost + ferryCost(g, line), state, KIND_FERRY, line, f >= 0 ? 0 : 1);
        }
      }
    }
  }
  if (found < 0) return null;

  // Walk back to the start.
  const steps: number[] = [];
  let origin = found;
  for (let st = found; st >= 0 && s.prev[st] !== -1; st = s.prev[st]) {
    steps.push(st);
    origin = s.prev[st];
  }
  steps.reverse();
  const start = starts.find(st => st.state === origin) ?? starts[0];

  const world: number[] = [...start.pts];
  const maneuvers: Maneuver[] = [];
  let time = start.cost;
  // Pieces meet end to start; the shared point goes in once.
  const append = (pts: number[]) => {
    const skip = world.length >= 2 && Math.hypot(world[world.length - 2] - pts[0], world[world.length - 1] - pts[1]) < 0.5 ? 2 : 0;
    for (let i = skip; i < pts.length; i++) world.push(pts[i]);
  };
  // The road the truck is on (class, lanes its way), for telling the main road from a turn-off.
  const first = start.state >> 1;
  const behind = (start.state & 1) === 0 ? g.nodeBwd[first] : g.nodeFwd[first];
  let from = { cls: 2, lanes: 1 };
  if (behind > 0) {
    const info = g.roadInfo[behind - 1];
    from = { cls: roadClass(info), lanes: g.roadB[behind - 1] === first ? lanesFwd(info) : lanesBack(info) };
  }

  // Roundabouts are read as a whole: from where the drive enters the ring to where it leaves it,
  // counting the exits it passes — whether the ring is one junction or built of several pieces.
  let ring: { index: number; heading: number; out: number; exits: number; number: number; leftHand: boolean } | null = null;
  const flushRing = () => {
    if (!ring) return;
    maneuvers.push({ type: 'roundabout', side: '', at: 0, index: ring.index, exit: ring.number || undefined, angle: degrees(ring.out - ring.heading), leftHand: ring.leftHand, onto: from.cls });
    ring = null;
  };

  for (const st of steps) {
    const kind = s.kind[st];
    if (kind === KIND_ROAD) {
      const r = s.id[st];
      // A short connector between a ring's pieces is part of the ring; anything longer leaves it.
      if (ring && g.roadLength[r] > 80) flushRing();
      const pts = roadPoints(g, r);
      if (s.sub[st] === 1) {
        const rev: number[] = [];
        for (let i = pts.length - 2; i >= 0; i -= 2) rev.push(pts[i], pts[i + 1]);
        append(rev);
      } else append(pts);
      time += roadCost(g, r);
      const info = g.roadInfo[r];
      from = { cls: roadClass(info), lanes: s.sub[st] === 1 ? lanesBack(info) : lanesFwd(info) };
    } else if (kind === KIND_LINK) {
      const j = s.id[st];
      const l = s.sub[st];
      const t = g.prefabType[j];
      const pts = linkPoints(g, j, l);
      if ((g.typeFlags[t] & 1 || onRing(g, j)) && pts.length >= 4) {
        const n = pts.length;
        const leftHand = isUkSector(g.prefabX[j], g.prefabZ[j]);
        ring ??= { index: world.length / 2 - 1, heading: Math.atan2(pts[3] - pts[1], pts[2] - pts[0]), out: 0, exits: 0, number: 0, leftHand };
        ring.out = Math.atan2(pts[n - 1] - pts[n - 3], pts[n - 2] - pts[n - 4]);
        // The ways on from where this piece is entered (turning back aside).
        const entry = g.typeLinks[4 * l];
        const ways: number[] = [];
        for (let k = g.typeLinkStart[t]; k < g.typeLinkStart[t + 1]; k++) {
          if (g.typeLinks[4 * k] === entry && Math.abs(g.linkTurn[k]) <= 165) ways.push(k);
        }
        // Signed so that "further round the ring" is always smaller (left where traffic keeps right).
        const round = (k: number) => (leftHand ? -g.linkTurn[k] : g.linkTurn[k]);
        if (ways.length >= 3) {
          // The whole ring in one piece: exits in the order the ring passes them.
          const ordered = [...ways].sort((a, b) => round(b) - round(a));
          ring.number = ordered.indexOf(l) + 1;
          append(pts);
          flushRing();
        } else {
          if (ways.length === 2) {
            // One piece of a ring: going on round, or out.
            ring.exits++;
            const other = ways.find(k => k !== l);
            if (other !== undefined && round(l) > round(other)) {
              ring.number = ring.exits;
              append(pts);
              flushRing();
              time += g.typeLinkLength[l] / JUNCTION;
              continue;
            }
          }
          append(pts);
        }
      } else {
        flushRing();
        const m = maneuverAt(g, j, t, l, g.typeLinks[4 * l], from, world.length / 2 - 1);
        if (m) maneuvers.push(m);
        append(pts);
      }
      time += g.typeLinkLength[l] / JUNCTION;
    } else if (kind === KIND_FERRY) {
      flushRing();
      const f = s.id[st];
      const names = g.ferryNames[f] ?? ['', ''];
      const to = s.sub[st] === 0 ? names[1] : names[0];
      maneuvers.push({ type: g.ferryTrain[f] ? 'train' : 'ferry', side: '', at: 0, index: world.length / 2 - 1, angle: 0, to, onto: -1 });
      append([g.nodeX[st >> 1], g.nodeZ[st >> 1]]);
      time += ferryCost(g, f);
    }
  }
  flushRing();
  // The last stretch: from the goal node to the destination itself.
  append([tx, tz]);
  maneuvers.push({ type: 'arrive', side: '', at: 0, index: world.length / 2 - 1, angle: 0, onto: -1 });

  const n = world.length / 2;
  const line: LngLat[] = new Array(n);
  const cum = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (i) sum += Math.hypot(world[2 * i] - world[2 * i - 2], world[2 * i + 1] - world[2 * i - 1]);
    cum[i] = sum;
    line[i] = gameToLngLat(world[2 * i], world[2 * i + 1]);
  }
  for (const mv of maneuvers) mv.at = cum[Math.min(n - 1, Math.max(0, mv.index))];
  return { line, world: Float32Array.from(world), cum, length: sum, time, maneuvers: mergeClose(maneuvers), visited };
}

/** What a driver has to do at junction `j` taking link `l` in from node `entry`, if anything. */
function maneuverAt(g: Graph, j: number, t: number, l: number, entry: number, from: { cls: number; lanes: number }, index: number): Maneuver | null {
  // Every way out of this junction from where the truck comes in: its turn and the road it leads
  // onto (a junction straight after a junction: taken as the road the truck is on). A way's
  // weight: its class first (motorway on top), then its lanes — slip roads are often built as
  // motorway, but they have one lane.
  const ns = g.prefabNodeStart[j];
  const ref = -(j + 1);
  const opts: Array<{ k: number; turn: number; cls: number; weight: number }> = [];
  for (let k = g.typeLinkStart[t]; k < g.typeLinkStart[t + 1]; k++) {
    if (g.typeLinks[4 * k] !== entry) continue;
    const m = g.prefabNodes[ns + g.typeLinks[4 * k + 1]];
    if (m < 0) continue;
    const road = roadBeyond(g, m, g.nodeFwd[m] === ref ? 1 : 0) ?? from;
    opts.push({ k, turn: g.linkTurn[k], cls: road.cls, weight: road.cls * 16 - Math.min(15, road.lanes) });
  }
  const fromClass = from.cls;
  const me = opts.find(o => o.k === l);
  if (!me) return null;
  const turn = me.turn;
  const abs = Math.abs(turn);
  const base = { at: 0, index, angle: turn, onto: me.cls };
  const side = (a: number): 'left' | 'right' => (a < 0 ? 'left' : 'right');

  // Turning back is never the obvious way; with nothing else to choose there is nothing to say.
  const real = opts.filter(o => Math.abs(o.turn) <= 150);
  if (abs <= 150 && real.length <= 1) return null;
  // The main road through: the heaviest of the ways ahead.
  const ahead = real.filter(o => Math.abs(o.turn) < 40);
  const top = ahead.length ? Math.min(...ahead.map(o => o.weight)) : me.weight;
  const majors = ahead.filter(o => o.weight === top);
  // Other ways close to this one: a fork, where only the side tells them apart.
  const near = real.filter(o => o !== me && Math.abs(o.turn - turn) < 40);
  if (abs < 25 || (abs < 45 && near.length)) {
    if (abs < 25 && me.weight === top && majors.length === 1) return null; // staying on the main road past a turn-off
    // Equals by class and lanes: the clearly straighter one, on the same class of road, is the
    // main road (a two-lane slip road leaving a motorway at 15° is still a slip road).
    if (abs < 25 && me.weight === top && me.cls === fromClass && majors.every(o => o === me || Math.abs(o.turn) - abs >= 8)) return null;
    if (!near.length) return null; // straight on across a junction
    // A fork between equals, or a turn-off from the main road: say which side to keep to.
    const others = (me.weight === top ? majors : near).filter(o => o !== me).map(o => o.turn);
    const mid = others.reduce((a, b) => a + b, 0) / Math.max(1, others.length);
    const s: 'left' | 'right' = !others.length ? side(turn) : turn > Math.max(...others) ? 'right' : turn < Math.min(...others) ? 'left' : turn >= mid ? 'right' : 'left';
    // Leaving a motorway or expressway's main lanes for a lesser way, on the side exits are on
    // (the right, the left in Great Britain), is an exit; anything else is keeping to a side.
    const exitSide = isUkSector(g.prefabX[j], g.prefabZ[j]) ? 'left' : 'right';
    const leaving = fromClass >= 0 && fromClass <= 1 && me.weight > top && s === exitSide;
    return { type: leaving ? 'exit' : 'keep', side: s, ...base };
  }
  // The main road bending gently while lesser roads go elsewhere: just follow it.
  if (abs < 50 && me.weight === top && real.filter(o => o.weight === top).length === 1) return null;
  if (abs < 60) return { type: 'slight', side: side(turn), ...base };
  if (abs < 135) return { type: 'turn', side: side(turn), ...base };
  if (abs < 170) return { type: 'sharp', side: side(turn), ...base };
  return { type: 'uturn', side: isUkSector(g.prefabX[j], g.prefabZ[j]) ? 'right' : 'left', ...base };
}

// How strongly each manoeuvre turns, for merging the pieces of one turn.
const STRENGTH: Record<ManeuverType, number> = { keep: 1, exit: 2, slight: 3, turn: 4, sharp: 5, uturn: 6, roundabout: 7, ferry: 8, train: 8, arrive: 9 };

/** One turn spread over junctions a few metres apart is one instruction. */
function mergeClose(list: Maneuver[]): Maneuver[] {
  const out: Maneuver[] = [];
  for (const m of list) {
    const prev = out[out.length - 1];
    const mergeable = (x: Maneuver) => STRENGTH[x.type] <= STRENGTH.sharp;
    if (prev && m.at - prev.at < 35 && mergeable(prev) && mergeable(m) && (prev.side === m.side || !prev.side)) {
      const angle = prev.angle + m.angle;
      const stronger = STRENGTH[m.type] > STRENGTH[prev.type] ? m : prev;
      out[out.length - 1] = { ...prev, type: stronger.type, side: stronger.side, angle, onto: m.onto };
      continue;
    }
    out.push(m);
  }
  return out;
}

/** The game's truck heading (0…1, counter-clockwise from north) as a map heading in radians. */
export function truckHeading(h: number): number {
  const yaw = h * Math.PI * 2;
  return Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
}

/**
 * A drive through `stops` in order (waypoints marked on the game's map, then the destination):
 * one leg after another, each leaving the way the last one arrived. A waypoint that cannot be
 * reached is passed over; the destination must be reached.
 */
export function findRouteVia(g: Graph, x: number, z: number, heading: number, stops: Array<[number, number]>): NavRoute | null {
  const legs: NavRoute[] = [];
  let from = { x, z, heading };
  for (let i = 0; i < stops.length; i++) {
    const leg = findRoute(g, from.x, from.z, from.heading, stops[i][0], stops[i][1]);
    if (!leg) {
      if (i === stops.length - 1) return null;
      continue;
    }
    legs.push(leg);
    const w = leg.world;
    const n = w.length;
    if (n >= 4) from = { x: w[n - 2], z: w[n - 1], heading: Math.atan2(w[n - 1] - w[n - 3], w[n - 2] - w[n - 4]) };
  }
  if (legs.length <= 1) return legs[0] ?? null;

  const line: LngLat[] = [];
  const world: number[] = [];
  const cum: number[] = [];
  const maneuvers: Maneuver[] = [];
  let offset = 0;
  let time = 0;
  let visited = 0;
  legs.forEach((leg, k) => {
    // Legs meet at the waypoint: its point goes in once.
    const skip = k === 0 ? 0 : 1;
    const base = line.length - skip;
    for (let i = skip; i < leg.line.length; i++) {
      line.push(leg.line[i]);
      world.push(leg.world[2 * i], leg.world[2 * i + 1]);
      cum.push(offset + leg.cum[i]);
    }
    for (const m of leg.maneuvers) {
      // Arriving at a waypoint is not arriving: the drive goes on.
      if (m.type === 'arrive' && k < legs.length - 1) continue;
      maneuvers.push({ ...m, index: base + m.index, at: offset + m.at });
    }
    offset += leg.length;
    time += leg.time;
    visited += leg.visited;
  });
  return { line, world: Float32Array.from(world), cum: Float32Array.from(cum), length: offset, time, maneuvers, visited };
}
