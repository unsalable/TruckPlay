// One volume for everything that plays: TruckPlay's own sound (radio, music, YouTube, the
// browser, YouTube Music) and the music app it controls on the PC (Spotify…). The host sets the
// Windows mixer level of their audio sessions, so the level is real, not a page trick.

import { host } from './bridge';
import { pc, pcSessions } from './pcMedia';
import { settings } from './ui';

/** Exe names of the PC music apps the volume also reaches. */
function musicApps(): string[] {
  const apps = new Set<string>(['spotify.exe']);
  for (const s of pcSessions()) {
    const id = s.app.toLowerCase();
    if (id.endsWith('.exe')) apps.add(id);
    else if (id.includes('spotify')) apps.add('spotify.exe');
  }
  return [...apps];
}

let sent = '';
function push() {
  if (!host) return;
  const level = settings.get().volume;
  const apps = musicApps();
  const key = `${level.toFixed(3)}|${apps.join()}`;
  if (key === sent) return;
  sent = key;
  void host.invoke('volume:set', level, apps).catch(() => {});
}

export function setVolume(level: number) {
  settings.patch({ volume: Math.round(Math.max(0, Math.min(1, level)) * 100) / 100 });
}

export function startVolume() {
  push();
  settings.subscribe(push);
  pc.subscribe(push);
}
