// The game's own GPS map, live (gameMapFeed.ts), painted in Apple Maps' colours (gameMapGl.ts) and
// filling its parent, with Apple's navigation arrow where the truck is. Zoom glides on a spring;
// the truck sits `lift` of the height below the middle, so more road ahead shows.

import { animate, useMotionValue } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { spring } from '../design/motion';
import { useStore } from '../state/store';
import { resolvedAppearance } from '../state/ui';
import { watchGameMap } from './gameMapFeed';
import { GameMapRenderer, type GameMapFrame } from './gameMapGl';
import './liveGameMap.css';

/** The least zoom that keeps the view inside the game's map, for a view of this shape. */
function leastZoom(aspect: number, lift: number, mapAspect: number) {
  return Math.max(0.5 + lift, (0.5 * aspect) / mapAspect) * 0.97;
}

export function LiveGameMap({ zoom = 1, lift = 0.2, className = '' }: { zoom?: number; lift?: number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [shown, setShown] = useState(false);
  const theme = useStore(resolvedAppearance, a => a);
  const themeNow = useRef(theme);
  themeNow.current = theme;
  const z = useMotionValue(zoom);
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const gl = new GameMapRenderer(el);
    // Without WebGL 2 the map shows as the game paints it.
    const flat = gl.ok ? null : el.getContext('2d', { alpha: false });
    let frame: GameMapFrame | null = null;
    let fresh = false;
    let raf = 0;
    let aspect = 16 / 9;

    const paint = () => {
      raf = 0;
      if (!frame) return;
      const w = Math.max(1, Math.round(el.clientWidth * devicePixelRatio));
      const h = Math.max(1, Math.round(el.clientHeight * devicePixelRatio));
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      aspect = w / h;
      const view = { zoom: Math.max(z.get(), leastZoom(aspect, lift, frame.w / frame.h)), lift, theme: themeNow.current };
      if (gl.ok) {
        if (fresh) gl.setFrame(frame);
        gl.draw(view);
      } else if (flat && fresh) {
        const img = new ImageData(new Uint8ClampedArray(frame.data.buffer as ArrayBuffer, frame.data.byteOffset, frame.data.byteLength), frame.w, frame.h);
        const down = (0.5 / view.zoom) * frame.h;
        const across = down * aspect;
        void createImageBitmap(img).then(bmp => {
          flat.drawImage(bmp, frame!.w / 2 - across / 2, frame!.h / 2 - lift * down - down / 2, across, down, 0, 0, w, h);
          bmp.close();
        });
      }
      fresh = false;
      setShown(true);
    };
    const ask = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    redraw.current = ask;

    const stop = watchGameMap(f => {
      frame = f;
      fresh = true;
      ask();
    });
    const ro = new ResizeObserver(ask);
    ro.observe(el);
    const offZoom = z.on('change', ask);
    return () => {
      stop();
      offZoom();
      ro.disconnect();
      cancelAnimationFrame(raf);
      gl.dispose();
      redraw.current = () => {};
    };
  }, [lift, z]);

  useEffect(() => redraw.current(), [theme]);

  useEffect(() => {
    const a = animate(z, zoom, spring.smooth);
    return () => a.stop();
  }, [zoom, z]);

  return (
    <div className={`live-map${shown ? ' live-map--on' : ''} ${className}`} data-theme={theme} style={{ ['--lift' as string]: lift }}>
      <canvas ref={canvas} className="live-map__canvas" />
      <div className="live-map__puck" aria-hidden="true">
        <svg viewBox="0 0 64 64">
          <defs>
            <linearGradient id="tp-live-puck" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3a9dff" />
              <stop offset="1" stopColor="#0a6cf5" />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="29" fill="#fff" />
          <path
            d="M32 13.5 46.2 47.4c.5 1.2-.8 2.4-2 1.8L32 43.2 19.8 49.2c-1.2.6-2.5-.6-2-1.8L32 13.5z"
            fill="url(#tp-live-puck)"
            stroke="url(#tp-live-puck)"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}
