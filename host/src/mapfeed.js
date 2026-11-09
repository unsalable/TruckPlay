// The game's own GPS map, as the plugin copies it out of the game (plugin/src/gamedraw.cpp):
// frames in shared memory (`Local\TruckPlayMap`, layout in shared/protocol.md), read up to 30
// times a second while the UI shows the map, and handed on to it. Win32 file mapping through koffi,
// bytes moved with RtlMoveMemory as in frames.js (Electron's memory cage forbids mapping them).

import koffi from 'koffi';

const MAGIC = 0x314d5054; // 'TPM1'
const HEADER = 64;
const MAX = 1024;
const BUF = MAX * MAX * 4;

const kernel32 = koffi.load('kernel32.dll');
const CreateFileMappingW = kernel32.func('void* __stdcall CreateFileMappingW(void* hFile, void* attrs, uint32 protect, uint32 sizeHigh, uint32 sizeLow, str16 name)');
const MapViewOfFile = kernel32.func('void* __stdcall MapViewOfFile(void* hMap, uint32 access, uint32 offHigh, uint32 offLow, uintptr size)');
const UnmapViewOfFile = kernel32.func('bool __stdcall UnmapViewOfFile(void* addr)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void* h)');
const copyOut = kernel32.func('RtlMoveMemory', 'void', ['void *', 'uintptr', 'uintptr']); // Buffer ← view

const INVALID_HANDLE_VALUE = -1;
const PAGE_READWRITE = 0x04;
const FILE_MAP_ALL_ACCESS = 0xf001f;

export class MapFeed {
  constructor(log) {
    this.log = log;
    this.map = null;
    this.view = null;
    this.base = 0n;
    this.header = Buffer.alloc(HEADER);
    this.seq = 0n;
  }

  open() {
    if (this.view) return true;
    // TRUCKPLAY_SHM: the test cab's own names, apart from a running game's.
    const base = process.env.TRUCKPLAY_SHM || '';
    const name = `Local\\${base ? `${base}Map` : 'TruckPlayMap'}`;
    const total = HEADER + 2 * BUF;
    this.map = CreateFileMappingW(INVALID_HANDLE_VALUE, null, PAGE_READWRITE, 0, total, name);
    if (!this.map) return false;
    this.view = MapViewOfFile(this.map, FILE_MAP_ALL_ACCESS, 0, 0, total);
    if (!this.view) {
      CloseHandle(this.map);
      this.map = null;
      return false;
    }
    this.base = BigInt(koffi.address(this.view));
    this.log(`map feed: shared memory ${name}`);
    return true;
  }

  /** The newest frame, if the plugin has written one since the last read: {seq, w, h, data}
   *  (RGBA, rows top down). */
  read() {
    if (!this.open()) return null;
    copyOut(this.header, this.base, HEADER);
    if (this.header.readUInt32LE(0) !== MAGIC) return null;
    const seq = this.header.readBigUInt64LE(16);
    if (seq === this.seq) return null;
    const front = this.header.readUInt32LE(8) & 1;
    const w = this.header.readUInt32LE(24 + front * 4);
    const h = this.header.readUInt32LE(32 + front * 4);
    if (!w || !h || w > MAX || h > MAX) return null;
    const data = Buffer.allocUnsafe(w * h * 4);
    copyOut(data, this.base + BigInt(HEADER + front * BUF), data.length);
    // Two frames written while copying would have reused the buffer read: drop this one.
    copyOut(this.header, this.base, HEADER);
    if (this.header.readBigUInt64LE(16) - seq >= 2n) return null;
    this.seq = seq;
    return { seq: Number(seq), w, h, data };
  }

  close() {
    if (this.view) UnmapViewOfFile(this.view);
    if (this.map) CloseHandle(this.map);
    this.view = null;
    this.map = null;
  }
}
