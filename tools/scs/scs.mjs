#!/usr/bin/env node
// Small CLI over hashfs.mjs:
//   node tools/scs/scs.mjs ls <dir>            list a directory across all archives
//   node tools/scs/scs.mjs where <file>        which archives hold a path
//   node tools/scs/scs.mjs cat <file>          print a text file (3nK decoded)
//   node tools/scs/scs.mjs get <file> <out>    write a file to disk
//   node tools/scs/scs.mjs grep <dir> <regex>  search text files under a directory (recursive)
// The game folder comes from ETS2_DIR or the default Steam library path.

import fs from 'node:fs';
import path from 'node:path';
import { openGame, decodeText } from './hashfs.mjs';

const GAME = process.env.ETS2_DIR ?? 'F:\\SteamLibrary\\steamapps\\common\\Euro Truck Simulator 2';
const [cmd, a1, a2] = process.argv.slice(2);
const game = openGame(GAME);
const clean = p => (p ?? '').replace(/^\/+/, '').replace(/\/+$/, '');

function* walk(dir, depth = 0) {
  const l = game.list(dir);
  for (const f of l.files) yield dir ? `${dir}/${f}` : f;
  if (depth > 12) return;
  for (const d of l.dirs) yield* walk(dir ? `${dir}/${d}` : d, depth + 1);
}

switch (cmd) {
  case 'ls': {
    const l = game.list(clean(a1));
    l.dirs.forEach(d => console.log(`${d}/`));
    l.files.forEach(f => console.log(f));
    break;
  }
  case 'where':
    for (const { archive, entry } of game.findAll(clean(a1))) {
      console.log(`${archive.name}\t${entry.isDirectory ? 'dir' : `${entry.size} B ${entry.compression}`}${entry.image ? ` img ${JSON.stringify(entry.image)}` : ''}`);
    }
    break;
  case 'cat': {
    const t = game.readText(clean(a1));
    if (t === undefined) {
      console.error(`not found: ${a1}`);
      process.exitCode = 1;
    } else process.stdout.write(t);
    break;
  }
  case 'get': {
    const b = game.read(clean(a1));
    if (!b) {
      console.error(`not found: ${a1}`);
      process.exitCode = 1;
    } else {
      fs.mkdirSync(path.dirname(a2), { recursive: true });
      fs.writeFileSync(a2, b);
      console.log(`${a2} (${b.length} B)`);
    }
    break;
  }
  case 'grep': {
    const re = new RegExp(a2, 'i');
    for (const f of walk(clean(a1))) {
      if (!/\.(sii|sui|mat|txt|tobj)$/i.test(f)) continue;
      let text;
      try {
        const b = game.read(f);
        if (!b) continue;
        text = /\.tobj$/i.test(f) ? b.toString('latin1') : decodeText(b);
      } catch {
        continue;
      }
      text.split(/\r?\n/).forEach((line, i) => {
        if (re.test(line)) console.log(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    break;
  }
  default:
    console.log('usage: scs.mjs ls|where|cat|get|grep ...');
}
game.close();
