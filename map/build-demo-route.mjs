// Builds the demo drive from the real map: the road from İstanbul to Edirne, found with A* over
// the road pieces in the tiles. Tiles clip roads at their edges and junction prefabs leave gaps
// between road items, so pieces are joined where they meet or nearly meet. The path is written
// in game coordinates for ui/src/state/demo.ts.
//
//   node map/build-demo-route.mjs [--from İstanbul] [--to Edirne] [--out ui/src/state/demoRoute.json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PmTiles } from '../shared/pmtiles.mjs';
import { lngLatToTile, tileFeatures } from './lib/mvt.mjs';
import { lngLatToGame } from '../ui/src/maps/projection.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const out = path.resolve(root, arg('out', 'ui/src/state/demoRoute.json'));
const fromName = arg('from', 'İstanbul');
const toName = arg('to', 'Edirne');
const Z = 8;

const search = JSON.parse(fs.readFileSync(path.join(root, 'map', 'data', 'ets2-search.geojson'), 'utf8'));
const city = name => {
  const f = search.features.find(f => f.properties.type === 'city' && (f.properties.label === name || f.properties.city?.name === name));
  if (!f) throw new Error(`no city ${name}`);
  return f.geometry.coordinates;
};
const FROM = city(fromName);
const TO = city(toName);
const pad = 0.35;
const BBOX = [Math.min(FROM[0], TO[0]) - pad, Math.min(FROM[1], TO[1]) - pad, Math.max(FROM[0], TO[0]) + pad, Math.max(FROM[1], TO[1]) + pad];

// Local metric frame in map metres.
const LAT0 = (FROM[1] + TO[1]) / 2;
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110_574;
const toXY = ([lng, lat]) => [lng * KX, lat * KY];
const toLngLat = ([x, y]) => [x / KX, y / KY];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const COST = { freeway: 1, divided: 1.25, local: 1.9 };
const archive = await PmTiles.open(path.join(root, 'map', 'data', 'ets2.pmtiles'));
const [x0, y0] = lngLatToTile(BBOX[0], BBOX[3], Z);
const [x1, y1] = lngLatToTile(BBOX[2], BBOX[1], Z);
const nodes = []; // [x, y]
const edges = []; // adjacency: [[to, cost], ...]
const ends = []; // node ids at piece ends
const node = p => {
  nodes.push(p);
  edges.push([]);
  return nodes.length - 1;
};
const link = (a, b, cost) => {
  edges[a].push([b, cost]);
  edges[b].push([a, cost]);
};
for (let tx = x0; tx <= x1; tx++) {
  for (let ty = y0; ty <= y1; ty++) {
    const buf = await archive.tile(Z, tx, ty);
    if (!buf) continue;
    for (const f of tileFeatures(buf, Z, tx, ty, 'ets2')) {
      const p = f.props;
      const k = COST[p.roadType];
      if (p.type !== 'road' || p.hidden || f.type !== 2 || !k) continue;
      for (const part of f.parts) {
        if (part.length < 2) continue;
        let prev = -1;
        for (const ll of part) {
          const id = node(toXY(ll));
          if (prev >= 0) link(prev, id, dist(nodes[prev], nodes[id]) * k);
          prev = id;
        }
        ends.push(prev - part.length + 1, prev);
      }
    }
  }
}
await archive.close();

// Spatial grid for joining pieces.
const CELL = 400;
const grid = new Map();
const key = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
nodes.forEach((p, i) => {
  const k = key(p[0], p[1]);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(i);
});
function near(p, r) {
  const found = [];
  const cx = Math.floor(p[0] / CELL);
  const cy = Math.floor(p[1] / CELL);
  const span = Math.ceil(r / CELL);
  for (let dx = -span; dx <= span; dx++) {
    for (let dy = -span; dy <= span; dy++) {
      for (const i of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        const d = dist(p, nodes[i]);
        if (d <= r) found.push([i, d]);
      }
    }
  }
  return found;
}

// Ends join whatever passes within reach: overlaps at tile edges are tight, gaps across junction
// prefabs are wider and cost more, so the path keeps to real road wherever it can.
let joins = 0;
for (const e of ends) {
  for (const [i, d] of near(nodes[e], 1800)) {
    if (i === e) continue;
    link(e, i, d < 120 ? d * 1.2 + 5 : d * 2.5 + 200);
    joins++;
  }
}
console.log(`${nodes.length} nodes, ${ends.length / 2} pieces, ${joins} joins`);

const closest = p => {
  let best = 0;
  nodes.forEach((n, i) => {
    if (dist(n, p) < dist(nodes[best], p)) best = i;
  });
  return best;
};
const start = closest(toXY(FROM));
const goal = closest(toXY(TO));

// A* (binary heap) from İstanbul to Edirne.
const g = new Float64Array(nodes.length).fill(Infinity);
const came = new Int32Array(nodes.length).fill(-1);
const heap = [];
const push = (f, i) => {
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
  const last = heap.pop();
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
  const [, i] = pop();
  if (i === goal) break;
  for (const [j, c] of edges[i]) {
    const ng = g[i] + c;
    if (ng < g[j]) {
      g[j] = ng;
      came[j] = i;
      push(ng + dist(nodes[j], nodes[goal]), j);
    }
  }
}
if (came[goal] < 0) throw new Error('no path');
const route = [];
for (let i = goal; i >= 0; i = came[i]) route.push(nodes[i]);
route.reverse();

// Drop duplicate points and needle-thin back-steps left by overlapping pieces.
const clean = [route[0]];
for (const p of route.slice(1)) {
  const last = clean[clean.length - 1];
  if (dist(p, last) < 1) continue;
  if (clean.length >= 2) {
    const prev = clean[clean.length - 2];
    const a = [last[0] - prev[0], last[1] - prev[1]];
    const b = [p[0] - last[0], p[1] - last[1]];
    if (a[0] * b[0] + a[1] * b[1] < -0.5 * Math.hypot(...a) * Math.hypot(...b)) {
      clean.pop(); // the path doubled back on itself here
      continue;
    }
  }
  clean.push(p);
}

// Even spacing in game metres, then game coordinates.
const game = clean.map(p => lngLatToGame(...toLngLat(p)));
const STEP = 6;
const even = [game[0]];
let carry = 0;
for (let i = 1; i < game.length; i++) {
  const a = game[i - 1];
  const b = game[i];
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let s = STEP - carry;
  while (s <= d) {
    even.push([a[0] + ((b[0] - a[0]) * s) / d, a[1] + ((b[1] - a[1]) * s) / d]);
    s += STEP;
  }
  carry = d - (s - STEP);
}
const lengthM = (even.length - 1) * STEP;
console.log(`route ${even.length} points, ${(lengthM / 1000).toFixed(1)} game km (${((lengthM * 19.23) / 1000).toFixed(0)} map km)`);

fs.writeFileSync(
  out,
  `${JSON.stringify({
    from: fromName,
    to: toName,
    step: STEP,
    points: even.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]),
  })}\n`,
);
console.log(`wrote ${path.relative(root, out)}`);
