// The browser's tabs and history, kept across restarts (localStorage, like Safari's iCloud tabs
// without the cloud).

import { createStore } from '../../state/store';

export interface Tab {
  id: string;
  url: string;
  title: string;
  favicon: string;
  /** Snapshot for the tab overview (data URL), taken when the overview opens. */
  thumb: string | null;
}

export interface Visit {
  url: string;
  title: string;
  visits: number;
  last: number;
}

export interface Favorite {
  name: string;
  url: string;
  tint: string;
}

export const FAVORITES: Favorite[] = [
  { name: 'Google', url: 'https://www.google.com', tint: '#4285f4' },
  { name: 'YouTube', url: 'https://m.youtube.com', tint: '#ff0033' },
  { name: 'Vikipedi', url: 'https://tr.m.wikipedia.org', tint: '#636366' },
  { name: 'TruckersMP', url: 'https://truckersmp.com', tint: '#e8562a' },
  { name: 'World of Trucks', url: 'https://www.worldoftrucks.com', tint: '#f08a00' },
  { name: 'Hava Durumu', url: 'https://www.mgm.gov.tr', tint: '#1d8cf0' },
  { name: 'Haberler', url: 'https://www.bbc.com/turkce', tint: '#bb1919' },
  { name: 'Twitch', url: 'https://m.twitch.tv', tint: '#9146ff' },
];

export const MAX_TABS = 6;

const KEY = 'tirplay.browser';

interface Saved {
  tabs: Array<Pick<Tab, 'id' | 'url' | 'title' | 'favicon'>>;
  active: string;
  history: Visit[];
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (Array.isArray(s.tabs) && s.tabs.length) return { tabs: s.tabs, active: s.active, history: s.history ?? [] };
    }
  } catch {
    // fresh start
  }
  const id = newId();
  return { tabs: [{ id, url: '', title: '', favicon: '' }], active: id, history: [] };
}

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}

const saved = load();

export const browser = createStore<{ tabs: Tab[]; active: string; history: Visit[] }>({
  tabs: saved.tabs.map(t => ({ ...t, thumb: null })),
  active: saved.tabs.some(t => t.id === saved.active) ? saved.active : saved.tabs[0].id,
  history: saved.history,
});

let saveTimer = 0;
browser.subscribe(() => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const s = browser.get();
    try {
      const out: Saved = { tabs: s.tabs.map(({ id, url, title, favicon }) => ({ id, url, title, favicon })), active: s.active, history: s.history.slice(0, 300) };
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch {
      // storage unavailable: tabs live for this session only
    }
  }, 400);
});

export function patchTab(id: string, patch: Partial<Tab>) {
  browser.set(s => ({ ...s, tabs: s.tabs.map(t => (t.id === id ? { ...t, ...patch } : t)) }));
}

export function addTab(url = ''): string {
  const id = newId();
  browser.set(s => {
    const tabs = [...s.tabs, { id, url, title: '', favicon: '', thumb: null }];
    return { ...s, tabs: tabs.slice(-MAX_TABS), active: id };
  });
  return id;
}

export function closeTab(id: string) {
  browser.set(s => {
    const i = s.tabs.findIndex(t => t.id === id);
    let tabs = s.tabs.filter(t => t.id !== id);
    if (!tabs.length) tabs = [{ id: newId(), url: '', title: '', favicon: '', thumb: null }];
    const active = s.active === id ? tabs[Math.max(0, Math.min(i, tabs.length - 1))].id : s.active;
    return { ...s, tabs, active };
  });
}

export function remember(url: string, title: string) {
  if (!/^https?:/i.test(url)) return;
  browser.set(s => {
    const now = Date.now();
    const found = s.history.find(v => v.url === url);
    const history = found
      ? s.history.map(v => (v.url === url ? { ...v, title: title || v.title, visits: v.visits + 1, last: now } : v))
      : [{ url, title, visits: 1, last: now }, ...s.history];
    history.sort((a, b) => b.last - a.last);
    return { ...s, history: history.slice(0, 300) };
  });
}

/** Most visited sites, one entry per host. */
export function frequent(history: Visit[], limit = 8): Visit[] {
  const byHost = new Map<string, Visit>();
  for (const v of history) {
    const h = hostOf(v.url);
    const prev = byHost.get(h);
    if (!prev || v.visits > prev.visits) byHost.set(h, { ...v, visits: (prev?.visits ?? 0) + v.visits });
  }
  return [...byHost.values()].sort((a, b) => b.visits - a.visits).slice(0, limit);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^(www|m|mobile)\./, '');
  } catch {
    return url;
  }
}

export function faviconFor(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(url))}&sz=64`;
}

/** What the address field means: a URL, or a search. */
export function resolveInput(input: string): string {
  const s = input.trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s) && !/\s/.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}
