// After a game update the game calls a mod made for the old version incompatible and leaves it out
// (TruckPlay's screen is gone from the cab). So when the game says hello with a version the mod was
// not made for, the mod is made again from the updated game's own files (mod/build-mod.mjs, as the
// installer does), in the background. The game reads its mods when it starts: the new one is in
// effect from the next start, and the UI says so.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const minor = v => String(v ?? '').split('.').slice(0, 2).join('.');
let running = false;

/** The game version the mod at hand was made for (shared/screens.json), or ''. */
function builtFor(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'shared', 'screens.json'), 'utf8')).gameVersion ?? '';
  } catch {
    return '';
  }
}

export function checkMod({ root, gameVersion, gameDir, documents, log, done }) {
  if (running || !gameVersion || !gameDir) return;
  const built = builtFor(root);
  if (minor(built) === minor(gameVersion)) return;
  const script = path.join(root, 'mod', 'build-mod.mjs');
  if (!fs.existsSync(script)) return;
  const out = path.join(documents, 'Euro Truck Simulator 2', 'mod', 'truckplay.scs');
  log(`mod: made for ${built || 'an earlier game'}, the game is ${gameVersion}: making it again → ${out}`);
  running = true;
  const child = spawn(process.execPath, [script, '--game', gameDir, '--out', out], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let tail = '';
  const keep = chunk => {
    tail = (tail + chunk).slice(-2000);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('error', e => {
    running = false;
    log(`mod: could not start the builder: ${e.message}`);
  });
  child.on('exit', code => {
    running = false;
    if (code === 0) {
      log(`mod: made for ${gameVersion}`);
      done?.(gameVersion);
    } else {
      log(`mod: builder failed (${code}): ${tail.trim().split('\n').slice(-3).join(' | ')}`);
    }
  });
}
