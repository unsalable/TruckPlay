// The music library: audio files in the Windows Music folder and the game's own music folder,
// with their tags, served to the UI through the tpmedia:// protocol.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseFile } from 'music-metadata';

const AUDIO = /\.(mp3|m4a|aac|ogg|oga|opus|flac|wav)$/i;
const LIMIT = 3000;

async function walk(dir, out, depth = 0) {
  if (out.length >= LIMIT || depth > 6) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= LIMIT) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out, depth + 1);
    else if (AUDIO.test(e.name)) out.push(full);
  }
}

const hueOf = s => {
  const h = crypto.createHash('md5').update(s).digest();
  return h[0] * 1.41 % 360 | 0;
};

export class MusicLibrary {
  constructor(folders, cacheDir) {
    this.folders = folders;
    this.cacheDir = cacheDir;
    this.tracks = null;
    this.byId = new Map();
  }

  async list() {
    if (this.tracks) return this.tracks;
    const files = [];
    for (const f of this.folders) await walk(f, files);
    await fs.mkdir(this.cacheDir, { recursive: true });
    const tracks = [];
    for (const file of files) {
      const id = crypto.createHash('sha1').update(file).digest('hex').slice(0, 16);
      let meta = null;
      try {
        meta = await parseFile(file, { duration: true, skipCovers: false });
      } catch {
        // unreadable tags: fall back to the file name
      }
      const common = meta?.common ?? {};
      let artwork = null;
      const pic = common.picture?.[0];
      if (pic?.data) {
        const ext = pic.format?.includes('png') ? 'png' : 'jpg';
        const coverFile = path.join(this.cacheDir, `${id}.${ext}`);
        await fs.writeFile(coverFile, pic.data).catch(() => {});
        this.byId.set(`${id}.cover`, coverFile);
        artwork = `tpmedia://cover/${id}`;
      }
      this.byId.set(id, file);
      tracks.push({
        url: `tpmedia://track/${id}`,
        title: common.title || path.basename(file).replace(AUDIO, ''),
        artist: common.artist || common.albumartist || '',
        album: common.album || '',
        artwork,
        duration: meta?.format?.duration ?? 0,
        hue: hueOf(common.album || common.artist || file),
      });
    }
    tracks.sort((a, b) => (a.artist + a.album + a.title).localeCompare(b.artist + b.album + b.title, 'tr'));
    this.tracks = tracks;
    return tracks;
  }

  /** Path for a tpmedia:// URL, or null. */
  resolve(url) {
    const u = new URL(url);
    const id = u.pathname.replace(/^\//, '');
    if (u.hostname === 'track') return this.byId.get(id) ?? null;
    if (u.hostname === 'cover') return this.byId.get(`${id}.cover`) ?? null;
    return null;
  }
}
