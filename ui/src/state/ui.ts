import { createStore } from './store';
import type { AppIconId } from '../icons/appIcons';
import type { Lang } from './i18n';
import { language } from './i18n';

export type AppId = AppIconId;
export type Appearance = 'light' | 'dark';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------- persisted settings ----------

export interface Settings {
  appearance: Appearance;
  wallpaper: string;
  clock: 'game' | 'real';
  units: 'metric' | 'imperial';
  lang: Lang;
  holdVk: number;
  zoomVk: number;
  sens: number;
  pauseWithGame: boolean;
  notifications: boolean;
  /** Moving wallpapers and ambient fields. */
  motion: boolean;
  /** Maps: tilted 3D view (else flat 2D), north up (else heading up), 3D buildings. */
  map3d: boolean;
  mapNorthUp: boolean;
  mapBuildings: boolean;
  /** Which kinds of places the map shows (see MAP_POI_GROUPS). */
  mapPois: Record<string, boolean>;
  /** One volume for everything that plays (state/volume.ts), 0–1. */
  volume: number;
  /** Keep ads and trackers out of web pages (browser, YouTube, YouTube Music). */
  adblock: boolean;
  /** The driver's own fit of the UI onto a cab screen, per truck and screen (see state/screen.ts). */
  screenFits: Record<string, { x: number; y: number; w: number; h: number }>;
  /** The route advisor (F3) shows a copy of the cab screen on top of its widgets. */
  advisorScreen: boolean;
  /** How many pixels the UI is drawn at: the cab screen's own size times this ('auto': by the
   *  game's resolution). The host keeps it (host/src/main.js `display`). */
  screenScale: ScreenScale;
}

export type ScreenScale = 'auto' | 1 | 1.5 | 2;

/** What the host draws the UI at now: the setting, the scale it came to, the pixels, and the game's
 *  own picture. */
export interface DisplayInfo {
  setting: ScreenScale;
  scale: number;
  w: number;
  h: number;
  game: { w: number; h: number };
}
export const display = createStore<DisplayInfo | null>(null);

/** Split screen (state/split.ts): the F3 panel has a part of its own beside the cab screen's. */
export const split = createStore<{ on: boolean }>({ on: false });
/** That part, in CSS pixels: the route advisor's TruckPlay texture, as the mod makes it. */
export const SPLIT_PANEL = { w: 642, h: 559 };

const defaults: Settings = {
  appearance: 'dark',
  motion: true,
  map3d: true,
  mapNorthUp: false,
  mapBuildings: true,
  mapPois: {},
  screenFits: {},
  advisorScreen: false,
  screenScale: 1,
  adblock: true,
  volume: 0.8,
  wallpaper: 'ocean',
  clock: 'game',
  units: 'metric',
  lang: 'tr',
  holdVk: 0x47, // G
  zoomVk: 0x59, // Y
  sens: 1,
  pauseWithGame: true,
  notifications: true,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem('tirplay.settings');
    const saved = raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
    // Automatic appearance is gone: dark unless the driver picked light.
    if (saved.appearance !== 'light') saved.appearance = 'dark';
    // 1.6: the resolution goes back to 1x once for everyone (2x was too heavy in the game for most;
    // whoever wants it picks it again).
    if (!localStorage.getItem('tirplay.scale16')) {
      saved.screenScale = 1;
      localStorage.setItem('tirplay.scale16', '1');
    }
    return saved;
  } catch {
    return defaults;
  }
}

export const settings = createStore<Settings>(load());
language.set(settings.get().lang);
settings.subscribe(() => {
  const s = settings.get();
  language.set(s.lang);
  try {
    localStorage.setItem('tirplay.settings', JSON.stringify(s));
  } catch {
    // Storage can be unavailable (private profile); settings then last for the session.
  }
});

// ---------- navigation ----------

/** Home pages, left to right, as in iOS 26 CarPlay: widgets, dashboard, then the app grid. */
export const PAGE_WIDGETS = 0;
export const PAGE_DASHBOARD = 1;
export const PAGE_APPS = 2;

export interface Nav {
  page: number;
  pageCount: number;
  app: AppId | null;
  /** Where the app's icon was when it opened, in screen coordinates. */
  origin: Rect | null;
  /** Which copy of the icon it opened from ('grid' / 'rail'), or null for cards and shortcuts. */
  originPlace: 'grid' | 'rail' | null;
  recents: AppId[];
}

export const nav = createStore<Nav>({
  page: PAGE_DASHBOARD,
  pageCount: 3,
  app: null,
  origin: null,
  originPlace: null,
  recents: ['maps', 'music', 'truck'],
});

export function openApp(app: AppId, origin: Rect | null, originPlace: 'grid' | 'rail' | null = null) {
  nav.set(n => ({
    ...n,
    app,
    origin,
    originPlace,
    recents: [app, ...n.recents.filter(a => a !== app)].slice(0, 3),
  }));
}

export function closeApp() {
  nav.patch({ app: null });
}

export function goToPage(page: number) {
  nav.set(n => ({ ...n, page: Math.max(0, Math.min(n.pageCount - 1, page)) }));
}

// ---------- pointer ----------

export interface PointerState {
  visible: boolean;
  x: number;
  y: number;
  down: boolean;
  /** The game plugin draws the pointer itself (no UI round trip); the UI only reports its targets. */
  native: boolean;
}
export const pointer = createStore<PointerState>({ visible: false, x: 0, y: 0, down: false, native: false });

// ---------- immersive (full-screen video) ----------

/** A video went full screen: the rail steps aside and the app takes the whole screen. */
export const immersive = createStore(false);

// ---------- resolved appearance ----------

export const resolvedAppearance = createStore<'light' | 'dark'>('dark');
