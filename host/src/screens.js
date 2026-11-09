// The cab screens the mod was built for (shared/screens.json, written by mod/build-mod.mjs). Each
// screen's marker texture already covers exactly what its glass shows, at the glass's own shape,
// so the UI fills the whole texture. The one exception is the square marker of the game's generic
// GPS script, used by trucks from other mods: its glass shows some band of it, so the UI goes where
// most cabs' glass is, unless the driver has fitted it to this truck by hand.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function load() {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'shared', 'screens.json'), 'utf8'));
  } catch {
    return { markerWidth: 1282, screens: [] };
  }
}
let table = load();

/** Reads the table again (the mod was just made anew, see modcheck.js). */
export function reloadScreens() {
  table = load();
}

export function screenFor(w, h) {
  if (w !== table.markerWidth) return null;
  if (w === h) return { id: 'generic', marker: [w, h] };
  return table.screens.find(s => s.marker[0] === w && s.marker[1] === h) ?? null;
}

/**
 * Where in the texture the UI goes: null for the whole texture, else { x, y, w, h }.
 * `fit` is the driver's own fit for this truck ({ x, y, w, h } as fractions of the texture).
 */
export function frameFor(w, h, fit = null) {
  // No cab screen yet (not in a truck, or the mod not loaded): the UI fills its default texture.
  if (!w || !h) return null;
  if (!fit && w !== h) return null;
  // Median glass of the cabs on the generic script: nearly the full width, 14 %–74 % of the height.
  const f = fit ?? { x: 0, y: 0.14, w: 1, h: 0.6 };
  const x = Math.round(f.x * w), y = Math.round(f.y * h);
  return { x, y, w: Math.max(64, Math.round(f.w * w)), h: Math.max(48, Math.round(f.h * h)) };
}
