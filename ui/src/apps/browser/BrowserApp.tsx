// Tarayıcı — Safari, sized for the cab. iOS 26's compact bar floats over the page as a capsule of
// glass (it tucks into a small pill while you read and comes back when you scroll up), tabs live
// in an overview of live snapshots, the start page offers favourites and frequent sites, and the
// address field suggests as you type. Text fields on pages take the keyboard through the plugin.

import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, ChevronLeft, Close, Globe, Lock, Plus, Reload, Search, Tabs } from '../../icons/glyphs';
import { goBack, pushBack } from '../../shell/appLayer';
import { host, sendToPlugin } from '../../state/bridge';
import { useT, language } from '../../state/i18n';
import { useStore } from '../../state/store';
import { closeApp, immersive } from '../../state/ui';
import { spring } from '../../design/motion';
import {
  FAVORITES,
  MAX_TABS,
  addTab,
  browser,
  closeTab,
  faviconFor,
  frequent,
  hostOf,
  patchTab,
  remember,
  resolveInput,
  type Tab,
  type Visit,
} from './browserState';
import { WebView, exitPageFullscreen, type PageState, type WebviewEl } from './WebView';
import './browser.css';

const EMPTY: PageState = { url: '', title: '', favicon: '', loading: false, canBack: false, canForward: false, theme: '', error: '' };

export function BrowserApp() {
  const { tabs, active } = useStore(browser, s => ({ tabs: s.tabs, active: s.active }));
  const views = useRef(new Map<string, WebviewEl>());
  const [pages, setPages] = useState<Record<string, PageState>>({});
  const [editing, setEditing] = useState(false);
  const [overview, setOverview] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const fullscreen = useStore(immersive, v => v);
  const tab = tabs.find(x => x.id === active) ?? tabs[0];
  const page = { ...EMPTY, ...pages[tab.id] };

  const update = (id: string, patch: Partial<PageState>) => {
    setPages(p => ({ ...p, [id]: { ...EMPTY, ...p[id], ...patch } }));
    const tp: Partial<Tab> = {};
    if (patch.url) tp.url = patch.url;
    if (patch.title !== undefined) tp.title = patch.title;
    if (patch.favicon) tp.favicon = patch.favicon;
    if (Object.keys(tp).length) patchTab(id, tp);
    if (patch.loading === false) {
      const v = views.current.get(id);
      try {
        if (v) remember(v.getURL(), v.getTitle());
      } catch {
        // page gone
      }
    }
  };

  const go = (input: string) => {
    const url = resolveInput(input);
    if (!url) return;
    setEditing(false);
    setCollapsed(false);
    const v = views.current.get(tab.id);
    if (tab.url && v) void v.loadURL(url).catch(() => {});
    else patchTab(tab.id, { url });
    update(tab.id, { url, loading: true, error: '' });
  };

  const openOverview = async () => {
    const v = views.current.get(tab.id);
    if (v && tab.url) {
      try {
        const img = await v.capturePage();
        patchTab(tab.id, { thumb: img.resize({ width: 520 }).toDataURL() });
      } catch {
        // keep the last snapshot
      }
    }
    setEditing(false);
    setOverview(true);
  };

  // Back: closes what is on top (overview, address), then walks the page's history.
  useEffect(
    () =>
      pushBack(() => {
        if (overview) setOverview(false);
        else if (editing) setEditing(false);
        else if (fullscreen) exitPageFullscreen(views.current.get(tab.id), () => immersive.set(false));
        else if (page.canBack) views.current.get(tab.id)?.goBack();
        else closeApp();
      }),
    [overview, editing, fullscreen, page.canBack, tab.id],
  );

  // Leaving the app: no full screen, no captured keyboard.
  useEffect(
    () => () => {
      immersive.set(false);
      sendToPlugin({ t: 'typing', on: false });
    },
    [],
  );

  return (
    <div className={`br ${fullscreen ? 'br--full' : ''}`} style={{ '--page-tint': page.theme || 'transparent' } as CSSProperties}>
      <motion.div
        className="br__pages"
        animate={overview ? { scale: 0.5, opacity: 0, borderRadius: 26 } : { scale: 1, opacity: 1, borderRadius: 0 }}
        transition={spring.zoom}
      >
        {tabs.map(x =>
          x.url ? (
            <WebView
              key={x.id}
              url={x.url}
              active={x.id === tab.id && !overview}
              onState={s => update(x.id, s)}
              onScroll={(dir, y) => x.id === tab.id && setCollapsed(dir === 'down' && y > 60)}
              onFullscreen={on => immersive.set(on)}
              register={el => {
                if (el) views.current.set(x.id, el);
                else views.current.delete(x.id);
              }}
            />
          ) : null,
        )}
        {!tab.url && <StartPage onOpen={go} />}
        {page.error && tab.url && !page.loading && <ErrorPage message={page.error} onRetry={() => views.current.get(tab.id)?.reload()} />}
      </motion.div>

      {!fullscreen && (
        <Toolbar
          page={page}
          hasUrl={Boolean(tab.url)}
          tabCount={tabs.length}
          collapsed={collapsed && !editing && !overview}
          hidden={overview}
          onExpand={() => setCollapsed(false)}
          onBack={() => (page.canBack ? views.current.get(tab.id)?.goBack() : goBack())}
          onForward={() => views.current.get(tab.id)?.goForward()}
          onReload={() => {
            const v = views.current.get(tab.id);
            if (page.loading) v?.stop();
            else v?.reload();
          }}
          onEdit={() => setEditing(true)}
          onTabs={openOverview}
        />
      )}

      <AnimatePresence>{editing && <AddressEditor initial={page.url} onGo={go} onCancel={() => setEditing(false)} />}</AnimatePresence>

      <AnimatePresence>
        {overview && (
          <TabOverview
            tabs={tabs}
            active={tab.id}
            onPick={id => {
              browser.patch({ active: id });
              setOverview(false);
            }}
            onClose={id => closeTab(id)}
            onNew={() => {
              addTab('');
              setOverview(false);
              setEditing(true);
            }}
            onDone={() => setOverview(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------- the bar ----------------

interface ToolbarProps {
  page: PageState;
  hasUrl: boolean;
  tabCount: number;
  collapsed: boolean;
  hidden: boolean;
  onExpand(): void;
  onBack(): void;
  onForward(): void;
  onReload(): void;
  onEdit(): void;
  onTabs(): void;
}

function Toolbar({ page, hasUrl, tabCount, collapsed, hidden, onExpand, onBack, onForward, onReload, onEdit, onTabs }: ToolbarProps) {
  const t = useT();
  const progress = useLoadProgress(page.loading);
  const width = useTransform(progress, p => `${p * 100}%`);
  const barOpacity = useTransform(progress, p => (p <= 0 || p >= 1 ? 0 : 1));
  const secure = page.url.startsWith('https://');
  const label = hasUrl ? hostOf(page.url) : t('web.searchOrType');

  return (
    <motion.div
      className={`br-bar glass-strong ${collapsed ? 'br-bar--mini' : ''}`}
      layout
      initial={false}
      animate={{ opacity: hidden ? 0 : 1, y: hidden ? 40 : 0 }}
      transition={spring.bouncy}
      style={{ borderRadius: 999 }}
      onClick={collapsed ? onExpand : undefined}
      data-pointer={collapsed ? 'highlight' : undefined}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {!collapsed && (
          <motion.div key="nav" className="br-bar__group" layout initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={spring.snappy}>
            <motion.button className="br-btn" data-pointer="highlight" onClick={onBack} whileTap={{ scale: 0.8, x: -3 }} transition={spring.snappy} aria-label="back">
              <ArrowLeft />
            </motion.button>
            <motion.button className="br-btn" data-pointer="highlight" disabled={!page.canForward} onClick={onForward} whileTap={{ scale: 0.8, x: 3 }} transition={spring.snappy} aria-label="forward">
              <ArrowRight />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div layout className="br-address" data-pointer={collapsed ? undefined : 'highlight'} onClick={collapsed ? undefined : onEdit} transition={spring.bouncy}>
        <motion.span layout="position" className="br-address__label">
          {hasUrl ? secure ? <Lock className="br-address__lock" /> : <Globe className="br-address__lock" /> : <Search className="br-address__lock" />}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={label} className="br-address__host" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={spring.snappy}>
              {label}
            </motion.span>
          </AnimatePresence>
        </motion.span>
        {!collapsed && hasUrl && (
          <motion.button
            className="br-address__reload"
            data-pointer="highlight"
            onClick={e => {
              e.stopPropagation();
              onReload();
            }}
            whileTap={{ scale: 0.8, rotate: page.loading ? 0 : -90 }}
            transition={spring.snappy}
            aria-label="reload"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={page.loading ? 'stop' : 'reload'} initial={{ opacity: 0, scale: 0.5, rotate: -60 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, scale: 0.5 }} transition={spring.snappy}>
                {page.loading ? <Close /> : <Reload />}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        )}
        <motion.span className="br-address__progress" style={{ width, opacity: barOpacity }} />
      </motion.div>

      <AnimatePresence initial={false} mode="popLayout">
        {!collapsed && (
          <motion.button
            key="tabs"
            layout
            className="br-btn br-btn--tabs"
            data-pointer="highlight"
            onClick={onTabs}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            whileTap={{ scale: 0.8 }}
            transition={spring.snappy}
            aria-label="tabs"
          >
            <Tabs />
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={tabCount} className="br-btn__count" initial={{ opacity: 0, y: 6, scale: 0.6 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.6 }} transition={spring.bouncy}>
                {tabCount}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Safari's loading bar: hurries to a third, creeps toward the end, completes when the page does. */
function useLoadProgress(loading: boolean) {
  const p = useMotionValue(0);
  useEffect(() => {
    if (loading) {
      p.set(0.04);
      const a = animate(p, [0.04, 0.35, 0.7, 0.88], { duration: 7, times: [0, 0.08, 0.4, 1], ease: 'easeOut' });
      return () => a.stop();
    }
    if (p.get() > 0) {
      const a = animate(p, 1, { duration: 0.25, ease: 'easeOut', onComplete: () => p.set(0) });
      return () => a.stop();
    }
  }, [loading, p]);
  return p;
}

// ---------------- typing an address ----------------

function AddressEditor({ initial, onGo, onCancel }: { initial: string; onGo(v: string): void; onCancel(): void }) {
  const t = useT();
  const [value, setValue] = useState(initial);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [pick, setPick] = useState(-1);
  const history = useStore(browser, s => s.history);
  const input = useRef<HTMLInputElement>(null);
  const q = value.trim();

  useEffect(() => {
    sendToPlugin({ t: 'typing', on: true });
    requestAnimationFrame(() => input.current?.select());
    return () => sendToPlugin({ t: 'typing', on: false });
  }, []);

  useEffect(() => {
    setPick(-1);
    if (!q || q === initial || !host) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void host!.invoke('web:suggest', q, language.get()).then((s: string[]) => setSuggestions(Array.isArray(s) ? s : []));
    }, 140);
    return () => window.clearTimeout(timer);
  }, [q, initial]);

  const visits = useMemo(() => {
    if (!q) return [];
    const needle = q.toLocaleLowerCase('tr');
    return history.filter(v => v.url.toLocaleLowerCase('tr').includes(needle) || v.title.toLocaleLowerCase('tr').includes(needle)).slice(0, 4);
  }, [q, history]);

  const rows: Array<{ kind: 'search' | 'suggest' | 'visit'; text: string; sub?: string; target: string }> = [];
  if (q) rows.push({ kind: 'search', text: q, target: q });
  for (const s of suggestions) if (s !== q) rows.push({ kind: 'suggest', text: s, target: s });
  for (const v of visits) rows.push({ kind: 'visit', text: v.title || hostOf(v.url), sub: hostOf(v.url), target: v.url });

  return (
    <motion.div className="br-edit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <motion.div className="br-edit__scrim" onClick={onCancel} />
      <motion.div
        className="br-edit__sheet glass-strong"
        initial={{ y: 40, scale: 0.96, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 30, scale: 0.97, opacity: 0 }}
        transition={spring.bouncy}
      >
        {rows.length > 0 ? (
          <div className="br-suggest">
            {rows.map((r, i) => (
              <motion.button
                key={`${r.kind}:${r.target}`}
                className={`br-suggest__row ${i === pick ? 'br-suggest__row--on' : ''}`}
                data-pointer="highlight"
                onMouseDown={e => e.preventDefault()}
                onClick={() => onGo(r.target)}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...spring.snappy, delay: Math.min(i, 6) * 0.025 }}
              >
                <span className="br-suggest__icon">{r.kind === 'visit' ? <img src={faviconFor(r.target)} alt="" /> : <Search />}</span>
                <span className="br-suggest__text">
                  <span>{r.kind === 'search' ? `“${r.text}”` : r.text}</span>
                  {r.sub && <small>{r.sub}</small>}
                </span>
                {r.kind === 'search' && <span className="br-suggest__hint">{t('web.searchGoogle')}</span>}
              </motion.button>
            ))}
          </div>
        ) : (
          <div className="br-edit__favs">
            {FAVORITES.slice(0, 8).map((f, i) => (
              <FavoriteTile key={f.url} name={f.name} url={f.url} tint={f.tint} index={i} onOpen={onGo} small />
            ))}
          </div>
        )}
        <div className="br-edit__field">
          <Search />
          <input
            ref={input}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onGo(pick >= 0 && rows[pick] ? rows[pick].target : value);
              else if (e.key === 'Escape') onCancel();
              else if (e.key === 'ArrowDown') setPick(p => Math.min(rows.length - 1, p + 1));
              else if (e.key === 'ArrowUp') setPick(p => Math.max(-1, p - 1));
            }}
            placeholder={t('web.searchOrType')}
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
      </motion.div>
    </motion.div>
  );
}

// ---------------- start page ----------------

function FavoriteTile({ name, url, tint, index, onOpen, small }: { name: string; url: string; tint: string; index: number; onOpen(u: string): void; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <motion.button
      className={`fav ${small ? 'fav--small' : ''}`}
      data-pointer="highlight"
      onClick={() => onOpen(url)}
      initial={{ opacity: 0, y: 16, scale: 0.86 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...spring.bouncy, delay: 0.04 + index * 0.035 }}
      whileTap={{ scale: 0.9 }}
    >
      <span className="fav__tile" style={{ '--tint': tint } as CSSProperties}>
        {failed ? <span className="fav__letter">{name[0]}</span> : <img src={faviconFor(url)} alt="" onError={() => setFailed(true)} />}
      </span>
      <span className="fav__name">{name}</span>
    </motion.button>
  );
}

function StartPage({ onOpen }: { onOpen(u: string): void }) {
  const t = useT();
  const history = useStore(browser, s => s.history);
  const often: Visit[] = frequent(history, 8);
  return (
    <div className="br-start">
      <motion.h1 className="br-start__title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring.smooth}>
        {t('web.favorites')}
      </motion.h1>
      <div className="br-start__grid">
        {FAVORITES.map((f, i) => (
          <FavoriteTile key={f.url} name={f.name} url={f.url} tint={f.tint} index={i} onOpen={onOpen} />
        ))}
      </div>
      {often.length > 0 && (
        <>
          <motion.h2 className="br-start__subtitle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
            {t('web.frequent')}
          </motion.h2>
          <div className="br-start__grid">
            {often.map((v, i) => (
              <FavoriteTile key={v.url} name={v.title || hostOf(v.url)} url={v.url} tint="#8e8e93" index={i + 4} onOpen={onOpen} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ErrorPage({ message, onRetry }: { message: string; onRetry(): void }) {
  const t = useT();
  return (
    <motion.div className="br-error" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={spring.smooth}>
      <Globe className="br-error__glyph" />
      <h2>{t('web.cantOpen')}</h2>
      <p>{message}</p>
      <motion.button className="br-error__retry" data-pointer="highlight" onClick={onRetry} whileTap={{ scale: 0.92 }}>
        <Reload /> {t('web.retry')}
      </motion.button>
    </motion.div>
  );
}

// ---------------- tabs ----------------

function TabOverview({ tabs, active, onPick, onClose, onNew, onDone }: { tabs: Tab[]; active: string; onPick(id: string): void; onClose(id: string): void; onNew(): void; onDone(): void }) {
  const t = useT();
  const cols = tabs.length <= 2 ? 2 : 3;
  return (
    <motion.div className="br-tabs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
      <div className="br-tabs__grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        <AnimatePresence>
          {tabs.map((tab, i) => (
            <motion.div
              key={tab.id}
              layout
              className={`tab-card ${tab.id === active ? 'tab-card--active' : ''}`}
              initial={{ opacity: 0, scale: tab.id === active ? 1.6 : 0.8, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.2 } }}
              transition={{ ...spring.bouncy, delay: tab.id === active ? 0 : 0.03 * i }}
              whileTap={{ scale: 0.96 }}
              onClick={() => onPick(tab.id)}
              data-pointer="highlight"
            >
              <div className="tab-card__head">
                {tab.url ? <img className="tab-card__icon" src={tab.favicon || faviconFor(tab.url)} alt="" /> : <Search className="tab-card__icon" />}
                <span className="tab-card__title">{tab.title || (tab.url ? hostOf(tab.url) : t('web.newTab'))}</span>
                <motion.button
                  className="tab-card__close"
                  data-pointer="highlight"
                  onClick={e => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  whileTap={{ scale: 0.8 }}
                  aria-label="close tab"
                >
                  <Close />
                </motion.button>
              </div>
              <div className="tab-card__shot">
                {tab.thumb ? <img src={tab.thumb} alt="" /> : <span className="tab-card__blank">{tab.url ? <Globe /> : <Search />}</span>}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <motion.div className="br-tabs__bar glass-strong" initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }} transition={spring.bouncy}>
        <motion.button className="br-btn" data-pointer="highlight" disabled={tabs.length >= MAX_TABS} onClick={onNew} whileTap={{ scale: 0.8, rotate: 90 }} transition={spring.snappy} aria-label="new tab">
          <Plus />
        </motion.button>
        <span className="br-tabs__count">
          {tabs.length} {t('web.tabs')}
        </span>
        <motion.button className="br-tabs__done" data-pointer="highlight" onClick={onDone} whileTap={{ scale: 0.9 }}>
          {t('common.done')}
        </motion.button>
      </motion.div>
      <motion.button className="br-tabs__back" data-pointer="highlight" onClick={onDone} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} aria-label="back">
        <ChevronLeft />
      </motion.button>
    </motion.div>
  );
}
