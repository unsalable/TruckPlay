// Media stops while the game is stopped, and plays on when it is back, the way a car stereo
// mutes for a phone call. "Stopped" is the game's own pause (single player) or its Esc menu: in a
// convoy the game never pauses, so the plugin reports Esc itself, and driving again (throttle,
// brake, steering) is taken as the menu having closed even if Esc was not pressed for it.
//
// What gets paused, and resumed only if it was playing: TruckPlay's own player (radio, music),
// every web page that plays (YouTube, the browser, YouTube Music), and the PC's music app.

import { createStore } from './store';
import { host, sendToPlugin } from './bridge';
import { connection, telemetry } from './telemetry';
import { settings } from './ui';
import { activeSession, pcCommand } from './pcMedia';
import { pauseForGame, resumeAfterGame } from './player';
import { livePages } from '../apps/browser/WebView';

/** The game's Esc menu, as the plugin saw it. */
export const gameMenu = createStore(false);
/** The game is paused or in its menu. */
export const gamePaused = createStore(false);

const PAUSE_PAGES = `(() => {
  let n = 0;
  for (const m of document.querySelectorAll('video, audio')) {
    if (!m.paused && !m.ended) { m.dataset.tpPaused = '1'; m.pause(); n++; }
  }
  return n;
})()`;
const RESUME_PAGES = `(() => {
  for (const m of document.querySelectorAll('[data-tp-paused]')) { delete m.dataset.tpPaused; m.play().catch(() => {}); }
})()`;

let pausedPc: string | null = null;
let pausedPages = false;

function pauseAll() {
  pauseForGame();
  const pcs = activeSession();
  if (pcs?.status === 'playing') {
    pcCommand(pcs.id, 'pause');
    pausedPc = pcs.id;
  }
  for (const v of livePages) void v.executeJavaScript(PAUSE_PAGES).catch(() => {});
  pausedPages = true;
}

function resumeAll() {
  resumeAfterGame();
  if (pausedPc) pcCommand(pausedPc, 'play');
  pausedPc = null;
  if (pausedPages) for (const v of livePages) void v.executeJavaScript(RESUME_PAGES).catch(() => {});
  pausedPages = false;
}

export function startGamePause() {
  if (!host) return;
  // In single player Esc really pauses the game, and the SDK says so: from the first time it
  // does (right after an Esc), the SDK's word is trusted and Esc alone means nothing (Esc also
  // closes the world map and other screens, which pause nothing).
  let escAt = -1e9;
  let sdkPauses = false;
  host.on('menu', (m: { open?: boolean }) => {
    escAt = performance.now();
    if (!sdkPauses) gameMenu.set(Boolean(m.open));
  });
  let wasPaused = telemetry.get().paused;
  telemetry.subscribe(() => {
    const p = telemetry.get().paused;
    if (p && !wasPaused && performance.now() - escAt < 1500 && !sdkPauses) {
      sdkPauses = true;
      if (gameMenu.get()) {
        gameMenu.set(false);
        sendToPlugin({ t: 'menu', open: false });
      }
    }
    wasPaused = p;
  });

  // Driving means the menu is gone (it was closed with the mouse, or Esc was pressed elsewhere).
  let since: { throttle: number; brake: number; steer: number } | null = null;
  gameMenu.subscribe(() => {
    const t = telemetry.get().truck;
    since = gameMenu.get() ? { throttle: t.throttle, brake: t.brake, steer: t.steer } : null;
  });

  const update = () => {
    const t = telemetry.get();
    if (since && gameMenu.get()) {
      const tr = t.truck;
      if (Math.abs(tr.throttle - since.throttle) > 0.15 || Math.abs(tr.brake - since.brake) > 0.15 || Math.abs(tr.steer - since.steer) > 0.08) {
        gameMenu.set(false);
        sendToPlugin({ t: 'menu', open: false });
      }
    }
    // The menu signal only ever comes from the game's plugin; the SDK's pause only counts live.
    const paused = (connection.get().state === 'live' && t.paused) || gameMenu.get();
    if (paused !== gamePaused.get()) gamePaused.set(paused);
  };
  telemetry.subscribe(update);
  gameMenu.subscribe(update);

  gamePaused.subscribe(() => {
    if (gamePaused.get()) {
      if (settings.get().pauseWithGame) pauseAll();
    } else resumeAll();
  });
}
