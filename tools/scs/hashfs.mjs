// Read-only access to SCS game archives (HashFS v2, used by ETS2 since 1.50).
// Layout: 53-byte header, zlib entry table (16 B per entry), zlib metadata table (u32 words).
// Each entry points at metadata headers (u24 index | u8 type); plain files carry a 16-byte
// record with size, compression and a 16-byte-aligned offset.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { cityHash64 } from './cityhash.mjs';

const META_IMG = 1;
const META_PLAIN = 0x80;
const META_DIRECTORY = 0x81;
const META_MIP_TAIL = 0x84;

const COMPRESSION = ['none', 'zlib', 'deflate', 'gdeflate', 'zstd'];

export const hashPath = p => cityHash64(p.replace(/^\/+/, ''));

export class HashFsArchive {
  constructor(file) {
    this.file = file;
    this.name = path.basename(file);
    this.fd = fs.openSync(file, 'r');
    const h = Buffer.alloc(53);
    fs.readSync(this.fd, h, 0, 53, 0);
    this.magic = h.toString('latin1', 0, 4);
    this.version = h.readUInt16LE(4);
    this.salt = h.readUInt16LE(6);
    this.hashMethod = h.toString('latin1', 8, 12);
    if (this.magic !== 'SCS#' || this.hashMethod !== 'CITY' || this.version !== 2 || this.salt !== 0) {
      this.valid = false;
      return;
    }
    this.valid = true;
    const count = h.readUInt32LE(12);
    const entryTableCompressed = h.readUInt32LE(16);
    const metaTableCompressed = h.readUInt32LE(24);
    const entryTableOffset = Number(h.readBigUInt64LE(28));
    const metaTableOffset = Number(h.readBigUInt64LE(36));

    const entryTable = zlib.inflateSync(this.#read(entryTableOffset, entryTableCompressed));
    const meta = zlib.inflateSync(this.#read(metaTableOffset, metaTableCompressed));

    this.entries = new Map();
    for (let i = 0; i < count; i++) {
      const o = i * 16;
      const hash = entryTable.readBigUInt64LE(o);
      const metaIndex = entryTable.readUInt32LE(o + 8);
      const metaCount = entryTable.readUInt16LE(o + 12);
      const isDirectory = (entryTable[o + 14] & 1) === 1;
      const metas = [];
      for (let m = 0; m < metaCount; m++) {
        const word = meta.readUInt32LE(4 * (metaIndex + m));
        metas.push({ type: word >>> 24, at: 4 * (word & 0xffffff) });
      }
      const plain = metas.find(m => m.type === META_PLAIN || m.type === META_DIRECTORY || m.type === META_MIP_TAIL);
      const img = metas.find(m => m.type === META_IMG);
      const entry = { hash, isDirectory, packedTexture: Boolean(img) };
      if (plain) {
        const packed = meta.readUInt32LE(plain.at);
        entry.compressedSize = packed & 0x0fffffff;
        entry.compression = COMPRESSION[packed >>> 28] ?? `unknown(${packed >>> 28})`;
        entry.size = meta.readUInt32LE(plain.at + 4) & 0x0fffffff;
        entry.offset = meta.readUInt32LE(plain.at + 12) * 16;
      }
      if (img) {
        entry.image = {
          width: meta.readUInt16LE(img.at) + 1,
          height: meta.readUInt16LE(img.at + 2) + 1,
          format: (meta.readUInt32LE(img.at + 4) >> 4) & 0xff,
          mips: 1 + (meta.readUInt32LE(img.at + 4) & 0xf),
        };
      }
      this.entries.set(hash, entry);
    }
  }

  #read(offset, length) {
    const b = Buffer.alloc(length);
    fs.readSync(this.fd, b, 0, length, offset);
    return b;
  }

  has(p) {
    return this.entries.has(hashPath(p));
  }

  entry(p) {
    return this.entries.get(hashPath(p));
  }

  readEntry(e) {
    const raw = this.#read(e.offset, e.compressedSize);
    switch (e.compression) {
      case 'none':
        return raw;
      case 'zlib':
        return zlib.inflateSync(raw);
      case 'deflate':
        return zlib.inflateRawSync(raw);
      default:
        throw new Error(`${this.name}: unsupported compression ${e.compression}`);
    }
  }

  read(p) {
    const e = this.entry(p);
    return e ? this.readEntry(e) : undefined;
  }

  // Directory listings: u32 count, count × u8 lengths, then names; "/name" marks a subdirectory.
  list(p) {
    const e = this.entry(p);
    if (!e || !e.isDirectory) return undefined;
    const b = this.readEntry(e);
    const n = b.readUInt32LE(0);
    let at = 4 + n;
    const dirs = [];
    const files = [];
    for (let i = 0; i < n; i++) {
      const s = b.toString('utf8', at, at + b[4 + i]);
      at += b[4 + i];
      if (s.startsWith('/')) dirs.push(s.slice(1));
      else files.push(s);
    }
    return { dirs, files };
  }

  close() {
    fs.closeSync(this.fd);
  }
}

// 3nK is a light byte scramble some .sii/.sui files use.
export function decodeText(buf) {
  if (buf.length >= 6 && buf.toString('latin1', 0, 3) === '3nK') {
    const out = Buffer.from(buf);
    let key = out[5];
    for (let i = 6; i < out.length; i++) {
      out[i] = ((((key << 2) ^ (key ^ 0xff)) << 3) ^ key ^ out[i]) & 0xff;
      key = (key + 1) & 0xff;
    }
    return out.toString('utf8', 6);
  }
  if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'ScsC') {
    throw new Error('encrypted SII (ScsC) is not supported');
  }
  return buf.toString('utf8');
}

// The game mounts archives in this order; later ones override earlier ones for the same path.
export function openGame(gameDir) {
  const names = fs
    .readdirSync(gameDir)
    .filter(f => f.endsWith('.scs'))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const archives = [];
  for (const n of names) {
    try {
      const a = new HashFsArchive(path.join(gameDir, n));
      if (a.valid) archives.push(a);
      else a.close();
    } catch (err) {
      console.warn(`skip ${n}: ${err.message}`);
    }
  }
  return new GameFs(archives);
}

function rank(name) {
  const order = ['effect.scs', 'core.scs', 'locale.scs', 'base_cfg.scs', 'base.scs', 'base_map.scs', 'base_vehicle.scs', 'base_share.scs', 'def.scs'];
  const i = order.indexOf(name);
  return i === -1 ? 100 : i;
}

export class GameFs {
  constructor(archives) {
    this.archives = archives;
  }

  // Last archive that holds the path wins, matching the game's mount order.
  find(p) {
    for (let i = this.archives.length - 1; i >= 0; i--) {
      const e = this.archives[i].entry(p);
      if (e) return { archive: this.archives[i], entry: e };
    }
    return undefined;
  }

  findAll(p) {
    return this.archives.filter(a => a.has(p)).map(a => ({ archive: a, entry: a.entry(p) }));
  }

  read(p) {
    const hit = this.find(p);
    return hit && !hit.entry.isDirectory ? hit.archive.readEntry(hit.entry) : undefined;
  }

  readText(p) {
    const b = this.read(p);
    return b === undefined ? undefined : decodeText(b);
  }

  // Directory listings are split per archive; merge them.
  list(p) {
    const dirs = new Set();
    const files = new Set();
    for (const a of this.archives) {
      const l = a.list(p);
      if (!l) continue;
      l.dirs.forEach(d => dirs.add(d));
      l.files.forEach(f => files.add(f));
    }
    return { dirs: [...dirs].sort(), files: [...files].sort() };
  }

  close() {
    this.archives.forEach(a => a.close());
  }
}
