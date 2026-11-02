// Camera state of the Maps app, shared by the map and its controls. How the followed view looks
// (3D or 2D, heading or north up, buildings) is a setting; see state/ui.ts.

import { createStore } from '../state/store';
import type { Destination } from './places';

/** follow: rides with the truck · overview: whole trip · free: the driver is exploring */
export type CameraMode = 'follow' | 'overview' | 'free';

export const mapView = createStore<{ mode: CameraMode; zoomBias: number }>({ mode: 'follow', zoomBias: 0 });

/** Where the current job ends, once found on the map. */
export const mapDestination = createStore<Destination | null>(null);

/** A place tapped on the map or chosen in search: its card shows what it is and how far. */
export const mapPick = createStore<{ at: [number, number]; label: string; kind: string; owned: boolean } | null>(null);

/** Somewhere the map should go and show (a search result); `seq` makes each request new. */
export const mapFocus = createStore<{ at: [number, number]; seq: number } | null>(null);

let focusSeq = 0;
export function focusMap(at: [number, number]) {
  mapFocus.set({ at, seq: ++focusSeq });
}

export function setCameraMode(mode: CameraMode) {
  mapView.patch({ mode });
}

export function zoomBy(delta: number) {
  const v = mapView.get();
  mapView.patch({ zoomBias: Math.max(-3, Math.min(2.5, v.zoomBias + delta)) });
}
