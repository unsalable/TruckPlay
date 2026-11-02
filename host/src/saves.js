// What the player owns, from the game's own save: which garages are bought. The game writes the
// save every few minutes while driving (autosave) and the SDK does not report garages, so this
// reads the newest game.sii of the profile in use: an ScsC container (AES-256-CBC with the
// game's published key, then zlib) around either a text SII or a binary one (BSII).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const KEY = Buffer.from([
  0x2a, 0x5f, 0xcb, 0x17, 0x91, 0xd2, 0x2f, 0xb6, 0x02, 0x45, 0xb3, 0xd8, 0x36, 0x9e, 0xd0, 0xb2, 0xc2, 0x73, 0x71, 0x56, 0x3f,
  0xbf, 0x1f, 0x3c, 0x9e, 0xdf, 0x6b, 0x11, 0x82, 0x5a, 0x5d, 0x0a,
]);

/** The save's plain bytes (text "SiiNunit…" or binary "BSII…"). */
export function openSave(file) {
  const b = fs.readFileSync(file);
  const sig = b.toString('latin1', 0, 4);
  if (sig === 'ScsC') {
    const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, b.subarray(36, 52));
    decipher.setAutoPadding(false);
    return zlib.inflateSync(Buffer.concat([decipher.update(b.subarray(56)), decipher.final()]));
  }
  return b;
}

// ---------- binary SII ----------

const TOKEN_CHARS = '\0' + '0123456789' + 'abcdefghijklmnopqrstuvwxyz' + '_';
function token(v) {
  let s = '';
  for (let x = v; x > 0n; x /= 38n) s += TOKEN_CHARS[Number(x % 38n)];
  return s;
}

/** Every unit of the given classes in a BSII save: { cls, id, values }. */
export function readBinaryUnits(buf, classes) {
  let o = 8;
  const u8 = () => buf[o++];
  const u32 = () => {
    const v = buf.readUInt32LE(o);
    o += 4;
    return v;
  };
  const str = () => {
    const n = u32();
    const s = buf.toString('utf8', o, o + n);
    o += n;
    return s;
  };
  const id = () => {
    const parts = u8();
    if (parts === 0xff) {
      const v = buf.readBigUInt64LE(o);
      o += 8;
      return `_nameless.${v.toString(16)}`;
    }
    const names = [];
    for (let i = 0; i < parts; i++) {
      names.push(token(buf.readBigUInt64LE(o)));
      o += 8;
    }
    return names.join('.');
  };
  const FIXED = {
    0x03: 8, 0x05: 4, 0x07: 8, 0x09: 12, 0x11: 12, 0x17: 16, 0x19: 32, 0x25: 4, 0x27: 4, 0x2b: 2, 0x2f: 4, 0x31: 8, 0x33: 8, 0x35: 1, 0x37: 4,
  };
  const ARRAY_OF = { 0x04: 0x03, 0x06: 0x05, 0x08: 0x07, 0x0a: 0x09, 0x12: 0x11, 0x18: 0x17, 0x1a: 0x19, 0x26: 0x25, 0x28: 0x27, 0x2c: 0x2b, 0x32: 0x31, 0x34: 0x33, 0x36: 0x35 };
  // Reads (or, with keep false, skips) one value.
  const value = (type, keep, field) => {
    if (type === 0x01) {
      if (keep) return str();
      const n = u32(); // (o += u32() would read o before u32 moves it)
      o += n;
      return undefined;
    }
    if (type === 0x02) {
      const n = u32();
      const out = [];
      for (let i = 0; i < n; i++) out.push(str());
      return keep ? out : undefined;
    }
    if (type === 0x39 || type === 0x3b || type === 0x3d) return keep ? id() : (id(), undefined);
    if (type === 0x3a || type === 0x3c) {
      const n = u32();
      const out = [];
      for (let i = 0; i < n; i++) out.push(id());
      return keep ? out : undefined;
    }
    if (FIXED[type] !== undefined) {
      const at = o;
      o += FIXED[type];
      if (!keep) return undefined;
      switch (type) {
        case 0x03:
          return token(buf.readBigUInt64LE(at));
        case 0x05:
          return buf.readFloatLE(at);
        case 0x25:
          return buf.readInt32LE(at);
        case 0x27:
        case 0x2f:
          return buf.readUInt32LE(at);
        case 0x2b:
          return buf.readUInt16LE(at);
        case 0x09:
          return [buf.readFloatLE(at), buf.readFloatLE(at + 4), buf.readFloatLE(at + 8)];
        case 0x11:
          return [buf.readInt32LE(at), buf.readInt32LE(at + 4), buf.readInt32LE(at + 8)];
        case 0x35:
          return buf[at] !== 0;
        case 0x37:
          return field.ordinals?.get(buf.readUInt32LE(at)) ?? buf.readUInt32LE(at);
        default:
          return undefined;
      }
    }
    if (ARRAY_OF[type] !== undefined) {
      const n = u32();
      if (keep && type === 0x12) {
        const out = [];
        for (let i = 0; i < n; i++) out.push([buf.readInt32LE(o + i * 12), buf.readInt32LE(o + i * 12 + 4), buf.readInt32LE(o + i * 12 + 8)]);
        o += n * 12;
        return out;
      }
      o += n * FIXED[ARRAY_OF[type]];
      return undefined;
    }
    throw new Error(`BSII value type 0x${type.toString(16)} at ${o}`);
  };

  const structs = new Map();
  const units = [];
  while (o + 4 <= buf.length) {
    const block = u32();
    if (block === 0) {
      if (!u8()) break; // the end
      const sid = u32();
      const name = str();
      const fields = [];
      for (;;) {
        const type = u32();
        if (!type) break;
        const fname = str();
        let ordinals;
        if (type === 0x37) {
          ordinals = new Map();
          const n = u32();
          for (let i = 0; i < n; i++) {
            const k = u32();
            ordinals.set(k, str());
          }
        }
        fields.push({ type, name: fname, ordinals });
      }
      structs.set(sid, { name, fields });
      continue;
    }
    const s = structs.get(block);
    if (!s) throw new Error(`BSII unknown structure ${block} at ${o - 4}`);
    const unitId = id();
    const keep = classes.has(s.name);
    const values = keep ? {} : null;
    for (const f of s.fields) {
      const v = value(f.type, keep, f);
      if (keep) values[f.name] = v;
    }
    if (keep) units.push({ cls: s.name, id: unitId, values });
  }
  return units;
}

// ---------- text SII ----------

function readTextUnits(text, classes) {
  const units = [];
  for (const m of text.matchAll(/^\s*([a-z_]+)\s*:\s*([\w.]+)\s*\{([\s\S]*?)^\s*\}/gm)) {
    if (!classes.has(m[1])) continue;
    const values = {};
    for (const line of m[3].matchAll(/^\s*(\w+)\s*:\s*(.*?)\s*$/gm)) values[line[1]] = line[2];
    units.push({ cls: m[1], id: m[2], values });
  }
  return units;
}

/** Units of the given classes from a save, whichever SII flavour it is. */
export function readUnits(file, classes) {
  const buf = openSave(file);
  const sig = buf.toString('latin1', 0, 4);
  if (sig === 'BSII') return readBinaryUnits(buf, new Set(classes));
  return readTextUnits(buf.toString('utf8'), new Set(classes));
}

// ---------- where saves are ----------

function* saveFiles(roots) {
  for (const root of roots) {
    let profiles;
    try {
      profiles = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory());
    } catch {
      continue;
    }
    for (const p of profiles) {
      const saveDir = path.join(root, p.name, 'save');
      let slots;
      try {
        slots = fs.readdirSync(saveDir, { withFileTypes: true }).filter(d => d.isDirectory());
      } catch {
        continue;
      }
      for (const s of slots) yield path.join(saveDir, s.name, 'game.sii');
    }
  }
}

/** Profile folders: Steam Cloud ones (Steam's userdata) and local ones (Documents). */
export function profileRoots(documents, steamDirs = []) {
  const roots = [
    path.join(documents, 'Euro Truck Simulator 2', 'profiles'),
    path.join(documents, 'Euro Truck Simulator 2', 'steam_profiles'),
  ];
  for (const steam of new Set([...steamDirs, 'C:/Program Files (x86)/Steam', 'C:/Program Files/Steam'])) {
    let users = [];
    try {
      users = fs.readdirSync(path.join(steam, 'userdata'));
    } catch {
      continue;
    }
    for (const u of users) roots.push(path.join(steam, 'userdata', u, '227300', 'remote', 'profiles'));
  }
  return roots;
}

/** The newest save of any profile (the one being played). */
export function latestSave(roots) {
  let best = null;
  for (const file of saveFiles(roots)) {
    try {
      const t = fs.statSync(file).mtimeMs;
      if (!best || t > best.t) best = { file, t };
    } catch {
      // slot without a game.sii
    }
  }
  return best;
}

/** City tokens of the garages the player owns. */
export function ownedGarages(file) {
  return readUnits(file, ['garage'])
    .filter(u => Number(u.values.status) > 0)
    .map(u => u.id.replace(/^garage\./, ''));
}

/**
 * What TruckPlay shows from a save: the garages owned (city tokens), the headquarters city, and
 * the waypoints the game's GPS route still has ahead (game metres [x, z], the last one is where
 * the route ends).
 */
export function saveInfo(file) {
  const units = readUnits(file, ['garage', 'player', 'economy', 'gps_waypoint_storage']);
  const economy = units.find(u => u.cls === 'economy')?.values ?? {};
  const player = units.find(u => u.cls === 'player')?.values ?? {};
  const stored = new Map(units.filter(u => u.cls === 'gps_waypoint_storage').map(u => [u.id, u.values.nav_node_position]));
  // The game keeps two GPS routes: one for single player and one for multiplayer (Convoy). Each
  // is a list of the waypoints still ahead; the last is where the route ends.
  const ahead = ids => {
    const out = [];
    for (const id of ids ?? []) {
      const p = stored.get(id);
      if (Array.isArray(p)) out.push([p[0] / 256, p[2] / 256]); // 24.8 fixed point
    }
    return out;
  };
  return {
    garages: units.filter(u => u.cls === 'garage' && Number(u.values.status) > 0).map(u => u.id.replace(/^garage\./, '')),
    hq: typeof player.hq_city === 'string' ? player.hq_city : '',
    waypoints: ahead(economy.stored_gps_ahead_waypoints),
    onlineWaypoints: ahead(economy.stored_online_gps_ahead_waypoints),
  };
}
