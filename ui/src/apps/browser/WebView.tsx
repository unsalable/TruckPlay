// One page: Electron's <webview> inside the host (a real browser with its own history), an iframe
// in a plain browser. Reports what the bar needs (address, title, icon, loading) and passes the
// page's own signals on: text focus (the plugin then hands it the keyboard), scrolling, the mouse's
// back gesture and full-screen video.

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { appPhase, registerFreezer } from '../../shell/appLayer';
import { host, routeToPages, sendToPlugin } from '../../state/bridge';
import { useStore } from '../../state/store';

export interface WebviewEl extends HTMLElement {
  loadURL(url: string): Promise<void>;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  getTitle(): string;
  isLoading(): boolean;
  insertCSS(css: string): Promise<string>;
  executeJavaScript(code: string): Promise<unknown>;
  getWebContentsId(): number;
  capturePage(): Promise<{ toDataURL(): string; resize(o: { width: number }): { toDataURL(): string } }>;
}

export interface PageState {
  url: string;
  title: string;
  favicon: string;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  theme: string;
  error: string;
}

/** Every page on screen or playing in the background (the game's pause reaches them all). */
export const livePages = new Set<WebviewEl>();

/** What a page is playing (its media session and media element), for Now Playing. */
export interface PageMedia {
  title: string;
  artist: string;
  album: string;
  art: string;
  playing: boolean;
  pos: number;
  dur: number;
}

/** Leaves a page's full screen (it happens inside the page, see webview-preload.cjs). */
export function exitPageFullscreen(v: WebviewEl | null | undefined, done: () => void) {
  let left = false;
  const finish = () => {
    if (left) return;
    left = true;
    done();
  };
  if (v) void v.executeJavaScript('document.exitFullscreen && document.exitFullscreen()').catch(() => {});
  // The page answers through its 'tp-fullscreen' message; if it is gone or stuck, leave anyway.
  window.setTimeout(finish, 450);
  return finish;
}

export const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
export const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// Quieter pages for a small screen: app-install nags and cookie walls out of the way where we can.
const CALM_CSS =
  'ytm-mealbar-promo-renderer, .mealbar-promo-renderer, ytm-statement-banner-renderer, .smartbanner, #smart-banner { display: none !important; }';

interface Props {
  url: string;
  active: boolean;
  onState(s: Partial<PageState>): void;
  onScroll?(dir: 'up' | 'down', y: number): void;
  onFullscreen?(on: boolean): void;
  onMedia?(m: PageMedia): void;
  register?(el: WebviewEl | null): void;
  /** Desktop user agent (sites like YouTube Music want it). */
  desktop?: boolean;
  /** Swap in a picture of the page before its app zooms closed (off for pages living outside an app). */
  freeze?: boolean;
}

/**
 * A live page zooms poorly with its app, so it keeps out of the app zoom: it is created once the
 * app has finished opening, and before the app zooms closed it swaps itself for a picture of
 * itself, which then shrinks into the icon like any other content.
 */
export function WebView(props: Props) {
  const phase = useStore(appPhase, p => p);
  const [ready, setReady] = useState(() => appPhase.get() !== 'opening');
  const [frozen, setFrozen] = useState<string | null>(null);
  const live = useRef<WebviewEl | null>(null);
  const activeRef = useRef(props.active);
  activeRef.current = props.active;

  useEffect(() => {
    if (phase === 'open') setReady(true);
    if (phase === 'opening' || phase === 'open') setFrozen(null); // reopened mid-close
  }, [phase]);

  const freezeRef = useRef(props.freeze !== false);
  freezeRef.current = props.freeze !== false;
  useEffect(
    () =>
      registerFreezer(async () => {
        const v = live.current;
        if (!v || !activeRef.current || !freezeRef.current) return;
        const shot = (await v.capturePage()).resize({ width: 720 }).toDataURL();
        // Decoded before it replaces the page, so no frame shows neither.
        const img = new Image();
        img.src = shot;
        await img.decode().catch(() => {});
        flushSync(() => setFrozen(shot));
      }),
    [],
  );

  return (
    <>
      {ready ? (
        <LivePage
          {...props}
          frozen={Boolean(frozen)}
          register={el => {
            live.current = el;
            props.register?.(el);
          }}
        />
      ) : (
        <div className="web-view web-view--waiting" />
      )}
      {frozen && props.active && <img className="web-view web-view--frozen" src={frozen} alt="" draggable={false} />}
    </>
  );
}

function LivePage({ url, active, frozen, onState, onScroll, onFullscreen, onMedia, register, desktop }: Props & { frozen: boolean }) {
  const ref = useRef<WebviewEl | null>(null);
  const cb = useRef({ onState, onScroll, onFullscreen, onMedia });
  cb.current = { onState, onScroll, onFullscreen, onMedia };
  const editing = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const v = ref.current;
    if (!v || !host) return;
    register?.(v);
    routeToPages(true);
    livePages.add(v);
    const sync = () => {
      try {
        cb.current.onState({ url: v.getURL(), title: v.getTitle(), canBack: v.canGoBack(), canForward: v.canGoForward() });
      } catch {
        // not ready yet
      }
    };
    const handlers: Array<[string, (e: any) => void]> = [
      ['did-start-loading', () => cb.current.onState({ loading: true, error: '' })],
      [
        'did-stop-loading',
        () => {
          cb.current.onState({ loading: false });
          sync();
        },
      ],
      ['did-navigate', sync],
      ['did-navigate-in-page', sync],
      ['page-title-updated', (e: { title: string }) => cb.current.onState({ title: e.title })],
      ['page-favicon-updated', (e: { favicons: string[] }) => cb.current.onState({ favicon: e.favicons?.[0] ?? '' })],
      ['dom-ready', () => void v.insertCSS(CALM_CSS).catch(() => {})],
      [
        'did-fail-load',
        (e: { errorCode: number; errorDescription: string; isMainFrame: boolean }) => {
          if (e.isMainFrame && e.errorCode !== -3) cb.current.onState({ loading: false, error: e.errorDescription || String(e.errorCode) });
        },
      ],
      ['enter-html-full-screen', () => cb.current.onFullscreen?.(true)],
      ['leave-html-full-screen', () => cb.current.onFullscreen?.(false)],
      [
        'ipc-message',
        (e: { channel: string; args: unknown[] }) => {
          if (e.channel === 'tp-edit') {
            editing.current = Boolean(e.args[0]);
            if (activeRef.current) sendToPlugin({ t: 'typing', on: editing.current, src: 'page' });
          } else if (e.channel === 'tp-theme') {
            cb.current.onState({ theme: String(e.args[0] ?? '') });
          } else if (e.channel === 'tp-scroll') {
            cb.current.onScroll?.(e.args[0] === 'down' ? 'down' : 'up', Number(e.args[1]) || 0);
          } else if (e.channel === 'tp-fullscreen') {
            cb.current.onFullscreen?.(Boolean(e.args[0]));
          } else if (e.channel === 'tp-media') {
            cb.current.onMedia?.(e.args[0] as PageMedia);
          }
        },
      ],
    ];
    for (const [name, fn] of handlers) v.addEventListener(name, fn);
    return () => {
      routeToPages(false);
      livePages.delete(v);
      for (const [name, fn] of handlers) v.removeEventListener(name, fn);
      register?.(null);
      if (editing.current) sendToPlugin({ t: 'typing', on: false });
    };
    // The element lives as long as the tab; handlers read the latest callbacks through cb.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A page that goes to the background lets go of the keyboard.
  useEffect(() => {
    if (!active && editing.current) sendToPlugin({ t: 'typing', on: false });
  }, [active]);

  // The page navigates on its own from here on; feeding its address back into `src` would load it again.
  const [initial] = useState(url);
  const style = active && !frozen ? undefined : { visibility: 'hidden' as const, pointerEvents: 'none' as const };
  if (!host) return <iframe className="web-view" src={initial} title="web" style={style} />;
  return (
    <webview
      ref={ref as never}
      className="web-view"
      src={initial}
      partition="persist:tirplay"
      useragent={desktop ? DESKTOP_UA : MOBILE_UA}
      allowpopups={'true' as never}
      webpreferences="backgroundThrottling=no"
      style={style}
    />
  );
}
