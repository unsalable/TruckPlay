// Just enough of SCS's compiled model formats (.pmd descriptor v4, .pmg geometry v0x15) to find a
// cab's in-dash screen: the pieces whose material shows the GPS drawable, which parts each
// interior variant shows, and the screen's texture coordinates and physical shape.

const TOKEN_CHARS = '\0' + '0123456789' + 'abcdefghijklmnopqrstuvwxyz' + '_';

/** SCS token (base-38 packed name) → string. */
export function tokenName(value) {
  let v = BigInt.asUintN(64, value);
  let s = '';
  while (v > 0n) {
    s += TOKEN_CHARS[Number(v % 38n)];
    v /= 38n;
  }
  return s;
}

function cstring(buf, at) {
  let end = at;
  while (end < buf.length && buf[end]) end++;
  return buf.toString('latin1', at, end);
}

/** Model descriptor: materials per look, variant names and the parts each variant shows. */
export function parsePmd(buf) {
  if (buf.readUInt32LE(0) !== 4) throw new Error(`pmd version ${buf.readUInt32LE(0)} not supported`);
  const u32 = o => buf.readUInt32LE(o);
  const materialCount = u32(4), lookCount = u32(8), variantCount = u32(16), partCount = u32(20);
  const attribCount = u32(24), valuesSize = u32(28);
  const lookOffset = u32(36), variantOffset = u32(40), partAttribOffset = u32(44);
  const valuesOffset = u32(48), attribOffset = u32(52), materialOffset = u32(56);

  const looks = [];
  for (let l = 0; l < lookCount; l++) {
    const materials = [];
    for (let m = 0; m < materialCount; m++) materials.push(cstring(buf, u32(materialOffset + (l * materialCount + m) * 4)));
    looks.push({ name: tokenName(buf.readBigUInt64LE(lookOffset + l * 8)), materials });
  }
  const attribs = [];
  for (let a = 0; a < attribCount; a++) {
    const o = attribOffset + a * 16;
    attribs.push({ name: tokenName(buf.readBigUInt64LE(o)), type: buf.readInt32LE(o + 8), offset: buf.readInt32LE(o + 12) });
  }
  const variants = [];
  for (let v = 0; v < variantCount; v++) {
    const visible = [];
    for (let p = 0; p < partCount; p++) {
      // Each part owns the attribute range [from, to).
      const from = buf.readInt32LE(partAttribOffset + p * 8);
      const to = buf.readInt32LE(partAttribOffset + p * 8 + 4);
      let shown = true;
      for (let a = from; a < to; a++) {
        if (attribs[a]?.name === 'visible') shown = buf.readInt32LE(valuesOffset + v * valuesSize + attribs[a].offset) !== 0;
      }
      visible.push(shown);
    }
    variants.push({ name: tokenName(buf.readBigUInt64LE(variantOffset + v * 8)), visible });
  }
  return { looks, variants, partCount };
}

/** Geometry: parts (piece ranges) and pieces with their material index and vertex/index streams. */
export function parsePmg(buf) {
  const version = buf[0];
  if (buf.toString('latin1', 1, 4) !== 'gmP' || version !== 0x15) {
    throw new Error(`pmg version 0x${version.toString(16)} not supported`);
  }
  const i32 = o => buf.readInt32LE(o);
  const pieceCount = i32(4), partCount = i32(8);
  const partsOffset = i32(0x4c), piecesOffset = i32(0x54);
  const parts = [];
  for (let p = 0; p < partCount; p++) {
    const o = partsOffset + p * 24;
    parts.push({ name: tokenName(buf.readBigUInt64LE(o)), pieceCount: i32(o + 8), pieceIndex: i32(o + 12) });
  }
  const pieces = [];
  for (let i = 0; i < pieceCount; i++) {
    const o = piecesOffset + i * 100;
    pieces.push({
      indices: i32(o),
      verts: i32(o + 4),
      material: i32(o + 16),
      stride: i32(o + 60),
      position: i32(o + 64),
      uv: i32(o + 72),
      index: i32(o + 96),
    });
  }
  return { buf, parts, pieces };
}

/**
 * The screen a set of pieces draws: its texture-coordinate box (fractions of the drawable, v down
 * as the GPU samples it) and its physical width and height in metres, measured along the surface
 * so curved screens count their full width.
 */
export function screenShape(pmg, pieceIndices) {
  const { buf } = pmg;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  let su = 0, sv = 0, area = 0;
  for (const pi of pieceIndices) {
    const p = pmg.pieces[pi];
    const uv = k => [buf.readFloatLE(p.uv + k * p.stride), buf.readFloatLE(p.uv + k * p.stride + 4)];
    const pos = k => [0, 4, 8].map(d => buf.readFloatLE(p.position + k * p.stride + d));
    for (let k = 0; k < p.verts; k++) {
      const [u, v] = uv(k);
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    // Per triangle: how far the surface runs per unit of u and of v (|dP/du|, |dP/dv|), weighted
    // by the triangle's UV area.
    for (let t = 0; t + 2 < p.indices; t += 3) {
      const [a, b, c] = [0, 1, 2].map(j => buf.readUInt16LE(p.index + (t + j) * 2));
      const [ua, va] = uv(a), [ub, vb] = uv(b), [uc, vc] = uv(c);
      const du1 = ub - ua, dv1 = vb - va, du2 = uc - ua, dv2 = vc - va;
      const det = du1 * dv2 - du2 * dv1;
      if (Math.abs(det) < 1e-12) continue;
      const pa = pos(a), pb = pos(b), pc = pos(c);
      const e1 = pb.map((x, d) => x - pa[d]);
      const e2 = pc.map((x, d) => x - pa[d]);
      const dPdu = e1.map((x, d) => (x * dv2 - e2[d] * dv1) / det);
      const dPdv = e1.map((x, d) => (e2[d] * du1 - x * du2) / det);
      const w = Math.abs(det) / 2;
      su += Math.hypot(...dPdu) * w;
      sv += Math.hypot(...dPdv) * w;
      area += w;
    }
  }
  if (!Number.isFinite(u0) || !area) return null;
  // Screens are laid out with whole-number UV offsets (sampled with wrapping); keep the fraction.
  const fu = Math.floor(u0 + 1e-4), fv = Math.floor(v0 + 1e-4);
  const box = { u0: u0 - fu, u1: u1 - fu, v0: v0 - fv, v1: v1 - fv };
  return { ...box, width: (su / area) * (box.u1 - box.u0), height: (sv / area) * (box.v1 - box.v0) };
}
