// The in-car browser's side of the host: every <webview> gets the preload that reports text
// focus, and search suggestions come from here (the UI's page cannot fetch them cross-origin).

import { net } from 'electron';
import path from 'node:path';

export function attachWebviews(contents, here) {
  contents.on('will-attach-webview', (_e, webPreferences) => {
    webPreferences.preload = path.join(here, 'webview-preload.cjs');
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
  });
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
