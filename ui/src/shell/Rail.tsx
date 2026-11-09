// The CarPlay status rail: clock and signal on top, Maps (always there: it is a truck), the two
// most recent other apps, and the button that flips between the Dashboard and the app grid (or
// closes the open app).

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { VolumeSlider } from '../components/VolumeSlider';
import { AppIconButton } from './AppIconButton';
import { Dashboard, Grid, Signal, Speaker } from '../icons/glyphs';
import { setVolume } from '../state/volume';
import { Rolling } from '../components/Rolling';
import { Equalizer } from '../apps/music/musicParts';
import { useStore } from '../state/store';
import { closeApp, goToPage, nav, openApp, PAGE_APPS, PAGE_DASHBOARD, settings } from '../state/ui';
import { connection, telemetry } from '../state/telemetry';
import { nowPlaying } from '../state/media';
import { clock } from '../state/format';
import { spring } from '../design/motion';
import './rail.css';

function useClockText(): string {
  const mode = useStore(settings, s => s.clock);
  const gameMinute = useStore(telemetry, t => t.game.time);
  const live = useStore(connection, c => c.state !== 'waiting');
  if (mode === 'game' && live && gameMinute > 0) return clock(gameMinute);
  const d = new Date();
  return clock(d.getHours() * 60 + d.getMinutes());
}

export function Rail({ iconSize }: { iconSize: number }) {
  const time = useClockText();
  const { recents, app, page } = useStore(nav, n => ({ recents: n.recents, app: n.app, page: n.page }));
  const conn = useStore(connection, c => c.state);
  const playing = useStore(nowPlaying, n => n.playing && n.source !== 'none' && Boolean(n.title));
  const playingIcon = useStore(nowPlaying, n => n.app?.icon ?? '');

  // From the dashboard the button offers the app grid; from anywhere else, the dashboard.
  const showGrid = !app && page === PAGE_DASHBOARD;
  const onHome = () => {
    if (app) {
      closeApp();
      return;
    }
    goToPage(showGrid ? PAGE_APPS : PAGE_DASHBOARD);
  };

  return (
    <nav className="rail glass">
      <div className="rail__status">
        <div className="rail__time">
          <Rolling value={time} />
        </div>
        <div className={`rail__signal rail__signal--${conn}`}>
          <Signal size="1em" />
          <span>{conn === 'waiting' ? '–' : '5G'}</span>
        </div>
        {/* CarPlay's now-playing indicator: dancing bars that open Now Playing. */}
        <AnimatePresence>
          {playing && (
            <motion.button
              className="rail__np"
              data-pointer="highlight"
              onClick={e => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                openApp('nowplaying', { x: r.left, y: r.top, w: r.width, h: r.width });
              }}
              initial={{ opacity: 0, scale: 0.4, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.4, y: -8 }}
              whileTap={{ scale: 0.85 }}
              transition={spring.bouncy}
              aria-label="now playing"
            >
              {playingIcon ? <img className="rail__np-icon" src={playingIcon} alt="" /> : null}
              <Equalizer />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className="rail__recents">
        <AppIconButton app="maps" size={iconSize} label={false} place="rail" />
        <AnimatePresence initial={false}>
          {recents
            .filter(id => id !== 'maps')
            .slice(0, 2)
            .map(id => (
            <motion.div
              key={id}
              layout
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={spring.smooth}
            >
              <AppIconButton app={id} size={iconSize} label={false} place="rail" />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <RailVolume />

      <motion.button className="rail__home" data-pointer="highlight" onClick={onHome} whileTap={{ scale: 0.86 }} transition={spring.snappy}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={showGrid ? 'grid' : 'dash'}
            className="rail__home-glyph"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={spring.snappy}
          >
            {showGrid ? <Grid size="1em" /> : <Dashboard size="1em" />}
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </nav>
  );
}

/** The volume: a speaker in the rail; a tap (or the wheel over it) shows Control Center's tall
 *  slider beside the rail, which tucks away a moment after the last touch. */
function RailVolume() {
  const level = useStore(settings, s => s.volume);
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState(false);
  const holding = useRef(false);
  const timer = useRef(0);
  const keep = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => !holding.current && setOpen(false), 2600);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // A press anywhere else puts it away at once, as Control Center's slider does.
  const own = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (e.type === 'pointerdown' && own.current?.contains(e.target as Node)) return;
      if (holding.current) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('tp-page-press', away);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('tp-page-press', away);
    };
  }, [open]);
  return (
    <div className="rail__volume" ref={own}>
      <motion.button
        className="rail__volume-button"
        data-pointer="highlight"
        onClick={() => {
          setOpen(o => !o);
          keep();
        }}
        onWheel={e => {
          setVolume(level + (e.deltaY < 0 ? 0.05 : -0.05));
          setOpen(true);
          keep();
        }}
        whileTap={{ scale: 0.86 }}
        transition={spring.snappy}
        aria-label="volume"
      >
        <Speaker />
        <svg className="rail__volume-ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r="16" pathLength="100" style={{ strokeDashoffset: 100 - level * 100 }} />
        </svg>
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="rail__volume-pop glass-strong"
            initial={{ opacity: 0, x: -12, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1, scaleX: held ? 1.08 : 1 }}
            exit={{ opacity: 0, x: -10, scale: 0.92 }}
            transition={spring.bouncy}
            onPointerMove={keep}
          >
            <VolumeSlider
              vertical
              onUse={keep}
              onHold={h => {
                holding.current = h;
                setHeld(h);
                keep();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
