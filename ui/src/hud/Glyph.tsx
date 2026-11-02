// Turn arrows, drawn from the manoeuvre itself rather than picked from a set: the arrow bends by
// the junction's real angle, a fork shows the branch not taken, a roundabout runs round its ring
// to the exit it names. One stroke weight and one arrowhead throughout, like Apple Maps' signs.

import { motion } from 'motion/react';
import type { GlyphSpec } from './types';

const STROKE = 11;
const VIEW = 100;

type Pt = [number, number];

/** A path that drives: straight up from `from`, then turns `angle` degrees (+ right) on a circle
 *  of `radius`, then runs on for `tail`. Returns the points and the final heading. */
function drive(from: Pt, up: number, angle: number, radius: number, tail: number): { pts: Pt[]; heading: number } {
  const pts: Pt[] = [from];
  let [x, y] = from;
  y -= up;
  pts.push([x, y]);
  let heading = -Math.PI / 2; // up the screen
  const steps = Math.max(2, Math.round(Math.abs(angle) / 6));
  const turn = (angle * Math.PI) / 180;
  const arc = Math.abs(turn) * radius;
  for (let i = 0; i < steps; i++) {
    heading += turn / steps;
    x += Math.cos(heading) * (arc / steps);
    y += Math.sin(heading) * (arc / steps);
    pts.push([x, y]);
  }
  x += Math.cos(heading) * tail;
  y += Math.sin(heading) * tail;
  pts.push([x, y]);
  return { pts, heading };
}

const path = (pts: Pt[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');

/** A filled arrowhead whose tip sits `reach` beyond the end of a stroke heading `heading`. */
function head([x, y]: Pt, heading: number, size = 15): string {
  const c = Math.cos(heading), s = Math.sin(heading);
  const tip: Pt = [x + c * size * 0.9, y + s * size * 0.9];
  const back: Pt = [x - c * size * 0.25, y - s * size * 0.25];
  const l: Pt = [back[0] - s * size, back[1] + c * size];
  const r: Pt = [back[0] + s * size, back[1] - c * size];
  return `M${tip[0].toFixed(2)} ${tip[1].toFixed(2)} L${l[0].toFixed(2)} ${l[1].toFixed(2)} L${r[0].toFixed(2)} ${r[1].toFixed(2)} Z`;
}

/** The arrow for a manoeuvre, as stroke paths (`main` bright, `dim` the branches not taken) and a
 *  filled arrowhead. */
export function glyphPaths(g: GlyphSpec): { main: string; dim: string[]; head: string } {
  const side = g.side === 'left' ? -1 : 1;
  switch (g.type) {
    case 'keep':
    case 'exit': {
      // A fork: the stem, the way not taken (faint) and the way to go. Leaving a motorway, the
      // faint way is the motorway running on straight; at a fork it leans the other way.
      const fork: Pt = [50 - side * 6, 60];
      const stem: Pt[] = [[50 - side * 6, 94], fork];
      const other: Pt[] =
        g.type === 'exit'
          ? [fork, [fork[0], 10]]
          : [fork, [fork[0] - side * 20, fork[1] - 26], [fork[0] - side * 24, 12]];
      const mine = drive(fork, 0, side * 42, 24, 20);
      const end = mine.pts[mine.pts.length - 1];
      return { main: path([...stem, ...mine.pts.slice(1)]), dim: [path(other)], head: head(end, mine.heading) };
    }
    case 'roundabout': {
      // The ring, entered from below, run round (counter-clockwise where traffic keeps right) to
      // the exit's direction, then out.
      const cx = 50, cy = 46, r = 19;
      const a = Math.max(-179, Math.min(180, g.angle));
      const sweep = g.leftHand ? 180 + a : 180 - a;
      const pts: Pt[] = [[50, 94], [50, cy + r]];
      const n = Math.max(3, Math.round(sweep / 8));
      for (let i = 1; i <= n; i++) {
        const psi = ((g.leftHand ? 180 + (sweep * i) / n : 180 - (sweep * i) / n) * Math.PI) / 180;
        pts.push([cx + r * Math.sin(psi), cy - r * Math.cos(psi)]);
      }
      const out = (a * Math.PI) / 180;
      const dir: Pt = [Math.sin(out), -Math.cos(out)];
      const last = pts[pts.length - 1];
      const end: Pt = [last[0] + dir[0] * 13, last[1] + dir[1] * 13];
      pts.push(end);
      const ring = `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`;
      return { main: path(pts), dim: [ring], head: head(end, Math.atan2(dir[1], dir[0])) };
    }
    case 'uturn': {
      const d = drive([g.side === 'left' ? 64 : 36, 92], 42, side * 180, 15, 16);
      return { main: path(d.pts), dim: [], head: head(d.pts[d.pts.length - 1], d.heading) };
    }
    case 'arrive':
    case 'ferry':
    case 'train':
      return { main: '', dim: [], head: '' };
    default: {
      // Turns of every sharpness: the junction's own angle, gently rounded.
      const a = g.type === 'straight' ? 0 : Math.max(-150, Math.min(150, g.angle || side * 90));
      const sharp = Math.abs(a) > 120;
      const d = drive([50 - (a / 150) * 12, 94], sharp ? 40 : 34, a, sharp ? 13 : 18, Math.abs(a) < 20 ? 18 : 14);
      return { main: path(d.pts), dim: [], head: head(d.pts[d.pts.length - 1], d.heading) };
    }
  }
}

function Pin() {
  return (
    <>
      <path d="M50 92 C50 92 22 62 22 42 A28 28 0 0 1 78 42 C78 62 50 92 50 92 Z" fill="currentColor" />
      <circle cx="50" cy="42" r="10" fill="var(--hud-card, #111)" />
    </>
  );
}

function Ship() {
  return (
    <>
      <path d="M14 62 L86 62 L76 82 Q50 90 24 82 Z" fill="currentColor" />
      <path d="M30 60 L30 42 L62 42 L70 60 Z" fill="currentColor" />
      <rect x="44" y="26" width="10" height="14" rx="2" fill="currentColor" />
    </>
  );
}

function Train() {
  return (
    <>
      <rect x="26" y="16" width="48" height="60" rx="12" fill="currentColor" />
      <rect x="34" y="26" width="32" height="18" rx="4" fill="var(--hud-card, #111)" />
      <circle cx="38" cy="62" r="5" fill="var(--hud-card, #111)" />
      <circle cx="62" cy="62" r="5" fill="var(--hud-card, #111)" />
      <path d="M32 92 L40 78 M68 92 L60 78" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
    </>
  );
}

export function Glyph({ spec, size, animate = true }: { spec: GlyphSpec; size: string; animate?: boolean }) {
  const p = glyphPaths(spec);
  const t = { type: 'spring', visualDuration: 0.45, bounce: 0.08 } as const;
  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} width={size} height={size} aria-hidden="true" style={{ overflow: 'visible' }}>
      {spec.type === 'arrive' ? (
        <Pin />
      ) : spec.type === 'ferry' ? (
        <Ship />
      ) : spec.type === 'train' ? (
        <Train />
      ) : (
        <>
          {p.dim.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="currentColor" strokeOpacity={0.32} strokeWidth={spec.type === 'roundabout' ? 8 : STROKE - 3} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          <motion.path
            d={p.main}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={animate ? { pathLength: 0 } : false}
            animate={{ pathLength: 1 }}
            transition={t}
          />
          <motion.path d={p.head} fill="currentColor" initial={animate ? { opacity: 0, scale: 0.6 } : false} animate={{ opacity: 1, scale: 1 }} transition={{ ...t, delay: animate ? 0.12 : 0 }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
        </>
      )}
    </svg>
  );
}
