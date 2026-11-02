// Reader for the game's map sectors (map/europe/*.base, format 907 — ETS2 1.61): the roads and
// junctions (prefabs) that make up the road network, the ferry and train ports, and the nodes that
// join them. Items follow one another with no length prefix, so every kind is walked field by field
// to find where the next one starts; only what the road graph needs is kept.
//
// Field lists from the community's notes on the format (sk-zk/map-docs, dariowouters/ts-map's
// templates, truckermudgeon/maps' parser), written out here on their own.

import { tokenName } from '../../mod/lib/models.mjs';

export const SECTOR_VERSION = 907;

const T = {
  terrain: 1, building: 2, road: 3, prefab: 4, model: 5, company: 6, service: 7, cutPlane: 8, mover: 9,
  noWeather: 11, city: 12, hinge: 13, mapOverlay: 18, ferry: 19, garage: 22, cameraPoint: 23, trigger: 34,
  fuelPump: 35, sign: 36, busStop: 37, trafficRule: 38, bezierPatch: 39, compound: 40, trajectory: 41,
  mapArea: 42, farModel: 43, curve: 44, cameraPath: 45, cutscene: 46, hookup: 47, visibilityArea: 48, gate: 49,
};

class Cursor {
  constructor(buf) {
    this.b = buf;
    this.o = 0;
  }
  u8() {
    return this.b[this.o++];
  }
  u16() {
    const v = this.b.readUInt16LE(this.o);
    this.o += 2;
    return v;
  }
  i32() {
    const v = this.b.readInt32LE(this.o);
    this.o += 4;
    return v;
  }
  u32() {
    const v = this.b.readUInt32LE(this.o);
    this.o += 4;
    return v;
  }
  f32() {
    const v = this.b.readFloatLE(this.o);
    this.o += 4;
    return v;
  }
  u64() {
    const v = this.b.readBigUInt64LE(this.o);
    this.o += 8;
    return v;
  }
  token() {
    return tokenName(this.u64());
  }
  skip(n) {
    this.o += n;
    if (this.o > this.b.length) throw new RangeError(`read past the end (${this.o} > ${this.b.length})`);
  }
  /** A u32 count, then that many fixed-size records. */
  skipList(size) {
    const n = this.u32();
    this.skip(n * size);
    return n;
  }
  skipList16(size) {
    const n = this.u16();
    this.skip(n * size);
    return n;
  }
  uids() {
    const n = this.u32();
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.u64();
    return out;
  }
  /** A string with a u64 length. */
  string() {
    const n = Number(this.u64());
    const s = this.b.toString('utf8', this.o, this.o + n);
    this.skip(n);
    return s;
  }
}

/** Terrain and Bézier patches carry a quad grid of terrain materials. */
function skipQuad(c) {
  c.skipList16(10); // materials: token, u16 rotation
  c.skipList16(4); // colours
  c.skip(4); // grid size x, y
  c.skipList(4); // storage
  c.skipList(16); // offsets: u16 x, u16 y, float3 normal
  c.skipList(16); // normals: the same
}
const skipSpheres = c => c.skipList(20); // vegetation spheres: float3 centre, radius, u32 type

// The common head of every item, after its u32 type: uid, position, rotation and flags.
function head(c) {
  const uid = c.u64();
  const x = c.f32();
  c.skip(4); // height
  const z = c.f32();
  c.skip(12 + 12 + 4); // position range, rotation, padding
  const flags = c.u32();
  c.skip(1); // view distance
  return { uid, x, z, flags };
}

/** One item; returns what the graph keeps from it (roads, prefabs, ferries), else null. */
function item(c, out, inCompound) {
  const type = c.u32();
  const h = head(c);
  switch (type) {
    case T.terrain:
      c.skip(16 + 24 + 8 + 4); // nodes, node offsets, lengths, seed
      c.skip(3 * 10); // railings: token, u16 offset
      c.skip(2 * (2 + 8 + 4 + 8 + 4 + 3 * 16 + 4)); // two terrain sides with three vegetation layers
      skipSpheres(c);
      skipQuad(c);
      skipQuad(c);
      c.skip(4 * 8); // edges and their looks
      return;
    case T.building:
      c.skip(16 + 16 + 4 + 4 + 4); // scheme, look, nodes, length, seed, stretch
      c.skipList(4); // height offsets
      return;
    case T.road: {
      c.skip(1); // flags
      const dlcGuard = c.u8();
      c.skip(2);
      const look = c.token();
      const rightLanes = c.token();
      const leftLanes = c.token();
      c.skip(2 * 8 + 4 * 8); // template variants, edges
      c.skip(12 + 12 + 16 + 8); // profiles, template looks, material
      c.skip(3 * 20); // railings: token, i16 offset, on both sides
      c.skip(8); // road heights
      const start = c.u64();
      const end = c.u64();
      const length = c.f32();
      if (!inCompound) {
        out.roads.push({
          uid: h.uid,
          look,
          rightLanes,
          leftLanes,
          start,
          end,
          length,
          dlcGuard,
          hidden: (h.flags & 0x02000000) !== 0,
          secret: (h.flags & 0x00010000) !== 0,
        });
      }
      return;
    }
    case T.prefab: {
      const model = c.token();
      c.skip(8); // variant
      c.skipList(8); // parts
      const nodes = c.uids();
      c.skipList(8); // connected items
      const ferryLink = c.u64();
      const origin = c.u16();
      c.skip(nodes.length * 12); // terrain per node: token, coefficient
      c.skip(8); // semaphore profile
      if (!inCompound) {
        out.prefabs.push({
          uid: h.uid,
          model,
          nodes,
          origin,
          ferryLink,
          dlcGuard: (h.flags & 0xff00) >> 8,
          hidden: (h.flags & 0x00020000) !== 0,
          secret: (h.flags & 0x20) !== 0,
          x: h.x,
          z: h.z,
        });
      }
      return;
    }
    case T.model:
      c.skip(24); // model, look, variant
      c.skipList(8); // extra parts
      c.skip(8 + 12 + 8 + 4 + 4); // node, scale, material, colour, terrain rotation
      return;
    case T.company: {
      const city = c.token();
      const prefab = c.u64();
      const name = c.token();
      const node = c.u64();
      c.skipList(12); // nodes with flags
      if (!inCompound) out.companies.push({ uid: h.uid, name, city, prefab, node });
      return;
    }
    case T.service:
      c.skip(16);
      c.skipList(8);
      return;
    case T.cutPlane:
      c.skipList(8);
      return;
    case T.mover:
      c.skipList(8); // tags
      c.skip(24 + 12 + 4); // model, look, variant, speed, delay, width, count
      c.skipList(4); // lengths
      c.skipList(8); // nodes
      return;
    case T.noWeather:
      c.skip(8 + 4 + 16 + 8);
      return;
    case T.city:
      c.skip(8 + 8 + 8);
      return;
    case T.hinge:
      c.skip(16 + 8 + 8);
      return;
    case T.mapOverlay:
      c.skip(16);
      return;
    case T.ferry: {
      const port = c.token();
      const prefab = c.u64();
      const node = c.u64();
      c.skip(12); // unload offset
      if (!inCompound) out.ferries.push({ uid: h.uid, port, prefab, node, train: (h.flags & 1) !== 0, x: h.x, z: h.z });
      return;
    }
    case T.garage:
      c.skip(8 + 4 + 8 + 8);
      c.skipList(8);
      return;
    case T.cameraPoint:
      c.skipList(8);
      c.skip(8);
      return;
    case T.trigger: {
      c.skipList(8); // tags
      const nodes = c.skipList(8);
      const actions = c.u32();
      for (let i = 0; i < actions; i++) {
        c.skip(8); // action
        const override = c.i32();
        if (override > 0) c.skip(override * 4);
        if (override >= 0) {
          const params = c.u32();
          for (let j = 0; j < params; j++) c.string();
          c.skipList(8); // target tags
          c.skip(8); // range, type
        }
      }
      if (nodes === 1) c.skip(4); // radius
      return;
    }
    case T.fuelPump:
      c.skip(16);
      c.skipList(8);
      return;
    case T.sign: {
      c.skip(8 + 8 + 8 + 8); // model, node, look, variant
      const boards = c.u8();
      c.skip(boards * 24);
      const template = c.string();
      if (template !== '') {
        const n = c.u32();
        for (let i = 0; i < n; i++) {
          c.skip(8);
          const f = c.u8();
          if (f & 1) c.skip(2);
          if (f & 2) c.skip(8);
        }
        const items = c.u32();
        for (let i = 0; i < items; i++) {
          c.skip(4 + 8);
          const attrs = c.u32();
          for (let j = 0; j < attrs; j++) {
            const kind = c.u16();
            c.skip(4); // index
            if (kind === 1) c.skip(1);
            else if (kind === 2 || kind === 3 || kind === 4) c.skip(4);
            else if (kind === 5) c.string();
            else if (kind === 6) c.skip(8);
            else throw new Error(`sign attribute of unknown kind ${kind}`);
          }
        }
      }
      return;
    }
    case T.busStop:
      c.skip(24);
      return;
    case T.trafficRule:
      c.skipList(8);
      c.skipList(8);
      c.skip(12);
      return;
    case T.bezierPatch:
      c.skip(16 * 12 + 4 + 8 + 4 + 3 * 11);
      skipSpheres(c);
      skipQuad(c);
      return;
    case T.compound: {
      c.skip(8); // node
      const children = c.u32();
      for (let i = 0; i < children; i++) item(c, out, true);
      c.skipList(56); // the children's own nodes
      return;
    }
    case T.trajectory:
      c.skipList(8);
      c.skip(8);
      c.skipList(28); // route rules: node, token, padding, float3
      c.skipList(16); // checkpoints
      c.skipList(8); // tags
      return;
    case T.mapArea:
      c.skipList(8);
      c.skip(4);
      return;
    case T.farModel:
      c.skip(8);
      c.skipList(20);
      c.skipList(8);
      c.skipList(8);
      return;
    case T.curve: {
      c.skip(16 + 16 + 4); // nodes, padding uids, length
      const mask = c.u32();
      let n = 0;
      for (let m = mask; m; m &= m - 1) n++;
      for (let i = 0; i < n; i++) {
        c.skip(76);
        c.skipList(4); // height offsets
        c.skip(20);
      }
      return;
    }
    case T.cameraPath:
      c.skipList(8);
      c.skipList(8);
      c.skipList(8);
      c.skipList(8);
      c.skipList(40); // key frames
      c.skip(4);
      return;
    case T.cutscene: {
      c.skipList(8);
      c.skip(8);
      const actions = c.u32();
      for (let i = 0; i < actions; i++) {
        c.skipList(4);
        const strings = c.u32();
        for (let j = 0; j < strings; j++) c.string();
        c.skipList(8);
        c.skip(8);
      }
      return;
    }
    case T.hookup:
      c.string();
      c.skip(8);
      return;
    case T.visibilityArea:
      c.skip(8 + 8);
      c.skipList(8);
      return;
    case T.gate:
      c.skip(8);
      c.skipList(8);
      for (let i = 0; i < 2; i++) {
        c.string();
        c.skip(4);
      }
      return;
    default:
      throw new Error(`item of unknown type ${type} at ${c.o}`);
  }
}

/**
 * One sector: { roads, prefabs, ferries, companies, nodes }. Node positions in metres (x east,
 * z south, y up); `qw`/`qy` the yaw part of the node's rotation; `back`/`fwd` the items on either
 * side of it.
 */
export function parseSector(buf) {
  const c = new Cursor(buf);
  const version = c.u32();
  if (version !== SECTOR_VERSION) throw new Error(`sector format ${version}, expected ${SECTOR_VERSION}`);
  c.skip(8 + 4); // game id, padding
  const out = { roads: [], prefabs: [], ferries: [], companies: [], nodes: [] };
  const items = c.u32();
  for (let i = 0; i < items; i++) item(c, out, false);
  const nodes = c.u32();
  for (let i = 0; i < nodes; i++) {
    const uid = c.u64();
    const x = c.i32() / 256;
    const y = c.i32() / 256;
    const z = c.i32() / 256;
    const qw = c.f32();
    c.skip(4);
    const qy = c.f32();
    c.skip(4);
    const back = c.u64();
    const fwd = c.u64();
    const flags = c.u32();
    out.nodes.push({ uid, x, y, z, qw, qy, back, fwd, flags });
  }
  c.skipList(8); // visible area children
  if (c.o !== buf.length) throw new Error(`sector read ${c.o} of ${buf.length} bytes`);
  return out;
}
