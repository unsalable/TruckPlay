// Spotify (and whatever else plays on the PC: a browser tab…), read through the host from
// Windows' media sessions, in a player of its own the way Apple Music shows a song: the cover
// large on the left over a backdrop drawn from it, the song, the scrubber and the controls; on the
// right the lyrics, lit word by word as they are sung (Lyrics.tsx; looked up on LRCLIB). Other
// sessions wait as chips under the controls. With nothing playing, Spotify can be started from
// here: the host starts it minimized (desktop or Microsoft Store version), so no window comes in
// front of the game, and it plays on where it left off. The free tier works too.

import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Empty } from '../../components/AppScaffold';
import { Cover } from '../../components/Cover';
import { useArtHue } from '../../components/artTint';
import { Backward, Forward, MusicNote, Pause, Play, Repeat, Shuffle, Speaker } from '../../icons/glyphs';
import { useT } from '../../state/i18n';
import { useStore } from '../../state/store';
import { activeSession, appOf, choosePc, pc, pcCommand, pcSessions, type PcSession } from '../../state/pcMedia';
import { lyricsFor, songKey, type SongLyrics } from '../../state/lyrics';
import { host } from '../../state/bridge';
import { spring } from '../../design/motion';
import { Equalizer, Marquee } from './musicParts';
import { LyricsView, PlainLyrics } from './Lyrics';
import './pcMedia.css';

export function PcMedia() {
  const state = useStore(pc, s => s);
  const list = pcSessions(state);
  const active = activeSession(state);
  if (!active) return <Launch />;
  return <Player s={active} art={state.art[active.id] || null} others={list.filter(s => s.id !== active.id)} />;
}

/** The tab fills the app below its bar. */
function useFill() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const body = ref.current?.closest<HTMLElement>('.app__body');
    if (!body) return;
    const measure = () => {
      const cs = getComputedStyle(body);
      setHeight(body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    return () => ro.disconnect();
  }, []);
  return { ref, height };
}

const mmss = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

function Player({ s, art, others }: { s: PcSession; art: string | null; others: PcSession[] }) {
  const t = useT();
  const { ref, height } = useFill();
  const app = appOf(s);
  const hue = useArtHue(art, 210);
  const playing = s.status === 'playing';
  const song = `${s.title}\u0000${s.artist}`;
  // The song's position, read whenever wanted (the lyrics and the scrubber read it every frame).
  const latest = useRef(s);
  latest.current = s;
  const position = useCallback(() => {
    const x = latest.current;
    return x.status === 'playing' ? x.pos + (Date.now() - x.ts) / 1000 : x.pos;
  }, []);
  const repeatNext = !s.repeat || s.repeat === 'none' ? 2 : s.repeat === 'list' ? 1 : 0;
  return (
    <div ref={ref} className="pcp" style={{ '--hero-hue': hue, height: height || undefined } as CSSProperties}>
      <div className="pcp__backdrop" aria-hidden="true">
        <AnimatePresence initial={false}>
          <motion.div
            key={art ?? song}
            className="pcp__backdrop-art"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: 'easeInOut' }}
          >
            {art ? <img src={art} alt="" /> : <span className="pcp__backdrop-hue" />}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="pcp__side">
        <motion.div className="pcp__art" animate={{ scale: playing ? 1 : 0.86 }} transition={spring.bouncy}>
          <AnimatePresence initial={false}>
            <motion.span
              key={art ?? song}
              className="pcp__cover"
              initial={{ opacity: 0, scale: 1.06 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.35, delay: 0.1 } }}
              transition={spring.smooth}
            >
              <Cover src={art} hue={hue} size="100%" radius="14rem" />
            </motion.span>
          </AnimatePresence>
        </motion.div>

        <div className="pcp__meta">
          <span className="pcp__app">
            {app.icon && <img src={app.icon} alt="" />}
            {app.name}
            {playing && <Equalizer />}
          </span>
          <span className="pcp__song">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={song}
                className="pcp__song-in"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10, transition: { duration: 0.16 } }}
                transition={spring.smooth}
              >
                <Marquee className="pcp__title">{s.title}</Marquee>
                <span className="pcp__artist">{s.artist}</span>
              </motion.span>
            </AnimatePresence>
          </span>
        </div>

        <Scrubber s={s} position={position} />

        <div className="pcp__controls">
          <motion.button
            className={`pcp__btn pcp__btn--small${s.shuffle ? ' is-on' : ''}`}
            data-pointer="highlight"
            disabled={!s.caps.shuffle}
            onClick={() => pcCommand(s.id, 'shuffle', s.shuffle ? 0 : 1)}
            whileTap={{ scale: 0.8 }}
            transition={spring.snappy}
            aria-label={t('np.shuffle')}
          >
            <Shuffle />
          </motion.button>
          <motion.button className="pcp__btn" data-pointer="highlight" disabled={!s.caps.prev} onClick={() => pcCommand(s.id, 'prev')} whileTap={{ scale: 0.8 }} transition={spring.snappy}>
            <Backward />
          </motion.button>
          <motion.button
            className="pcp__btn pcp__btn--main"
            data-pointer="highlight"
            onClick={() => {
              choosePc(s.id);
              pcCommand(s.id, playing ? 'pause' : 'play');
            }}
            whileTap={{ scale: 0.86 }}
            transition={spring.snappy}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={playing ? 'pause' : 'play'}
                className="pcp__glyph"
                initial={{ opacity: 0, scale: 0.4, rotate: -30 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.4, rotate: 30 }}
                transition={spring.snappy}
              >
                {playing ? <Pause /> : <Play />}
              </motion.span>
            </AnimatePresence>
          </motion.button>
          <motion.button className="pcp__btn" data-pointer="highlight" disabled={!s.caps.next} onClick={() => pcCommand(s.id, 'next')} whileTap={{ scale: 0.8 }} transition={spring.snappy}>
            <Forward />
          </motion.button>
          <motion.button
            className={`pcp__btn pcp__btn--small${s.repeat && s.repeat !== 'none' ? ' is-on' : ''}`}
            data-pointer="highlight"
            disabled={!s.caps.repeat}
            onClick={() => pcCommand(s.id, 'repeat', repeatNext)}
            whileTap={{ scale: 0.8 }}
            transition={spring.snappy}
            aria-label={t('np.repeat')}
          >
            <Repeat />
            {s.repeat === 'track' && <span className="pcp__one">1</span>}
          </motion.button>
        </div>

        <AnimatePresence initial={false}>
          {others.length > 0 && (
            <motion.div className="pcp__others" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.smooth}>
              {others.slice(0, 2).map(o => (
                <motion.button key={o.id} className="pcp__chip" data-pointer="highlight" onClick={() => choosePc(o.id)} whileTap={{ scale: 0.94 }} transition={spring.snappy}>
                  <AppMark s={o} />
                  <span className="pcp__chip-title">{o.title}</span>
                  {o.status === 'playing' && <Equalizer className="pcp__chip-eq" />}
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="pcp__lyrics">
        <SongWords s={s} position={position} />
      </div>
    </div>
  );
}

/** The scrubber: where the song is, dragged or tapped to move it. */
function Scrubber({ s, position }: { s: PcSession; position(): number }) {
  const track = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const left = useRef<HTMLSpanElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  dragRef.current = drag;
  // Painted every frame from the song's position (no re-render per frame).
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const pos = Math.min(s.dur || Infinity, dragRef.current ?? position());
      const f = s.dur > 0 ? Math.min(1, Math.max(0, pos / s.dur)) : 0;
      if (fill.current) fill.current.style.transform = `scaleX(${f.toFixed(4)})`;
      if (elapsed.current) elapsed.current.textContent = mmss(pos);
      if (left.current) left.current.textContent = s.dur > 0 ? `−${mmss(Math.max(0, s.dur - pos))}` : '';
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [position, s.dur]);
  const at = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * s.dur;
  };
  const seekable = s.caps.seek && s.dur > 0;
  return (
    <div className={`pcp__scrub${drag !== null ? ' is-drag' : ''}`}>
      <div
        ref={track}
        className="pcp__track"
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
          pcCommand(s.id, 'seek', at(e.clientX));
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <span ref={fill} className="pcp__fill" />
      </div>
      <div className="pcp__times tabular">
        <span ref={elapsed} />
        <span ref={left} />
      </div>
    </div>
  );
}

/** The song's lyrics: synced and lit as sung, or the plain text scrolling, or a quiet note. */
function SongWords({ s, position }: { s: PcSession; position(): number }) {
  const t = useT();
  const key = songKey({ title: s.title, artist: s.artist });
  const [found, setFound] = useState<{ key: string; lyrics: SongLyrics | null } | null>(null);
  useEffect(() => {
    let live = true;
    if (!s.title) return;
    void lyricsFor({ title: s.title, artist: s.artist, album: s.album, duration: s.dur }).then(lyrics => live && setFound({ key, lyrics }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const lyrics = found?.key === key ? found.lyrics : undefined;
  const seek = s.caps.seek ? (sec: number) => pcCommand(s.id, 'seek', sec) : undefined;
  const kind = lyrics === undefined ? 'wait' : lyrics?.synced ? 'synced' : lyrics?.plain ? 'plain' : 'none';
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={`${key}|${kind}`}
        className="pcp__words"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10, transition: { duration: 0.18 } }}
        transition={spring.smooth}
      >
        {kind === 'wait' ? (
          <div className="pcp__note pcp__note--wait">
            <span className="pcp__shimmer" />
            <span className="pcp__shimmer" />
            <span className="pcp__shimmer pcp__shimmer--short" />
          </div>
        ) : kind === 'synced' ? (
          <LyricsView lines={lyrics!.synced!} position={position} playing={s.status === 'playing'} onSeek={seek} />
        ) : kind === 'plain' ? (
          <PlainLyrics text={lyrics!.plain!} position={position} duration={s.dur} />
        ) : (
          <div className="pcp__note">
            <MusicNote />
            <span>{lyrics?.instrumental ? t('music.instrumental') : t('music.noLyrics')}</span>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
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
