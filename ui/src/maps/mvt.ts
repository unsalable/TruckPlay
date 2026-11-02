// Just enough Mapbox Vector Tile decoding for the route planner: road lines with their
// properties, in longitude/latitude. (MapLibre decodes tiles for drawing; this is for routing.)

export interface TileLine {
  props: Record<string, string | number | boolean | null>;
  type: number; // 1 point, 2 line, 3 polygon
  parts: Array<Array<[number, number]>>;
}

const text = new TextDecoder();

export function decodeTile(buf: Uint8Array, z: number, tx: number, ty: number, keep: (props: TileLine['props'], type: number) => boolean): TileLine[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 0;
  const varint = () => {
    let r = 0;
    let m = 1;
    let b: number;
    do {
      b = buf[pos++];
      r += (b & 0x7f) * m;
      m *= 128;
    } while (b >= 0x80);
    return r;
  };
  const skip = (wt: number) => {
    if (wt === 0) varint();
    else if (wt === 1) pos += 8;
    else if (wt === 2) {
      const n = varint(); // read the length before moving past it
      pos += n;
    } else if (wt === 5) pos += 4;
  };
  const str = () => {
    const n = varint();
    const s = text.decode(buf.subarray(pos, pos + n));
    pos += n;
    return s;
  };
  const packed = () => {
    const n = varint();
    const end = pos + n;
    const out: number[] = [];
    while (pos < end) out.push(varint());
    return out;
  };

  const out: TileLine[] = [];
  const n = 2 ** z;
  while (pos < buf.length) {
    const tag = varint();
    if (tag >> 3 !== 3 || (tag & 7) !== 2) {
      skip(tag & 7);
      continue;
    }
    const len = varint();
    const end = pos + len;
    const keys: string[] = [];
    const values: Array<string | number | boolean | null> = [];
    const raw: Array<{ tags: number[]; type: number; geometry: number[] }> = [];
    let extent = 4096;
    while (pos < end) {
      const t = varint();
      const f = t >> 3;
      if (f === 3) keys.push(str());
      else if (f === 5) extent = varint();
      else if (f === 4) {
        const vlen = varint();
        const vend = pos + vlen;
        let val: string | number | boolean | null = null;
        while (pos < vend) {
          const vt = varint();
          const vf = vt >> 3;
          if (vf === 1) val = str();
          else if (vf === 2) {
            val = view.getFloat32(pos, true);
            pos += 4;
          } else if (vf === 3) {
            val = view.getFloat64(pos, true);
            pos += 8;
          } else if (vf === 4 || vf === 5) val = varint();
          else if (vf === 6) {
            const zz = varint();
            val = zz % 2 ? -(zz + 1) / 2 : zz / 2;
          } else if (vf === 7) val = !!varint();
          else skip(vt & 7);
        }
        values.push(val);
      } else if (f === 2) {
        const flen = varint();
        const fend = pos + flen;
        const feat = { tags: [] as number[], type: 0, geometry: [] as number[] };
        while (pos < fend) {
          const ft = varint();
          const ff = ft >> 3;
          if (ff === 2) feat.tags = packed();
          else if (ff === 3) feat.type = varint();
          else if (ff === 4) feat.geometry = packed();
          else skip(ft & 7);
        }
        raw.push(feat);
      } else skip(t & 7);
    }
    pos = end;

    for (const f of raw) {
      const props: TileLine['props'] = {};
      for (let i = 0; i < f.tags.length; i += 2) props[keys[f.tags[i]]] = values[f.tags[i + 1]];
      if (!keep(props, f.type)) continue;
      const parts: Array<Array<[number, number]>> = [];
      let x = 0;
      let y = 0;
      let cur: Array<[number, number]> | null = null;
      const g = f.geometry;
      for (let i = 0; i < g.length; ) {
        const cmd = g[i] & 7;
        const count = g[i] >> 3;
        i++;
        if (cmd !== 1 && cmd !== 2) continue;
        for (let k = 0; k < count; k++) {
          const dx = g[i++];
          const dy = g[i++];
          x += (dx >>> 1) ^ -(dx & 1);
          y += (dy >>> 1) ^ -(dy & 1);
          if (cmd === 1) {
            cur = [];
            parts.push(cur);
          }
          const lng = ((tx + x / extent) / n) * 360 - 180;
          const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + y / extent)) / n))) * 180) / Math.PI;
          cur!.push([lng, lat]);
        }
      }
      out.push({ props, type: f.type, parts });
    }
  }
  return out;
}

export function lngLatToTile(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [Math.floor(((lng + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
}
