import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { AppIconButton } from '../shell/AppIconButton';
import { useStage } from '../shell/stage';
import { useStore } from '../state/store';
import { nav, PAGE_APPS, type AppId } from '../state/ui';
import { spring } from '../design/motion';
import './appGrid.css';

export const GRID: AppId[] = ['maps', 'music', 'youtube', 'browser', 'nowplaying', 'radio', 'truck', 'job', 'messages', 'settings'];

export function AppGrid() {
  const { width, height } = useStage();
  const cols = 5;
  // Icons fill the row comfortably but never crowd the labels; CarPlay's large-icon proportions.
  const size = Math.round(Math.min(height * 0.205, (width / cols) * 0.6));
  // Arriving on the grid from another page, the icons ripple in from the middle outward (iOS's
  // home-screen entrance). Not when an app closes: it zooms back into an icon that must hold still.
  const page = useStore(nav, n => n.page);
  const prev = useRef(page);
  const [wave, setWave] = useState(0);
  useEffect(() => {
    if (page === PAGE_APPS && prev.current !== PAGE_APPS) setWave(w => w + 1);
    prev.current = page;
  }, [page]);
  return (
    <div className="app-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {GRID.map((id, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const ring = Math.abs(col - (cols - 1) / 2) + row * 0.8;
        return (
          <motion.div
            className="app-grid__cell"
            key={`${id}:${wave}`}
            initial={wave > 0 ? { opacity: 0, scale: 0.55, y: 18 } : false}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ ...spring.bouncy, delay: 0.03 + ring * 0.045 }}
          >
            <AppIconButton app={id} size={size} place="grid" />
          </motion.div>
        );
      })}
    </div>
  );
}
