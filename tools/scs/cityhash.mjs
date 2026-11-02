// CityHash64 (Google, 2011 — the variant SCS uses to hash HashFS paths).
// BigInt port; every intermediate is masked back to 64 bits.

const M = (1n << 64n) - 1n;
const k0 = 0xc3a5c85c97cb3127n;
const k1 = 0xb492b66fbe98f273n;
const k2 = 0x9ae16a3b2f90404fn;
const k3 = 0xc949d7c7509e6557n;
const kMul = 0x9ddfea08eb382d69n;

const add = (...xs) => xs.reduce((s, x) => (s + x) & M, 0n);
const mul = (a, b) => (a * b) & M;
const rot = (v, s) => (s === 0 ? v : ((v >> BigInt(s)) | (v << BigInt(64 - s))) & M);
const shiftMix = v => v ^ (v >> 47n);

function hash128to64(lo, hi) {
  let a = mul(lo ^ hi, kMul);
  a ^= a >> 47n;
  let b = mul(hi ^ a, kMul);
  b ^= b >> 47n;
  return mul(b, kMul);
}
const hashLen16 = (u, v) => hash128to64(u, v);

function f64(buf, i) {
  return buf.readBigUInt64LE(i);
}
function f32(buf, i) {
  return BigInt(buf.readUInt32LE(i));
}

function hashLen0to16(s, len) {
  if (len > 8) {
    const a = f64(s, 0);
    const b = f64(s, len - 8);
    return hashLen16(a, rot(add(b, BigInt(len)), len)) ^ b;
  }
  if (len >= 4) {
    const a = f32(s, 0);
    return hashLen16(add(BigInt(len), (a << 3n) & M), f32(s, len - 4));
  }
  if (len > 0) {
    const a = BigInt(s[0]);
    const b = BigInt(s[len >> 1]);
    const c = BigInt(s[len - 1]);
    const y = (a + (b << 8n)) & 0xffffffffn;
    const z = (BigInt(len) + (c << 2n)) & 0xffffffffn;
    return mul(shiftMix(mul(y, k2) ^ mul(z, k3)), k2);
  }
  return k2;
}

function hashLen17to32(s, len) {
  const a = mul(f64(s, 0), k1);
  const b = f64(s, 8);
  const c = mul(f64(s, len - 8), k2);
  const d = mul(f64(s, len - 16), k0);
  return hashLen16(
    add(rot((a - b) & M, 43), rot(c, 30), d),
    (add(a, rot(b ^ k3, 20), BigInt(len)) - c) & M,
  );
}

function weak(w, x, y, z, a, b) {
  a = add(a, w);
  b = rot(add(b, a, z), 21);
  const c = a;
  a = add(a, x, y);
  b = add(b, rot(a, 44));
  return [add(a, z), add(b, c)];
}
const weakAt = (s, i, a, b) => weak(f64(s, i), f64(s, i + 8), f64(s, i + 16), f64(s, i + 24), a, b);

function hashLen33to64(s, len) {
  let z = f64(s, 24);
  let a = add(f64(s, 0), mul(add(BigInt(len), f64(s, len - 16)), k0));
  let b = rot(add(a, z), 52);
  let c = rot(a, 37);
  a = add(a, f64(s, 8));
  c = add(c, rot(a, 7));
  a = add(a, f64(s, 16));
  const vf = add(a, z);
  const vs = add(b, rot(a, 31), c);
  a = add(f64(s, 16), f64(s, len - 32));
  z = f64(s, len - 8);
  b = rot(add(a, z), 52);
  c = rot(a, 37);
  a = add(a, f64(s, len - 24));
  c = add(c, rot(a, 7));
  a = add(a, f64(s, len - 16));
  const wf = add(a, z);
  const ws = add(b, rot(a, 31), c);
  const r = shiftMix(add(mul(add(vf, ws), k2), mul(add(wf, vs), k0)));
  return mul(shiftMix(add(mul(r, k0), vs)), k2);
}

export function cityHash64(input) {
  const s = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  let len = s.length;
  if (len <= 32) return len <= 16 ? hashLen0to16(s, len) : hashLen17to32(s, len);
  if (len <= 64) return hashLen33to64(s, len);

  let x = f64(s, len - 40);
  let y = add(f64(s, len - 16), f64(s, len - 56));
  let z = hashLen16(add(f64(s, len - 48), BigInt(len)), f64(s, len - 24));
  let v = weakAt(s, len - 64, BigInt(len), z);
  let w = weakAt(s, len - 32, add(y, k1), x);
  x = add(mul(x, k1), f64(s, 0));

  let off = 0;
  len = (len - 1) & ~63;
  do {
    x = mul(rot(add(x, y, v[0], f64(s, off + 8)), 37), k1);
    y = mul(rot(add(y, v[1], f64(s, off + 48)), 42), k1);
    x ^= w[1];
    y = add(y, v[0], f64(s, off + 40));
    z = mul(rot(add(z, w[0]), 33), k1);
    v = weakAt(s, off, mul(v[1], k1), add(x, w[0]));
    w = weakAt(s, off + 32, add(z, w[1]), add(y, f64(s, off + 16)));
    [z, x] = [x, z];
    off += 64;
    len -= 64;
  } while (len !== 0);
  return hashLen16(add(hashLen16(v[0], w[0]), mul(shiftMix(y), k1), z), add(hashLen16(v[1], w[1]), x));
}
