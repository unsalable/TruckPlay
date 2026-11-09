// TruckPlay's own updates (host/src/updater.js): what Settings > Updates shows. The host looks at
// TruckPlay's GitHub releases, fetches a newer one in the background and installs it once the game
// has closed; this side only shows where that stands and passes on the driver's choices.

import { host } from './bridge';
import { createStore } from './store';

export interface UpdateInfo {
  /** off: this TruckPlay does not update itself (a developer build). */
  state: 'off' | 'idle' | 'checking' | 'current' | 'downloading' | 'ready' | 'error';
  /** This TruckPlay's version, and the newest release's. */
  current: string;
  latest?: string;
  /** 0–1 while downloading. */
  progress?: number;
  /** When the host last looked (ms since 1970). */
  checkedAt?: number;
  error?: 'network' | 'verify' | 'install' | 'stuck';
  /** Whether TruckPlay looks and installs by itself. */
  auto: boolean;
  /** When a ready update goes in: once the game closes, or (trial window) once the window does. */
  when: 'game' | 'window';
}

export const update = createStore<UpdateInfo>({ state: 'off', current: host?.info.version ?? '', auto: true, when: 'game' });

const take = (u: UpdateInfo | null | undefined) => {
  if (u && typeof u.state === 'string') update.set(u);
};

export function startUpdates() {
  if (!host) return;
  host.on('update', take);
  void host
    .invoke('update:state')
    .then(take)
    .catch(() => {});
}

export function setAutoUpdate(on: boolean) {
  update.patch({ auto: on });
  void host
    ?.invoke('update:auto', on)
    .then(take)
    .catch(() => {});
}

export function checkForUpdate() {
  void host
    ?.invoke('update:check')
    .then(take)
    .catch(() => {});
}
