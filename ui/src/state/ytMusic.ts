// YouTube Music inside TruckPlay: free, and without ads while ad blocking is on. Its page lives
// for as long as TruckPlay does (apps/music/YtMusic.tsx keeps it outside the Music app), so the
// music plays on after the app closes. What it plays shows in Now Playing and on the dashboard,
// and the same controls drive it. One thing plays at a time: it pauses the radio and the PC's
// music when it starts, and steps aside when they start.

import { createStore } from './store';
import { nowPlaying, onOwnPlaybackStart, setMediaControls } from './media';
import { pauseOwn } from './player';
import { pcCommand, pcSessions } from './pcMedia';
import type { PageMedia, WebviewEl } from '../apps/browser/WebView';

export const YTM_URL = 'https://music.youtube.com';

export const ytMusic = createStore<{ started: boolean; media: PageMedia | null }>({ started: false, media: null });

let view: WebviewEl | null = null;
export const setYtMusicView = (v: WebviewEl | null) => {
  view = v;
};

const run = (code: string) => void view?.executeJavaScript(code).catch(() => {});
const click = (selector: string) => run(`document.querySelector(${JSON.stringify(selector)})?.click()`);

export const ytMusicControls = {
  toggle: () => run(`(() => { const v = document.querySelector('video'); if (!v) return; v.paused ? v.play() : v.pause(); })()`),
  next: () => click('ytmusic-player-bar .next-button'),
  previous: () => click('ytmusic-player-bar .previous-button'),
  seek: (sec: number) => run(`(() => { const v = document.querySelector('video'); if (v) v.currentTime = ${Number(sec) || 0}; })()`),
  pause: () => run(`document.querySelector('video')?.pause()`),
};

/** Opens YouTube Music's page (the first visit to its tab). */
export function startYtMusic() {
  if (!ytMusic.get().started) ytMusic.patch({ started: true });
}

const hueOf = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

let wasPlaying = false;

/** The page reported what it plays. */
export function ytMusicMedia(m: PageMedia) {
  ytMusic.patch({ media: m });
  const startedNow = m.playing && !wasPlaying;
  wasPlaying = m.playing;
  const np = nowPlaying.get();
  if (startedNow) {
    // It takes over: TruckPlay's radio and the PC's music step aside.
    pauseOwn();
    for (const s of pcSessions()) if (s.status === 'playing') pcCommand(s.id, 'pause');
  }
  if (!startedNow && np.source !== 'ytmusic') return;
  if (!m.title) return;
  nowPlaying.set({
    source: 'ytmusic',
    title: m.title,
    artist: m.artist,
    album: m.album,
    artwork: m.art || null,
    hue: hueOf(m.album || m.artist || m.title),
    playing: m.playing,
    position: m.pos,
    duration: m.dur,
    updatedAt: performance.now(),
    canSkip: true,
    canSeek: m.dur > 0,
    app: { name: 'YouTube Music', icon: '' },
  });
  setMediaControls(ytMusicControls);
}

// The radio or a song from the library started: YouTube Music pauses.
onOwnPlaybackStart(() => {
  if (wasPlaying) ytMusicControls.pause();
});
