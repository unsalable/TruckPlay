// Lyrics for what plays: looked up by the host (host/src/lyrics.js, from LRCLIB) and kept per
// song for the session.

import { host } from './bridge';

export interface LyricWord {
  t: number;
  text: string;
}

export interface LyricLine {
  /** Seconds into the song the line starts. */
  t: number;
  text: string;
  /** Word stamps, when the lyrics carry them (enhanced LRC); else the line's time is shared out. */
  words?: LyricWord[];
}

export interface SongLyrics {
  synced: LyricLine[] | null;
  plain: string | null;
  instrumental: boolean;
}

export interface Song {
  title: string;
  artist: string;
  album?: string;
  /** Seconds. */
  duration?: number;
}

const kept = new Map<string, Promise<SongLyrics | null>>();

export const songKey = (s: Song) => `${s.artist}\n${s.title}`.toLowerCase();

export function lyricsFor(song: Song): Promise<SongLyrics | null> {
  const key = songKey(song);
  let p = kept.get(key);
  if (!p) {
    p = (host?.invoke('lyrics:get', song) ?? Promise.resolve(null)).catch(() => null) as Promise<SongLyrics | null>;
    kept.set(key, p);
    // A failed lookup may be tried again later.
    void p.then(r => {
      if (!r) window.setTimeout(() => kept.delete(key), 60_000);
    });
  }
  return p;
}

/**
 * When each word of a line is sung: its own stamps, or the line's time (until the next line, at
 * most about a word a third of a second… a word a second) shared out by the words' lengths.
 */
export function wordTimes(line: LyricLine, next: number | null): Array<{ text: string; from: number; to: number }> {
  const parts = line.text.split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  if (line.words?.length) {
    return line.words.map((w, i) => ({ text: w.text, from: w.t, to: line.words![i + 1]?.t ?? Math.min(next ?? w.t + 1, w.t + 1.2) }));
  }
  const room = Math.max(0.6, (next ?? line.t + parts.length * 0.6) - line.t);
  const span = Math.min(room * 0.92, Math.max(parts.length * 0.32, Math.min(room, parts.length * 1.0)));
  const weights = parts.map(p => p.length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  let at = line.t;
  return parts.map((text, i) => {
    const d = (weights[i] / total) * span;
    const w = { text, from: at, to: at + d };
    at += d;
    return w;
  });
}
