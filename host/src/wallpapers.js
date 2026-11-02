// Photos to use as wallpaper: the player's own ETS2 screenshots first, then the Pictures folder.
// Served over tpwall:// as screen-sized JPEGs (and small thumbnails), cached in userData.

import { nativeImage } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const IMAGE = /\.(jpe?g|png|webp|bmp)$/i;
const LIMIT = 48;

export class WallpaperPhotos {
  constructor(folders, cacheDir) {
    this.folders = folders; // [{ dir, source }]
    this.cacheDir = cacheDir;
    this.byId = new Map();
  }

  async list() {
    const found = [];
    for (const { dir, source } of this.folders) {
      let entries = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isFile() || !IMAGE.test(e.name)) continue;
        const file = path.join(dir, e.name);
        try {
          const st = await fs.stat(file);
          if (st.size < 20_000) continue; // icons and the like
          found.push({ file, source, mtime: st.mtimeMs, name: e.name });
        } catch {
          // vanished meanwhile
        }
      }
    }
    found.sort((a, b) => b.mtime - a.mtime);
    return found.slice(0, LIMIT).map(f => {
      const id = crypto.createHash('sha1').update(f.file).digest('hex').slice(0, 16);
      this.byId.set(id, f.file);
      return { id, source: f.source, name: f.name.replace(IMAGE, ''), date: f.mtime };
    });
  }

  /** Response for tpwall://photo/<id> or tpwall://thumb/<id>. */
  async serve(url) {
    const u = new URL(url);
    const id = u.pathname.replace(/^\//, '').replace(/[^\w]/g, '');
    const thumb = u.hostname === 'thumb';
    const cached = path.join(this.cacheDir, `${id}${thumb ? '-t' : ''}.jpg`);
    try {
      return new Response(await fs.readFile(cached), { headers: { 'content-type': 'image/jpeg' } });
    } catch {
      // not made yet
    }
    if (!this.byId.has(id)) await this.list(); // after a restart the chosen photo is not indexed yet
    const file = this.byId.get(id);
    if (!file) return new Response('not found', { status: 404 });
    let img = thumb ? await nativeImage.createThumbnailFromPath(file, { width: 320, height: 200 }).catch(() => null) : null;
    if (!img || img.isEmpty()) img = nativeImage.createFromPath(file);
    if (img.isEmpty()) return new Response('unreadable', { status: 415 });
    const width = thumb ? 320 : 1920;
    if (img.getSize().width > width) img = img.resize({ width, quality: 'best' });
    const jpeg = img.toJPEG(thumb ? 82 : 90);
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(cached, jpeg).catch(() => {});
    return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } });
  }
}
