// The HUD: one card over the road. The turn to make, how far to it, then the speed and the limit.
// The main UI decides what it says (state/hud.ts); this window only lays it out and moves it, the
// way Apple Maps' guidance card moves: the distance rolls down, the arrow draws itself, a passed
// turn slides away as the next one takes its place, and the card fills with blue at the turn.

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { spring } from '../design/motion';
import { Glyph } from './Glyph';
import { NO_FRAME, type GlyphSpec, type HudFrame } from './types';
import './hud.css';

interface HostBridge {
  on(channel: string, cb: (msg: unknown) => void): () => void;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}
const host = (window as unknown as { tirplay?: HostBridge }).tirplay;

/** Characters that roll on their own when they change, odometer style: counting down, the new
 *  digit drops in from above. */
function Roll({ text, className }: { text: string; className?: string }) {
  const chars = [...text];
  return (
    <span className={`roll ${className ?? ''}`}>
      {chars.map((c, i) => (
        <span className="roll__slot" key={chars.length - i}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={c}
              className="roll__char"
              initial={{ y: '-100%' }}
              animate={{ y: '0%' }}
              exit={{ y: '100%' }}
              transition={spring.snappy}
            >
              {c}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}

const glyphKey = (g: GlyphSpec) => `${g.type}:${g.side}:${Math.round(g.angle / 5)}:${g.exit ?? ''}`;

export function HudApp() {
  const [frame, setFrame] = useState<HudFrame>(NO_FRAME);
  // What the card showed last, kept while it leaves.
  const last = useRef<HudFrame>(NO_FRAME);
  if (frame.show) last.current = frame;
  const f = frame.show ? frame : last.current;

  useEffect(() => {
    if (host) return host.on('hud', msg => setFrame(msg as HudFrame));
    // Without the host (vite dev): walk through a few situations, for working on the design.
    return demo(setFrame);
  }, []);

  return (
    <div className="hud" data-theme={f.theme}>
      <AnimatePresence onExitComplete={() => void host?.invoke('hud:idle')}>
        {frame.show && (
          <motion.div
            key="hud"
            className="hud__stack"
            initial={{ opacity: 0, y: -26, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
            transition={spring.bouncy}
          >
            <motion.div className={`hud__card${f.now ? ' is-now' : ''}${f.arrived ? ' is-arrived' : ''}`} layout transition={spring.smooth}>
              <div className="hud__glyph">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={`${f.key}|${glyphKey(f.glyph)}`}
                    className="hud__glyph-in"
                    initial={{ opacity: 0, y: 26, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, scale: f.now ? [1, 1.1, 1] : 1 }}
                    exit={{ opacity: 0, y: -30, scale: 0.85 }}
                    transition={spring.snappy}
                  >
                    <Glyph spec={f.glyph} size="64px" />
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="hud__lines">
                <div className="hud__dist">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {f.dist && !f.now ? (
                      <motion.span key="d" className="hud__dist-in" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={spring.snappy}>
                        <Roll text={f.dist.value} />
                        <span className="hud__unit">{f.dist.unit}</span>
                      </motion.span>
                    ) : (
                      <motion.span key="now" className="hud__dist-in hud__now" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={spring.bouncy}>
                        {f.nowLabel}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div key={`${f.key}|${f.text}`} className="hud__text" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={spring.smooth}>
                    {f.text}
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="hud__rule" />

              <div className={`hud__speed${f.over ? ' is-over' : ''}`}>
                <div className="hud__speed-num">
                  <span>{f.speed}</span>
                  <span className="hud__speed-unit">{f.speedUnit}</span>
                </div>
                <AnimatePresence initial={false}>
                  {f.limit > 0 && (
                    <motion.div
                      key={f.limit}
                      className="hud__limit"
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: f.over ? [1, 1.14, 1] : 1 }}
                      exit={{ opacity: 0, scale: 0.6 }}
                      transition={spring.bouncy}
                    >
                      {f.limit}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <motion.div className="hud__progress" initial={false} animate={{ scaleX: f.progress, opacity: f.progress > 0 ? 1 : 0 }} transition={spring.smooth} />
            </motion.div>

            <AnimatePresence>
              {f.then && (
                <motion.div
                  key="then"
                  className="hud__then"
                  initial={{ opacity: 0, y: -18, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -12, scale: 0.92 }}
                  transition={spring.bouncy}
                >
                  <span className="hud__then-label">{f.then.label}</span>
                  <Glyph spec={f.then.glyph} size="26px" animate={false} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Design bench: a drive towards an exit, a roundabout, a turn and arrival, looping. */
function demo(set: (f: HudFrame) => void): () => void {
  const steps: Array<Partial<HudFrame>> = [];
  const base: HudFrame = { ...NO_FRAME, show: true, nowLabel: 'Şimdi', speed: 84, limit: 90, speedUnit: 'km/h' };
  for (let d = 900; d >= 0; d -= 50) {
    steps.push({ key: 1, glyph: { type: 'exit', side: 'right', angle: 15 }, text: 'Sağdan çıkın', dist: d >= 1000 ? { value: '1,0', unit: 'km' } : { value: String(d), unit: 'm' }, now: d < 40, progress: Math.max(0, 1 - d / 600) });
  }
  for (let d = 400; d >= 0; d -= 40) {
    steps.push({ key: 2, glyph: { type: 'roundabout', side: '', angle: -90, exit: 3 }, text: 'Dönel kavşakta 3. çıkış', dist: { value: String(d), unit: 'm' }, now: d < 40, progress: Math.max(0, 1 - d / 250), speed: 46, limit: 50, then: d < 200 ? { glyph: { type: 'turn', side: 'left', angle: -90 }, label: 'Sonra' } : null });
  }
  for (let d = 200; d >= 0; d -= 25) {
    steps.push({ key: 3, glyph: { type: 'turn', side: 'left', angle: -90 }, text: 'Sola dönün', dist: { value: String(d), unit: 'm' }, now: d < 30, progress: Math.max(0, 1 - d / 250), speed: 38, limit: 50 });
  }
  steps.push({ key: 4, glyph: { type: 'arrive', side: '', angle: 0 }, text: 'Varış noktası', dist: null, now: true, nowLabel: 'Vardınız', arrived: true, speed: 0 });
  steps.push({ show: false });
  let i = 0;
  const id = window.setInterval(() => {
    set({ ...base, ...steps[i % steps.length] });
    i++;
  }, 420);
  // Bench handle: stop the loop and show any frame by hand (window.__hud({ ... })).
  Object.assign(window, {
    __hud: (f: Partial<HudFrame>) => {
      window.clearInterval(id);
      set({ ...base, ...f });
    },
    __hudSteps: steps,
  });
  return () => window.clearInterval(id);
}
