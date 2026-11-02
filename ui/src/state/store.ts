import { useSyncExternalStore, useRef } from 'react';

// A tiny observable store. Telemetry arrives 20 times a second, so components subscribe to the
// slice they render and skip renders when that slice is unchanged.

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  patch(partial: Partial<T>): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const store: Store<T> = {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? (next as (p: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      listeners.forEach(l => l());
    },
    patch(partial) {
      store.set({ ...state, ...partial });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return store;
}

export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(k => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function useStore<T, S>(store: Store<T>, select: (s: T) => S, equal: (a: S, b: S) => boolean = shallowEqual): S {
  const last = useRef<{ value: S } | null>(null);
  const getSnapshot = () => {
    const next = select(store.get());
    if (last.current && equal(last.current.value, next)) return last.current.value;
    last.current = { value: next };
    return next;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
