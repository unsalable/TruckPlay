import { AnimatePresence, motion } from 'motion/react';
import { AppScaffold } from '../../components/AppScaffold';
import { useStore } from '../../state/store';
import { nowPlaying } from '../../state/media';
import { playStation, currentStationId } from '../../state/player';
import { useT } from '../../state/i18n';
import { spring } from '../../design/motion';
import { Equalizer } from './musicParts';
import { STATIONS, type Station } from './stations';
import './radio.css';

/** A station's tile. `appear`: its delay as the grid comes in (tiles arrive one after another). */
export function StationTile({ st, playing, appear = 0 }: { st: Station; playing: boolean; appear?: number }) {
  return (
    <motion.button
      className={`station${playing ? ' station--on' : ''}`}
      data-pointer="highlight"
      style={{ '--h': st.hue } as React.CSSProperties}
      onClick={() => playStation(st)}
      initial={{ opacity: 0, y: 14, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { ...spring.smooth, delay: appear } }}
      whileTap={{ scale: 0.93 }}
      transition={spring.snappy}
    >
      <span className="station__art">
        <span className="station__glow" />
        <span className="station__name">{st.name}</span>
        <AnimatePresence>
          {playing && (
            <motion.span
              className="station__live"
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.14 } }}
              transition={spring.bouncy}
            >
              <Equalizer />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="station__genre">{st.genre}</span>
    </motion.button>
  );
}

export function StationGrid() {
  const playingId = useStore(nowPlaying, n => (n.source === 'radio' && n.playing ? currentStationId() : undefined));
  return (
    <div className="stations">
      {STATIONS.map((st, i) => (
        <StationTile key={st.id} st={st} playing={playingId === st.id} appear={Math.min(i, 14) * 0.022} />
      ))}
    </div>
  );
}

export function RadioApp() {
  const t = useT();
  return (
    <AppScaffold title={t('app.radio')}>
      <StationGrid />
    </AppScaffold>
  );
}
