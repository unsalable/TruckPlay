// Mapbox Vector Tile decoding for the map/ build scripts: layers, properties and geometry in
// longitude/latitude. Small on purpose — the UI renders tiles with MapLibre; this is only for
// reading map data offline (demo route, checks).

export function decodeTile(buf) {
  let pos = 0;
  const varint = () => {
    let r = 0;
    let m = 1;
    let b;
    do {
      b = buf[pos++];
      r += (b & 0x7f) * m;
      m *= 128;
    } while (b >= 0x80);
    return r;
  };
  const skip = wt => {
    if (wt === 0) varint();
    else if (wt === 1) pos += 8;
    else if (wt === 2) {
      const n = varint(); // read the length before moving past it
      pos += n;
    }
    else if (wt === 5) pos += 4;
  };
  const str = len => {
    const s = buf.toString('utf8', pos, pos + len);
    pos += len;
    return s;
  };
  const packed = () => {
    const out = [];
    const n = varint();
    const end = pos + n;
    while (pos < end) out.push(varint());
    return out;
  };

  const layers = [];
  while (pos < buf.length) {
    const tag = varint();
    if (tag >> 3 !== 3 || (tag & 7) !== 2) {
      skip(tag & 7);
      continue;
    }
    const n = varint();
    const end = pos + n;
    const layer = { name: '', extent: 4096, keys: [], values: [], raw: [] };
    while (pos < end) {
      const t = varint();
      const f = t >> 3;
      if (f === 1) layer.name = str(varint());
      else if (f === 3) layer.keys.push(str(varint()));
      else if (f === 5) layer.extent = varint();
      else if (f === 4) {
        const vlen = varint();
        const vend = pos + vlen;
        let val = null;
        while (pos < vend) {
          const vt = varint();
          const vf = vt >> 3;
          if (vf === 1) val = str(varint());
          else if (vf === 2) {
            val = buf.readFloatLE(pos);
            pos += 4;
          } else if (vf === 3) {
            val = buf.readDoubleLE(pos);
            pos += 8;
          } else if (vf === 4 || vf === 5) val = varint();
          else if (vf === 6) {
            const z = varint();
            val = z % 2 ? -(z + 1) / 2 : z / 2;
          } else if (vf === 7) val = !!varint();
          else skip(vt & 7);
        }
        layer.values.push(val);
      } else if (f === 2) {
        const flen = varint();
        const fend = pos + flen;
        const feat = { tags: [], type: 0, geometry: [] };
        while (pos < fend) {
          const ft = varint();
          const ff = ft >> 3;
          if (ff === 2) feat.tags = packed();
          else if (ff === 3) feat.type = varint();
          else if (ff === 4) feat.geometry = packed();
          else skip(ft & 7);
        }
        layer.raw.push(feat);
      } else skip(t & 7);
    }
    pos = end;
    layers.push(layer);
  }
  return layers;
}

const zigzag = n => (n >>> 1) ^ -(n & 1);

/** Rings or lines of [px, py] tile coordinates. */
export function decodeGeometry(geom) {
  const parts = [];
  let x = 0;
  let y = 0;
  let cur = null;
  for (let i = 0; i < geom.length; ) {
    const cmd = geom[i] & 7;
    const count = geom[i] >> 3;
    i++;
    if (cmd === 1 || cmd === 2) {
      for (let k = 0; k < count; k++) {
        x += zigzag(geom[i++]);
        y += zigzag(geom[i++]);
        if (cmd === 1) {
          cur = [];
          parts.push(cur);
        }
        cur.push([x, y]);
      }
    } else if (cmd === 7 && cur?.length) {
      cur.push(cur[0]);
    }
  }
  return parts;
}

export function tileToLngLat(z, tx, ty, extent, px, py) {
  const n = 2 ** z;
  const lng = ((tx + px / extent) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + py / extent)) / n))) * 180) / Math.PI;
  return [lng, lat];
}

export function lngLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [Math.floor(((lng + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
}

/** Features of one tile as { props, type, parts: [[lng, lat], ...][] }. */
export function tileFeatures(buf, z, tx, ty, layerName) {
  const out = [];
  for (const layer of decodeTile(buf)) {
    if (layerName && layer.name !== layerName) continue;
    for (const f of layer.raw) {
      const props = {};
      for (let i = 0; i < f.tags.length; i += 2) props[layer.keys[f.tags[i]]] = layer.values[f.tags[i + 1]];
      const parts = decodeGeometry(f.geometry).map(part => part.map(([px, py]) => tileToLngLat(z, tx, ty, layer.extent, px, py)));
      out.push({ props, type: f.type, parts });
    }
  }
  return out;
}
