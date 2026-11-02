// Now Playing, Apple Music's way: the cover is the hero and breathes with playback — full size
// while playing, settling smaller when paused — over a slow field tinted by the cover itself.
// Track changes slide the cover across and lift the new titles in; the scrubber swells under the
// pointer and can be dragged. Spotify, Apple Music and friends show their own app badge.

import { VolumeSlider } from '../../components/VolumeSlider';
import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AppScaffold, Empty } from '../../components/AppScaffold';
import { Cover } from '../../components/Cover';
import { useNow } from '../../components/useNow';
import { useArtHue } from '../../components/artTint';
import { Antenna, Backward, Forward, MusicNote, Pause, Play, Repeat, Shuffle } from '../../icons/glyphs';
import { useStore } from '../../state/store';
import { livePosition, media, nowPlaying, type NowPlaying } from '../../state/media';
import { useT, type StringKey } from '../../state/i18n';
import { spring } from '../../design/motion';
import { Equalizer, Marquee } from './musicParts';
import './nowPlaying.css';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const SOURCE_LABEL: Partial<Record<NowPlaying['source'], StringKey>> = {
  radio: 'music.radio',
  library: 'music.library',
  youtube: 'app.youtube',
};

export function NowPlayingApp() {
  const t = useT();
  const np = useStore(nowPlaying, n => n);
  useNow(np.playing ? 250 : 0);
  const has = np.source !== 'none' && !!np.title;
  const hue = useArtHue(np.artwork, np.hue);
  const trackKey = `${np.title}\u0001${np.artist}`;
  const sourceLabel = np.app?.name ?? (SOURCE_LABEL[np.source] ? t(SOURCE_LABEL[np.source]!) : '');

  return (
    <AppScaffold title={t('app.nowplaying')} scroll={false} className="np-app">
      <div className="np__field" style={{ '--np-hue': hue } as CSSProperties} />
      {!has ? (
        <Empty glyph={<MusicNote />} title={t('music.notPlaying')} hint={t('dash.noMusicHint')} />
      ) : (
        <div className="np" style={{ '--np-hue': hue } as CSSProperties}>
          <div className="np__stage">
            <motion.div className="np__glow" animate={{ opacity: np.playing ? 0.75 : 0.25, scale: np.playing ? 1 : 0.86 }} transition={spring.smooth} style={{ '--np-hue': hue } as CSSProperties} />
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={trackKey}
                className="np__cover"
                initial={{ opacity: 0, x: 60, scale: 0.9, rotate: 3 }}
                animate={{ opacity: 1, x: 0, scale: np.playing ? 1 : 0.84, rotate: 0 }}
                exit={{ opacity: 0, x: -60, scale: 0.86, rotate: -3 }}
                transition={spring.bouncy}
              >
                <Cover src={np.artwork} hue={np.hue} size="100%" radius="14rem" />
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="np__info">
            {sourceLabel && (
              <motion.div className="np__source" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth}>
                {np.app?.icon ? <img className="np__app-icon" src={np.app.icon} alt="" /> : null}
                <span>{sourceLabel}</span>
                {np.playing && <Equalizer />}
              </motion.div>
            )}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={trackKey}
                className="np__titles"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={spring.smooth}
              >
                <Marquee className="np__title">{np.title}</Marquee>
                <span className="np__artist">{np.artist}</span>
                {np.album && <span className="np__album">{np.album}</span>}
              </motion.div>
            </AnimatePresence>
            {np.duration === 0 ? (
              <span className="np__live">
                <Antenna /> {t('music.live')}
              </span>
            ) : (
              <Scrubber np={np} />
            )}
            <div className="np__controls">
              {np.shuffle !== undefined && (
                <Toggle on={np.shuffle} onClick={() => media.shuffle(!np.shuffle)} label="shuffle">
                  <Shuffle />
                </Toggle>
              )}
              <motion.button className="np__btn" data-pointer="highlight" onClick={media.previous} whileTap={{ scale: 0.8, x: -4 }} transition={spring.snappy} aria-label="previous">
                <Backward />
              </motion.button>
              <motion.button className="np__btn np__btn--main" data-pointer="highlight" onClick={media.toggle} whileTap={{ scale: 0.82 }} transition={spring.snappy} aria-label="play">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={np.playing ? 'pause' : 'play'}
                    className="np__glyph"
                    initial={{ opacity: 0, scale: 0.4 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.4 }}
                    transition={spring.snappy}
                  >
                    {np.playing ? <Pause /> : <Play />}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
              <motion.button className="np__btn" data-pointer="highlight" onClick={media.next} whileTap={{ scale: 0.8, x: 4 }} transition={spring.snappy} aria-label="next">
                <Forward />
              </motion.button>
              {np.repeat !== undefined && (
                <Toggle
                  on={np.repeat !== 'none'}
                  onClick={() => media.repeat(np.repeat === 'none' ? 'list' : np.repeat === 'list' ? 'track' : 'none')}
                  label="repeat"
                >
                  <Repeat />
                  {np.repeat === 'track' && <span className="np__one">1</span>}
                </Toggle>
              )}
            </div>
            <div className="np__volume">
              <VolumeSlider />
            </div>
          </div>
        </div>
      )}
    </AppScaffold>
  );
}

function Toggle({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <motion.button
      className={`np__toggle ${on ? 'np__toggle--on' : ''}`}
      data-pointer="highlight"
      onClick={onClick}
      whileTap={{ scale: 0.84 }}
      animate={{ scale: on ? 1 : 0.94 }}
      transition={spring.bouncy}
      aria-label={label}
      aria-pressed={on}
    >
      {children}
    </motion.button>
  );
}

// iOS 26 scrubber: thin at rest, thicker under the pointer, draggable; while dragging, the times
// follow the thumb and the bar commits the seek on release.
function Scrubber({ np }: { np: NowPlaying }) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const pos = drag ?? livePosition(np);
  const fraction = np.duration ? Math.min(1, pos / np.duration) : 0;
  const seekable = np.canSeek !== false;
  const at = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * np.duration;
  };
  return (
    <div className={`np__progress ${drag !== null ? 'np__progress--drag' : ''}`}>
      <div
        ref={track}
        className="np__track"
        data-pointer={seekable ? 'highlight' : undefined}
        onPointerDown={e => {
          if (!seekable) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(at(e.clientX));
        }}
        onPointerMove={e => {
          if (drag !== null) setDrag(at(e.clientX));
        }}
        onPointerUp={e => {
          if (drag === null) return;
          media.seek(at(e.clientX));
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <span className="np__fill" style={{ transform: `scaleX(${fraction})` }} />
      </div>
      <div className="np__times tabular">
        <span>{mmss(pos)}</span>
        <span>−{mmss(Math.max(0, np.duration - pos))}</span>
      </div>
    </div>
  );
}
