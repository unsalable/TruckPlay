// Lyrics for what plays, from LRCLIB (lrclib.net: an open, free database of lyrics, most of them
// synced line by line; no account or key). Kept on disk per song — misses too, for a day — so a
// song is looked up once.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://lrclib.net/api';
const AGENT = 'TruckPlay (ETS2 cab screen; https://github.com/)';
const MISS_TTL = 24 * 3600_000;

/** LRC text → lines [{t (seconds), text, words?: [{t, text}]}], in time order. Enhanced LRC's
 *  word stamps (<mm:ss.xx>) are kept when present. */
export function parseLrc(lrc) {
  const lines = [];
  const stamp = /\[(\d+):(\d+(?:[.:]\d+)?)\]/g;
  for (const raw of String(lrc).split(/\r?\n/)) {
    const times = [];
    let m;
    stamp.lastIndex = 0;
    let rest = raw;
    while ((m = /^\s*\[(\d+):(\d+(?:[.:]\d+)?)\]/.exec(rest))) {
      times.push(Number(m[1]) * 60 + Number(m[2].replace(':', '.')));
      rest = rest.slice(m[0].length);
    }
    if (!times.length) continue;
    const words = [];
    const wordStamp = /<(\d+):(\d+(?:\.\d+)?)>([^<]*)/g;
    let w;
    while ((w = wordStamp.exec(rest))) {
      if (w[3].trim()) words.push({ t: Number(w[1]) * 60 + Number(w[2]), text: w[3].trim() });
    }
    const text = rest.replace(/<\d+:\d+(?:\.\d+)?>/g, '').replace(/\s+/g, ' ').trim();
    for (const t of times) lines.push(words.length ? { t, text, words } : { t, text });
  }
  return lines.sort((a, b) => a.t - b.t);
}

export class Lyrics {
  constructor(dir, log) {
    this.dir = dir;
    this.log = log;
    this.pending = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }

  /** {synced: lines | null, plain: string | null, instrumental} for the song, or null. */
  async get({ title, artist, album, duration } = {}) {
    const song = { title: String(title ?? '').trim(), artist: String(artist ?? '').trim(), album: String(album ?? '').trim(), duration: Number(duration) || 0 };
    if (!song.title) return null;
    const key = crypto.createHash('sha1').update(`${song.artist.toLowerCase()}\n${song.title.toLowerCase()}`).digest('hex');
    const file = path.join(this.dir, `${key}.json`);
    try {
      const kept = JSON.parse(await fs.promises.readFile(file, 'utf8'));
      if (kept.lyrics || Date.now() - kept.at < MISS_TTL) return kept.lyrics ?? null;
    } catch {
      // not looked up yet
    }
    let job = this.pending.get(key);
    if (!job) {
      job = this.lookUp(song)
        .then(async lyrics => {
          await fs.promises.writeFile(file, JSON.stringify({ at: Date.now(), lyrics }));
          return lyrics;
        })
        .catch(e => {
          this.log(`lyrics: ${e.message}`);
          return null;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, job);
    }
    return job;
  }

  async lookUp({ title, artist, album, duration }) {
    const headers = { 'User-Agent': AGENT, 'Lrclib-Client': AGENT };
    const ask = async (what, params) => {
      const res = await fetch(`${API}/${what}?${new URLSearchParams(params)}`, { headers, signal: AbortSignal.timeout(8000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`lrclib ${what}: ${res.status}`);
      return res.json();
    };
    // The API's own match (title, artist, album, length) first, then a search: the synced entry
    // closest in length wins.
    const exact = { track_name: title, artist_name: artist };
    if (album) exact.album_name = album;
    if (duration > 0) exact.duration = String(Math.round(duration));
    let hit = null;
    try {
      if (artist) hit = await ask('get', exact);
    } catch {
      // a busy moment on their side: the search may still answer
    }
    if (!hit || (!hit.syncedLyrics && !hit.plainLyrics && !hit.instrumental)) {
      const list = (await ask('search', artist ? { track_name: title, artist_name: artist } : { q: title })) ?? [];
      const fits = (Array.isArray(list) ? list : []).filter(x => !duration || !x.duration || Math.abs(x.duration - duration) < 5);
      const score = x => (x.syncedLyrics ? 0 : 10) + (duration && x.duration ? Math.abs(x.duration - duration) : 2);
      hit = fits.sort((a, b) => score(a) - score(b))[0] ?? hit;
    }
    if (!hit) return null;
    const synced = hit.syncedLyrics ? parseLrc(hit.syncedLyrics) : null;
    return {
      synced: synced && synced.length ? synced : null,
      plain: hit.plainLyrics ? String(hit.plainLyrics) : null,
      instrumental: !!hit.instrumental,
    };
  }
}
