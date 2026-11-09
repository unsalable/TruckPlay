// The YouTube page outlives the YouTube app (as YouTube Music's does): it lives in a layer of the
// Shell's stage (YouTubeLayer.tsx), shown over the app's slot while the app is open and at rest, and
// kept, video and all, while it is closed. So leaving YouTube for Maps for a moment and coming back
// finds the same video at the same second. In split screen (state/split.ts) the same page plays in
// the F3 panel's part of the screen, again without reloading.

import { createStore } from '../../state/store';
import { exitPageFullscreen, type WebviewEl } from './WebView';

export const YT_HOME = 'https://m.youtube.com';
export const ytResults = (q: string) => `${YT_HOME}/results?search_query=${encodeURIComponent(q)}`;

export interface YtPage {
  /** The page exists (it starts the first time YouTube opens, or with split screen). */
  started: boolean;
  /** The app's area while it is on screen, and whether the live page shows over it. */
  slot: HTMLElement | null;
  live: boolean;
  /** The last picture of the page, standing in for it while the app moves. */
  picture: string;
  canBack: boolean;
  /** The bar tucks away while the page scrolls down. */
  tucked: boolean;
  /** The page shows a video full screen (inside itself). */
  fullscreen: boolean;
}

export const ytPage = createStore<YtPage>({ started: false, slot: null, live: false, picture: '', canBack: false, tucked: false, fullscreen: false });

let view: WebviewEl | null = null;
export const ytView = () => view;
export function setYtView(v: WebviewEl | null) {
  view = v;
}

export function startYouTube() {
  if (!ytPage.get().started) ytPage.patch({ started: true });
}

/** Runs `act` on the page if it is there and ready: a <webview> throws (synchronously) until it
 *  is attached and has had its dom-ready, and a throw in a React effect would take the UI down. */
function onPage(act: (v: WebviewEl) => unknown) {
  const v = view;
  if (!v) return;
  try {
    void Promise.resolve(act(v)).catch(() => {});
  } catch {
    // not ready yet: whoever asked asks again (split screen does, every few seconds)
  }
}

export function openYouTube(url: string) {
  onPage(v => v.loadURL(url));
}

/** A picture of the page, for the app's slot while the app moves. */
export async function takeYtPicture() {
  const v = view;
  if (!v) return;
  try {
    ytPage.patch({ picture: (await v.capturePage()).resize({ width: 720 }).toDataURL() });
  } catch {
    // keep the last picture
  }
}

/** Just the video (on), filling the page, or the page as it was (off): for split screen. Nothing
 *  but the video is painted then, and it fills the page on its own terms, whatever layout the site
 *  is in or last sized its player for. */
export function youTubeVideoOnly(on: boolean) {
  const v = view;
  if (!v) return;
  const js = `(() => {
    let s = document.getElementById('tp-video-only');
    if (!s) {
      s = document.createElement('style');
      s.id = 'tp-video-only';
      s.textContent =
        'html[data-tp-video-only], html[data-tp-video-only] body { background: #000 !important; overflow: hidden !important; }' +
        'html[data-tp-video-only] body * { visibility: hidden !important; }' +
        'html[data-tp-video-only] video { visibility: visible !important; position: fixed !important; inset: 0 !important;' +
        ' left: 0 !important; top: 0 !important; width: 100vw !important; height: 100vh !important; max-width: none !important;' +
        ' max-height: none !important; margin: 0 !important; transform: none !important; object-fit: contain !important;' +
        ' z-index: 2147483647 !important; background: #000 !important; }';
      (document.head || document.documentElement).appendChild(s);
    }
    if (${on}) document.documentElement.setAttribute('data-tp-video-only', '');
    else document.documentElement.removeAttribute('data-tp-video-only');
    return true;
  })()`;
  onPage(page => page.executeJavaScript(js));
  if (!on && ytPage.get().fullscreen) onPage(page => exitPageFullscreen(page, () => ytPage.patch({ fullscreen: false })));
}
