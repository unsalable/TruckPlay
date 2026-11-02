import { createStore } from './store';

export type MediaSource = 'none' | 'library' | 'radio' | 'pc' | 'youtube' | 'ytmusic' | 'demo';

export interface NowPlaying {
  source: MediaSource;
  title: string;
  artist: string;
  album: string;
  /** Artwork URL, or null to draw a generated cover from `hue`. */
  artwork: string | null;
  hue: number;
  playing: boolean;
  /** Seconds; duration 0 means live (radio). */
  position: number;
  duration: number;
  updatedAt: number;
  canSkip: boolean;
  /** The PC app it plays in (Spotify, Apple Music…), with its own icon. */
  app?: { name: string; icon: string };
  canSeek?: boolean;
  /** Present when the source can shuffle / repeat. */
  shuffle?: boolean;
  repeat?: 'none' | 'track' | 'list';
}

export const nowPlaying = createStore<NowPlaying>({
  source: 'none',
  title: '',
  artist: '',
  album: '',
  artwork: null,
  hue: 220,
  playing: false,
  position: 0,
  duration: 0,
  updatedAt: 0,
  canSkip: false,
});

export interface MediaControls {
  toggle(): void;
  next(): void;
  previous(): void;
  seek(seconds: number): void;
  shuffle?(on: boolean): void;
  repeat?(mode: 'none' | 'track' | 'list'): void;
}

let controls: MediaControls | null = null;
export const setMediaControls = (c: MediaControls | null) => {
  controls = c;
};
export const media = {
  toggle: () => controls?.toggle(),
  next: () => controls?.next(),
  previous: () => controls?.previous(),
  seek: (s: number) => controls?.seek(s),
  shuffle: (on: boolean) => controls?.shuffle?.(on),
  repeat: (mode: 'none' | 'track' | 'list') => controls?.repeat?.(mode),
};

// TruckPlay's own player announces when it starts, so whatever plays on the PC can step aside.
const ownStart = new Set<() => void>();
export const onOwnPlaybackStart = (cb: () => void) => {
  ownStart.add(cb);
  return () => ownStart.delete(cb);
};
export const ownPlaybackStarted = () => ownStart.forEach(cb => cb());

/** Position now, extrapolated while playing. */
export function livePosition(n: NowPlaying, now = performance.now()): number {
  if (!n.playing || !n.duration) return n.position;
  return Math.min(n.duration, n.position + (now - n.updatedAt) / 1000);
}

/** Demo track (made up) so the dashboard has something to show without a player. */
export function startDemoMedia() {
  const track = { title: 'Gece Yolu', artist: 'Mavi Şerit', album: 'Otoban Şarkıları', hue: 212, duration: 214 };
  nowPlaying.set({
    source: 'demo',
    ...track,
    artwork: null,
    playing: true,
    position: 37,
    updatedAt: performance.now(),
    canSkip: true,
  });
  setMediaControls({
    toggle: () => {
      const n = nowPlaying.get();
      nowPlaying.set({ ...n, position: livePosition(n), playing: !n.playing, updatedAt: performance.now() });
    },
    next: () => nowPlaying.set({ ...nowPlaying.get(), position: 0, updatedAt: performance.now() }),
    previous: () => nowPlaying.set({ ...nowPlaying.get(), position: 0, updatedAt: performance.now() }),
    seek: s => nowPlaying.set({ ...nowPlaying.get(), position: s, updatedAt: performance.now() }),
  });
}
