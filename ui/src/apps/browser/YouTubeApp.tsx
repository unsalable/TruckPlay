// YouTube: the mobile site, with a small glass bar for back, search, home and reload. Search is
// TruckPlay's own field with YouTube's suggestions (typing there never depends on the page); the
// site's own search box works too. Videos can go full screen over the whole screen.
//
// The page itself lives outside the app (YouTubeLayer.tsx), so closing YouTube and coming back
// finds the same video where it was. The app is its slot: the page shows over it once the app is at
// rest, and its bar and search sheet sit above the page in the stage's top layer.

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Close, Home, Reload, Search } from '../../icons/glyphs';
import { pushBack } from '../../shell/appLayer';
import { stageOver } from '../../shell/stage';
import { host, sendToPlugin } from '../../state/bridge';
import { language, useT } from '../../state/i18n';
import { useStore } from '../../state/store';
import { closeApp, immersive, split } from '../../state/ui';
import { setSplit } from '../../state/split';
import { spring } from '../../design/motion';
import { exitPageFullscreen } from './WebView';
import { YT_HOME, openYouTube, startYouTube, ytPage, ytResults, ytView } from './youtubePage';
import './browser.css';

export function YouTubeApp() {
  const slotRef = useRef<HTMLDivElement>(null);
  const picture = useStore(ytPage, p => p.picture);
  const live = useStore(ytPage, p => p.live);
  const canBack = useStore(ytPage, p => p.canBack);
  const tucked = useStore(ytPage, p => p.tucked);
  const fullscreen = useStore(immersive, v => v);
  const over = useStore(stageOver, el => el);
  const [searching, setSearching] = useState(false);

  // The page comes to this screen: out of the F3 panel if split screen had it there.
  useLayoutEffect(() => {
    if (split.get().on) setSplit(false);
    startYouTube();
    const el = slotRef.current;
    ytPage.patch({ slot: el });
    return () => {
      if (ytPage.get().slot === el) ytPage.patch({ slot: null });
    };
  }, []);

  useEffect(
    () =>
      pushBack(() => {
        if (searching) setSearching(false);
        else if (fullscreen) exitPageFullscreen(ytView(), () => immersive.set(false));
        else if (canBack) ytView()?.goBack();
        else closeApp();
      }),
    [canBack, fullscreen, searching],
  );
  useEffect(
    () => () => {
      immersive.set(false);
      sendToPlugin({ t: 'typing', on: false });
    },
    [],
  );

  const open = (url: string) => {
    setSearching(false);
    openYouTube(url);
  };

  const chrome = (
    <div className="yt-chrome">
      <AnimatePresence>
        {live && !fullscreen && (
          <motion.div
            key="bar"
            className="yt-bar glass-strong"
            initial={{ opacity: 0, y: -16, scale: 0.9 }}
            animate={tucked ? { opacity: 0, y: '-130%', scale: 0.92 } : { opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
            transition={spring.bouncy}
            style={{ pointerEvents: tucked ? 'none' : undefined }}
          >
            <motion.button className="br-btn" data-pointer="highlight" onClick={() => (canBack ? ytView()?.goBack() : closeApp())} whileTap={{ scale: 0.8, x: -3 }} transition={spring.snappy} aria-label="back">
              <ArrowLeft />
            </motion.button>
            <motion.button className="br-btn" data-pointer="highlight" onClick={() => setSearching(true)} whileTap={{ scale: 0.8 }} transition={spring.snappy} aria-label="search">
              <Search />
            </motion.button>
            <motion.button className="br-btn" data-pointer="highlight" onClick={() => open(YT_HOME)} whileTap={{ scale: 0.8 }} transition={spring.snappy} aria-label="home">
              <Home />
            </motion.button>
            <motion.button className="br-btn" data-pointer="highlight" onClick={() => ytView()?.reload()} whileTap={{ scale: 0.8, rotate: -90 }} transition={spring.snappy} aria-label="reload">
              <Reload />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{searching && <YouTubeSearch onSearch={q => open(ytResults(q))} onCancel={() => setSearching(false)} />}</AnimatePresence>
    </div>
  );

  return (
    <div className="br">
      <div ref={slotRef} className="br__pages yt-slot">
        {picture && <img className="yt-slot__picture" src={picture} alt="" draggable={false} />}
      </div>
      {over ? createPortal(chrome, over) : chrome}
    </div>
  );
}

function YouTubeSearch({ onSearch, onCancel }: { onSearch(q: string): void; onCancel(): void }) {
  const t = useT();
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [pick, setPick] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const q = value.trim();

  useEffect(() => {
    sendToPlugin({ t: 'typing', on: true });
    requestAnimationFrame(() => input.current?.focus());
    return () => sendToPlugin({ t: 'typing', on: false });
  }, []);

  useEffect(() => {
    setPick(-1);
    if (!q || !host) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void host!.invoke('web:suggest', q, language.get(), 'yt').then((s: string[]) => setSuggestions(Array.isArray(s) ? s : []));
    }, 140);
    return () => window.clearTimeout(timer);
  }, [q]);

  const rows = q ? [q, ...suggestions.filter(s => s !== q)] : [];
  const submit = (text: string) => {
    if (text.trim()) onSearch(text.trim());
  };

  return (
    <motion.div className="br-edit br-edit--top" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <motion.div className="br-edit__scrim" onClick={onCancel} />
      <motion.div className="br-edit__sheet glass-strong" initial={{ y: -40, scale: 0.96, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: -30, scale: 0.97, opacity: 0 }} transition={spring.bouncy}>
        <div className="br-edit__field">
          <Search />
          <input
            ref={input}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submit(pick >= 0 && rows[pick] ? rows[pick] : value);
              else if (e.key === 'Escape') onCancel();
              else if (e.key === 'ArrowDown') setPick(p => Math.min(rows.length - 1, p + 1));
              else if (e.key === 'ArrowUp') setPick(p => Math.max(-1, p - 1));
            }}
            placeholder={t('youtube.search')}
            spellCheck={false}
            autoFocus
          />
          {value && (
            <motion.button className="br-edit__clear" data-pointer="highlight" onMouseDown={e => e.preventDefault()} onClick={() => setValue('')} whileTap={{ scale: 0.8 }}>
              <Close />
            </motion.button>
          )}
          <motion.button className="br-edit__cancel" data-pointer="highlight" onClick={onCancel} whileTap={{ scale: 0.9 }}>
            {t('common.cancel')}
          </motion.button>
        </div>
        {rows.length > 0 && (
          <div className="br-suggest">
            {rows.map((r, i) => (
              <motion.button
                key={r}
                className={`br-suggest__row ${i === pick ? 'br-suggest__row--on' : ''}`}
                data-pointer="highlight"
                onMouseDown={e => e.preventDefault()}
                onClick={() => submit(r)}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring.snappy, delay: Math.min(i, 6) * 0.025 }}
              >
                <span className="br-suggest__icon">
                  <Search />
                </span>
                <span className="br-suggest__text">
                  <span>{r}</span>
                </span>
              </motion.button>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
