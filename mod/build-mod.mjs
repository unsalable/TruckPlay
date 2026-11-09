#!/usr/bin/env node
// Builds truckplay.scs, the game-side half of TruckPlay, from the installed game's own files:
//  • every cab screen is surveyed from its model (mod/lib/screens.mjs): the part of the GPS
//    drawable its glass shows and its real proportions;
//  • each distinct screen gets its own GPS UI script that draws one image, its marker texture,
//    exactly over the part the glass shows (groups 100/300 = on, 200 = screen off, as the game
//    toggles them), and the interiors showing it point their gps_path at that script;
//  • marker textures are uncompressed BGRA .dds files 1282 px wide, as tall as the screen's
//    proportions ask, so the plugin recognises them when the game creates them and streams the
//    UI into them every frame, and the UI is drawn at the screen's true shape;
//  • the game's generic GPS script (and the dashboard scripts) still draw a marker, for trucks
//    from other mods that use them;
//  • right beneath the marker, each GPS script still draws the game's own navigation map (the
//    "bare map" image of the game's GPS screens): the game keeps rendering it, and the plugin
//    copies it from there for TruckPlay's Maps (plugin/src/gamedraw.cpp);
//  • the route advisor (F3) gets a TruckPlay panel laid over its own panel: one more marker
//    (642 x 559, see plugin/src/d3d_hooks.h), transparent until the plugin draws the cab screen
//    into it — when the driver turns it on in Settings.
//
// usage: node mod/build-mod.mjs [--mode live|calibrate] [--out <file.scs>] [--game <dir>]
//                               [--folder <dir>]   (also write the unpacked mod, e.g. for Workshop)
//                               [--base-only]      (leave out trucks that come in DLC archives)
//                               [--game-version 1.61] [--screens <file>] (where the screen table goes)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGame } from '../tools/scs/hashfs.mjs';
import { buildZip } from './lib/zip.mjs';
import { ddsBgra, tobj } from './lib/texture.mjs';
import { Canvas } from './lib/raster.mjs';
import { GENERIC_DRAWABLE, GENERIC_SCRIPT, MARKER_WIDTH, inlineGpsIncludes, scriptSpace, surveyScreens, withGps } from './lib/screens.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const mode = args.mode ?? 'live';
const gameDir = args.game ?? process.env.ETS2_DIR ?? 'F:\\SteamLibrary\\steamapps\\common\\Euro Truck Simulator 2';
const out =
  args.out ?? path.join(process.env.USERPROFILE ?? '', 'OneDrive', 'Belgeler', 'Euro Truck Simulator 2', 'mod', 'truckplay.scs');
const version = JSON.parse(fs.readFileSync(path.join(here, '..', 'host', 'package.json'), 'utf8')).version;

const game = openGame(gameDir);
const files = [];
const add = (name, data) => files.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8') });

// ---------- GPS scripts ----------

function unit(type, name, fields) {
  const body = Object.entries(fields)
    .flatMap(([k, v]) => (Array.isArray(v) ? [` ${k}: ${v.length}`, ...v.map((x, i) => ` ${k}[${i}]: ${x}`)] : [` ${k}: ${v}`]))
    .join('\n');
  return `${type} : ${name} {\n${body}\n}\n`;
}

const box = ({ l, r, t, b }) => ({ coords_l: l, coords_r: r, coords_t: t, coords_b: b });
const fillParent = { area_l: 1, area_r: 0, area_t: 0, area_b: 1 };
const common = { id: 0, tab: -1, pointer: -1 };

/** A GPS script in `original`'s coordinate space and screen groups, drawing `material` over `visible`. */
function gpsScript(original, material, visible) {
  const full = scriptSpace(original);
  const [vl, vb, vr, vt] = visible ?? [full.l, full.b, full.r, full.t];
  const shown = { l: vl, b: vb, r: vr, t: vt };
  const groups = original.includes('id: 300') ? ['on', 'off', 'alt'] : ['on', 'off'];

  let s = 'SiiNunit\n{\n';
  s += unit('ui::window', '_nameless.truckplay.wnd', {
    window_handler: 'null',
    clip_children: 'false',
    keep_aspect: 'none',
    user_string_data: '""',
    first_direction_focus_id: 0,
    fitting: 'true',
    my_children: groups.map(g => `_nameless.truckplay.${g}`),
    ...box(full),
    area_l: full.l,
    area_r: full.r,
    area_t: full.t,
    area_b: full.b,
    id: 0,
    layer: 0,
    tab: -1,
    pointer: -1,
    my_parent: 'null',
  });
  const group = (g, id, children) =>
    unit('ui::group', `_nameless.truckplay.${g}`, {
      fitting: 'true',
      my_children: children,
      ...box(full),
      area_l: full.l,
      area_r: full.r,
      area_t: full.t,
      area_b: full.b,
      id,
      layer: 1,
      tab: -1,
      pointer: -1,
      my_parent: '_nameless.truckplay.wnd',
    });
  const text = (name, parent, rect, layer, markup) =>
    unit('ui::text', `_nameless.truckplay.${name}`, {
      text: `"${markup}"`,
      ...box(rect),
      ...fillParent,
      ...common,
      layer,
      my_parent: `_nameless.truckplay.${parent}`,
    });
  const black = '<img src=/material/ui/white.mat color=ff000000 xscale=stretch yscale=stretch>';
  const screen = `<img src=${material} xscale=stretch yscale=stretch>`;
  // The game's own map, drawn just before the marker covers it (see the top of this file).
  const map = original.match(/<img src=\/material\/ui\/dashboard\/bare_map\.mat[^>]*>/)?.[0] ?? null;
  const lit = g => [`_nameless.truckplay.${g}_bg`, ...(map ? [`_nameless.truckplay.${g}_map`] : []), `_nameless.truckplay.${g}_img`];

  s += group('on', 100, lit('on'));
  s += text('on_bg', 'on', full, 1, black);
  if (map) s += text('on_map', 'on', shown, 2, map);
  s += text('on_img', 'on', shown, 3, screen);
  s += group('off', 200, ['_nameless.truckplay.off_bg']);
  s += text('off_bg', 'off', full, 1, black);
  if (groups.includes('alt')) {
    s += group('alt', 300, lit('alt'));
    s += text('alt_bg', 'alt', full, 1, black);
    if (map) s += text('alt_map', 'alt', shown, 2, map);
    s += text('alt_img', 'alt', shown, 3, screen);
  }
  return s + '}\n';
}

// ---------- marker textures ----------

// Calibration: a grid in percent of the picture, coloured corners, so a glance shows whether
// the picture meets the glass on every side.
function calibrationImage(w, h) {
  const c = new Canvas(w, h);
  c.fill([18, 18, 22]);
  for (let i = 0; i <= 10; i++) {
    const x = Math.round((i / 10) * (w - 1));
    const y = Math.round((i / 10) * (h - 1));
    const major = i % 5 === 0;
    const col = major ? [255, 196, 0] : [90, 90, 100];
    c.fillRect(x - (major ? 2 : 1), 0, major ? 4 : 2, h, col);
    c.fillRect(0, y - (major ? 2 : 1), w, major ? 4 : 2, col);
  }
  const scale = Math.max(2, Math.round(w / 240));
  for (let i = 1; i < 10; i++) {
    c.text(i * 10, Math.round((i / 10) * (w - 1)) + 6, Math.round(h / 2) + 6, scale, [255, 255, 255]);
    c.text(i * 10, Math.round(w / 2) + 6, Math.round((i / 10) * (h - 1)) + 6, scale, [120, 220, 255]);
  }
  const m = Math.round(Math.min(w, h) / 12);
  c.fillRect(0, 0, m, m, [255, 59, 48]);
  c.fillRect(w - m, 0, m, m, [52, 199, 89]);
  c.fillRect(0, h - m, m, m, [0, 122, 255]);
  c.fillRect(w - m, h - m, m, m, [255, 255, 255]);
  c.text('TRUCKPLAY', Math.round(w / 2 - c.textWidth('TRUCKPLAY', scale * 2) / 2), Math.round(h * 0.3), scale * 2, [255, 255, 255]);
  return c.data;
}

// What the screen shows before the host streams the first frame: a calm dark field with the wordmark.
function splashImage(w, h) {
  const c = new Canvas(w, h);
  c.gradient([12, 14, 20], [4, 5, 8]);
  const scale = Math.max(3, Math.round(w / 200));
  const label = 'TRUCKPLAY';
  c.text(label, Math.round(w / 2 - c.textWidth(label, scale) / 2), Math.round(h / 2 - 3.5 * scale), scale, [235, 235, 245]);
  return c.data;
}

const uiMat = id =>
  `effect : "ui.rfx" {\n\ttexture : "texture" {\n\t\tsource : "screen_${id}.tobj"\n\t\tu_address : clamp\n\t\tv_address : clamp\n\t\tmip_filter : none\n\t}\n}\n`;

function addMarker(id, w, h) {
  const pixels = mode === 'calibrate' ? calibrationImage(w, h) : splashImage(w, h);
  add(`material/ui/truckplay/screen_${id}.dds`, ddsBgra(w, h, pixels));
  add(`material/ui/truckplay/screen_${id}.tobj`, tobj(`/material/ui/truckplay/screen_${id}.dds`));
  add(`material/ui/truckplay/screen_${id}.mat`, uiMat(id));
  return `/material/ui/truckplay/screen_${id}.mat`;
}

// ---------- the route advisor's TruckPlay panel ----------

// Same as the plugin's kAdvisorWidth/kAdvisorHeight: how it knows the panel's texture.
const ADVISOR = { w: 642, h: 559 };
const ADVISOR_SCRIPT = 'ui/adviser_gps.sii';
const PANEL = '_nameless._.truckplay.panel';

/** The advisor's script with our panel laid over its own panel (the map, id 1000), on top of all
 *  of it; its texture transparent until the plugin draws into it. */
function advisorScript(original) {
  const units = [...original.matchAll(/^(\S+) : (\S+) \{\n([\s\S]*?)\n\}/gm)];
  const panel = units.find(m => m[1] === 'ui::group' && /^ id: 1000$/m.test(m[3]));
  if (!panel) return null;
  const [whole, , name, body] = panel;
  const num = key => Number(body.match(new RegExp(`^ ${key}: (.+)$`, 'm'))?.[1]);
  const rect = { l: num('coords_l'), r: num('coords_r'), t: num('coords_t'), b: num('coords_b') };
  if (![rect.l, rect.r, rect.t, rect.b].every(Number.isFinite)) return null;
  const kids = [...body.matchAll(/^ my_children\[\d+\]: (.+)$/gm)].map(m => m[1]);
  const next = body.replace(
    /^ my_children: \d+\n(?: my_children\[\d+\]: .+\n?)*/m,
    [` my_children: ${kids.length + 1}`, ...[...kids, PANEL].map((k, i) => ` my_children[${i}]: ${k}`)].join('\n') + '\n',
  );
  const image = unit('ui::text', PANEL, {
    text: '"<img src=/material/ui/truckplay/advisor.mat xscale=stretch yscale=stretch>"',
    ...box(rect),
    ...fillParent,
    id: 9901,
    layer: 40,
    tab: -1,
    pointer: -1,
    my_parent: name,
  });
  const patched = original.replace(whole, `ui::group : ${name} {\n${next}\n}`);
  const close = patched.lastIndexOf('}');
  return `${patched.slice(0, close)}\n${image}\n${patched.slice(close)}`;
}

function addAdvisor() {
  let script = null;
  try {
    script = advisorScript(game.readText(ADVISOR_SCRIPT));
  } catch {
    script = null;
  }
  if (!script) {
    report.push(`  ! ${ADVISOR_SCRIPT}: its widget stack was not found, no TruckPlay panel in the route advisor`);
    return;
  }
  add(ADVISOR_SCRIPT, script);
  add('material/ui/truckplay/advisor.dds', ddsBgra(ADVISOR.w, ADVISOR.h, Buffer.alloc(ADVISOR.w * ADVISOR.h * 4)));
  add('material/ui/truckplay/advisor.tobj', tobj('/material/ui/truckplay/advisor.dds'));
  add(
    'material/ui/truckplay/advisor.mat',
    `effect : "ui.rfx" {\n\ttexture : "texture" {\n\t\tsource : "advisor.tobj"\n\t\tu_address : clamp\n\t\tv_address : clamp\n\t\tmip_filter : none\n\t}\n}\n`,
  );
  report.push(`  route advisor: TruckPlay panel over its own, ${ADVISOR.w}x${ADVISOR.h}`);
}

// ---------- assemble ----------

const report = [];
const screens = surveyScreens(game, { log: line => report.push(line) });
// A build for everyone (Workshop) leaves interiors from DLC archives alone: a player without that
// DLC would get interiors for a truck their game does not have. Those trucks still get TruckPlay
// through their dashboard scripts below.
const baseOnly = 'base-only' in args;
const originals = new Map();
const original = script => {
  if (!originals.has(script)) originals.set(script, game.readText(script.replace(/^\/+/, '')));
  return originals.get(script);
};

let interiorCount = 0;
for (const s of screens) {
  const material = addMarker(s.id, s.marker[0], s.marker[1]);
  const script = `/ui/truckplay/${s.id}.sii`;
  add(script.slice(1), gpsScript(original(s.script), material, s.visible));
  for (const { file, dlc } of s.interiors) {
    if (baseOnly && dlc) continue;
    add(file, withGps(inlineGpsIncludes(game, file), script, s.drawable));
    interiorCount++;
  }
  report.push(
    `  ${s.id.padEnd(22)} ${s.marker.join('x').padEnd(9)} ${(s.size.w * 1000).toFixed(0)}x${(s.size.h * 1000).toFixed(0)} mm` +
      `  uv ${s.uv.u0.toFixed(3)}-${s.uv.u1.toFixed(3)} × ${s.uv.v0.toFixed(3)}-${s.uv.v1.toFixed(3)}  ${s.interiors.length} interior(s)  ${s.trucks.join(' ')}`,
  );
}

// Trucks from other mods use the game's own scripts. The generic one keeps a square marker (its
// glass shows some band of it; the host places the UI where most cabs' glass is); the dashboard
// scripts show the marker of the screen they were made for, edge to edge.
add(GENERIC_SCRIPT.slice(1), gpsScript(original(GENERIC_SCRIPT), addMarker('generic', MARKER_WIDTH, MARKER_WIDTH), null));
addAdvisor();
for (const script of new Set(screens.map(s => s.script).filter(s => s !== GENERIC_SCRIPT))) {
  const own = screens.filter(s => s.script === script).sort((a, b) => b.interiors.length - a.interiors.length)[0];
  add(script.slice(1), gpsScript(original(script), `/material/ui/truckplay/screen_${own.id}.mat`, null));
}

add(
  'manifest.sii',
  `SiiNunit\n{\nmod_package : .package_name\n{\n\tpackage_version: "${version}"\n\tdisplay_name: "TruckPlay"\n\tauthor: "TruckPlay"\n` +
    `\tcategory[]: "interior"\n\tcategory[]: "ui"\n\ticon: "mod_icon.jpg"\n\tdescription_file: "mod_description.txt"\n` +
    `\tcompatible_versions[]: "${gameVersion()}"\n\tcompatible_versions[]: "1.*"\n\tmp_mod_optional: true\n}\n}\n`,
);
add(
  'mod_description.txt',
  'TruckPlay — tırın kendi multimedya ekranında CarPlay tarzı arayüz.\n\n' +
    'Bu mod kabin ekranını TruckPlay ekranına çevirir; her tırın ekranına tam oturur. Görüntüyü TruckPlay uygulaması ' +
    '(oyun eklentisi truckplay.dll ve TruckPlay) sağlar, ayrıca indirilir.\n\n' +
    'TruckPlay — a CarPlay-style screen on the truck\'s own infotainment display. Needs the TruckPlay app (separate download).\n',
);
const icon = path.join(here, 'assets', 'mod_icon.jpg');
if (fs.existsSync(icon)) add('mod_icon.jpg', fs.readFileSync(icon));
else report.push('  ! mod/assets/mod_icon.jpg missing (run host/tools/icon.mjs)');

// The host reads the screen table to name what it is drawing on.
fs.writeFileSync(
  args.screens ?? path.join(here, '..', 'shared', 'screens.json'),
  JSON.stringify(
    {
      comment: 'Generated by mod/build-mod.mjs from the installed game: one entry per cab screen. marker = texture size the UI is drawn at.',
      gameVersion: exeVersion(),
      markerWidth: MARKER_WIDTH,
      generic: { marker: [MARKER_WIDTH, MARKER_WIDTH], drawable: GENERIC_DRAWABLE },
      screens: screens.map(s => ({
        id: s.id,
        marker: s.marker,
        mm: [Math.round(s.size.w * 1000), Math.round(s.size.h * 1000)],
        trucks: s.trucks,
      })),
    },
    null,
    1,
  ) + '\n',
);

const zip = buildZip(files);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, zip);
if (args.folder) {
  fs.rmSync(args.folder, { recursive: true, force: true });
  for (const f of files) {
    const p = path.join(args.folder, ...f.name.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.data);
  }
}
game.close();
console.log(`TruckPlay mod ${version} (${mode}) → ${out}${args.folder ? ` and ${args.folder}` : ''}`);
console.log(`${files.length} files, ${screens.length} screens, ${interiorCount} interiors`);
console.log(report.join('\n'));

/**
 * The game's version, from its executable's version resource (the ProductVersion string, e.g.
 * "1.62.1"); `--game-version` overrides it.
 */
function exeVersion() {
  if (args['game-version']) return args['game-version'];
  try {
    const exe = fs.readFileSync(path.join(gameDir, 'bin', 'win_x64', 'eurotrucks2.exe'));
    const key = Buffer.from('ProductVersion\0', 'utf16le');
    const at = exe.lastIndexOf(key);
    if (at < 0) return '';
    let i = at + key.length;
    while (i + 1 < exe.length && exe[i] === 0 && exe[i + 1] === 0) i += 2; // padding
    let v = '';
    for (; i + 1 < exe.length; i += 2) {
      const c = exe.readUInt16LE(i);
      if (!c) break;
      v += String.fromCharCode(c);
    }
    return /^\d+\.\d+/.test(v) ? v.trim() : '';
  } catch {
    return '';
  }
}

/** The versions the mod says it fits: this game's ("1.62.*"), and any 1.x — a game update then
 *  does not switch the mod off before TruckPlay has made it again for the new version (see
 *  host/src/modcheck.js). */
function gameVersion() {
  const v = exeVersion() || '1.62';
  return `${v.split('.').slice(0, 2).join('.')}.*`;
}
