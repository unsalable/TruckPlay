// YouTube: the mobile site in its own page, with a small glass bar for back, search, home and
// reload. Search is TruckPlay's own field with YouTube's suggestions (typing there never depends on
// the page); the site's own search box works too. Videos can go full screen over the whole screen.

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Close, Home, Reload, Search } from '../../icons/glyphs';
import { pushBack } from '../../shell/appLayer';
import { host, sendToPlugin } from '../../state/bridge';
import { language, useT } from '../../state/i18n';
import { useStore } from '../../state/store';
import { closeApp, immersive } from '../../state/ui';
import { spring } from '../../design/motion';
import { WebView, exitPageFullscreen, type WebviewEl } from './WebView';
import './browser.css';

const HOME = 'https://m.youtube.com';
const results = (q: string) => `${HOME}/results?search_query=${encodeURIComponent(q)}`;

export function YouTubeApp() {
  const view = useRef<WebviewEl | null>(null);
  const [canBack, setCanBack] = useState(false);
  const [searching, setSearching] = useState(false);
  // The bar tucks away while scrolling down the page (it would cover the site's own header) and
  // comes back on the way up, as Safari's does.
  const [tucked, setTucked] = useState(false);
  const fullscreen = useStore(immersive, v => v);

  useEffect(
    () =>
      pushBack(() => {
        if (searching) setSearching(false);
        else if (fullscreen) exitPageFullscreen(view.current, () => immersive.set(false));
        else if (canBack) view.current?.goBack();
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
    void view.current?.loadURL(url).catch(() => {});
  };

  return (
    <div className="br">
      <div className="br__pages">
        <WebView
          url={HOME}
          active
          onState={s => {
            if (s.canBack !== undefined) setCanBack(s.canBack);
            if (s.url !== undefined) setTucked(false);
          }}
          onScroll={(dir, y) => setTucked(dir === 'down' && y > 60)}
          onFullscreen={on => immersive.set(on)}
          register={el => {
            view.current = el;
          }}
        />
      </div>
      {!fullscreen && (
        <motion.div
          className="yt-bar glass-strong"
          initial={{ opacity: 0, y: -16, scale: 0.9 }}
          animate={tucked ? { opacity: 0, y: '-130%', scale: 0.92 } : { opacity: 1, y: 0, scale: 1 }}
          transition={spring.bouncy}
          style={{ pointerEvents: tucked ? 'none' : undefined }}
        >
          <motion.button className="br-btn" data-pointer="highlight" onClick={() => (canBack ? view.current?.goBack() : closeApp())} whileTap={{ scale: 0.8, x: -3 }} transition={spring.snappy} aria-label="back">
            <ArrowLeft />
          </motion.button>
          <motion.button className="br-btn" data-pointer="highlight" onClick={() => setSearching(true)} whileTap={{ scale: 0.8 }} transition={spring.snappy} aria-label="search">
            <Search />
          </motion.button>
          <motion.button className="br-btn" data-pointer="highlight" onClick={() => open(HOME)} whileTap={{ scale: 0.8 }} transition={spring.snappy} aria-label="home">
            <Home />
          </motion.button>
          <motion.button className="br-btn" data-pointer="highlight" onClick={() => view.current?.reload()} whileTap={{ scale: 0.8, rotate: -90 }} transition={spring.snappy} aria-label="reload">
            <Reload />
          </motion.button>
        </motion.div>
      )}
      <AnimatePresence>{searching && <YouTubeSearch onSearch={q => open(results(q))} onCancel={() => setSearching(false)} />}</AnimatePresence>
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
