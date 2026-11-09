// The YouTube page itself (youtubePage.ts), in the Shell's stage above the apps: over the YouTube
// app's slot while the app is open and at rest, in the F3 panel's part of the screen in split
// screen, and otherwise kept out of sight, still loaded. While the app zooms the slot shows a picture
// of the page instead, taken just before: the live page only shows once the app has come to rest,
// and steps away before it leaves.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { SPLIT_PANEL, immersive, nav, split } from '../../state/ui';
import { appPhase, registerFreezer } from '../../shell/appLayer';
import { WebView } from './WebView';
import { YT_HOME, setYtView, takeYtPicture, youTubeVideoOnly, ytPage } from './youtubePage';

export function YouTubeLayer() {
  const started = useStore(ytPage, s => s.started);
  const slot = useStore(ytPage, s => s.slot);
  const splitOn = useStore(split, s => s.on);
  const app = useStore(nav, n => n.app);
  const phase = useStore(appPhase, p => p);
  const [closing, setClosing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // The app that was open: while YouTube zooms closed, nav.app is already empty.
  const lastApp = useRef(app);
  if (app) lastApp.current = app;
  const inApp = !splitOn && Boolean(slot) && !closing && lastApp.current === 'youtube' && (phase === 'open' || phase === 'closing');
  const shown = splitOn || inApp;
  const inAppRef = useRef(inApp);
  inAppRef.current = inApp;

  useEffect(() => {
    if (phase === 'open' || phase === 'opening') setClosing(false);
  }, [phase]);

  useEffect(() => {
    if (ytPage.get().live !== inApp) ytPage.patch({ live: inApp });
  }, [inApp]);

  // Before the app zooms closed: a picture of the page for the slot, then the page steps away.
  useEffect(
    () =>
      registerFreezer(async () => {
        if (!inAppRef.current) return;
        await takeYtPicture();
        setClosing(true);
      }),
    [],
  );

  // Over the app's slot (following it while it moves), or in the F3 panel's part beside the screen.
  useEffect(() => {
    if (!shown) return;
    let raf = 0;
    const stage = document.querySelector('.stage');
    const place = () => {
      const b = box.current;
      if (!b || !stage) return;
      const s = stage.getBoundingClientRect();
      let r: { left: number; top: number; width: number; height: number } | null = null;
      if (splitOn) r = { left: window.innerWidth - SPLIT_PANEL.w, top: 0, width: SPLIT_PANEL.w, height: SPLIT_PANEL.h };
      else if (slot) r = slot.getBoundingClientRect();
      if (r) {
        b.style.transform = `translate(${r.left - s.left}px, ${r.top - s.top}px)`;
        b.style.width = `${r.width}px`;
        b.style.height = `${r.height}px`;
      }
      if (!splitOn) raf = requestAnimationFrame(place);
    };
    place();
    const onResize = () => place();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [shown, slot, splitOn]);

  // In the F3 panel: just the video, again after whatever the page loads meanwhile.
  useEffect(() => {
    if (!splitOn) return;
    youTubeVideoOnly(true);
    const t = window.setInterval(() => youTubeVideoOnly(true), 2000);
    return () => window.clearInterval(t);
  }, [splitOn]);

  // While the page shows in the app, the slot's picture is kept fresh for the next zoom.
  useEffect(() => {
    if (!inApp) return;
    const t = window.setInterval(() => void takeYtPicture(), 8000);
    return () => window.clearInterval(t);
  }, [inApp]);

  if (!started) return null;
  return (
    <div ref={box} className={`yt-layer${shown ? '' : ' yt-layer--away'}${splitOn ? ' yt-layer--panel' : ''}`}>
      <WebView
        url={YT_HOME}
        active={shown}
        freeze={false}
        onState={s => {
          if (s.canBack !== undefined) ytPage.patch({ canBack: s.canBack });
          if (s.url !== undefined) ytPage.patch({ tucked: false });
        }}
        onScroll={(dir, y) => ytPage.patch({ tucked: dir === 'down' && y > 60 })}
        onFullscreen={on => {
          ytPage.patch({ fullscreen: on });
          // Full screen in the app takes the whole cab screen; in the F3 panel it stays there.
          if (!split.get().on) immersive.set(on);
        }}
        register={setYtView}
      />
    </div>
  );
}
