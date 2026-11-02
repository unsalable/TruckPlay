// Which cab screen the UI is drawn on, as the host reports it, and the driver's own fit of the UI
// onto the glass. The mod measures every screen of the game's own trucks, so their pictures fit
// edge to edge; trucks from other mods use the game's generic screen, where the UI sits where most
// cabs' glass is until the driver fits it (Settings › Screen & Keys). Fits are kept per truck.

import { createStore } from './store';
import { host } from './bridge';
import { telemetry } from './telemetry';
import { settings } from './ui';

export interface Fit {
  /** Fractions of the screen's texture. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScreenInfo {
  w: number;
  h: number;
  /** The mod's id for this screen; 'generic' for trucks it has no measurements for. */
  id: string | null;
  frame: { x: number; y: number; w: number; h: number } | null;
}

export const screenInfo = createStore<ScreenInfo>({ w: 0, h: 0, id: null, frame: null });

/** The fit tool is showing. */
export const fitting = createStore(false);

/** Where the UI goes before any fit: the whole texture of a measured screen, else the usual glass. */
export function defaultFit(id: string | null): Fit {
  return id === 'generic' ? { x: 0, y: 0.14, w: 1, h: 0.6 } : { x: 0, y: 0, w: 1, h: 1 };
}

/** Fits are per truck and per screen (one truck model can have several interiors). */
export function fitKey(): string | null {
  const s = screenInfo.get();
  const truck = telemetry.get().truck.id;
  return s.w && s.h ? `${truck || 'truck'}@${s.w}x${s.h}` : null;
}

export function currentFit(): Fit {
  const key = fitKey();
  return (key && settings.get().screenFits[key]) || defaultFit(screenInfo.get().id);
}

export function setFit(fit: Fit | null) {
  const key = fitKey();
  if (!key) return;
  const fits = { ...settings.get().screenFits };
  if (fit) fits[key] = fit;
  else delete fits[key];
  settings.patch({ screenFits: fits });
  void host?.invoke('screen:fit', fit).catch(() => {});
}

/** Re-applies the saved fit whenever the screen or the truck changes. */
export function startScreenFit() {
  let applied = '';
  const sync = () => {
    const key = fitKey();
    if (!key || key === applied) return;
    applied = key;
    const saved = settings.get().screenFits[key] ?? null;
    void host?.invoke('screen:fit', saved).catch(() => {});
  };
  screenInfo.subscribe(sync);
  telemetry.subscribe(sync);
}
