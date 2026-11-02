// Every in-cab GPS screen the installed game ships: which interiors show it, through which UI
// script, and exactly which part of the GPS drawable its glass shows. The part comes from the cab
// model itself (the texture coordinates of the pieces painted with the GPS drawable), the shape
// from the same pieces' geometry, so TruckPlay's picture can be laid onto each screen edge to edge
// with the screen's real proportions.

import { parsePmd, parsePmg, screenShape } from './models.mjs';

export const MARKER_WIDTH = 1282;
export const GENERIC_SCRIPT = '/ui/gps.sii';
/** Drawable for screens on the generic script (the game's default is 256×256, too coarse). */
export const GENERIC_DRAWABLE = [1024, 1024];

const clean = p => p.replace(/^\/+/, '');
const dirOf = f => f.slice(0, f.lastIndexOf('/'));

function* walk(game, dir) {
  const l = game.list(dir);
  for (const f of l.files) yield `${dir}/${f}`;
  for (const d of l.dirs) yield* walk(game, `${dir}/${d}`);
}

function includePath(from, inc) {
  return inc.startsWith('/') ? clean(inc) : `${dirOf(from)}/${inc}`;
}

/** The file's text with every @include replaced by the included text (recursively). */
function inlineAll(game, file, depth = 0) {
  const text = game.readText(file) ?? '';
  if (depth > 8) return text;
  return text.replace(/^[ \t]*@include\s+"([^"]+)"[^\n]*$/gm, (_, inc) => inlineAll(game, includePath(file, inc), depth + 1));
}

const GPS_LINE = /^[ \t]*gps_(path|drawable_size)[ \t]*:/m;

/**
 * The interior's own text with the includes that set gps_path / gps_drawable_size written out in
 * place, so those two settings can be replaced for this interior alone (an include such as
 * computers_2025.sui is shared by interiors whose screens differ).
 */
export function inlineGpsIncludes(game, file) {
  const text = game.readText(file) ?? '';
  return text.replace(/^[ \t]*@include\s+"([^"]+)"[^\n]*$/gm, (line, inc) => {
    const full = inlineAll(game, includePath(file, inc));
    return GPS_LINE.test(full) ? full : line;
  });
}

/** Interior text with its GPS script and drawable set to ours. */
export function withGps(text, script, drawable) {
  const lines = text.split(/\r?\n/).filter(l => !/^[ \t]*gps_(path|drawable_size)[ \t]*:/.test(l));
  const at = lines.findIndex(l => /^[ \t]*model[ \t]*:/.test(l));
  const indent = at >= 0 ? lines[at].match(/^[ \t]*/)[0] : '\t';
  const ours = [`${indent}gps_path: "${script}"`, `${indent}gps_drawable_size: (${drawable[0]}, ${drawable[1]})`];
  lines.splice(at >= 0 ? at + 1 : lines.length, 0, ...ours);
  return lines.join('\n');
}

/** The root window's coordinate space of a GPS UI script: { l, b, r, t } (y up). */
export function scriptSpace(text) {
  const num = k => Number(text.match(new RegExp(`\\n\\s*${k}:\\s*(-?\\d+)`))?.[1]);
  return { l: num('coords_l'), r: num('coords_r'), t: num('coords_t'), b: num('coords_b') };
}

function field(text, key) {
  return text.match(new RegExp(`^[ \\t]*${key}[ \\t]*:[ \\t]*"?([^"\\n]*)"?`, 'm'))?.[1]?.trim();
}

function parseSize(s) {
  const m = s?.match(/\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * Survey the installed game. Returns the distinct screens, each with the interiors that show it:
 *   { id, script, space, uv, size, aspect, drawable, marker: [w, h], visible: [l, b, r, t],
 *     trucks: [...], interiors: [{ file, truck, dlc }] }
 * `visible` is in the script's own UI units: the rectangle the glass shows. Texture v grows
 * upwards on every cab screen (as UI y does), so v maps straight onto UI y.
 */
export function surveyScreens(game, { log = () => {} } = {}) {
  const models = new Map();
  const materialTex = new Map();
  const loadModel = p => {
    if (!models.has(p)) {
      try {
        models.set(p, { pmd: parsePmd(game.read(clean(p))), pmg: parsePmg(game.read(clean(p).replace(/\.pmd$/, '.pmg'))) });
      } catch (e) {
        models.set(p, { error: e.message });
      }
    }
    return models.get(p);
  };
  const showsGps = mat => {
    if (!materialTex.has(mat)) {
      const t = game.readText(clean(mat)) ?? '';
      materialTex.set(mat, /source\s*:\s*"\/vehicle\/truck\/share\/gps\.tobj"/.test(t));
    }
    return materialTex.get(mat);
  };
  const scripts = new Map();
  const space = script => {
    if (!scripts.has(script)) {
      const text = game.readText(clean(script));
      scripts.set(script, text ? scriptSpace(text) : null);
    }
    return scripts.get(script);
  };

  const groups = new Map();
  for (const truck of game.list('def/vehicle/truck').dirs) {
    for (const file of walk(game, `def/vehicle/truck/${truck}/interior`)) {
      if (!/\.sii$/.test(file)) continue;
      const text = inlineAll(game, file);
      if (!/accessory_interior_data\s*:/.test(text)) continue;
      const modelPath = field(text, 'model');
      let script = field(text, 'gps_path');
      if (!modelPath || !script) continue;
      if (!script.endsWith('.sii')) script += '.sii';
      const m = loadModel(modelPath);
      if (m.error) {
        log(`  ! ${file}: ${m.error}`);
        continue;
      }
      const look = Math.max(0, m.pmd.looks.findIndex(l => l.name === field(text, 'look')));
      const variant = m.pmd.variants.findIndex(v => v.name === field(text, 'variant'));
      const shown = m.pmd.variants[Math.max(0, variant)]?.visible ?? [];
      const mats = m.pmd.looks[look].materials;
      const pieces = [];
      m.pmg.parts.forEach((part, pi) => {
        if (shown[pi] === false) return;
        for (let k = part.pieceIndex; k < part.pieceIndex + part.pieceCount; k++) {
          if (showsGps(mats[m.pmg.pieces[k].material])) pieces.push(k);
        }
      });
      const shape = pieces.length ? screenShape(m.pmg, pieces) : null;
      const sp = space(script);
      if (!shape || !sp || !(shape.width > 0.02) || !(shape.height > 0.02)) continue;

      const generic = script === GENERIC_SCRIPT;
      const drawable = generic ? GENERIC_DRAWABLE : (parseSize(field(text, 'gps_drawable_size')) ?? [1024, 512]);
      const q = x => Math.round(x * 500) / 500;
      const aspect = shape.width / shape.height;
      const key = [script, q(shape.u0), q(shape.u1), q(shape.v0), q(shape.v1), Math.round(aspect * 100), drawable].join('|');
      if (!groups.has(key)) {
        groups.set(key, {
          script,
          space: sp,
          uv: { u0: shape.u0, u1: shape.u1, v0: shape.v0, v1: shape.v1 },
          size: { w: shape.width, h: shape.height },
          aspect,
          drawable,
          trucks: new Set(),
          interiors: [],
        });
      }
      const g = groups.get(key);
      g.trucks.add(truck);
      // Interiors from DLC archives: a build for everyone (Workshop) leaves them as they are.
      g.interiors.push({ file, truck, dlc: /^dlc_/i.test(game.find(file)?.archive.name ?? '') });
    }
  }

  // Stable, readable ids; marker heights follow each screen's own proportions and stay unique,
  // never square (a square marker is the generic fallback for trucks we do not know).
  const screens = [...groups.values()].sort((a, b) => [...a.trucks][0].localeCompare([...b.trucks][0]) || a.aspect - b.aspect);
  const usedIds = new Map();
  const usedHeights = new Set([MARKER_WIDTH]);
  for (const s of screens) {
    const base = [...s.trucks].sort()[0].replace(/[^a-z0-9]+/g, '_');
    const n = (usedIds.get(base) ?? 0) + 1;
    usedIds.set(base, n);
    s.id = n === 1 ? base : `${base}_${n}`;
    let h = Math.round(MARKER_WIDTH / s.aspect);
    while (usedHeights.has(h)) h++;
    usedHeights.add(h);
    s.marker = [MARKER_WIDTH, h];
    const { l, b, r, t } = s.space;
    const W = r - l, H = t - b;
    // Round outwards: a sliver of picture past the glass is invisible, a sliver of black is not.
    s.visible = [
      Math.floor(l + s.uv.u0 * W),
      Math.floor(b + s.uv.v0 * H),
      Math.ceil(l + s.uv.u1 * W),
      Math.ceil(b + s.uv.v1 * H),
    ].map((x, i) => Math.min([r, t, r, t][i], Math.max([l, b, l, b][i], x)));
    s.trucks = [...s.trucks].sort();
  }
  return screens;
}
