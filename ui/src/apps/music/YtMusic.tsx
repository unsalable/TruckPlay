// YouTube Music's page outlives the Music app: it is kept in a layer above the apps (YtMusicLayer,
// in the Shell), shown over its tab (YtMusicSlot) while that tab is on screen, and hidden — still
// playing — otherwise. Whenever the tab moves (the app's zoom, sliding in or out between Music's
// tabs) the tab shows a still picture of the page instead, taken just before: the live page only
// shows once the tab has come to rest, and steps away before it leaves, so it never floats over
// another tab or hangs unmoved while the app moves.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createStore } from '../../state/store';
import { useStore } from '../../state/store';
import { nav } from '../../state/ui';
import { appPhase, registerFreezer } from '../../shell/appLayer';
import { WebView, type WebviewEl } from '../browser/WebView';
import { YTM_URL, setYtMusicView, startYtMusic, ytMusic, ytMusicMedia } from '../../state/ytMusic';

/** The tab's area while it is on screen, whether it is at rest (the live page may show), and the
 *  last picture of the page. */
const slot = createStore<{ el: HTMLElement | null; live: boolean; picture: string }>({ el: null, live: false, picture: '' });

let liveView: WebviewEl | null = null;
const PICTURE_WIDTH = 900;

async function takePicture() {
  const v = liveView;
  if (!v) return;
  try {
    slot.patch({ picture: (await v.capturePage()).resize({ width: PICTURE_WIDTH }).toDataURL() });
  } catch {
    // keep the last picture
  }
}

/** Before Music leaves the YouTube Music tab: the page's picture takes its place, then the page
 *  steps away, so the tab slides out as a picture. */
export async function leaveYtMusic() {
  if (!slot.get().live) return;
  await takePicture();
  slot.patch({ live: false });
}

/** The tab has slid in and come to rest: the live page may show over it. */
export function ytMusicSettled() {
  if (slot.get().el) slot.patch({ live: true });
}

/** Music's YouTube Music tab: where the page shows. `entering`: it slides in (the page waits for
 *  ytMusicSettled); otherwise it is there from the start. */
export function YtMusicSlot({ entering = false }: { entering?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const picture = useStore(slot, s => s.picture);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    startYtMusic();
    const node = ref.current;
    slot.patch({ el: node, live: !entering });
    // The page fills the app's body below its bar.
    const body = ref.current?.closest<HTMLElement>('.app__body');
    const measure = () => {
      if (!body) return;
      const cs = getComputedStyle(body);
      setHeight(body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
    };
    measure();
    const ro = body ? new ResizeObserver(measure) : null;
    if (body) ro?.observe(body);
    return () => {
      ro?.disconnect();
      if (slot.get().el === node) slot.patch({ el: null, live: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} className="ytm-slot" style={{ height: height || undefined }}>
      {picture && <img className="ytm-slot__picture" src={picture} alt="" draggable={false} />}
    </div>
  );
}

/** The page itself, in the Shell's stage, above the apps. */
export function YtMusicLayer() {
  const started = useStore(ytMusic, s => s.started);
  const el = useStore(slot, s => s.el);
  const live = useStore(slot, s => s.live);
  const app = useStore(nav, n => n.app);
  const phase = useStore(appPhase, p => p);
  const [closing, setClosing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<WebviewEl | null>(null);
  // The app that was open: while Music zooms closed, nav.app is already empty.
  const lastApp = useRef(app);
  if (app) lastApp.current = app;
  const visible = Boolean(el) && live && !closing && lastApp.current === 'music' && (phase === 'open' || phase === 'closing');
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (phase === 'open' || phase === 'opening') setClosing(false);
  }, [phase]);

  // Before the app zooms closed: a picture of the page for the tab, then the page steps away.
  useEffect(
    () =>
      registerFreezer(async () => {
        if (!view.current || !visibleRef.current) return;
        await takePicture();
        setClosing(true);
      }),
    [],
  );

  // Follow the tab's area while it shows.
  useEffect(() => {
    if (!visible || !el) return;
    let raf = 0;
    const stage = document.querySelector('.stage');
    const place = () => {
      raf = requestAnimationFrame(place);
      const b = box.current;
      if (!b || !stage) return;
      const s = stage.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      b.style.transform = `translate(${r.left - s.left}px, ${r.top - s.top}px)`;
      b.style.width = `${r.width}px`;
      b.style.height = `${r.height}px`;
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [visible, el]);

  // While the page shows live, the tab's picture is refreshed for the next zoom.
  useEffect(() => {
    if (!visible) return;
    const t = window.setInterval(() => void takePicture(), 8000);
    return () => window.clearInterval(t);
  }, [visible]);

  if (!started) return null;
  return (
    <div ref={box} className={`ytm-layer${visible ? '' : ' ytm-layer--away'}`}>
      <WebView
        url={YTM_URL}
        active={visible}
        desktop
        freeze={false}
        onState={() => {}}
        onMedia={ytMusicMedia}
        register={v => {
          view.current = v;
          liveView = v;
          setYtMusicView(v);
        }}
      />
    </div>
  );
}
