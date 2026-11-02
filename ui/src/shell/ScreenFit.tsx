// Fitting the UI onto a cab screen by eye: a bright frame runs along the UI's edges, and each edge
// nudges in or out until it meets the glass. The UI itself moves as the edges do (the host places
// it inside the texture), so what the driver sees in the cab is the result, live.

import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from '../icons/glyphs';
import { useT, type StringKey } from '../state/i18n';
import { useStore } from '../state/store';
import { currentFit, defaultFit, fitting, screenInfo, setFit, type Fit } from '../state/screen';
import { settings } from '../state/ui';
import { spring } from '../design/motion';
import './screenFit.css';

const STEP = 0.004; // of the texture, about 5 px

type Edge = 'top' | 'bottom' | 'left' | 'right';

function nudge(f: Fit, edge: Edge, dir: -1 | 1): Fit {
  const n = { ...f };
  const d = dir * STEP;
  if (edge === 'top') {
    n.y = Math.max(0, Math.min(f.y + f.h - 0.2, f.y + d));
    n.h = f.h - (n.y - f.y);
  } else if (edge === 'bottom') {
    n.h = Math.max(0.2, Math.min(1 - f.y, f.h + d));
  } else if (edge === 'left') {
    n.x = Math.max(0, Math.min(f.x + f.w - 0.3, f.x + d));
    n.w = f.w - (n.x - f.x);
  } else {
    n.w = Math.max(0.3, Math.min(1 - f.x, f.w + d));
  }
  const q = (v: number) => Math.round(v * 10000) / 10000;
  return { x: q(n.x), y: q(n.y), w: q(n.w), h: q(n.h) };
}

export function ScreenFit() {
  const open = useStore(fitting, v => v);
  return <AnimatePresence>{open && <FitTool />}</AnimatePresence>;
}

function FitTool() {
  const t = useT();
  useStore(settings, s => s.screenFits); // re-render as the fit changes
  const id = useStore(screenInfo, s => s.id);
  const fit = currentFit();
  const move = (edge: Edge, dir: -1 | 1) => setFit(nudge(currentFit(), edge, dir));

  const rows: Array<{ edge: Edge; label: StringKey; minus: ReactNode; plus: ReactNode }> = [
    { edge: 'top', label: 'fit.top', minus: <ChevronDown style={{ rotate: '180deg' }} />, plus: <ChevronDown /> },
    { edge: 'bottom', label: 'fit.bottom', minus: <ChevronDown style={{ rotate: '180deg' }} />, plus: <ChevronDown /> },
    { edge: 'left', label: 'fit.left', minus: <ChevronLeft />, plus: <ChevronRight /> },
    { edge: 'right', label: 'fit.right', minus: <ChevronLeft />, plus: <ChevronRight /> },
  ];

  return (
    <motion.div className="fit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <div className="fit__frame" aria-hidden="true">
        {['tl', 'tr', 'bl', 'br'].map(c => (
          <span key={c} className={`fit__corner fit__corner--${c}`} />
        ))}
      </div>
      <motion.div className="fit__panel glass-strong" initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95 }} transition={spring.bouncy}>
        <h2 className="fit__title">{t('fit.title')}</h2>
        <p className="fit__hint">{t(id === 'generic' ? 'fit.hint.generic' : 'fit.hint.measured')}</p>
        <div className="fit__edges">
          {rows.map(r => (
            <div key={r.edge} className="fit__edge">
              <span className="fit__edge-name">{t(r.label)}</span>
              <motion.button className="fit__nudge" data-pointer="highlight" onClick={() => move(r.edge, -1)} whileTap={{ scale: 0.85 }} transition={spring.snappy}>
                {r.minus}
              </motion.button>
              <motion.button className="fit__nudge" data-pointer="highlight" onClick={() => move(r.edge, 1)} whileTap={{ scale: 0.85 }} transition={spring.snappy}>
                {r.plus}
              </motion.button>
            </div>
          ))}
        </div>
        <div className="fit__actions">
          <motion.button
            className="fit__button"
            data-pointer="highlight"
            onClick={() => setFit(null)}
            whileTap={{ scale: 0.94 }}
            transition={spring.snappy}
            disabled={JSON.stringify(fit) === JSON.stringify(defaultFit(id))}
          >
            {t('fit.reset')}
          </motion.button>
          <motion.button className="fit__button fit__button--done" data-pointer="highlight" onClick={() => fitting.set(false)} whileTap={{ scale: 0.94 }} transition={spring.snappy}>
            {t('fit.done')}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
