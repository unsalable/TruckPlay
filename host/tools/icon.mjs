// Draws TruckPlay's app icon (a glass-blue squircle with the truck glyph) and writes it as a
// Windows .ico (PNG images at 256, 64, 48, 32 and 16 px) for the installer and TruckPlay.exe.
// usage: electron tools/icon.mjs <out.ico>

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';

const out = process.argv[process.argv.length - 1];
const TRUCK =
  'M2.6 5.2h10.8c.7 0 1.2.5 1.2 1.2v9.1H1.4V6.4c0-.7.5-1.2 1.2-1.2zm13.2 2.9h3.4c.5 0 .9.2 1.1.6l2.1 3.5c.1.2.2.4.2.7v3.1c0 .5-.4.9-.9.9h-.5a2.7 2.7 0 0 0-5.3 0h-.1V8.1zm1.6 1.6v3h3.6l-1.7-2.7c-.1-.2-.3-.3-.5-.3h-1.4zM1.4 16.6h2.3a2.7 2.7 0 0 1 5.3 0h4.4v.9H9a2.7 2.7 0 0 1-5.3 0H1.4v-.9zm5 3.1a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zm12.1 0a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a9bff"/><stop offset="1" stop-color="#1b3fd8"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <path d="M128 8c88 0 120 32 120 120s-32 120-120 120S8 216 8 128 40 8 128 8z" fill="url(#bg)"/>
  <path d="M128 8c88 0 120 32 120 120s-32 120-120 120S8 216 8 128 40 8 128 8z" fill="url(#shine)"/>
  <g transform="translate(40 40) scale(7.33)" fill="#fff"><path d="${TRUCK}"/></g>
</svg>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html,${encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)}`);
  await new Promise(r => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  const sizes = [256, 64, 48, 32, 16];
  const pngs = sizes.map(s => (s === 256 ? image : image.resize({ width: s, height: s, quality: 'best' })).toPNG());
  // ICONDIR, one ICONDIRENTRY per image, then the PNGs.
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    head[e] = s === 256 ? 0 : s;
    head[e + 1] = s === 256 ? 0 : s;
    head.writeUInt16LE(1, e + 4); // planes
    head.writeUInt16LE(32, e + 6); // bits per pixel
    head.writeUInt32LE(pngs[i].length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  fs.writeFileSync(out, Buffer.concat([head, ...pngs]));
  fs.writeFileSync(out.replace(/\.ico$/, '.png'), pngs[0]);
  console.log(`${out} (${sizes.join(', ')})`);
  app.exit(0);
});
