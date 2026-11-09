// The game's own GPS map, live: the plugin copies it out of the game as the game draws it (the
// map its GPS screens show, with its route, its marks and the truck), the host hands the frames
// on. This is the map TruckPlay shows, painted in Apple Maps' colours (gameMapGl.ts): exactly the
// game's route and marks, at the game's pace. TruckPlay's own map (GameMap.tsx) is only for when
// there is no game (the window without it, development).
//
// The plugin sends the whole map texture, up to 30 times a second while anyone watches; each
// viewer crops and zooms it itself.

import { createStore } from '../state/store';
import { host } from '../state/bridge';
import type { GameMapFrame } from './gameMapGl';

/** The game's map is coming (the plugin has seen the game draw it lately). */
export const gameMapReady = createStore(false);

type Listener = (frame: GameMapFrame) => void;
const listeners = new Set<Listener>();
let latest: GameMapFrame | null = null;
let sent = '';

function sendWant() {
  const want = { on: listeners.size > 0 };
  const json = JSON.stringify(want);
  if (json === sent) return;
  sent = json;
  void host?.invoke('mapfeed:want', want).catch(() => {});
}

/** Watches the game's map: each new frame (and the latest one right away) while it lasts. Returns
 *  the function that stops watching. */
export function watchGameMap(cb: Listener): () => void {
  listeners.add(cb);
  sendWant();
  if (latest) cb(latest);
  return () => {
    listeners.delete(cb);
    sendWant();
  };
}

let started = false;
export function startGameMapFeed() {
  if (started || !host) return;
  started = true;
  host.on('mapfeed:status', (m: { ready?: boolean }) => gameMapReady.set(!!m?.ready));
  host.on('mapfeed', (m: { w: number; h: number; data: Uint8Array }) => {
    if (!m?.data || m.data.length !== m.w * m.h * 4) return;
    latest = { w: m.w, h: m.h, data: m.data };
    for (const cb of listeners) cb(latest);
  });
}
