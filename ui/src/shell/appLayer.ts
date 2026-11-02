import { motionValue } from 'motion/react';
import { createStore } from '../state/store';
import type { AppId } from '../state/ui';
import { closeApp } from '../state/ui';

/** 0 = home, 1 = app fully open. Drives the app zoom and the home screen's reaction to it. */
export const appProgress = motionValue(0);

/** Where the app zoom is. Heavy content (web pages) waits for 'open' and freezes for 'closing'. */
export const appPhase = createStore<'idle' | 'opening' | 'open' | 'closing'>('idle');

export type IconPlace = 'grid' | 'rail';

/** The one icon copy the open app grew out of (or is shrinking back into); it hides meanwhile. */
export const hiddenIcon = createStore<{ app: AppId; place: IconPlace | null } | null>(null);

// Before an app zooms away, live content that animates badly (a web page) swaps itself for a
// still picture of itself. The zoom waits for those pictures, briefly.
const freezers = new Set<() => Promise<void>>();

export function registerFreezer(freeze: () => Promise<void>): () => void {
  freezers.add(freeze);
  return () => freezers.delete(freeze);
}

export function freezeApp(timeoutMs = 140): Promise<void> {
  if (!freezers.size) return Promise.resolve();
  const all = Promise.all([...freezers].map(f => f().catch(() => undefined))).then(() => undefined);
  return Promise.race([all, new Promise<void>(r => window.setTimeout(r, timeoutMs))]);
}

// Back navigation: apps push a handler while they show a nested view. The on-screen back buttons
// pop it, or close the app at its root.
const backStack: Array<() => void> = [];

export function pushBack(handler: () => void): () => void {
  backStack.push(handler);
  return () => {
    const i = backStack.lastIndexOf(handler);
    if (i >= 0) backStack.splice(i, 1);
  };
}

export function goBack() {
  const top = backStack[backStack.length - 1];
  if (top) top();
  else closeApp();
}
