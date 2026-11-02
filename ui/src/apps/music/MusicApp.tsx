import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { AppScaffold, Empty, Row, Section, Segmented } from '../../components/AppScaffold';
import { Cover } from '../../components/Cover';
import { MusicNote, Speaker } from '../../icons/glyphs';
import { useT } from '../../state/i18n';
import { host } from '../../state/bridge';
import { playQueue, type Track } from '../../state/player';
import { pc, pcSessions } from '../../state/pcMedia';
import { spring } from '../../design/motion';
import { StationGrid } from './RadioApp';
import { PcMedia } from './PcMedia';
import { YtMusicSlot, leaveYtMusic, ytMusicSettled } from './YtMusic';
import { nowPlaying } from '../../state/media';

type Tab = 'pc' | 'ytmusic' | 'radio' | 'library';
const ORDER: Tab[] = ['pc', 'ytmusic', 'radio', 'library'];

// Music opens where the music is: YouTube Music when it plays, Spotify (or whatever plays on the
// PC) when that does, else the radio.
let lastTab: Tab | null = null;

// Tabs slide the way the segmented control moves (a tab to the right comes in from the right),
// the old one leaving quicker than the new one arrives.
const slide: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: 40 * dir }),
  center: { opacity: 1, x: 0, transition: spring.smooth },
  exit: (dir: number) => ({ opacity: 0, x: -40 * dir, transition: { duration: 0.16, ease: [0.3, 0, 1, 1] } }),
};

export function MusicApp() {
  const t = useT();
  const [tab, setTab] = useState<Tab>(
    () => lastTab ?? (nowPlaying.get().source === 'ytmusic' ? 'ytmusic' : pcSessions(pc.get()).length ? 'pc' : 'radio'),
  );
  // The control answers at once; the content follows once YouTube Music's page has stepped away.
  const [pill, setPill] = useState(tab);
  const [dir, setDir] = useState(1);
  const shown = useRef(tab);
  const wanted = useRef(tab);
  const switched = useRef(false);
  const choose = async (v: Tab) => {
    if (v === wanted.current) return;
    wanted.current = v;
    lastTab = v;
    setPill(v);
    if (shown.current === 'ytmusic') await leaveYtMusic();
    if (wanted.current !== v) return; // tapped on meanwhile
    switched.current = true;
    setDir(ORDER.indexOf(v) > ORDER.indexOf(shown.current) ? 1 : -1);
    shown.current = v;
    setTab(v);
  };
  return (
    <AppScaffold
      title={t('app.music')}
      trailing={
        <Segmented<Tab>
          value={pill}
          onChange={v => void choose(v)}
          options={[
            { value: 'pc', label: 'Spotify' },
            { value: 'ytmusic', label: 'YouTube Music' },
            { value: 'radio', label: t('music.radio') },
            { value: 'library', label: t('music.library') },
          ]}
        />
      }
    >
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.div
          key={tab}
          custom={dir}
          variants={slide}
          initial="enter"
          animate="center"
          exit="exit"
          onAnimationComplete={def => {
            if (def === 'center' && tab === 'ytmusic') ytMusicSettled();
          }}
        >
          {tab === 'pc' && <PcMedia />}
          {tab === 'ytmusic' && <YtMusicSlot entering={switched.current} />}
          {tab === 'radio' && <StationGrid />}
          {tab === 'library' && <Library />}
        </motion.div>
      </AnimatePresence>
    </AppScaffold>
  );
}

function Library() {
  const t = useT();
  const [tracks, setTracks] = useState<Track[] | null>(null);
  useEffect(() => {
    if (!host) {
      setTracks([]);
      return;
    }
    host.invoke('music:list').then((list: Track[]) => setTracks(list ?? []), () => setTracks([]));
  }, []);
  if (tracks === null) return <div className="music-wait" />;
  if (tracks.length === 0) {
    return (
      <motion.div
        style={{ position: 'relative', height: '280rem' }}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={spring.smooth}
      >
        <Empty glyph={<MusicNote />} title={t('music.emptyLibrary')} hint={t('music.emptyLibraryHint')} />
      </motion.div>
    );
  }
  return (
    <Section>
      {tracks.map((tr, i) => (
        <Row
          key={tr.url}
          icon={<Cover src={tr.artwork} hue={tr.hue} size="30rem" radius="6rem" />}
          tint="transparent"
          title={tr.title}
          subtitle={tr.artist}
          onClick={() => playQueue(tracks, i)}
          appear={Math.min(i, 12) * 0.025}
        >
          {null}
        </Row>
      ))}
      <Row icon={<Speaker />} tint="var(--pink)" title={`${tracks.length} ${t('music.songs')}`} appear={Math.min(tracks.length, 12) * 0.025} />
    </Section>
  );
}
