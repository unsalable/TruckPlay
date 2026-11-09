import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { AppScaffold, Row, Section, Segmented, Toggle } from '../../components/AppScaffold';
import { Clock, Dashboard, Globe, Keyboard, Lock, Map as MapGlyph, Moon, Photo, Road, Signal, Sparkles, Speaker, Sun } from '../../icons/glyphs';
import { WallpaperArt, isPhoto, wallpapers, type WallpaperDef } from '../../shell/Wallpaper';
import { MapSettings } from '../maps/MapSettings';
import { pushBack } from '../../shell/appLayer';
import { host } from '../../state/bridge';
import { useStore } from '../../state/store';
import { display, settings, resolvedAppearance, type Appearance } from '../../state/ui';
import { connection } from '../../state/telemetry';
import { fitKey, fitting, screenInfo } from '../../state/screen';
import { useT, language, type StringKey } from '../../state/i18n';
import { spring } from '../../design/motion';
import './settings.css';

// Virtual-key names for the keys a player would pick.
function keyName(vk: number): string {
  if (vk >= 0x41 && vk <= 0x5a) return String.fromCharCode(vk);
  if (vk >= 0x30 && vk <= 0x39) return String.fromCharCode(vk);
  if (vk >= 0x70 && vk <= 0x87) return `F${vk - 0x6f}`;
  const named: Record<number, string> = { 0x09: 'Tab', 0x14: 'Caps Lock', 0x20: 'Space', 0xc0: '"', 0x2d: 'Insert', 0x24: 'Home', 0x21: 'Page Up', 0x22: 'Page Down', 0x23: 'End' };
  return named[vk] ?? `0x${vk.toString(16)}`;
}

function KeyPicker({ value, onPick }: { value: number; onPick: (vk: number) => void }) {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key !== 'Escape') onPick(e.keyCode);
      setListening(false);
    };
    window.addEventListener('keydown', onKey, { once: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [listening, onPick]);
  return (
    <motion.button className={`keycap ${listening ? 'keycap--listening' : ''}`} data-pointer="highlight" onClick={() => setListening(true)} whileTap={{ scale: 0.92 }} transition={spring.snappy}>
      {listening ? '…' : keyName(value)}
    </motion.button>
  );
}

// Settings pushes its sub-pages the iOS way: the new page slides in from the right over a root
// that drifts left and dims; back slides it away again.
type Page = 'root' | 'wallpaper';

export function SettingsApp() {
  const [page, setPage] = useState<Page>('root');
  useEffect(() => (page === 'root' ? undefined : pushBack(() => setPage('root'))), [page]);
  const depth = page === 'root' ? 0 : 1;
  return (
    <div className="nav-stack">
      <AnimatePresence initial={false} custom={depth}>
        {page === 'root' ? (
          <NavPage key="root" depth={0}>
            <Root onWallpaper={() => setPage('wallpaper')} />
          </NavPage>
        ) : (
          <NavPage key="wallpaper" depth={1}>
            <WallpaperPage onBack={() => setPage('root')} />
          </NavPage>
        )}
      </AnimatePresence>
    </div>
  );
}

const navVariants = {
  enter: (d: number) => ({ x: d > 0 ? '100%' : '-30%', opacity: d > 0 ? 1 : 0.6 }),
  center: { x: '0%', opacity: 1 },
  exit: (d: number) => ({ x: d > 0 ? '-30%' : '100%', opacity: d > 0 ? 0.6 : 1 }),
};


/** Settings > Screen and keys > Resolution: how many pixels the UI is drawn at. */
function ResolutionRow() {
  const t = useT();
  const v = useStore(settings, x => (x.screenScale === 'auto' || !x.screenScale ? 1 : x.screenScale));
  const d = useStore(display, x => x);
  const subtitle = d && d.w > 0 ? `${d.w} × ${d.h}` : '';
  return (
    <Row icon={<Dashboard />} tint="var(--teal)" title={t('settings.resolution')} subtitle={subtitle || undefined}>
      <Segmented<string>
        value={String(v)}
        onChange={x => settings.patch({ screenScale: Number(x) as 1 | 1.5 | 2 })}
        options={[
          { value: '1', label: '1×' },
          { value: '1.5', label: '1,5×' },
          { value: '2', label: '2×' },
        ]}
      />
    </Row>
  );
}

function NavPage({ depth, children }: { depth: number; children: ReactNode }) {
  return (
    <motion.div
      className="nav-stack__page"
      custom={depth}
      variants={navVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={spring.smooth}
      style={{ zIndex: depth + 1 }}
    >
      {children}
    </motion.div>
  );
}

function Root({ onWallpaper }: { onWallpaper(): void }) {
  const t = useT();
  const s = useStore(settings, x => x);
  const dark = useStore(resolvedAppearance, a => a === 'dark');
  const conn = useStore(connection, c => c);
  const set = (patch: Partial<typeof s>) => settings.patch(patch);
  const lang = useStore(language, l => l);
  const current = wallpaperName(s.wallpaper, lang);
  const screenId = useStore(screenInfo, x => x.id);
  const key = fitKey();
  const fitted = Boolean(key && s.screenFits[key]);

  return (
    <AppScaffold title={t('settings.title')}>
      <Section title={t('settings.wallpaper').toLocaleUpperCase('tr')}>
        <motion.button className="wp-current" data-pointer="highlight" onClick={onWallpaper} whileTap={{ scale: 0.985 }} transition={spring.snappy}>
          <span className="wp-current__pair">
            <span className="wp-current__thumb">
              <WallpaperArt id={s.wallpaper} dark={false} still />
            </span>
            <span className="wp-current__thumb">
              <WallpaperArt id={s.wallpaper} dark still />
            </span>
          </span>
          <span className="wp-current__text">
            <span className="wp-current__name">{current}</span>
            <span className="wp-current__hint">{t('wallpaper.change')}</span>
          </span>
        </motion.button>
      </Section>

      <Section title={t('settings.appearance').toLocaleUpperCase('tr')}>
        <Row icon={dark ? <Moon /> : <Sun />} tint="var(--indigo)" title={t('settings.appearance')}>
          <Segmented<Appearance>
            value={s.appearance}
            onChange={appearance => set({ appearance })}
            options={[
              { value: 'light', label: t('settings.appearance.light') },
              { value: 'dark', label: t('settings.appearance.dark') },
            ]}
          />
        </Row>
        <Row icon={<Sparkles />} tint="var(--purple)" title={t('settings.motion')}>
          <Toggle on={s.motion} onChange={motion => set({ motion })} />
        </Row>
      </Section>

      <MapSettings />

      <Section title={t('settings.advisor').toLocaleUpperCase('tr')} footer={t('settings.advisor.hint')}>
        <Row icon={<MapGlyph />} tint="var(--green)" title={t('settings.advisor.screen')}>
          <Toggle on={s.advisorScreen} onChange={advisorScreen => set({ advisorScreen })} />
        </Row>
      </Section>

      <Section title={t('settings.controls').toLocaleUpperCase('tr')}>
        <Row icon={<Keyboard />} tint="var(--gray)" title={t('settings.holdKey')}>
          <KeyPicker value={s.holdVk} onPick={holdVk => set({ holdVk })} />
        </Row>
        <Row icon={<Keyboard />} tint="var(--gray)" title={t('settings.zoomKey')}>
          <KeyPicker value={s.zoomVk} onPick={zoomVk => set({ zoomVk })} />
        </Row>
        <Row
          icon={<Dashboard />}
          tint="var(--yellow)"
          title={t('settings.screenFit')}
          subtitle={t(fitted ? 'settings.screenFit.manual' : screenId === 'generic' ? 'settings.screenFit.generic' : 'settings.screenFit.measured')}
          chevron
          onClick={() => fitting.set(true)}
        />
        <ResolutionRow />
        <Row icon={<Road />} tint="var(--blue)" title={t('settings.sensitivity')}>
          <Segmented<string>
            value={String(s.sens)}
            onChange={v => set({ sens: Number(v) })}
            options={[
              { value: '0.6', label: '−' },
              { value: '1', label: '1×' },
              { value: '1.6', label: '+' },
            ]}
          />
        </Row>
      </Section>

      <Section>
        <Row icon={<Clock />} tint="var(--orange)" title={t('settings.clock')}>
          <Segmented<'game' | 'real'>
            value={s.clock}
            onChange={clock => set({ clock })}
            options={[
              { value: 'game', label: t('settings.clock.game') },
              { value: 'real', label: t('settings.clock.real') },
            ]}
          />
        </Row>
        <Row icon={<Globe />} tint="var(--blue)" title={t('settings.language')}>
          <Segmented<'tr' | 'en'>
            value={s.lang}
            onChange={l => set({ lang: l })}
            options={[
              { value: 'tr', label: 'Türkçe' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Row>
        <Row icon={<Speaker />} tint="var(--pink)" title={t('settings.pauseWithGame')}>
          <Toggle on={s.pauseWithGame} onChange={pauseWithGame => set({ pauseWithGame })} />
        </Row>
        <Row icon={<Signal />} tint="var(--red)" title={t('settings.notifications')}>
          <Toggle on={s.notifications} onChange={notifications => set({ notifications })} />
        </Row>
      </Section>

      <Section title={t('settings.web').toLocaleUpperCase('tr')} footer={t('settings.adblockHint')}>
        <Row icon={<Lock />} tint="var(--green)" title={t('settings.adblock')}>
          <Toggle on={s.adblock} onChange={adblock => set({ adblock })} />
        </Row>
      </Section>

      <Section title={t('settings.connection').toLocaleUpperCase('tr')}>
        <Row
          icon={<Signal />}
          tint={conn.state === 'live' ? 'var(--green)' : conn.state === 'demo' ? 'var(--orange)' : 'var(--gray)'}
          title={t(`settings.connection.${conn.state}` as StringKey)}
          value={conn.plugin ? `v${conn.plugin}` : undefined}
        />
        <Row title="TruckPlay" value={host?.info.version ?? '1.6.0'} />
      </Section>
    </AppScaffold>
  );
}

function wallpaperName(id: string, lang: 'tr' | 'en'): string {
  if (isPhoto(id)) return lang === 'tr' ? 'Fotoğraf' : 'Photo';
  return (wallpapers.find(w => w.id === id) ?? wallpapers[0]).name[lang];
}

interface PhotoItem {
  id: string;
  source: 'ets2' | 'pictures';
  name: string;
  date: number;
}

function WallpaperPage({ onBack }: { onBack(): void }) {
  const t = useT();
  const chosen = useStore(settings, s => s.wallpaper);
  const appearance = useStore(resolvedAppearance, a => a);
  const lang = useStore(language, l => l);
  const [preview, setPreview] = useState<'light' | 'dark'>(appearance);
  const [photos, setPhotos] = useState<PhotoItem[] | null>(host ? null : []);

  useEffect(() => {
    if (!host) return;
    void host.invoke('wall:list').then(
      (list: PhotoItem[]) => setPhotos(Array.isArray(list) ? list : []),
      () => setPhotos([]),
    );
  }, []);

  const choose = (id: string) => settings.patch({ wallpaper: id });
  const dynamic = wallpapers.filter(w => w.dynamic);
  const still = wallpapers.filter(w => !w.dynamic);

  return (
    <AppScaffold title={t('settings.wallpaper')} onBack={onBack}>
      <div className="wp-hero">
        <AnimatePresence initial={false}>
          <motion.div
            key={`${chosen}:${preview}`}
            className="wp-hero__art"
            initial={{ opacity: 0, scale: 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.35, delay: 0.25 } }}
            transition={{ opacity: { duration: 0.45 }, scale: spring.smooth }}
          >
            <WallpaperArt id={chosen} dark={preview === 'dark'} />
          </motion.div>
        </AnimatePresence>
        {/* A sketch of the CarPlay screen over it, so the choice is judged in place. */}
        <div className="wp-hero__mock" aria-hidden="true">
          <span className="wp-hero__rail glass" />
          <span className="wp-hero__card glass wp-hero__card--big" />
          <span className="wp-hero__col">
            <span className="wp-hero__card glass" />
            <span className="wp-hero__card glass" />
            <span className="wp-hero__card glass" />
          </span>
        </div>
        <div className="wp-hero__switch">
          <Segmented<'light' | 'dark'>
            value={preview}
            onChange={setPreview}
            options={[
              { value: 'light', label: t('settings.appearance.light') },
              { value: 'dark', label: t('settings.appearance.dark') },
            ]}
          />
        </div>
      </div>

      <WallpaperGrid title={t('wallpaper.dynamic')} glyph={<Sparkles />} items={dynamic} chosen={chosen} dark={preview === 'dark'} lang={lang} onPick={choose} />
      <WallpaperGrid title={t('wallpaper.tirplay')} items={still} chosen={chosen} dark={preview === 'dark'} lang={lang} onPick={choose} />

      <section className="wp-section">
        <h2 className="wp-section__title">
          <Photo /> {t('wallpaper.photos')}
        </h2>
        {photos && photos.length === 0 && <p className="wp-section__empty">{t('wallpaper.photosEmpty')}</p>}
        <div className="wp-grid">
          {(photos ?? []).map((p, i) => {
            const id = `photo:${p.id}`;
            return (
              <Thumb key={p.id} index={i} on={chosen === id} onPick={() => choose(id)} label={p.source === 'ets2' ? 'ETS2' : p.name} badge={p.source === 'ets2'}>
                <img className="wp-thumb__photo" src={`tpwall://thumb/${p.id}`} alt="" draggable={false} />
              </Thumb>
            );
          })}
        </div>
      </section>
    </AppScaffold>
  );
}

function WallpaperGrid({ title, glyph, items, chosen, dark, lang, onPick }: { title: string; glyph?: ReactNode; items: WallpaperDef[]; chosen: string; dark: boolean; lang: 'tr' | 'en'; onPick(id: string): void }) {
  return (
    <section className="wp-section">
      <h2 className="wp-section__title">
        {glyph} {title}
      </h2>
      <div className="wp-grid">
        {items.map((w, i) => (
          <Thumb key={w.id} index={i} on={chosen === w.id} onPick={() => onPick(w.id)} label={w.name[lang]}>
            {/* Only the chosen dynamic wallpaper keeps moving in its thumbnail. */}
            <WallpaperArt id={w.id} dark={dark} still={!(w.dynamic && chosen === w.id)} />
          </Thumb>
        ))}
      </div>
    </section>
  );
}

function Thumb({ on, onPick, label, index, badge, children }: { on: boolean; onPick(): void; label: string; index: number; badge?: boolean; children: ReactNode }) {
  return (
    <motion.button
      className={`wp-thumb ${on ? 'wp-thumb--on' : ''}`}
      data-pointer="highlight"
      onClick={onPick}
      initial={{ opacity: 0, y: 14, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...spring.bouncy, delay: Math.min(index, 10) * 0.03 }}
      whileTap={{ scale: 0.94 }}
    >
      <span className="wp-thumb__art">
        {children}
        {badge && <span className="wp-thumb__badge">ETS2</span>}
        <AnimatePresence>
          {on && (
            <motion.span className="wp-thumb__check" initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0, opacity: 0 }} transition={spring.bouncy}>
              ✓
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="wp-thumb__name">{label}</span>
    </motion.button>
  );
}
