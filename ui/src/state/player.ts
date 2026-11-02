// One audio element for everything TruckPlay plays itself: internet radio (MP3/AAC or HLS) and
// tracks from the music folders the host lists. Now Playing and the media controls follow it.

import { nowPlaying, ownPlaybackStarted, setMediaControls } from './media';
import { STATIONS, type Station } from '../apps/music/stations';

export interface Track {
  url: string;
  title: string;
  artist: string;
  album: string;
  artwork: string | null;
  duration: number;
  hue: number;
}

const audio = new Audio();
audio.preload = 'none';
let hls: { destroy(): void } | null = null;
let station: Station | null = null;
let queue: Track[] = [];
let index = 0;
let pausedByGame = false;

function detachHls() {
  hls?.destroy();
  hls = null;
}

async function load(url: string, isHls: boolean) {
  detachHls();
  audio.removeAttribute('src');
  if (isHls && !audio.canPlayType('application/vnd.apple.mpegurl')) {
    const { default: Hls } = await import('hls.js');
    if (Hls.isSupported()) {
      const h = new Hls({ lowLatencyMode: false, maxBufferLength: 20 });
      h.loadSource(url);
      h.attachMedia(audio);
      hls = h;
    }
  } else {
    audio.src = url;
  }
  try {
    await audio.play();
  } catch {
    nowPlaying.patch({ playing: false });
  }
}

const now = () => performance.now();

audio.addEventListener('playing', () => nowPlaying.patch({ playing: true, position: audio.currentTime, updatedAt: now() }));
audio.addEventListener('pause', () => nowPlaying.patch({ playing: false, position: audio.currentTime, updatedAt: now() }));
audio.addEventListener('loadedmetadata', () => {
  if (Number.isFinite(audio.duration)) nowPlaying.patch({ duration: audio.duration });
});
audio.addEventListener('seeked', () => nowPlaying.patch({ position: audio.currentTime, updatedAt: now() }));
audio.addEventListener('ended', () => {
  if (queue.length) playIndex(index + 1);
});

// ---------- radio ----------

const radioControls = {
  toggle() {
    if (!audio.paused) {
      audio.pause();
      return;
    }
    // Live streams resume at the live edge rather than from a stale buffer.
    if (station) void load(station.url, !!station.hls);
  },
  next() {
    const i = STATIONS.findIndex(s => s.id === station?.id);
    playStation(STATIONS[(i + 1) % STATIONS.length]);
  },
  previous() {
    const i = STATIONS.findIndex(s => s.id === station?.id);
    playStation(STATIONS[(i - 1 + STATIONS.length) % STATIONS.length]);
  },
  seek() {},
};

export function playStation(st: Station) {
  ownPlaybackStarted();
  station = st;
  queue = [];
  nowPlaying.set({
    source: 'radio',
    title: st.name,
    artist: st.genre,
    album: 'Radyo',
    artwork: null,
    hue: st.hue,
    playing: true,
    position: 0,
    duration: 0,
    updatedAt: now(),
    canSkip: true,
  });
  setMediaControls(radioControls);
  void load(st.url, !!st.hls);
}

export const currentStationId = () => (nowPlaying.get().source === 'radio' ? station?.id : undefined);

// ---------- library ----------

function playIndex(i: number) {
  if (!queue.length) return;
  index = (i + queue.length) % queue.length;
  const tr = queue[index];
  nowPlaying.set({
    source: 'library',
    title: tr.title,
    artist: tr.artist,
    album: tr.album,
    artwork: tr.artwork,
    hue: tr.hue,
    playing: true,
    position: 0,
    duration: tr.duration,
    updatedAt: now(),
    canSkip: queue.length > 1,
  });
  void load(tr.url, false);
}

export function playQueue(tracks: Track[], start: number) {
  ownPlaybackStarted();
  station = null;
  queue = tracks;
  setMediaControls({
    toggle: () => (audio.paused ? void audio.play() : audio.pause()),
    next: () => playIndex(index + 1),
    previous: () => (audio.currentTime > 4 ? (audio.currentTime = 0) : playIndex(index - 1)),
    seek: s => {
      audio.currentTime = s;
    },
  });
  playIndex(start);
}

export function stopPlayer() {
  audio.pause();
  detachHls();
  audio.removeAttribute('src');
}

/** Something else started playing (on the PC): step aside without forgetting the queue. */
export function pauseOwn() {
  if (!audio.paused) audio.pause();
}

export const ownPlaying = () => !audio.paused;

// ---------- the game's pause (see state/gamePause.ts) ----------

/** Pauses TruckPlay's own player for the game's pause; true if it was playing. */
export function pauseForGame(): boolean {
  if (audio.paused) return false;
  pausedByGame = true;
  audio.pause();
  return true;
}

/** Plays on after the game's pause (a live station reconnects: its buffer is stale). */
export function resumeAfterGame() {
  if (!pausedByGame) return;
  pausedByGame = false;
  if (station) void load(station.url, !!station.hls);
  else void audio.play();
}
