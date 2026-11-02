// Stands in for truckplay.dll to test the host without the game: serves \\.\pipe\tirplay, reports a
// 1282×722 screen, streams telemetry, taps an app icon with the pointer and saves what the host
// draws (read back from shared memory) as PNGs.
// usage: node tools/fake-plugin.mjs <outDir>

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import koffi from 'koffi';

const out = path.resolve(process.argv[2] ?? '.');
fs.mkdirSync(out, { recursive: true });
const W = Number(process.argv[3] ?? 1282);
const H = Number(process.argv[4] ?? 722);
const HEADER = 128;
const BUF = 2048 * 1600 * 4;
const TOTAL = HEADER + 2 * BUF;

const k32 = koffi.load('kernel32.dll');
const CreateFileMappingW = k32.func('void* __stdcall CreateFileMappingW(void*, void*, uint32, uint32, uint32, str16)');
const MapViewOfFile = k32.func('void* __stdcall MapViewOfFile(void*, uint32, uint32, uint32, uintptr)');
const map = CreateFileMappingW(-1, null, 4, 0, TOTAL, 'Local\\TruckPlayFrames');
const mem = Buffer.from(koffi.view(MapViewOfFile(map, 0xf001f, 0, 0, TOTAL), TOTAL));

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = b => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function png(bgra, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = y * (w * 4 + 1) + 1 + x * 4;
      raw[d] = bgra[s + 2];
      raw[d + 1] = bgra[s + 1];
      raw[d + 2] = bgra[s];
      raw[d + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function snapshot(name) {
  const front = mem.readUInt32LE(8) & 1;
  const info = 32 + front * 32;
  const w = mem.readUInt32LE(info);
  const h = mem.readUInt32LE(info + 4);
  const seq = mem.readBigUInt64LE(16);
  if (!w || !h) {
    console.log(`${name}: no frame yet (seq ${seq})`);
    return;
  }
  const px = mem.subarray(HEADER + front * BUF, HEADER + front * BUF + w * h * 4);
  fs.writeFileSync(path.join(out, `${name}.png`), png(px, w, h));
  console.log(`${name}.png ${w}x${h} seq ${seq} alive=${mem.readUInt32LE(12) & 1}`);
}

const tel = t => ({
  t: 'tel',
  paused: false,
  game: { time: 3 * 1440 + 21 * 60 + 5 + Math.floor(t / 3), rest: 400, brk: 0, scale: 19, mp: 0 },
  truck: {
    on: true, brand: 'Scania', brandId: 'scania', name: 'S', id: 'vehicle.scania.s_2016', plate: '34 TP 2026', plateCountry: 'Türkiye',
    speed: 22, rpm: 1310, rpmMax: 2500, gear: 11, dgear: 11, gearsF: 12, gearsR: 2, cruise: 22.2, steer: 0, throttle: 0.3, brake: 0, clutch: 0,
    fuel: 560, fuelCap: 1200, fuelRange: 1800000, fuelAvg: 0.31, fuelWarn: false, adblue: 50, adblueCap: 80, adblueWarn: false,
    air: 8.8, airWarnAt: 6.2, airWarn: false, airEmg: false, brakeT: 70, oilP: 4, oilWarn: false, oilT: 93, waterT: 87, waterWarn: false,
    batt: 27.9, battWarn: false, electric: true, engine: true, pbrake: false, mbrake: false, retarder: 0, retarderSteps: 4,
    lights: { lBlink: false, rBlink: false, lInd: false, rInd: false, hazard: false, parking: true, low: true, high: false, beacon: false, brake: false, reverse: false, auxF: 0, auxR: 0 },
    wipers: false, diffLock: false, backlight: 1, odo: 184300, wear: { engine: 0.02, trans: 0.03, cabin: 0.05, chassis: 0.04, wheels: 0.06 },
    nav: { dist: 212000 - t * 22, time: 9800, limit: 25 }, pos: { x: -3000 - t * 15, y: 50, z: 15600 - t * 16, h: 0.12, p: 0, r: 0 },
  },
  trailer: { on: true, attached: true, name: 'Krone', brand: 'Krone', plate: '', cargoDamage: 0, wear: { body: 0, chassis: 0, wheels: 0 }, pos: { x: 0, y: 0, z: 0, h: 0, p: 0, r: 0 } },
  job: { on: true, cargo: 'Elektronik', cargoId: 'electronics', mass: 18640, damage: 0.004, income: 7850, due: 4 * 1440 + 6 * 60, plannedKm: 452, loaded: true, special: false, market: 'cargo_market',
    src: { city: 'İstanbul', cityId: 'istanbul', company: 'Tirsan', companyId: 'tirsan' }, dst: { city: 'Ankara', cityId: 'ankara', company: 'Tradeaux', companyId: 'tradeaux' } },
});

const server = net.createServer(sock => {
  console.log('host connected');
  const send = m => sock.write(`${JSON.stringify(m)}\n`);
  sock.on('data', d => process.stdout.write(`host says: ${d}`));
  send({ t: 'hello', plugin: 'fake', game: 'eut2', sdk: '1.21' });
  send({ t: 'screen', w: W, h: H, fmt: 91, count: 1, serial: 1 });
  let t = 0;
  const timer = setInterval(() => send(tel(t++)), 50);
  const steps = [
    [2500, () => snapshot('1-dashboard')],
    [2600, () => send({ t: 'ptr', act: 'enter', x: 0.5, y: 0.5 })],
    // The rail's bottom button → app grid.
    [2700, () => send({ t: 'ptr', act: 'move', x: 0.045, y: 0.925 })],
    [2800, () => send({ t: 'ptr', act: 'down', x: 0.045, y: 0.925, b: 0 })],
    [2850, () => send({ t: 'ptr', act: 'up', x: 0.045, y: 0.925, b: 0 })],
    [3900, () => snapshot('2-grid-with-pointer')],
    // Tap Tır (second row, second column).
    [4000, () => send({ t: 'ptr', act: 'move', x: 0.364, y: 0.68 })],
    [4100, () => send({ t: 'ptr', act: 'down', x: 0.364, y: 0.68, b: 0 })],
    [4150, () => send({ t: 'ptr', act: 'up', x: 0.364, y: 0.68, b: 0 })],
    [5400, () => snapshot('3-truck-app')],
    [5500, () => send({ t: 'ev', id: 'player.fined', a: { 'fine.offence': 'speeding', 'fine.amount': 450 } })],
    [6000, () => snapshot('4-banner')],
    [6100, () => send({ t: 'ptr', act: 'leave', x: 0.5, y: 0.5 })],
    [6300, () => {
      clearInterval(timer);
      sock.end();
      server.close();
      setTimeout(() => process.exit(0), 200);
    }],
  ];
  for (const [ms, fn] of steps) setTimeout(fn, ms);
});
server.listen('\\\\.\\pipe\\tirplay', () => console.log('fake plugin listening'));
