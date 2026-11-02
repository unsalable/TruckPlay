// Spotify (and whatever else plays on the PC: a browser tab…), read through the host from
// Windows' media sessions — like CarPlay showing the phone's audio. The playing app gets a large
// card with its own icon; other sessions are listed below it. With nothing playing, Spotify can be
// started from here: the host starts it minimized (desktop or Microsoft Store version), so no
// window comes in front of the game, and it plays on where it left off. The free tier works too.

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type CSSProperties } from 'react';
import { Empty } from '../../components/AppScaffold';
import { Cover } from '../../components/Cover';
import { useArtHue } from '../../components/artTint';
import { Backward, Forward, Pause, Play, Speaker } from '../../icons/glyphs';
import { useT } from '../../state/i18n';
import { useStore } from '../../state/store';
import { activeSession, appOf, choosePc, pc, pcCommand, pcSessions, type PcSession } from '../../state/pcMedia';
import { openApp } from '../../state/ui';
import { host } from '../../state/bridge';
import { spring } from '../../design/motion';
import { Equalizer } from './musicParts';
import './pcMedia.css';

export function PcMedia() {
  const t = useT();
  const state = useStore(pc, s => s);
  const list = pcSessions(state);
  const active = activeSession(state);
  if (!active) return <Launch />;
  const others = list.filter(s => s.id !== active.id);
  return (
    <div className="pc">
      <Hero s={active} art={state.art[active.id] || null} />
      {others.length > 0 && (
        <>
          <h2 className="pc__heading">{t('music.pcOther')}</h2>
          <div className="pc__list">
            {others.map((s, i) => (
              <motion.button
                key={s.id}
                className="pc-row"
                data-pointer="highlight"
                onClick={() => choosePc(s.id)}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring.smooth, delay: 0.08 + i * 0.05 }}
                whileTap={{ scale: 0.97 }}
              >
                <Cover src={state.art[s.id] || null} hue={200} size="42rem" radius="8rem" />
                <span className="pc-row__text">
                  <span className="pc-row__title">{s.title}</span>
                  <span className="pc-row__sub">
                    <AppMark s={s} /> {s.artist}
                  </span>
                </span>
                {s.status === 'playing' && <Equalizer className="pc-row__eq" />}
              </motion.button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type LaunchState = 'idle' | 'starting' | 'missing';
// Survives the tab being left and opened again while Spotify starts.
let launching: { state: LaunchState; at: number } = { state: 'idle', at: 0 };

/** Nothing plays on the PC: Spotify starts from here. */
function Launch() {
  const t = useT();
  const [state, setState] = useState<LaunchState>(() =>
    launching.state === 'starting' && Date.now() - launching.at > 15_000 ? 'idle' : launching.state,
  );
  const set = (v: LaunchState) => {
    launching = { state: v, at: Date.now() };
    setState(v);
  };
  // Started but nothing shows up to play (no song in its queue yet): the button comes back.
  useEffect(() => {
    if (state !== 'starting') return;
    const timer = window.setTimeout(() => set('idle'), Math.max(0, 15_000 - (Date.now() - launching.at)));
    return () => window.clearTimeout(timer);
  }, [state]);
  const start = async () => {
    if (!host || state === 'starting') return;
    set('starting');
    const r = (await host.invoke('spotify:open').catch(() => null)) as { ok: boolean } | null;
    if (!r?.ok) set('missing');
  };
  return (
    <motion.div className="pc-empty" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={spring.smooth}>
      <Empty
        glyph={<Speaker />}
        title={state === 'missing' ? t('music.spotifyMissing') : t('music.pcEmpty')}
        hint={state === 'missing' ? t('music.spotifyMissingHint') : t('music.pcHint')}
      />
      <motion.button
        className={`pc-empty__open${state === 'starting' ? ' pc-empty__open--busy' : ''}`}
        data-pointer="highlight"
        onClick={() => void start()}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.smooth, delay: 0.12 }}
        whileTap={{ scale: 0.95 }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={state === 'starting' ? 'busy' : 'idle'}
            className="pc-empty__label"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={spring.snappy}
          >
            {state === 'starting' && <span className="pc-spinner" />}
            {state === 'starting' ? t('music.spotifyStarting') : t('music.openSpotify')}
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </motion.div>
  );
}

/** Where a session is in its song, now: its last report plus the time since, while it plays. */
function usePosition(s: PcSession) {
  const playing = s.status === 'playing';
  const [, tick] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => tick(n => n + 1), 500);
    return () => window.clearInterval(timer);
  }, [playing]);
  const pos = playing ? s.pos + (Date.now() - s.ts) / 1000 : s.pos;
  return s.dur > 0 ? Math.max(0, Math.min(1, pos / s.dur)) : 0;
}

function AppMark({ s }: { s: PcSession }) {
  const app = appOf(s);
  return (
    <span className="app-mark">
      {app.icon && <img src={app.icon} alt="" />}
      {app.name}
    </span>
  );
}

function Hero({ s, art }: { s: PcSession; art: string | null }) {
  const app = appOf(s);
  const hue = useArtHue(art, 210);
  const playing = s.status === 'playing';
  const progress = usePosition(s);
  const song = `${s.title}\u0000${s.artist}`;
  return (
    <motion.div
      className="pc-hero"
      style={{ '--hero-hue': hue } as CSSProperties}
      data-pointer="highlight"
      onClick={e => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        choosePc(s.id);
        openApp('nowplaying', { x: r.left + 20, y: r.top + 20, w: 120, h: 120 });
      }}
      initial={{ opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring.bouncy}
      whileTap={{ scale: 0.985 }}
    >
      <div className="pc-hero__field" />
      <motion.div className="pc-hero__art" animate={{ scale: playing ? 1 : 0.9 }} transition={spring.bouncy}>
        {/* A new song's cover comes in over the old one. */}
        <AnimatePresence initial={false}>
          <motion.span
            key={art ?? song}
            className="pc-hero__cover"
            initial={{ opacity: 0, scale: 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.35, delay: 0.1 } }}
            transition={spring.smooth}
          >
            <Cover src={art} hue={hue} size="100%" radius="12rem" />
          </motion.span>
        </AnimatePresence>
      </motion.div>
      <div className="pc-hero__info">
        <span className="pc-hero__app">
          {app.icon && <img src={app.icon} alt="" />}
          {app.name}
          {playing && <Equalizer />}
        </span>
        <span className="pc-hero__song">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={song}
              className="pc-hero__song-in"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10, transition: { duration: 0.16 } }}
              transition={spring.smooth}
            >
              <span className="pc-hero__title">{s.title}</span>
              <span className="pc-hero__artist">{s.artist}</span>
            </motion.span>
          </AnimatePresence>
        </span>
        {s.dur > 0 && (
          <span className="pc-hero__bar">
            <span className="pc-hero__fill" style={{ transform: `scaleX(${progress})` }} />
          </span>
        )}
        <span className="pc-hero__controls" onClick={e => e.stopPropagation()}>
          <motion.button className="pc-hero__btn" data-pointer="highlight" disabled={!s.caps.prev} onClick={() => pcCommand(s.id, 'prev')} whileTap={{ scale: 0.8 }} transition={spring.snappy}>
            <Backward />
          </motion.button>
          <motion.button
            className="pc-hero__btn pc-hero__btn--main"
            data-pointer="highlight"
            onClick={() => {
              choosePc(s.id);
              pcCommand(s.id, playing ? 'pause' : 'play');
            }}
            whileTap={{ scale: 0.8 }}
            transition={spring.snappy}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={playing ? 'pause' : 'play'}
                className="pc-hero__glyph"
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.4 }}
                transition={spring.snappy}
              >
                {playing ? <Pause /> : <Play />}
              </motion.span>
            </AnimatePresence>
          </motion.button>
          <motion.button className="pc-hero__btn" data-pointer="highlight" disabled={!s.caps.next} onClick={() => pcCommand(s.id, 'next')} whileTap={{ scale: 0.8 }} transition={spring.snappy}>
            <Forward />
          </motion.button>
        </span>
      </div>
    </motion.div>
  );
}
