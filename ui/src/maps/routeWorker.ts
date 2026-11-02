// Plans a drive over the map's roads, off the main thread. Tiles clip roads at their edges and
// junction prefabs leave gaps between road items, so road pieces are joined where they meet or
// nearly meet — tight joins are cheap, gap joins cost more, so the route keeps to real road.

import { decodeTile } from './mvt';

type LngLat = [number, number];

export interface RouteRequest {
  id: number;
  tiles: Array<{ z: number; x: number; y: number; buf: ArrayBuffer }>;
  from: LngLat;
  to: LngLat;
}

export interface RouteResponse {
  id: number;
  route: LngLat[] | null;
  error?: string;
}

const COST: Record<string, number> = { freeway: 1, divided: 1.2, local: 1.7, unknown: 1.9 };
const M_LAT = 110_574;
const mx = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);
const dist = (a: LngLat, b: LngLat) => Math.hypot((a[0] - b[0]) * mx((a[1] + b[1]) / 2), (a[1] - b[1]) * M_LAT);

export function plan({ tiles, from, to }: RouteRequest): LngLat[] | null {
  const nodes: LngLat[] = [];
  const edges: Array<Array<[number, number]>> = [];
  const ends: number[] = [];
  const link = (a: number, b: number, cost: number) => {
    edges[a].push([b, cost]);
    edges[b].push([a, cost]);
  };

  for (const t of tiles) {
    const lines = decodeTile(
      new Uint8Array(t.buf),
      t.z,
      t.x,
      t.y,
      (p, type) =>
        type === 2 &&
        // Ferries and the Channel train carry trucks too, at a price.
        (p.type === 'ferry' || p.type === 'train' || (p.type === 'road' && p.hidden !== true && typeof p.roadType === 'string' && p.roadType in COST)),
    );
    for (const l of lines) {
      const k = l.props.type === 'road' ? COST[l.props.roadType as string] : 3;
      for (const part of l.parts) {
        if (part.length < 2) continue;
        let prev = -1;
        for (const p of part) {
          nodes.push(p);
          edges.push([]);
          const id = nodes.length - 1;
          if (prev >= 0) link(prev, id, dist(nodes[prev], p) * k);
          prev = id;
        }
        ends.push(prev - part.length + 1, prev);
      }
    }
  }
  if (!nodes.length) return null;

  // Grid in degrees of latitude; longitude cells widen with latitude.
  const CELL = 0.02;
  const grid = new Map<string, number[]>();
  const cellOf = (p: LngLat) => [Math.floor((p[0] * Math.cos((p[1] * Math.PI) / 180)) / CELL), Math.floor(p[1] / CELL)];
  nodes.forEach((p, i) => {
    const [cx, cy] = cellOf(p);
    const key = `${cx},${cy}`;
    const cell = grid.get(key);
    if (cell) cell.push(i);
    else grid.set(key, [i]);
  });
  const within = (p: LngLat, r: number) => {
    const found: Array<[number, number]> = [];
    const [cx, cy] = cellOf(p);
    const span = Math.ceil(r / (CELL * M_LAT)) + 1;
    for (let dx = -span; dx <= span; dx++) {
      for (let dy = -span; dy <= span; dy++) {
        for (const i of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const d = dist(p, nodes[i]);
          if (d <= r) found.push([i, d]);
        }
      }
    }
    return found;
  };

  for (const e of ends) {
    for (const [i, d] of within(nodes[e], 1800)) {
      if (i !== e) link(e, i, d < 120 ? d * 1.2 + 5 : d * 2.5 + 200);
    }
  }

  // Connected pieces of the network: both ends must snap into the same one, or A* has nowhere
  // to go (the nearest road to a depot can be an island — a yard road with no join in reach).
  const parent = new Int32Array(nodes.length).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  edges.forEach((list, a) => {
    for (const [b] of list) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }
  });
  const candidates = (p: LngLat) => within(p, 30_000).sort((a, b) => a[1] - b[1]);
  const starts = candidates(from);
  const goals = candidates(to);
  const goalByComp = new Map<number, number>();
  for (const [i] of goals) if (!goalByComp.has(find(i))) goalByComp.set(find(i), i);
  let start = -1;
  let goal = -1;
  for (const [i] of starts) {
    const g = goalByComp.get(find(i));
    if (g !== undefined) {
      start = i;
      goal = g;
      break;
    }
  }
  if (start < 0 || goal < 0) return null;

  // A* with a binary heap.
  const g = new Float64Array(nodes.length).fill(Infinity);
  const came = new Int32Array(nodes.length).fill(-1);
  const heap: Array<[number, number]> = [];
  const push = (f: number, i: number) => {
    heap.push([f, i]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  g[start] = 0;
  push(dist(nodes[start], nodes[goal]), start);
  while (heap.length) {
    const [f, i] = pop();
    if (i === goal) break;
    if (f - dist(nodes[i], nodes[goal]) > g[i] + 1e-6) continue; // stale entry
    for (const [j, c] of edges[i]) {
      const ng = g[i] + c;
      if (ng < g[j]) {
        g[j] = ng;
        came[j] = i;
        push(ng + dist(nodes[j], nodes[goal]), j);
      }
    }
  }
  if (start !== goal && came[goal] < 0) return null;

  const path: LngLat[] = [];
  for (let i = goal; i >= 0; i = came[i]) path.push(nodes[i]);
  path.reverse();

  // Drop repeats and the needle-thin doubling back left where clipped pieces overlap.
  const clean: LngLat[] = [path[0]];
  for (const p of path.slice(1)) {
    const last = clean[clean.length - 1];
    if (dist(p, last) < 1) continue;
    if (clean.length >= 2) {
      const prev = clean[clean.length - 2];
      const ax = last[0] - prev[0];
      const ay = last[1] - prev[1];
      const bx = p[0] - last[0];
      const by = p[1] - last[1];
      if (ax * bx + ay * by < -0.5 * Math.hypot(ax, ay) * Math.hypot(bx, by)) {
        clean.pop();
        continue;
      }
    }
    clean.push(p);
  }
  return clean;
}

const reply = (msg: RouteResponse) => (self as unknown as { postMessage(m: RouteResponse): void }).postMessage(msg);

// Also imported on the main thread as a fallback, where there is a window and no worker to serve.
if (typeof window === 'undefined') {
  self.onmessage = (e: MessageEvent<RouteRequest>) => {
    try {
      reply({ id: e.data.id, route: plan(e.data) });
    } catch (err) {
      reply({ id: e.data.id, route: null, error: String(err) });
    }
  };
}
