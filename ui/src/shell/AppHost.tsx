// The app zoom. One spring value p (0 → 1) drives everything: the app layer starts exactly on the
// icon (same centre, same size, cropped square with the icon's corner radius) and grows to fill the
// stage while the icon artwork fades out and the app fades in. Closing runs the same path back to
// wherever the icon is now (grid or rail), so the motion stays continuous and interruptible.
//
// The icon end of the path is measured live, every frame of the zoom: the home screen scales while
// the app is open, the rail slides back after full-screen video, and the whole UI can sit anywhere
// inside the cab screen's texture. Following the icon itself keeps the app landing exactly on it.
//
// The icon hides only while the zoom runs (the app is the icon then); once the app is open its
// rail icon is back, as CarPlay keeps it. Switching straight to another app from the rail grows
// the new one over the old, which stays put underneath until it is covered: no glimpse of home.

import { animate, cancelFrame, frame, motion, useMotionValue, useTransform, type AnimationPlaybackControls } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppIcon } from '../icons/appIcons';
import { appComponent } from '../apps/registry';
import { useStore } from '../state/store';
import { immersive, nav, PAGE_APPS, resolvedAppearance, type AppId, type Rect } from '../state/ui';
import { spring } from '../design/motion';
import { appPhase, appProgress, freezeApp, hiddenIcon, type IconPlace } from './appLayer';
import { useStage } from './stage';
import './appHost.css';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ramp = (from: number, to: number, v: number) => Math.min(1, Math.max(0, (v - from) / (to - from)));

const iconArt = (app: AppId, place: IconPlace | null) =>
  place ? document.querySelector<HTMLElement>(`[data-app-icon="${app}"][data-place="${place}"] .app-icon__art`) : null;

/** The icon copy a closing app goes back into: the grid's if its page is showing, else the rail's. */
function closingIcon(app: AppId): { el: HTMLElement; place: IconPlace } | null {
  const grid = iconArt(app, 'grid');
  const stage = document.querySelector('.stage')?.getBoundingClientRect();
  if (grid && stage && nav.get().page === PAGE_APPS) {
    const r = grid.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    if (r.width > 4 && cx > stage.left && cx < stage.right) return { el: grid, place: 'grid' };
  }
  // The rail always holds the open app among its recents (it may still be sliding back in).
  const rail = iconArt(app, 'rail');
  return rail ? { el: rail, place: 'rail' } : null;
}

export function AppHost() {
  const { width: W, height: H } = useStage();
  const { app, origin, originPlace } = useStore(nav, n => ({ app: n.app, origin: n.origin, originPlace: n.originPlace }));
  const dark = useStore(resolvedAppearance, a => a === 'dark');
  const [shown, setShown] = useState<AppId | null>(null);
  // The app being switched away from: it stays, still and open, under the one growing over it.
  const [under, setUnder] = useState<AppId | null>(null);
  const anim = useRef<AnimationPlaybackControls | null>(null);
  const turn = useRef(0); // the latest open/close; a close still waiting on its freeze checks it

  // The icon end of the zoom, in stage coordinates.
  const rx = useMotionValue(W / 2 - 30);
  const ry = useMotionValue(H / 2 - 30);
  const rw = useMotionValue(60);
  const follow = useRef<{ el: HTMLElement | null; rect: Rect | null }>({ el: null, rect: null });

  // One stable function: it is scheduled on Motion's read phase every frame while a zoom runs.
  const measure = useRef(() => {
    const stageEl = document.querySelector('.stage');
    if (!stageEl) return;
    const stage = stageEl.getBoundingClientRect();
    const { el } = follow.current;
    if (el?.isConnected) {
      const b = el.getBoundingClientRect();
      if (b.width > 2) follow.current.rect = { x: b.left, y: b.top, w: b.width, h: b.height };
    }
    const r = follow.current.rect;
    if (r) {
      rx.set(r.x - stage.left);
      ry.set(r.y - stage.top);
      rw.set(r.w);
    } else {
      // Nothing to go back into (an app opened from a shortcut that is gone): a small square mid-stage.
      const s = stage.height * 0.16;
      rx.set(stage.width / 2 - s / 2);
      ry.set(stage.height / 2 - s / 2);
      rw.set(s);
    }
  }).current;
  const tracking = useRef(false);
  const startTracking = (el: HTMLElement | null, rect: Rect | null) => {
    follow.current = { el, rect };
    measure();
    if (!tracking.current) {
      tracking.current = true;
      frame.read(measure, true);
    }
  };
  const stopTracking = () => {
    tracking.current = false;
    cancelFrame(measure);
  };

  useLayoutEffect(() => {
    anim.current?.stop();
    const my = ++turn.current;
    if (app) {
      const switching = shown && shown !== app && appProgress.get() > 0.5;
      if (shown && shown !== app) {
        // Switching apps from the rail: the old app stays underneath, the new one grows from its
        // icon over it.
        setUnder(switching ? shown : null);
        appProgress.set(0);
      }
      startTracking(iconArt(app, originPlace), origin);
      setShown(app);
      // A home screen icon gives way to the app growing out of it; the rail's stays where it is
      // (the rail stays on screen beside the app, an icon blinking out there would only flicker).
      hiddenIcon.set(originPlace === 'grid' ? { app, place: 'grid' } : null);
      appPhase.set('opening');
      anim.current = animate(appProgress, 1, {
        ...spring.zoom,
        onComplete: () => {
          if (turn.current !== my) return;
          stopTracking();
          setUnder(null);
          hiddenIcon.set(null);
          appPhase.set('open');
        },
      });
    } else if (shown) {
      const closing = shown;
      setUnder(null);
      appPhase.set('closing');
      // Full-screen video ends as the app closes, so the rail is back to receive it.
      immersive.set(false);
      // Web pages swap in a still picture of themselves first: a live page zooms poorly.
      void freezeApp().then(() => {
        if (turn.current !== my) return;
        const target = closingIcon(closing);
        startTracking(target?.el ?? null, null);
        hiddenIcon.set(target?.place === 'grid' ? { app: closing, place: 'grid' } : null);
        anim.current = animate(appProgress, 0, {
          ...spring.zoom,
          onComplete: () => {
            if (turn.current !== my) return;
            stopTracking();
            setShown(null);
            hiddenIcon.set(null);
            appPhase.set('idle');
          },
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app]);

  useEffect(
    () => () => {
      anim.current?.stop();
      cancelFrame(measure);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const base = Math.min(W, H);
  const geometry = (p: number, x: number, y: number, w: number) => {
    const s0 = w / base;
    const s = lerp(s0, 1, p);
    const tx = lerp(x + w / 2 - W / 2, 0, p);
    const ty = lerp(y + w / 2 - H / 2, 0, p);
    const insetX = (W - lerp(base, W, p)) / 2;
    const insetY = (H - lerp(base, H, p)) / 2;
    const radius = lerp((w * 0.225) / s0, 0, Math.min(1, p * 1.15));
    return { s, tx, ty, insetX, insetY, radius };
  };

  const transform = useTransform([appProgress, rx, ry, rw], ([p, x, y, w]: number[]) => {
    const g = geometry(p, x, y, w);
    return `translate3d(${g.tx}px, ${g.ty}px, 0) scale(${g.s})`;
  });
  const clipPath = useTransform([appProgress, rx, ry, rw], ([p, x, y, w]: number[]) => {
    const g = geometry(p, x, y, w);
    return `inset(${g.insetY}px ${g.insetX}px ${g.insetY}px ${g.insetX}px round ${g.radius}px)`;
  });
  const iconOpacity = useTransform(appProgress, p => 1 - ramp(0.06, 0.4, p));
  const contentOpacity = useTransform(appProgress, p => ramp(0.12, 0.46, p));

  if (!shown) return null;

  // Keyed layers, so the app going under keeps its element (and its state) as it changes role.
  const layers = under && under !== shown ? [under, shown] : [shown];
  return (
    <>
      {layers.map(id => {
        const App = appComponent(id);
        const top = id === shown;
        return (
          <motion.div
            key={id}
            className={`app-host${top ? '' : ' app-host--under'}`}
            style={top ? { width: W, height: H, transform, clipPath } : { width: W, height: H }}
          >
            <motion.div className="app-host__content" style={top ? { opacity: contentOpacity } : undefined}>
              {App && <App />}
            </motion.div>
            {top && (
              <motion.div
                className="app-host__icon"
                style={{ width: base, height: base, left: (W - base) / 2, top: (H - base) / 2, opacity: iconOpacity }}
              >
                <AppIcon app={id} dark={dark} />
              </motion.div>
            )}
          </motion.div>
        );
      })}
    </>
  );
}
