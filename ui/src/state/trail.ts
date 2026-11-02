import { telemetry } from './telemetry';

// The road just driven, sampled every few meters (game-world x/z). Kept outside components so the
// map keeps its trace while apps open and close.

export const trail: Array<{ x: number; z: number }> = [];
let last = { x: NaN, z: NaN };

export function seedTrail(points: Array<{ x: number; z: number }>) {
  trail.splice(0, trail.length, ...points);
  const end = points[points.length - 1];
  if (end) last = { ...end };
}

telemetry.subscribe(() => {
  const t = telemetry.get();
  if (!t.truck.on) return;
  const p = t.truck.pos;
  const d = Math.hypot(p.x - last.x, p.z - last.z);
  if (d < 4) return;
  if (d > 2000) trail.length = 0; // ferry, train or a new profile: start over
  trail.push({ x: p.x, z: p.z });
  if (trail.length > 1500) trail.splice(0, trail.length - 1500);
  last = { x: p.x, z: p.z };
});
