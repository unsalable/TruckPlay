import { AnimatePresence, motion, useTransform } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Rail } from './Rail';
import { Pager } from './Pager';
import { AppHost } from './AppHost';
import { YtMusicLayer } from '../apps/music/YtMusic';
import { YouTubeLayer } from '../apps/browser/YouTubeLayer';
import { Banners } from './Banner';
import { Pointer } from './Pointer';
import { ScreenFit } from './ScreenFit';
import { WallpaperArt } from './Wallpaper';
import { appProgress } from './appLayer';
import { StageContext, stageOrigin, stageOver, type StageSize } from './stage';
import { Widgets } from '../pages/Widgets';
import { Dashboard } from '../pages/Dashboard';
import { AppGrid } from '../pages/AppGrid';
import { useStore } from '../state/store';
import { PAGE_DASHBOARD, immersive, resolvedAppearance, settings, split } from '../state/ui';
import './shell.css';

// Light or dark, as the driver chose (dark by default).
function useAppearance() {
  const resolved = useStore(settings, s => (s.appearance === 'light' ? 'light' : 'dark'));
  useEffect(() => {
    resolvedAppearance.set(resolved);
    document.documentElement.dataset.appearance = resolved;
  }, [resolved]);
  return resolved;
}

export function Shell() {
  const appearance = useAppearance();
  const wallpaper = useStore(settings, s => s.wallpaper);
  const ambient = useStore(settings, s => s.motion);
  const full = useStore(immersive, v => v);
  const splitOn = useStore(split, s => s.on);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<StageSize>({ width: 800, height: 480, pt: 1 });

  useLayoutEffect(() => {
    const el = stageRef.current!;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const pt = parseFloat(getComputedStyle(document.documentElement).fontSize) || 1;
      stageOrigin.set({ left: r.left, top: r.top });
      setStage(s => (s.width === r.width && s.height === r.height && s.pt === pt ? s : { width: r.width, height: r.height, pt }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // The UI can move inside the cab screen's texture without changing size.
    window.addEventListener('tp-frame', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('tp-frame', measure);
    };
  }, []);

  // Right click does nothing: no context menu, and no "back" (the back buttons are on screen).
  useEffect(() => {
    const onContext = (e: MouseEvent) => e.preventDefault();
    window.addEventListener('contextmenu', onContext);
    return () => window.removeEventListener('contextmenu', onContext);
  }, []);

  const homeScale = useTransform(appProgress, p => 1 + p * 0.08);
  const homeOpacity = useTransform(appProgress, p => Math.max(0, 1 - p * 1.6));
  const wallScale = useTransform(appProgress, p => 1 + p * 0.04);

  return (
    <div className={`screen ${full ? 'screen--immersive' : ''} ${splitOn ? 'screen--split' : ''}`}>
      <motion.div className="screen__wallpaper" style={{ scale: wallScale }}>
        {/* A new wallpaper (or the other appearance) settles in over the old one. */}
        <AnimatePresence initial={false}>
          <motion.div
            key={`${wallpaper}:${appearance}`}
            className="screen__wallpaper-layer"
            initial={{ opacity: 0, scale: 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.4, delay: 0.7 } }}
            transition={{ opacity: { duration: 0.8, ease: [0.4, 0, 0.2, 1] }, scale: { duration: 1.4, ease: [0.16, 1, 0.3, 1] } }}
          >
            <WallpaperArt id={wallpaper} dark={appearance === 'dark'} still={!ambient} />
          </motion.div>
        </AnimatePresence>
      </motion.div>
      <Rail iconSize={Math.round(stage.pt * 44)} />
      <div className="stage" ref={stageRef}>
        <StageContext.Provider value={stage}>
          <motion.div className="stage__home" style={{ scale: homeScale, opacity: homeOpacity }}>
            <Pager pages={[<Widgets key="w" />, <Dashboard key="d" />, <AppGrid key="a" />]} hideDotsOn={PAGE_DASHBOARD} />
          </motion.div>
          <AppHost />
          <YtMusicLayer />
          <YouTubeLayer />
          <div className="stage__over" ref={el => stageOver.set(el)} />
        </StageContext.Provider>
      </div>
      <Banners />
      <ScreenFit />
      <Pointer />
    </div>
  );
}
