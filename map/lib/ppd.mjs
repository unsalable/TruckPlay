// Reader for prefab descriptors (.ppd, format 25): the junction's connection points (nodes), its
// lanes as navigation curves, and the game's own GPS links between its nodes (nav nodes) — which
// node can be reached from which, over which curves. That last part is what makes turn-by-turn
// directions follow the game's own idea of what is a legal turn.
//
// Layout per the community's notes (ConverterPIX, SCS Blender Tools, ts-map's ppd template).

export const PPD_VERSION = 25;

function f3(b, o) {
  return [b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)];
}

/**
 * { nodes: [{x, z, dx, dz, inLanes, outLanes}], curves: [{x0, z0, x1, z1, q0, q1, length, next, prev}],
 *   links: [{from, to, length, curves}] } — positions in the prefab's own space (x east, z south),
 *   node directions as unit vectors, `links` between node indices (physical nav nodes only).
 */
export function parsePpd(buf) {
  const version = buf.readUInt32LE(0);
  if (version !== PPD_VERSION) throw new Error(`ppd format ${version}, expected ${PPD_VERSION}`);
  const count = i => buf.readUInt32LE(4 + i * 4);
  const ptr = i => buf.readUInt32LE(48 + i * 4);
  const numNodes = count(0);
  const numCurves = count(1);
  const numMapPoints = count(7);
  const numNavNodes = count(10);

  const nodes = [];
  for (let i = 0, o = ptr(0); i < numNodes; i++, o += 104) {
    const [x, , z] = f3(buf, o + 16);
    const [dx, , dz] = f3(buf, o + 28);
    const lanes = at => {
      const out = [];
      for (let k = 0; k < 8; k++) {
        const v = buf.readInt32LE(at + k * 4);
        if (v !== -1) out.push(v);
      }
      return out;
    };
    const len = Math.hypot(dx, dz) || 1;
    nodes.push({ x, z, dx: dx / len, dz: dz / len, inLanes: lanes(o + 40), outLanes: lanes(o + 72) });
  }

  const curves = [];
  for (let i = 0, o = ptr(1); i < numCurves; i++, o += 132) {
    const flags = buf.readUInt32LE(o + 8);
    const [x0, , z0] = f3(buf, o + 16);
    const [x1, , z1] = f3(buf, o + 28);
    // Rotations as quaternions (w, x, y, z); only the yaw matters on the map.
    const q0 = [buf.readFloatLE(o + 40), buf.readFloatLE(o + 48)];
    const q1 = [buf.readFloatLE(o + 56), buf.readFloatLE(o + 64)];
    const length = buf.readFloatLE(o + 72);
    const nextN = buf.readUInt32LE(o + 108);
    const prevN = buf.readUInt32LE(o + 112);
    const next = [];
    const prev = [];
    for (let k = 0; k < Math.min(4, nextN); k++) next.push(buf.readInt32LE(o + 76 + k * 4));
    for (let k = 0; k < Math.min(4, prevN); k++) prev.push(buf.readInt32LE(o + 92 + k * 4));
    curves.push({ x0, z0, x1, z1, q0, q1, length, next, prev, flags });
  }

  // Nav nodes: "physical" ones sit on a junction node; the others are waypoints part-way along a
  // lane (a link lists at most eight curves, so longer paths hop through them).
  const nav = [];
  for (let i = 0, o = ptr(11); i < numNavNodes; i++, o += 188) {
    const conns = [];
    for (let k = 0; k < Math.min(8, buf[o + 3]); k++) {
      const c = o + 4 + k * 23;
      const curveList = [];
      for (let j = 0; j < Math.min(8, buf[c + 6]); j++) curveList.push(buf.readUInt16LE(c + 7 + j * 2));
      conns.push({ target: buf.readUInt16LE(c), length: buf.readFloatLE(c + 2), curves: curveList });
    }
    nav.push({ physical: buf[o] === 0, index: buf.readUInt16LE(o + 1), conns });
  }
  // Junction node → junction node, following waypoints; the shortest way between each pair.
  const best = new Map();
  for (const start of nav) {
    if (!start.physical || start.index >= numNodes) continue;
    const stack = start.conns.map(c => ({ ...c, seen: new Set() }));
    while (stack.length) {
      const step = stack.pop();
      const at = nav[step.target];
      if (!at || step.seen.has(step.target)) continue;
      if (at.physical) {
        if (at.index >= numNodes) continue;
        const key = start.index * 256 + at.index;
        const prev = best.get(key);
        if (!prev || step.length < prev.length) best.set(key, { from: start.index, to: at.index, length: step.length, curves: step.curves });
        continue;
      }
      const seen = new Set(step.seen).add(step.target);
      for (const c of at.conns) stack.push({ target: c.target, length: step.length + c.length, curves: step.curves.concat(c.curves), seen });
    }
  }
  return { nodes, curves, links: [...best.values()], mapPoints: numMapPoints };
}
