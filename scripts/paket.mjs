#!/usr/bin/env node
// Builds what friends download: one file.
//   dist/TruckPlay-Kurulum.exe   the installer (plugin/setup/setup.cpp) with the whole app appended:
//                                double-click and TruckPlay, its game plugin and the mod are in
//                                place (scripts/package/setup.ps1 does the work).
//   dist/TruckPlay/              the same app, unpacked (what the installer carries)
//   dist/workshop/TruckPlay/     with --workshop: the mod as a folder for SCS's Workshop Uploader
//
// usage: node scripts/paket.mjs [--skip-build] [--game <ETS2 folder>] [--workshop]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = k => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const version = JSON.parse(fs.readFileSync(path.join(root, 'host', 'package.json'), 'utf8')).version;
const dist = path.join(root, 'dist');
const app = path.join(dist, 'TruckPlay');
const res = path.join(app, 'resources', 'app');
const workshop = path.join(dist, 'workshop');
const build = path.join(root, 'plugin', 'build');

const step = s => console.log(`\n» ${s}`);
// npm/npx are .cmd scripts on Windows and need a shell; nothing else gets one (paths have spaces).
const run = (cmd, argv, cwd = root) => execFileSync(cmd, argv, { cwd, stdio: 'inherit', shell: /^np[mx]$/.test(cmd) });
const copy = (from, to, filter) => fs.cpSync(from, to, { recursive: true, filter });
// Windows' own bsdtar (a Git Bash tar earlier in PATH takes "C:" for a remote host).
const tar = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe');

if (!args.includes('--skip-build')) {
  step('Arayüz derleniyor');
  run('npx', ['vite', 'build'], path.join(root, 'ui'));
  step('Eklenti ve kurulum programı derleniyor');
  run('cmd', ['/c', path.join(root, 'scripts', 'build-plugin.cmd')]);
}

step('Klasörler temizleniyor');
for (const old of fs.readdirSync(dist, { withFileTypes: true })) {
  if (/^TirPlay|^TruckPlay-.*\.zip$/.test(old.name)) fs.rmSync(path.join(dist, old.name), { recursive: true, force: true });
}
fs.rmSync(app, { recursive: true, force: true });
fs.rmSync(workshop, { recursive: true, force: true });
fs.mkdirSync(path.join(app, 'game'), { recursive: true });
fs.mkdirSync(path.join(res, 'shared'), { recursive: true });

// The installer builds the mod from each player's own game; this ready-made one (the base game's
// cabs, DLC trucks through their dashboard scripts) is only the fallback.
step('Hazır mod (yedek)');
const game = opt('game') ?? process.env.ETS2_DIR ?? 'F:\\SteamLibrary\\steamapps\\common\\Euro Truck Simulator 2';
run('node', [
  path.join(root, 'mod', 'build-mod.mjs'),
  '--game', game,
  '--base-only',
  '--out', path.join(app, 'game', 'truckplay.scs'),
  '--screens', path.join(res, 'shared', 'screens.json'),
  ...(args.includes('--workshop') ? ['--folder', path.join(workshop, 'TruckPlay')] : []),
]);

step('Electron');
const electron = path.join(root, 'host', 'node_modules', 'electron', 'dist');
copy(electron, app, src => {
  const rel = path.relative(electron, src);
  if (rel === path.join('resources', 'default_app.asar')) return false;
  // Two languages are enough for the host's own dialogs (it shows none).
  if (rel.startsWith(`locales${path.sep}`)) return /(en-US|tr)\.pak$/.test(rel);
  return true;
});
fs.renameSync(path.join(app, 'electron.exe'), path.join(app, 'TruckPlay.exe'));
run(path.join(build, 'seticon.exe'), [path.join(app, 'TruckPlay.exe'), path.join(root, 'plugin', 'setup', 'truckplay.ico')]);

step('Uygulama dosyaları');
fs.writeFileSync(
  path.join(res, 'package.json'),
  JSON.stringify({ name: 'tirplay-host', productName: 'TruckPlay', version, private: true, type: 'module', main: 'host/src/main.js' }, null, 2) + '\n',
);
copy(path.join(root, 'host', 'src'), path.join(res, 'host', 'src'));
copy(path.join(root, 'host', 'package.json'), path.join(res, 'host', 'package.json'));
// Production dependencies only (Electron itself is the runtime above).
const deps = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: path.join(root, 'host'), shell: true, encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(p => p.includes(`${path.sep}node_modules${path.sep}`))
  // Electron is a peer of the ad blocker, so npm lists it too; it is the runtime itself.
  .filter(p => !/[\\/]node_modules[\\/](electron|@electron|@electron-internal|@types)([\\/]|$)/.test(p));
for (const dir of deps) copy(dir, path.join(res, 'host', path.relative(path.join(root, 'host'), dir)));
copy(path.join(root, 'ui', 'dist'), path.join(res, 'ui', 'dist'));
copy(path.join(root, 'shared', 'pmtiles.mjs'), path.join(res, 'shared', 'pmtiles.mjs'));
// The HUD's voice packs, when made (scripts/voices.mjs).
if (fs.existsSync(path.join(root, 'voices'))) copy(path.join(root, 'voices'), path.join(res, 'voices'));
// The installer rebuilds the mod from the player's own game (TruckPlay.exe runs it as Node.js).
copy(path.join(root, 'mod', 'build-mod.mjs'), path.join(res, 'mod', 'build-mod.mjs'));
copy(path.join(root, 'mod', 'lib'), path.join(res, 'mod', 'lib'));
copy(path.join(root, 'mod', 'assets', 'mod_icon.jpg'), path.join(res, 'mod', 'assets', 'mod_icon.jpg'));
for (const f of ['hashfs.mjs', 'cityhash.mjs']) copy(path.join(root, 'tools', 'scs', f), path.join(res, 'tools', 'scs', f));
copy(path.join(root, 'map', 'build-cities.mjs'), path.join(res, 'map', 'build-cities.mjs'));
// The road graph for directions is built at install too, from the player's own map and DLCs.
copy(path.join(root, 'map', 'build-graph.mjs'), path.join(res, 'map', 'build-graph.mjs'));
for (const f of ['sector.mjs', 'ppd.mjs']) copy(path.join(root, 'map', 'lib', f), path.join(res, 'map', 'lib', f));
fs.mkdirSync(path.join(res, 'map', 'data'), { recursive: true });
fs.mkdirSync(path.join(res, 'plugin', 'build'), { recursive: true });
copy(path.join(build, 'truckplay-media.exe'), path.join(res, 'plugin', 'build', 'truckplay-media.exe'));
copy(path.join(build, 'truckplay.dll'), path.join(app, 'game', 'truckplay.dll'));

step('Kurulum betiği');
for (const f of ['setup.ps1', 'BENIOKU.txt']) {
  const text = fs.readFileSync(path.join(root, 'scripts', 'package', f), 'utf8').replace(/^\ufeff/, '').replaceAll('{{version}}', version);
  // PowerShell 5 reads a script without a BOM in the ANSI code page: Turkish letters need the BOM.
  fs.writeFileSync(path.join(app, f), (f.endsWith('.ps1') ? '\ufeff' : '') + text.replace(/\r?\n/g, '\r\n'));
}

if (args.includes('--workshop')) {
  step('Atölye klasörü');
  copy(path.join(root, 'mod', 'assets', 'workshop_preview.jpg'), path.join(workshop, 'workshop_preview.jpg'));
  copy(path.join(root, 'scripts', 'package', 'ATOLYE.txt'), path.join(workshop, 'ATOLYE.txt'));
}

step('Tek dosya: TruckPlay-Kurulum.exe');
const payload = path.join(dist, 'payload.zip');
fs.rmSync(payload, { force: true });
execFileSync(tar, ['-a', '-cf', payload, '-C', app, '.'], { stdio: 'inherit' });
const stub = fs.readFileSync(path.join(build, 'truckplay-setup.exe'));
const zip = fs.readFileSync(payload);
const tail = Buffer.alloc(16);
tail.writeBigUInt64LE(BigInt(stub.length), 0);
tail.write('TPSETUP1', 8, 'latin1');
const installer = path.join(dist, 'TruckPlay-Kurulum.exe');
fs.writeFileSync(installer, Buffer.concat([stub, zip, tail]));
fs.rmSync(payload, { force: true });
console.log(`\n${installer} (${(fs.statSync(installer).size / 1048576).toFixed(0)} MB)`);
