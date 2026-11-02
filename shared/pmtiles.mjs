// Minimal PMTiles v3 reader for Node (spec: github.com/protomaps/PMTiles, spec/v3/spec.md).
// Serves the map's vector tiles to the UI — through the host in the game, through the Vite dev
// server on the desktop. Tiles come back decompressed, ready for MapLibre.

import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gunzip = promisify(zlib.gunzip);
const brotli = promisify(zlib.brotliDecompress);

const HEADER_BYTES = 127;
const COMPRESSION = { unknown: 0, none: 1, gzip: 2, brotli: 3, zstd: 4 };
const TILE_TYPE = { 1: 'mvt', 2: 'png', 3: 'jpg', 4: 'webp', 5: 'avif' };

function decompress(buf, compression) {
  switch (compression) {
    case COMPRESSION.none:
    case COMPRESSION.unknown:
      return buf;
    case COMPRESSION.gzip:
      return gunzip(buf);
    case COMPRESSION.brotli:
      return brotli(buf);
    default:
      throw new Error(`PMTiles compression ${compression} is not supported`);
  }
}

/** Tile id along the Hilbert curve of zoom level z, offset by the tiles of all lower levels. */
export function zxyToTileId(z, x, y) {
  if (z > 26) throw new Error('zoom too large');
  let acc = 0;
  for (let i = 0; i < z; i++) acc += 4 ** i;
  const n = 2 ** z;
  let tx = x;
  let ty = y;
  let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (tx & s) > 0 ? 1 : 0;
    const ry = (ty & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        tx = s - 1 - tx;
        ty = s - 1 - ty;
      }
      [tx, ty] = [ty, tx];
    }
  }
  return acc + d;
}

class Varints {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  next() {
    // Values reach past 2^32 (offsets in big archives), so no bitwise maths here.
    let result = 0;
    let mul = 1;
    for (;;) {
      const b = this.buf[this.pos++];
      if (b === undefined) throw new Error('PMTiles directory ended early');
      result += (b & 0x7f) * mul;
      if (b < 0x80) return result;
      mul *= 128;
    }
  }
}

function parseDirectory(buf) {
  const v = new Varints(buf);
  const count = v.next();
  const entries = new Array(count);
  let id = 0;
  for (let i = 0; i < count; i++) {
    id += v.next();
    entries[i] = { tileId: id, offset: 0, length: 0, runLength: 1 };
  }
  for (let i = 0; i < count; i++) entries[i].runLength = v.next();
  for (let i = 0; i < count; i++) entries[i].length = v.next();
  for (let i = 0; i < count; i++) {
    const value = v.next();
    entries[i].offset = value === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : value - 1;
  }
  return entries;
}

function findEntry(entries, tileId) {
  let lo = 0;
  let hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = tileId - entries[mid].tileId;
    if (c > 0) lo = mid + 1;
    else if (c < 0) hi = mid - 1;
    else return entries[mid];
  }
  // The entry before covers a run of identical tiles, or points at a leaf directory.
  if (hi >= 0) {
    const e = entries[hi];
    if (e.runLength === 0) return e;
    if (tileId - e.tileId < e.runLength) return e;
  }
  return null;
}

export class PmTiles {
  static async open(file) {
    const fh = await fs.open(file, 'r');
    const archive = new PmTiles(fh, file);
    await archive.init();
    return archive;
  }

  constructor(fh, file) {
    this.fh = fh;
    this.file = file;
    this.leaves = new Map(); // offset → entries, small LRU
  }

  async read(offset, length) {
    const buf = Buffer.allocUnsafe(length);
    const { bytesRead } = await this.fh.read(buf, 0, length, offset);
    return bytesRead === length ? buf : buf.subarray(0, bytesRead);
  }

  async init() {
    const h = await this.read(0, HEADER_BYTES);
    if (h.toString('latin1', 0, 7) !== 'PMTiles' || h[7] !== 3) throw new Error(`${this.file} is not a PMTiles v3 archive`);
    const u64 = o => Number(h.readBigUInt64LE(o));
    const e7 = o => h.readInt32LE(o) / 1e7;
    this.header = {
      rootOffset: u64(8),
      rootLength: u64(16),
      metadataOffset: u64(24),
      metadataLength: u64(32),
      leafOffset: u64(40),
      leafLength: u64(48),
      dataOffset: u64(56),
      dataLength: u64(64),
      internalCompression: h[97],
      tileCompression: h[98],
      tileType: TILE_TYPE[h[99]] ?? 'unknown',
      minZoom: h[100],
      maxZoom: h[101],
      bounds: [e7(102), e7(106), e7(110), e7(114)],
      center: [e7(119), e7(123), h[118]],
    };
    const root = await this.read(this.header.rootOffset, this.header.rootLength);
    this.root = parseDirectory(await decompress(root, this.header.internalCompression));
  }

  async metadata() {
    if (!this.meta) {
      const { metadataOffset, metadataLength, internalCompression } = this.header;
      const raw = await this.read(metadataOffset, metadataLength);
      this.meta = metadataLength ? JSON.parse((await decompress(raw, internalCompression)).toString('utf8')) : {};
    }
    return this.meta;
  }

  async leaf(offset, length) {
    const hit = this.leaves.get(offset);
    if (hit) {
      this.leaves.delete(offset);
      this.leaves.set(offset, hit);
      return hit;
    }
    const raw = await this.read(this.header.leafOffset + offset, length);
    const entries = parseDirectory(await decompress(raw, this.header.internalCompression));
    this.leaves.set(offset, entries);
    if (this.leaves.size > 64) this.leaves.delete(this.leaves.keys().next().value);
    return entries;
  }

  /** The tile's bytes, decompressed; null when the archive has no tile there. */
  async tile(z, x, y) {
    if (z < this.header.minZoom || z > this.header.maxZoom) return null;
    const id = zxyToTileId(z, x, y);
    let entries = this.root;
    for (let depth = 0; depth < 4; depth++) {
      const e = findEntry(entries, id);
      if (!e) return null;
      if (e.runLength > 0) {
        const raw = await this.read(this.header.dataOffset + e.offset, e.length);
        return decompress(raw, this.header.tileCompression);
      }
      entries = await this.leaf(e.offset, e.length);
    }
    return null;
  }

  /** TileJSON for MapLibre, pointing at `tilesUrl` (with {z}/{x}/{y}). */
  async tileJson(tilesUrl) {
    const meta = await this.metadata();
    const { minZoom, maxZoom, bounds, center } = this.header;
    return {
      tilejson: '3.0.0',
      tiles: [tilesUrl],
      minzoom: minZoom,
      maxzoom: maxZoom,
      bounds,
      center,
      vector_layers: meta.vector_layers ?? [],
      attribution: meta.attribution,
      name: meta.name,
    };
  }

  close() {
    return this.fh.close();
  }
}

/**
 * Serves a folder of archives: `tiles/<name>.json` (TileJSON), `tiles/<name>/<z>/<x>/<y>`, and
 * the plain data files beside them as `data/<file>.geojson`.
 * Returns { status, type, body } so the host's IPC handler and the dev server can share it.
 */
export class TileServer {
  constructor(dir, baseUrl) {
    this.dir = dir;
    this.baseUrl = baseUrl;
    this.archives = new Map();
  }

  archive(name) {
    if (!/^[\w-]+$/.test(name)) return null;
    if (!this.archives.has(name)) {
      const p = PmTiles.open(`${this.dir}/${name}.pmtiles`);
      p.catch(() => this.archives.delete(name));
      this.archives.set(name, p);
    }
    return this.archives.get(name);
  }

  async handle(path) {
    try {
      let m = /^tiles\/([\w-]+)\.json$/.exec(path);
      if (m) {
        const a = await this.archive(m[1]);
        if (!a) return { status: 404 };
        const json = await a.tileJson(`${this.baseUrl}tiles/${m[1]}/{z}/{x}/{y}`);
        return { status: 200, type: 'application/json', body: Buffer.from(JSON.stringify(json)) };
      }
      m = /^tiles\/([\w-]+)\/(\d+)\/(\d+)\/(\d+)$/.exec(path);
      if (m) {
        const a = await this.archive(m[1]);
        if (!a) return { status: 404 };
        const body = await a.tile(+m[2], +m[3], +m[4]);
        return body?.length ? { status: 200, type: 'application/x-protobuf', body } : { status: 204 };
      }
      m = /^data\/([\w-]+\.(geo)?json)$/.exec(path);
      if (m) {
        const body = await fs.readFile(`${this.dir}/${m[1]}`);
        return { status: 200, type: 'application/json', body };
      }
      // The road graph for directions (map/build-graph.mjs).
      if (path === 'data/graph.bin') {
        const body = await fs.readFile(`${this.dir}/graph.bin`);
        return { status: 200, type: 'application/octet-stream', body };
      }
      return { status: 404 };
    } catch (e) {
      return { status: 404, error: e };
    }
  }
}
