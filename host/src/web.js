// The in-car browser's side of the host: every <webview> gets the preload that reports text
// focus, and search suggestions come from here (the UI's page cannot fetch them cross-origin).

import { net, webContents } from 'electron';
import path from 'node:path';

/**
 * Pages get the preload, and the UI's resolution as their zoom (the page is zoomed by the
 * resolution, so a page inside it lays out the same at any resolution). Chromium keeps a zoom per
 * site, and keeps it across starts: a page is set to the resolution again on every load, or a site
 * once seen at 2x would stay zoomed in at 1x. `scale()` is the resolution now.
 */
export function attachWebviews(contents, here, scale = () => 1) {
  contents.on('will-attach-webview', (_e, webPreferences) => {
    webPreferences.preload = path.join(here, 'webview-preload.cjs');
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
  });
  contents.on('did-attach-webview', (_e, guest) => {
    const fit = () => {
      if (!guest.isDestroyed() && Math.abs(guest.getZoomFactor() - scale()) > 0.001) guest.setZoomFactor(scale());
    };
    guest.on('did-navigate', fit);
    guest.on('did-navigate-in-page', fit);
    guest.on('dom-ready', fit);
    fit();
  });
}

/** Every page of `contents` to the resolution now (after it changed). */
export function zoomWebviews(contents, factor) {
  for (const guest of webContents.getAllWebContents()) {
    if (guest.getType() === 'webview' && guest.hostWebContents === contents && !guest.isDestroyed()) guest.setZoomFactor(factor);
  }
}

/** Up to six search suggestions for what is being typed, in Turkish when the UI is; `source`
 *  'yt' asks for YouTube's. */
export async function suggest(query, lang = 'tr', source = 'web') {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const ds = source === 'yt' ? '&ds=yt' : '';
  const url = `https://suggestqueries.google.com/complete/search?client=firefox${ds}&hl=${lang === 'en' ? 'en' : 'tr'}&q=${encodeURIComponent(q)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await net.fetch(url, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = JSON.parse(Buffer.from(await res.arrayBuffer()).toString('utf8'));
    return Array.isArray(data?.[1]) ? data[1].slice(0, 6).map(String) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
