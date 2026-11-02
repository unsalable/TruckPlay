// What plays elsewhere on the PC — Spotify, Apple Music, a browser tab — read by the host from
// Windows' media sessions. TruckPlay shows it the way CarPlay shows the phone's audio: in Now Playing,
// on the Dashboard and in Music, under the app's own name and icon. One thing plays at a time:
// starting TruckPlay's radio pauses the PC, and music starting on the PC pauses TruckPlay's player.

import { createStore } from './store';
import { host } from './bridge';
import { nowPlaying, onOwnPlaybackStart, setMediaControls, type NowPlaying } from './media';
import { ownPlaying, pauseOwn } from './player';
import { ytMusicControls } from './ytMusic';

export type PcStatus = 'playing' | 'paused' | 'stopped' | 'changing' | 'opened' | 'closed';

export interface PcSession {
  id: string;
  app: string;
  title: string;
  artist: string;
  album: string;
  status: PcStatus;
  pos: number;
  dur: number;
  /** When `pos` was true, ms since the epoch. */
  ts: number;
  shuffle?: boolean;
  repeat?: 'none' | 'track' | 'list';
  caps: { play: boolean; pause: boolean; next: boolean; prev: boolean; seek: boolean; shuffle: boolean; repeat: boolean };
}

export interface PcApp {
  name: string;
  icon: string;
}

interface PcState {
  list: PcSession[];
  current: string;
  art: Record<string, string>;
  apps: Record<string, PcApp>;
  /** The session the driver picked in Music; otherwise whatever plays. */
  chosen: string | null;
}

export const pc = createStore<PcState>({ list: [], current: '', art: {}, apps: {}, chosen: null });

const SELF = /electron|tirplay/i;
const usable = (s: PcSession) => Boolean(s.title) && !SELF.test(s.app) && s.status !== 'closed';

export function pcSessions(state = pc.get()): PcSession[] {
  return state.list.filter(usable);
}

export function appOf(s: PcSession, state = pc.get()): PcApp {
  return state.apps[s.app] ?? { name: s.app.replace(/\.exe$/i, '').replace(/^\w/, c => c.toUpperCase()), icon: '' };
}

/** The session TruckPlay follows: the chosen one, else one that plays, else the system's current. */
export function activeSession(state = pc.get()): PcSession | null {
  const list = pcSessions(state);
  return (
    list.find(s => s.id === state.chosen) ??
    list.find(s => s.id === state.current && s.status === 'playing') ??
    list.find(s => s.status === 'playing') ??
    list.find(s => s.id === state.current) ??
    list[0] ??
    null
  );
}

export function pcCommand(id: string, cmd: 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'seek' | 'shuffle' | 'repeat', v = 0) {
  void host?.invoke('media:cmd', id, cmd, v);
}

const hueOf = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

function livePos(s: PcSession) {
  const at = s.status === 'playing' ? s.pos + Math.max(0, Date.now() - s.ts) / 1000 : s.pos;
  return s.dur ? Math.min(s.dur, Math.max(0, at)) : Math.max(0, at);
}

function show(s: PcSession) {
  const state = pc.get();
  const app = appOf(s, state);
  const next: NowPlaying = {
    source: 'pc',
    title: s.title,
    artist: s.artist,
    album: s.album,
    artwork: state.art[s.id] || null,
    hue: hueOf(s.album || s.artist || s.title),
    playing: s.status === 'playing',
    position: livePos(s),
    duration: s.dur,
    updatedAt: performance.now(),
    canSkip: s.caps.next || s.caps.prev,
    app,
    canSeek: s.caps.seek && s.dur > 0,
    shuffle: s.caps.shuffle ? Boolean(s.shuffle) : undefined,
    repeat: s.caps.repeat ? (s.repeat ?? 'none') : undefined,
  };
  nowPlaying.set(next);
  setMediaControls({
    toggle: () => {
      // Answer at once; the session confirms a moment later.
      const n = nowPlaying.get();
      nowPlaying.set({ ...n, playing: !n.playing, position: n.playing ? n.position + (performance.now() - n.updatedAt) / 1000 : n.position, updatedAt: performance.now() });
      pcCommand(s.id, n.playing ? 'pause' : 'play');
    },
    next: () => pcCommand(s.id, 'next'),
    previous: () => pcCommand(s.id, 'prev'),
    seek: sec => {
      nowPlaying.patch({ position: sec, updatedAt: performance.now() });
      pcCommand(s.id, 'seek', sec);
    },
    shuffle: on => pcCommand(s.id, 'shuffle', on ? 1 : 0),
    repeat: mode => pcCommand(s.id, 'repeat', mode === 'list' ? 2 : mode === 'track' ? 1 : 0),
  });
}

const lastStatus = new Map<string, PcStatus>();
let ownStartedAt = -1e9;

function route() {
  const s = activeSession();
  const np = nowPlaying.get();
  if (!s) {
    if (np.source === 'pc') {
      nowPlaying.set({ ...np, source: 'none', title: '', playing: false, app: undefined });
      setMediaControls(null);
    }
    lastStatus.clear();
    return;
  }
  // Music that just started on the PC takes over, unless TruckPlay itself just started playing
  // (the PC session is then only about to pause).
  const started = s.status === 'playing' && lastStatus.get(s.id) !== 'playing';
  for (const x of pc.get().list) lastStatus.set(x.id, x.status);
  const own = np.source === 'radio' || np.source === 'library' || np.source === 'ytmusic';
  if (started && own && performance.now() - ownStartedAt > 2500) {
    if (ownPlaying()) pauseOwn();
    if (np.source === 'ytmusic') ytMusicControls.pause();
    show(s);
    return;
  }
  if (np.source === 'pc' || np.source === 'none' || np.source === 'demo' || (!own && s.status === 'playing')) show(s);
}

/** The driver picked a PC session (Music › This PC). */
export function choosePc(id: string) {
  pc.patch({ chosen: id });
  const s = activeSession();
  if (!s) return;
  if (ownPlaying()) pauseOwn();
  show(s);
}

function apply(msg: any) {
  if (msg?.t === 'sessions') {
    const list: PcSession[] = Array.isArray(msg.list) ? msg.list : [];
    pc.set(st => ({ ...st, list, current: msg.current ?? '', chosen: list.some(x => x.id === st.chosen) ? st.chosen : null }));
  } else if (msg?.t === 'art') {
    pc.set(st => ({ ...st, art: { ...st.art, [msg.id]: msg.data || '' } }));
  } else if (msg?.t === 'app') {
    pc.set(st => ({ ...st, apps: { ...st.apps, [msg.app]: { name: msg.name || msg.app, icon: msg.icon || '' } } }));
  } else {
    return;
  }
  route();
}

export function startPcMedia() {
  if (!host) return;
  host.on('media', apply);
  void host.invoke('media:state').then((msgs: unknown) => {
    if (Array.isArray(msgs)) msgs.forEach(apply);
  });
  // TruckPlay's radio or library started: whatever plays on the PC pauses.
  onOwnPlaybackStart(() => {
    ownStartedAt = performance.now();
    for (const s of pcSessions()) if (s.status === 'playing') pcCommand(s.id, 'pause');
    pc.patch({ chosen: null });
  });
}
