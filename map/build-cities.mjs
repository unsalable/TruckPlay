// Reads the game's city definitions and their translations into map/data/cities.json:
//   { "<token>": { "name": "München", "en": "Munich", "tr": "Münih", "country": "germany" } }
// The SDK names a job's cities by token; the map data uses English names. This table joins the
// two, and lets the map show city names in the language TruckPlay speaks.
//
//   node map/build-cities.mjs [--game <ETS2 folder>] [--out map/data/cities.json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGame } from '../tools/scs/hashfs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const GAME = arg('game', process.env.ETS2_DIR ?? 'F:\\SteamLibrary\\steamapps\\common\\Euro Truck Simulator 2');
const out = path.resolve(root, arg('out', 'map/data/cities.json'));
const LANGS = { en: 'en_us', tr: 'tr_tr' };

const game = openGame(GAME);
const value = (body, key) => new RegExp(`\\b${key}\\s*:\\s*("([^"]*)"|(\\S+))`).exec(body)?.slice(2).find(v => v !== undefined);

const cities = {};
for (const file of game.list('def/city').files) {
  if (!/\.(sii|sui)$/.test(file)) continue;
  const text = game.readText(`def/city/${file}`) ?? '';
  for (const m of text.matchAll(/city_data\s*:\s*city\.(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const [, token, body] = m;
    cities[token] = {
      name: value(body, 'city_name') ?? token,
      key: /@@(\w+)@@/.exec(value(body, 'city_name_localized') ?? '')?.[1] ?? token,
      country: value(body, 'country') ?? '',
    };
  }
}

function localization(lang) {
  const table = new Map();
  for (const file of game.list(`locale/${lang}`).files) {
    if (!/\.(sii|sui)$/.test(file)) continue;
    const text = game.readText(`locale/${lang}/${file}`) ?? '';
    let key = null;
    for (const m of text.matchAll(/^\s*(key|val)\[\]\s*:\s*"((?:[^"\\]|\\.)*)"/gm)) {
      if (m[1] === 'key') key = m[2];
      else if (key !== null) {
        table.set(key, m[2]);
        key = null;
      }
    }
  }
  return table;
}

const result = {};
const tables = Object.fromEntries(Object.entries(LANGS).map(([k, lang]) => [k, localization(lang)]));
for (const [token, c] of Object.entries(cities).sort(([a], [b]) => a.localeCompare(b))) {
  result[token] = { name: c.name, country: c.country };
  for (const k of Object.keys(LANGS)) result[token][k] = tables[k].get(c.key) ?? c.name;
}
game.close();

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(result)}\n`);
const n = Object.keys(result).length;
const sample = ['munchen', 'wien', 'istanbul', 'edirne', 'praha'].map(t => `${t}=${result[t]?.en}/${result[t]?.tr}`).join(' ');
console.log(`${n} cities → ${path.relative(root, out)}  (${sample})`);
