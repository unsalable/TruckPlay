// Split screen (the Split app): the cab screen keeps TruckPlay (Maps opens there), and the F3 route
// advisor's panel gets a part of its own beside it in the same page, where YouTube plays. The host
// widens the page by that part and tells the plugin where each part is (host/src/main.js `split`);
// the YouTube page moves there without reloading (apps/browser/YouTubeLayer.tsx). Opening YouTube
// on the cab screen, or the Split app again, ends it.

import { host, sendToPlugin } from './bridge';
import { emitGameEvent } from './telemetry';
import { SPLIT_PANEL, nav, openApp, settings, split } from './ui';
import { startYouTube, youTubeVideoOnly } from '../apps/browser/youtubePage';

export function setSplit(on: boolean) {
  if (split.get().on === on) return;
  split.set({ on });
  void host?.invoke('split:set', on ? { on: true, ...SPLIT_PANEL } : { on: false }).catch(() => {});
  // The F3 panel shows TruckPlay while split, whatever the setting says; after, as the setting says.
  sendToPlugin({ t: 'advisor', on: on || settings.get().advisorScreen });
  if (on) {
    startYouTube();
    if (nav.get().app !== 'maps') openApp('maps', null);
    // Just the video in the panel.
    youTubeVideoOnly(true);
  } else {
    youTubeVideoOnly(false);
  }
  emitGameEvent({ id: 'truckplay.split', a: { on } });
}

export const toggleSplit = () => setSplit(!split.get().on);
