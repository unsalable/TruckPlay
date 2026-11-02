// Builds TruckPlay's road graph from the player's own game: every drivable road and junction of
// the base map and the map DLCs they own, joined the way the game's GPS joins them, for turn-by-turn
// directions. Output: map/data/graph.bin (layout below, read by ui/src/maps/graph.ts).
//
//   node map/build-graph.mjs [--game <ETS2 folder>] [--out map/data/graph.bin] [--stats]
//
// What goes in:
//   nodes    where items meet: position, the heading of their forward side, the item on each side
//   roads    start/end node, length, lanes each way, speed class (motorway, expressway, local…)
//   prefabs  junctions: the descriptor they are an instance of, placed (position + rotation), and
//            which graph node each of the descriptor's nodes is
//   types    junction descriptors: nodes, lane curves and the game's nav links between nodes
//   ferries  ferry and train crossings between terminal junctions
// Hidden roads (not on the game's map, so not on its GPS either) and junctions of DLCs the player
// does not own are left out, as the game leaves them out.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGame } from '../tools/scs/hashfs.mjs';
import { parseSector } from './lib/sector.mjs';
import { parsePpd } from './lib/ppd.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const GAME = arg('game', process.env.ETS2_DIR ?? 'F:\\SteamLibrary\\steamapps\\common\\Euro Truck Simulator 2');
const out = path.resolve(root, arg('out', 'map/data/graph.bin'));
const STATS = process.argv.includes('--stats');
const t0 = Date.now();
const log = s => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);

const game = openGame(GAME);

// DLC guards: which map DLCs an item needs. Owned = its archive is installed.
const GUARD_DLCS = {
  1: ['east'], 2: ['north'], 3: ['fr'], 4: ['it'], 5: ['it', 'fr'], 6: ['balt'], 7: ['balt', 'east'], 8: ['balt', 'north'],
  9: ['balkan_e'], 10: ['balkan_e', 'east'], 11: ['iberia'], 12: ['iberia', 'fr'], 13: ['rus'], 14: ['rus', 'balt'],
  15: ['krone'], 16: ['balkan_w'], 17: ['balkan_w', 'east'], 18: ['balkan_w', 'balt'], 19: ['feldbinder'], 20: ['greece'],
  21: ['greece', 'east'], 22: ['greece', 'balkan_w'], 23: ['polar'], 24: ['polar', 'balt'], 25: ['polar', 'north'],
};
const owned = new Set(game.archives.map(a => /dlc_(\w+)\.scs$/i.exec(a.file ?? a.name ?? '')?.[1]).filter(Boolean));
// A guard we do not know (a DLC newer than this table) is taken as owned: its archive is the only
// way its roads get into the files at all.
const guardOk = g => g === 0 || !GUARD_DLCS[g] || GUARD_DLCS[g].every(d => owned.has(d));

// ---- definitions --------------------------------------------------------------------------------

const defFiles = prefix =>
  game
    .list('def/world')
    .files.filter(f => f.startsWith(prefix) && /\.(sii|sui)$/.test(f))
    .map(f => game.readText(`def/world/${f}`) ?? '');

// Speed classes, slowest last: what the lanes are for.
const CLASS = { motorway: 0, expressway: 1, local: 2, slow: 3, minor: 4 };
function laneClass(lane) {
  if (/\.motorway/.test(lane)) return CLASS.motorway;
  if (/\.expressway/.test(lane)) return CLASS.expressway;
  if (/\.road\.local/.test(lane)) return CLASS.local;
  if (/slow_road/.test(lane)) return CLASS.slow;
  return CLASS.minor; // no_vehicles: drivable, but no traffic uses it
}
const looks = new Map();
for (const text of defFiles('road_look')) {
  // Units end with a "}" on its own line, indented in some files.
  for (const m of text.matchAll(/road_look\s*:\s*road\.(\w+)\s*\{([\s\S]*?)\n\s*\}/g)) {
    const lanes = side => [...m[2].matchAll(new RegExp(`lanes_${side}\\[\\]\\s*:\\s*([\\w.]+)`, 'g'))].map(x => x[1]);
    const left = lanes('left');
    const right = lanes('right');
    const road = [...left, ...right].filter(l => !/^traffic_lane\.rail/.test(l));
    looks.set(m[1], {
      // Rail looks are tracks, not roads.
      left: left.filter(l => !/\.rail/.test(l)).length,
      right: right.filter(l => !/\.rail/.test(l)).length,
      cls: road.length ? Math.min(...road.map(laneClass)) : -1,
      name: /name:\s*"([^"]*)"/.exec(m[2])?.[1] ?? '',
    });
  }
}
log(`${looks.size} road looks`);

const prefabDefs = new Map();
for (const text of defFiles('prefab.')) {
  for (const m of text.matchAll(/prefab_model\s*:\s*prefab\.(\w+)\s*\{([\s\S]*?)\n\s*\}/g)) {
    const desc = /prefab_desc:\s*"([^"]+)"/.exec(m[2])?.[1];
    if (desc) prefabDefs.set(m[1], desc.replace(/^\//, ''));
  }
}
log(`${prefabDefs.size} junction definitions`);

// Ferry and train lines: conn.<port>.<port> with the crossing's time (game minutes) and distance (km).
const crossings = [];
for (const f of game.list('def/ferry/connection').files) {
  const text = game.readText(`def/ferry/connection/${f}`) ?? '';
  for (const m of text.matchAll(/ferry_connection\s*:\s*conn\.(\w+)\.(\w+)\s*\{([\s\S]*?)\}/g)) {
    const num = k => Number(new RegExp(`${k}:\\s*([\\d.]+)`).exec(m[3])?.[1] ?? 0);
    crossings.push({ a: m[1], b: m[2], time: num('time'), km: num('distance') });
  }
}

// ---- sectors ------------------------------------------------------------------------------------

const nodes = new Map();
const roads = [];
const prefabs = [];
const ferries = [];
let hiddenRoads = 0;
let guardedOut = 0;
for (const f of game.list('map/europe').files.filter(f => f.endsWith('.base'))) {
  const s = parseSector(game.read(`map/europe/${f}`));
  for (const n of s.nodes) nodes.set(n.uid, n);
  for (const r of s.roads) {
    if (r.hidden) hiddenRoads++;
    else if (!guardOk(r.dlcGuard)) guardedOut++;
    else roads.push(r);
  }
  for (const p of s.prefabs) {
    if (!p.hidden && guardOk(p.dlcGuard)) prefabs.push(p);
  }
  ferries.push(...s.ferries);
}
log(`${nodes.size} nodes, ${roads.length} roads (${hiddenRoads} hidden, ${guardedOut} of DLCs not owned), ${prefabs.length} junctions, ${ferries.length} ports`);

// ---- graph --------------------------------------------------------------------------------------

const nodeIndex = new Map();
const nodeList = [];
const idx = uid => {
  let i = nodeIndex.get(uid);
  if (i === undefined) {
    const n = nodes.get(uid);
    if (!n) return -1;
    i = nodeList.length;
    nodeIndex.set(uid, i);
    nodeList.push(n);
  }
  return i;
};

const roadRows = [];
const roadRef = new Map(); // road uid → row
let lookMissing = 0;
for (const r of roads) {
  const look = looks.get(r.look);
  if (!look) {
    lookMissing++;
    continue;
  }
  if (look.cls < 0 || (look.left === 0 && look.right === 0)) continue; // tracks
  const a = idx(r.start);
  const b = idx(r.end);
  if (a < 0 || b < 0) continue;
  roadRef.set(r.uid, roadRows.length);
  roadRows.push({ a, b, length: r.length, fwd: look.right, back: look.left, cls: look.cls, secret: r.secret });
}

// Junction descriptors, read once each.
const types = [];
const typeIndex = new Map();
let ppdFailed = 0;
function typeOf(model) {
  if (typeIndex.has(model)) return typeIndex.get(model);
  let t = -1;
  const file = prefabDefs.get(model);
  const buf = file && game.read(file);
  if (buf) {
    try {
      const d = parsePpd(buf);
      d.roundabout = isRoundabout(d, file);
      d.file = file;
      t = types.length;
      types.push(d);
    } catch {
      ppdFailed++;
    }
  }
  typeIndex.set(model, t);
  return t;
}

// A roundabout says so in its file name ("…_roundabout…", "…_round_narrow…", a ring's
// "round_center"); motorway joints with "round" in theirs are not. Where the name only hints
// ("one_way_round"), the lanes decide: going round a ring winds far more than it turns.
function isRoundabout(d, file) {
  const name = file.split('/').pop();
  if (!/round/i.test(name) || /joint|join_short|ground/i.test(name)) return false;
  if (/roundabout|round_center|_round_(narrow|wide|tmpl|tram)|^round_/i.test(name)) return true;
  const yaw = q => {
    const y = 2 * Math.atan2(q[1], q[0]);
    return Math.atan2(-Math.cos(y), -Math.sin(y));
  };
  const norm = a => Math.atan2(Math.sin(a), Math.cos(a));
  let loops = 0;
  for (const l of d.links) {
    if (!l.curves.length) continue;
    let wind = 0;
    let prev = null;
    for (const ci of l.curves) {
      const c = d.curves[ci];
      const a = yaw(c.q0), b = yaw(c.q1);
      if (prev !== null) wind += Math.abs(norm(a - prev));
      wind += Math.abs(norm(b - a));
      prev = b;
    }
    const net = Math.abs(norm(yaw(d.curves[l.curves[l.curves.length - 1]].q1) - yaw(d.curves[l.curves[0]].q0)));
    if (wind - net > (120 * Math.PI) / 180) loops++;
  }
  return loops >= 2;
}

// Fit a junction's own space onto the map from its nodes: the rotation and offset that carry the
// descriptor's node positions onto the placed nodes.
function placement(d, world) {
  const pts = [];
  for (let i = 0; i < d.nodes.length; i++) if (world[i] >= 0) pts.push([d.nodes[i], nodeList[world[i]]]);
  if (!pts.length) return null;
  let lx = 0, lz = 0, wx = 0, wz = 0;
  for (const [l, w] of pts) {
    lx += l.x; lz += l.z; wx += w.x; wz += w.z;
  }
  lx /= pts.length; lz /= pts.length; wx /= pts.length; wz /= pts.length;
  let angle;
  if (pts.length >= 2) {
    let dot = 0, cross = 0;
    for (const [l, w] of pts) {
      const ax = l.x - lx, az = l.z - lz, bx = w.x - wx, bz = w.z - wz;
      dot += ax * bx + az * bz;
      cross += ax * bz - az * bx;
    }
    angle = Math.atan2(cross, dot);
  } else {
    // One node: turn the descriptor's node direction onto the placed node's heading.
    const [l, w] = pts[0];
    angle = heading(w) - Math.atan2(l.dz, l.dx);
  }
  const c = Math.cos(angle), s = Math.sin(angle);
  return { angle, x: wx - (c * lx - s * lz), z: wz - (s * lx + c * lz) };
}

// A node's forward heading on the map (radians, x east, z south): its yaw rotates the game's
// forward axis (-z).
function heading(n) {
  const yaw = 2 * Math.atan2(n.qy, n.qw);
  return Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
}

const prefabRows = [];
const prefabRef = new Map();
let unplaced = 0;
for (const p of prefabs) {
  const t = typeOf(p.model);
  if (t < 0) continue;
  const d = types[t];
  const n = p.nodes.length;
  if (n !== d.nodes.length) continue;
  // The item lists its nodes starting from the descriptor's origin node.
  const world = new Array(n);
  for (let i = 0; i < n; i++) world[i] = idx(p.nodes[(i - p.origin + n) % n]);
  const place = placement(d, world);
  if (!place) {
    unplaced++;
    continue;
  }
  prefabRef.set(p.uid, prefabRows.length);
  prefabRows.push({ type: t, world, ...place });
}
log(`${types.length} junction kinds (${ppdFailed} unreadable), ${prefabRows.length} junctions placed (${unplaced} without nodes)`);

// Items on either side of each node: road r → r + 1, junction j → -(j + 1), else 0.
const itemRef = uid => {
  if (uid === 0n) return 0;
  const r = roadRef.get(uid);
  if (r !== undefined) return r + 1;
  const j = prefabRef.get(uid);
  return j !== undefined ? -(j + 1) : 0;
};

// Ferries: each port's terminal junction; lines join the road-side nodes of two terminals.
const ports = new Map();
for (const f of ferries) {
  const j = prefabRef.get(f.prefab);
  if (j === undefined) continue;
  if (!ports.has(f.port)) ports.set(f.port, { j, train: f.train });
}
const ferryRows = [];
for (const c of crossings) {
  const a = ports.get(c.a);
  const b = ports.get(c.b);
  if (!a || !b) continue;
  ferryRows.push({ a: a.j, b: b.j, time: c.time, km: c.km, train: a.train || b.train, names: [c.a, c.b] });
}
log(`${ferryRows.length} ferry and train lines`);

// ---- write --------------------------------------------------------------------------------------

const N = nodeList.length;
const R = roadRows.length;
const P = prefabRows.length;
const K = types.length;
const F = ferryRows.length;

const sections = {};
const add = (name, array) => {
  sections[name] = array;
};
add('nodeX', Float32Array.from(nodeList, n => n.x));
add('nodeZ', Float32Array.from(nodeList, n => n.z));
add('nodeHeading', Float32Array.from(nodeList, heading));
add('nodeFwd', Int32Array.from(nodeList, n => itemRef(n.fwd)));
add('nodeBwd', Int32Array.from(nodeList, n => itemRef(n.back)));

add('roadA', Int32Array.from(roadRows, r => r.a));
add('roadB', Int32Array.from(roadRows, r => r.b));
add('roadLength', Float32Array.from(roadRows, r => r.length));
// lanes forward (4 bits) | lanes back (4 bits) | class (4 bits) | secret (1 bit)
add('roadInfo', Uint32Array.from(roadRows, r => Math.min(15, r.fwd) | (Math.min(15, r.back) << 4) | (r.cls << 8) | (r.secret ? 1 << 12 : 0)));

const typeNodeStart = new Int32Array(K + 1);
const typeCurveStart = new Int32Array(K + 1);
const typeLinkStart = new Int32Array(K + 1);
let tn = 0, tc = 0, tl = 0, tlc = 0;
for (let k = 0; k < K; k++) {
  typeNodeStart[k] = tn;
  typeCurveStart[k] = tc;
  typeLinkStart[k] = tl;
  tn += types[k].nodes.length;
  tc += types[k].curves.length;
  tl += types[k].links.length;
  for (const l of types[k].links) tlc += l.curves.length;
}
typeNodeStart[K] = tn;
typeCurveStart[K] = tc;
typeLinkStart[K] = tl;
const typeNodes = new Float32Array(tn * 4);
const typeCurves = new Float32Array(tc * 7);
const typeLinks = new Int32Array(tl * 4);
const typeLinkLength = new Float32Array(tl);
const typeLinkCurves = new Uint16Array(tlc + (tlc & 1));
const typeFlags = new Uint8Array(K + ((4 - (K % 4)) % 4));
const curveYaw = q => {
  // A curve's direction on the map, from its rotation (w, y), as for nodes.
  const yaw = 2 * Math.atan2(q[1], q[0]);
  return Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
};
tn = tc = tl = tlc = 0;
for (let k = 0; k < K; k++) {
  const d = types[k];
  for (const n of d.nodes) typeNodes.set([n.x, n.z, n.dx, n.dz], 4 * tn++);
  for (const c of d.curves) typeCurves.set([c.x0, c.z0, c.x1, c.z1, curveYaw(c.q0), curveYaw(c.q1), c.length], 7 * tc++);
  for (const l of d.links) {
    typeLinks.set([l.from, l.to, tlc, l.curves.length], 4 * tl);
    typeLinkLength[tl++] = l.length;
    for (const c of l.curves) typeLinkCurves[tlc++] = c;
  }
  typeFlags[k] = d.roundabout ? 1 : 0;
}
add('typeNodeStart', typeNodeStart);
add('typeCurveStart', typeCurveStart);
add('typeLinkStart', typeLinkStart);
add('typeNodes', typeNodes);
add('typeCurves', typeCurves);
add('typeLinks', typeLinks);
add('typeLinkLength', typeLinkLength);
add('typeLinkCurves', typeLinkCurves);
add('typeFlags', typeFlags);

const prefabNodeStart = new Int32Array(P + 1);
let pn = 0;
for (let j = 0; j < P; j++) {
  prefabNodeStart[j] = pn;
  pn += prefabRows[j].world.length;
}
prefabNodeStart[P] = pn;
const prefabNodes = new Int32Array(pn);
pn = 0;
for (const p of prefabRows) for (const w of p.world) prefabNodes[pn++] = w;
add('prefabType', Int32Array.from(prefabRows, p => p.type));
add('prefabX', Float32Array.from(prefabRows, p => p.x));
add('prefabZ', Float32Array.from(prefabRows, p => p.z));
add('prefabAngle', Float32Array.from(prefabRows, p => p.angle));
add('prefabNodeStart', prefabNodeStart);
add('prefabNodes', prefabNodes);

add('ferryA', Int32Array.from(ferryRows, f => f.a));
add('ferryB', Int32Array.from(ferryRows, f => f.b));
add('ferryTime', Float32Array.from(ferryRows, f => f.time));
add('ferryKm', Float32Array.from(ferryRows, f => f.km));
add('ferryTrain', Uint32Array.from(ferryRows, f => (f.train ? 1 : 0)));

// File: "TPG1", u32 JSON length, JSON (counts, section offsets, ferry port names), padding to 4,
// then the sections, each 4-byte aligned.
const layout = {};
let offset = 0;
for (const [name, a] of Object.entries(sections)) {
  layout[name] = [offset, a.length, a.constructor.name];
  offset += Math.ceil(a.byteLength / 4) * 4;
}
const meta = {
  version: 1,
  built: new Date().toISOString(),
  dlcs: [...owned].sort(),
  counts: { nodes: N, roads: R, prefabs: P, types: K, ferries: F },
  ferryNames: ferryRows.map(f => f.names),
  // Which descriptor each junction kind is (for telling junctions apart when debugging directions).
  typeFiles: types.map(t => t.file),
  sections: layout,
};
let json = Buffer.from(JSON.stringify(meta), 'utf8');
const pad = (4 - ((8 + json.length) % 4)) % 4;
json = Buffer.concat([json, Buffer.alloc(pad, 0x20)]);
const headerLen = 8 + json.length;
const file = Buffer.alloc(headerLen + offset);
file.write('TPG1', 0, 'latin1');
file.writeUInt32LE(json.length, 4);
json.copy(file, 8);
for (const [name, a] of Object.entries(sections)) {
  Buffer.from(a.buffer, a.byteOffset, a.byteLength).copy(file, headerLen + layout[name][0]);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, file);
log(`${out}: ${N} nodes, ${R} roads, ${P} junctions of ${K} kinds, ${F} crossings — ${(file.length / 1048576).toFixed(1)} MB`);
if (lookMissing) log(`${lookMissing} roads with an unknown look left out`);

if (STATS) {
  // Sanity: a road's start node has it on its forward side, its end node on its backward side.
  let ok = 0, bad = 0;
  for (let r = 0; r < R; r++) {
    const a = nodeList[roadRows[r].a], b = nodeList[roadRows[r].b];
    if (itemRef(a.fwd) === r + 1 && itemRef(b.back) === r + 1) ok++;
    else bad++;
  }
  log(`road ends: ${ok} as expected, ${bad} not`);
  const linkCounts = types.map(t => t.links.length);
  log(`links per junction kind: avg ${(linkCounts.reduce((a, b) => a + b, 0) / K).toFixed(1)}, none ${linkCounts.filter(n => n === 0).length}`);
  log(`roundabout kinds: ${types.filter(t => t.roundabout).length}; e.g. ${types.filter(t => t.roundabout).slice(0, 3).map(t => t.file).join(', ')}`);
  log(`owned DLC maps: ${[...owned].sort().join(', ')}`);
}
game.close();
