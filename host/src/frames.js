// Writes UI frames into the shared memory the game plugin reads (layout: shared/protocol.md).
// Win32 file mapping through koffi. Electron's V8 memory cage forbids ArrayBuffers over foreign
// memory, so nothing is mapped into JS: bytes move with RtlMoveMemory between Buffers and the view.

import koffi from 'koffi';

const MAGIC = 0x31465054; // 'TPF1'
const HEADER = 128;

const kernel32 = koffi.load('kernel32.dll');
const CreateFileMappingW = kernel32.func('void* __stdcall CreateFileMappingW(void* hFile, void* attrs, uint32 protect, uint32 sizeHigh, uint32 sizeLow, str16 name)');
const MapViewOfFile = kernel32.func('void* __stdcall MapViewOfFile(void* hMap, uint32 access, uint32 offHigh, uint32 offLow, uintptr size)');
const UnmapViewOfFile = kernel32.func('bool __stdcall UnmapViewOfFile(void* addr)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void* h)');
const GetLastError = kernel32.func('uint32 __stdcall GetLastError()');
const copyIn = kernel32.func('RtlMoveMemory', 'void', ['uintptr', 'void *', 'uintptr']); // view ← Buffer
const copyOut = kernel32.func('RtlMoveMemory', 'void', ['void *', 'uintptr', 'uintptr']); // Buffer ← view

const INVALID_HANDLE_VALUE = -1;
const PAGE_READWRITE = 0x04;
const FILE_MAP_ALL_ACCESS = 0xf001f;

/** Whole pixels inside the frame, at least 1×1. */
function clampRect(r, width, height) {
  const x = Math.max(0, Math.min(width - 1, Math.floor(r.x)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(r.y)));
  const right = Math.max(x + 1, Math.min(width, Math.ceil(r.x + r.width)));
  const bottom = Math.max(y + 1, Math.min(height, Math.ceil(r.y + r.height)));
  return { x, y, width: right - x, height: bottom - y };
}

function union(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** The shared memory a channel of frames lives in: the cab screen's, or the HUD's (`hud`). Both
 *  sides derive the same name and size (plugin/src/frames.cpp). */
export function channel(kind = 'screen') {
  // TRUCKPLAY_SHM: the test cab uses its own frames, apart from a running game's.
  const base = process.env.TRUCKPLAY_SHM || '';
  if (kind === 'hud') return { name: `Local\\${base ? `${base}Hud` : 'TruckPlayHud'}`, maxW: 2048, maxH: 800 };
  if (kind === 'wind') return { name: `Local\\${base ? `${base}Wind` : 'TruckPlayWind'}`, maxW: 1600, maxH: 800 };
  return { name: `Local\\${base || 'TruckPlayFrames'}`, maxW: 2048, maxH: 1600 };
}

export class FrameWriter {
  constructor({ name, maxW, maxH } = channel()) {
    this.maxW = maxW;
    this.maxH = maxH;
    this.buf = maxW * maxH * 4;
    const total = HEADER + 2 * this.buf;
    this.map = CreateFileMappingW(INVALID_HANDLE_VALUE, null, PAGE_READWRITE, 0, total, name);
    if (!this.map) throw new Error(`CreateFileMapping failed (${GetLastError()})`);
    this.view = MapViewOfFile(this.map, FILE_MAP_ALL_ACCESS, 0, 0, total);
    if (!this.view) throw new Error(`MapViewOfFile failed (${GetLastError()})`);
    this.base = BigInt(koffi.address(this.view));
    // Our copy of the header; written back whole after each frame.
    this.header = Buffer.alloc(HEADER);
    copyOut(this.header, this.base, HEADER);
    this.header.writeUInt32LE(MAGIC, 0);
    this.header.writeUInt32LE(1, 4);
    this.header.writeUInt32LE(1, 12); // host alive
    this.header.writeBigUInt64LE(BigInt(process.pid), 24);
    this.front = this.header.readUInt32LE(8) & 1;
    this.seq = this.header.readBigUInt64LE(16);
    this.flushHeader();
    this.frames = 0;
    // Each buffer is brought up to date incrementally: it already holds the frame before last,
    // so only what changed in the last two frames is copied.
    this.held = [null, null]; // {w, h} a buffer holds a complete frame of, else null
    this.prevDirty = null;
  }

  flushHeader() {
    copyIn(this.base, this.header, HEADER);
  }

  setAlive(alive) {
    this.header.writeUInt32LE((this.header.readUInt32LE(12) & ~1) | (alive ? 1 : 0), 12);
    this.flushHeader();
  }

  /** The HUD's channel: whether the plugin should draw it at all (bit 1 of the flags). */
  setVisible(visible) {
    this.header.writeUInt32LE((this.header.readUInt32LE(12) & ~2) | (visible ? 2 : 0), 12);
    this.flushHeader();
  }

  /** image: the OSR NativeImage (BGRA); dirty: {x,y,width,height} changed since the previous frame. */
  write(image, dirty) {
    const { width, height } = image.getSize();
    if (!width || !height || width > this.maxW || height > this.maxH) return;
    const back = this.front ^ 1;
    const stride = width * 4;
    const full = { x: 0, y: 0, width, height };
    const d = clampRect(dirty ?? full, width, height);
    const held = this.held[back];
    const whole = !held || held.w !== width || held.h !== height || !this.prevDirty;
    const u = whole ? full : union(this.prevDirty, d);
    const dst = this.base + BigInt(HEADER + back * this.buf);
    if (u.width === width) {
      // Whole rows are contiguous in both places: one copy.
      const bmp = u.height === height ? image.toBitmap() : image.crop(u).toBitmap();
      copyIn(dst + BigInt(u.y * stride), bmp, stride * u.height);
    } else {
      const bmp = image.crop(u).toBitmap();
      const row = u.width * 4;
      for (let y = 0; y < u.height; y++) {
        copyIn(dst + BigInt((u.y + y) * stride + u.x * 4), bmp.subarray(y * row, (y + 1) * row), row);
      }
    }
    this.held[back] = { w: width, h: height };
    this.prevDirty = d;

    const info = 32 + back * 32;
    this.header.writeUInt32LE(width, info);
    this.header.writeUInt32LE(height, info + 4);
    this.header.writeUInt32LE(stride, info + 8);
    this.header.writeUInt32LE(d.x, info + 12);
    this.header.writeUInt32LE(d.y, info + 16);
    this.header.writeUInt32LE(d.width, info + 20);
    this.header.writeUInt32LE(d.height, info + 24);
    this.header.writeUInt32LE(back, 8);
    this.front = back;
    this.seq += 1n;
    this.header.writeBigUInt64LE(this.seq, 16);
    // Dims, front and seq land in one copy; the plugin reads seq first and re-checks it after.
    this.flushHeader();
    this.frames++;
  }

  close() {
    try {
      this.setAlive(false);
      UnmapViewOfFile(this.view);
      CloseHandle(this.map);
    } catch {
      // closing at exit; nothing useful to do on failure
    }
  }
}
