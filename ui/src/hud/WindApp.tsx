// The windshield HUD (hud.html?view=wind): light on the road, as a real truck's head-up display
// projects it onto the glass — no panel, only luminous figures with a soft glow. The speed in the
// middle, the limit beside it, the next turn on the left while a drive is planned, with a bar
// filling as it nears. The plugin places it a little below the driver's line of sight and keeps
// it there as the head moves, in the cab view only.

import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { spring } from '../design/motion';
import { Glyph } from './Glyph';
import { NO_WIND, type GlyphSpec, type WindFrame } from './types';
import './wind.css';

interface HostBridge {
  on(channel: string, cb: (msg: unknown) => void): () => void;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}
const host = (window as unknown as { tirplay?: HostBridge }).tirplay;

const glyphKey = (g: GlyphSpec) => `${g.type}:${g.side}:${Math.round(g.angle / 5)}:${g.exit ?? ''}`;

// Coming on and going off like a projector: out of a slight blur, growing into place.
const POWER = { duration: 0.5, ease: [0.2, 0.8, 0.2, 1] } as const;

export function WindApp() {
  const [frame, setFrame] = useState<WindFrame>(NO_WIND);
  const last = useRef<WindFrame>(NO_WIND);
  if (frame.on) last.current = frame;
  const f = frame.on ? frame : last.current;
  const nav = f.nav;

  useEffect(() => {
    if (host) return host.on('hud', msg => setFrame(msg as WindFrame));
    return demo(setFrame);
  }, []);

  return (
    <div className="wind">
      <AnimatePresence onExitComplete={() => void host?.invoke('wind:idle')}>
        {frame.on && (
          <motion.div
            key="wind"
            className="wind__cluster"
            initial={{ opacity: 0, scale: 0.94, filter: 'blur(6px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.97, filter: 'blur(4px)', transition: { duration: 0.3, ease: [0.4, 0, 1, 1] } }}
            transition={POWER}
          >
            <LayoutGroup>
              <AnimatePresence initial={false} mode="popLayout">
                {nav && (
                  <motion.div
                    key="nav"
                    layout
                    className={`wind__nav${nav.now ? ' is-now' : ''}`}
                    initial={{ opacity: 0, x: -14 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10, transition: { duration: 0.2 } }}
                    transition={spring.smooth}
                  >
                    <div className="wind__arrow">
                      <AnimatePresence mode="popLayout" initial={false}>
                        <motion.div
                          key={`${nav.key}|${glyphKey(nav.glyph)}`}
                          className="wind__arrow-in"
                          initial={{ opacity: 0, y: 18, scale: 0.85 }}
                          animate={{ opacity: 1, y: 0, scale: nav.now ? [1, 1.12, 1] : 1 }}
                          exit={{ opacity: 0, y: -20, scale: 0.9 }}
                          transition={spring.snappy}
                        >
                          <Glyph spec={nav.glyph} size="54px" />
                        </motion.div>
                      </AnimatePresence>
                    </div>
                    <div className="wind__guide">
                      <AnimatePresence mode="popLayout" initial={false}>
                        {nav.dist && !nav.now ? (
                          <motion.span key="d" className="wind__dist" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={spring.snappy}>
                            {nav.dist.value}
                            <span className="wind__dist-unit">{nav.dist.unit}</span>
                          </motion.span>
                        ) : (
                          <motion.span key="now" className="wind__dist wind__dist--now" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={spring.bouncy}>
                            {nav.nowLabel}
                          </motion.span>
                        )}
                      </AnimatePresence>
                      <span className="wind__bar">
                        <motion.span className="wind__bar-fill" initial={false} animate={{ scaleX: nav.progress }} transition={spring.smooth} />
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.div layout className={`wind__speed${f.over ? ' is-over' : ''}`} transition={spring.smooth}>
                <span className="wind__num">{f.speed}</span>
                <span className="wind__unit">{f.speedUnit}</span>
                <AnimatePresence initial={false}>
                  {f.cruise > 0 && (
                    <motion.span
                      key="cruise"
                      className="wind__cruise"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={spring.snappy}
                    >
                      <CruiseMark />
                      {f.cruise}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>

              <AnimatePresence initial={false} mode="popLayout">
                {f.limit > 0 && (
                  <motion.div
                    key={f.limit}
                    layout
                    className={`wind__limit${f.over ? ' is-over' : ''}`}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={spring.bouncy}
                  >
                    {f.limit}
                  </motion.div>
                )}
              </AnimatePresence>
            </LayoutGroup>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The cruise control's mark: a speedometer arc with its needle. */
function CruiseMark() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M2.6 11.5a6 6 0 1 1 10.8 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 9.6 11 5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Design bench (vite dev, no host): a drive towards a turn, then cruising without a route. */
function demo(set: (f: WindFrame) => void): () => void {
  const base: WindFrame = { ...NO_WIND, on: true, speed: 82, limit: 90, cruise: 85 };
  const steps: Array<Partial<WindFrame>> = [];
  for (let d = 800; d >= 0; d -= 50) {
    steps.push({
      speed: d < 300 ? 54 : 82,
      limit: d < 300 ? 50 : 90,
      over: d < 300 && d > 150,
      nav: { key: 1, glyph: { type: 'exit', side: 'right', angle: 15 }, dist: { value: String(d), unit: 'm' }, now: d < 40, nowLabel: 'Şimdi', progress: Math.max(0, 1 - d / 600) },
    });
  }
  for (let k = 0; k < 8; k++) steps.push({ speed: 64, limit: 70, cruise: 0, nav: null });
  let i = 0;
  const id = window.setInterval(() => {
    set({ ...base, ...steps[i % steps.length] });
    i++;
  }, 420);
  Object.assign(window, {
    __wind: (f: Partial<WindFrame>) => {
      window.clearInterval(id);
      set({ ...base, ...f });
    },
  });
  return () => window.clearInterval(id);
}
