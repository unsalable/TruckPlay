// Texture files for the mod: uncompressed BGRA .dds (one mip) and the binary .tobj that points at it.

// Legacy DDS header with A8R8G8B8 masks, which D3D maps to DXGI_FORMAT_B8G8R8A8_UNORM.
export function ddsBgra(width, height, bgra) {
  if (bgra.length !== width * height * 4) throw new Error('dds: pixel buffer size mismatch');
  const h = Buffer.alloc(128);
  h.write('DDS ', 0, 'latin1');
  h.writeUInt32LE(124, 4); // header size
  h.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x8 | 0x1000, 8); // CAPS | HEIGHT | WIDTH | PITCH | PIXELFORMAT
  h.writeUInt32LE(height, 12);
  h.writeUInt32LE(width, 16);
  h.writeUInt32LE(width * 4, 20); // pitch
  h.writeUInt32LE(0, 24); // depth
  h.writeUInt32LE(1, 28); // mip count
  // pixel format @76
  h.writeUInt32LE(32, 76);
  h.writeUInt32LE(0x1 | 0x40, 80); // ALPHAPIXELS | RGB
  h.writeUInt32LE(0, 84); // fourCC
  h.writeUInt32LE(32, 88); // bit count
  h.writeUInt32LE(0x00ff0000, 92); // R
  h.writeUInt32LE(0x0000ff00, 96); // G
  h.writeUInt32LE(0x000000ff, 100); // B
  h.writeUInt32LE(0xff000000, 104); // A
  h.writeUInt32LE(0x1000, 108); // caps: TEXTURE
  return Buffer.concat([h, bgra]);
}

// Binary TOBJ, laid out like the UI textures other mods ship (2D map, default filters, no compression).
export function tobj(ddsPath) {
  const p = Buffer.from(ddsPath, 'latin1');
  const h = Buffer.alloc(48);
  h.writeUInt32LE(0x70b10a01, 0); // version
  h.writeUInt32LE(0x00020001, 20);
  h[24] = 2; // type: map 2D
  h[26] = 3; // mag filter: default
  h[27] = 3; // min filter: default
  h[28] = 3; // mip filter: default (the .mat asks for none)
  h[33] = 1; // no compression
  h[37] = 1;
  h.writeUInt32LE(p.length, 40);
  return Buffer.concat([h, p]);
}
