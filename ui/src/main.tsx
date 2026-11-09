import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/opsz.css';
import './design/tokens.css';
import './design/base.css';
import './design/glass.css';
import { Shell } from './shell/Shell';
import { startBridge, host } from './state/bridge';
import { startDemoMedia } from './state/media';
import { pc, startPcMedia } from './state/pcMedia';
import { screenInfo, startScreenFit } from './state/screen';
import { nowPlaying } from './state/media';
import { startVolume } from './state/volume';
import { startGamePause } from './state/gamePause';
import { gameMapReady, startGameMapFeed } from './maps/gameMapFeed';
import { startTargets } from './maps/targets';
import { closeApp, goToPage, nav, openApp, settings, type AppId } from './state/ui';
import { demoEvent, startDemo, stopDemo } from './state/demo';

// 1rem = 1pt = screen height / 480 (CarPlay's reference height). The host sizes the window to the
// truck screen's texture; in a browser, ?w=&h= previews a specific screen size.
const params = new URLSearchParams(location.search);
const frameW = Number(params.get('w')) || 0;
const frameH = Number(params.get('h')) || 0;

// The UI fills the cab screen's texture: the mod gives every known screen a texture that is
// exactly its glass. On a truck we have no measurements for, the host names the part of the
// texture the glass most likely shows; everything else stays black.
let frame: { x: number; y: number; w: number; h: number } | null = frameW && frameH ? { x: 0, y: 0, w: frameW, h: frameH } : null;
const root = document.getElementById('root')!;

function applyScale() {
  const h = frame?.h || window.innerHeight;
  document.documentElement.style.fontSize = `${h / 480}px`;
  if (frame) {
    Object.assign(root.style, {
      position: 'absolute',
      zIndex: '1',
      left: `${frame.x || (window.innerWidth - frame.w) / 2}px`,
      top: `${frame.y}px`,
      width: `${frame.w}px`,
      height: `${frame.h}px`,
    });
  } else {
    Object.assign(root.style, { position: '', left: '', top: '', width: '', height: '' });
  }
  window.dispatchEvent(new Event('tp-frame'));
}
applyScale();
window.addEventListener('resize', applyScale);
host?.on('screen', (m: { w: number; h: number; screen?: string | null; frame?: { x: number; y: number; w: number; h: number } | null }) => {
  frame = m.frame ?? null;
  screenInfo.set({ w: m.w, h: m.h, id: m.screen ?? null, frame });
  applyScale();
});
startScreenFit();
startVolume();
startGamePause();
// The drive and its turns run whether or not a map is on screen: the HUD follows them.
startTargets();

startBridge();
startGameMapFeed();
if (!host) startDemoMedia();
startPcMedia();

// Handle for development snapshots and the host's own tooling.
Object.assign(window, {
  __tp: {
    goToPage,
    openApp,
    closeApp,
    demoEvent,
    startDemo,
    stopDemo,
    settings,
    nav,
    nowPlaying,
    pc,
    gameMapReady,
    /** Open an app the way a tap on its visible icon would. */
    tap(id: AppId) {
      const el = [...document.querySelectorAll<HTMLElement>(`[data-app-icon="${id}"]`)].find(e => {
        const r = e.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.width > 0;
      });
      el?.click();
    },
  },
});

createRoot(root).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
