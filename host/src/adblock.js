// Ads and trackers kept out of the pages in the browser, YouTube and YouTube Music: EasyList,
// EasyPrivacy and uBlock Origin's own lists (with their scriptlets), run by Ghostery's filter
// engine for Electron. uBlock Origin Lite itself cannot run here: it is built on a browser API
// Electron does not have. The compiled engine is kept on disk and rebuilt from fresh lists once a
// week. YouTube gets extra help in webview-preload.cjs.

import fs from 'node:fs/promises';
import path from 'node:path';
import { ElectronBlocker } from '@ghostery/adblocker-electron';

const WEEK = 7 * 24 * 3600 * 1000;

export class AdBlock {
  constructor(session, dir, log) {
    this.session = session;
    this.file = path.join(dir, 'adblock-engine.bin');
    this.log = log;
    this.on = false;
    this.blocker = null;
    this.loading = null;
    this.active = false;
  }

  async engine() {
    if (this.blocker) return this.blocker;
    this.loading ??= (async () => {
      try {
        const stat = await fs.stat(this.file);
        if (Date.now() - stat.mtimeMs > WEEK) await fs.rm(this.file, { force: true });
      } catch {
        // no cache yet
      }
      const started = Date.now();
      const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(globalThis.fetch, {
        path: this.file,
        read: fs.readFile,
        write: fs.writeFile,
      });
      this.log(`adblock: engine ready in ${Date.now() - started} ms`);
      return blocker;
    })();
    try {
      this.blocker = await this.loading;
    } catch (e) {
      this.log(`adblock: lists unavailable (${e.message})`);
    } finally {
      this.loading = null;
    }
    return this.blocker;
  }

  /** Turns blocking on or off for the pages' session. */
  async set(on) {
    this.on = Boolean(on);
    if (this.on) {
      const blocker = await this.engine();
      if (blocker && this.on && !this.active) {
        blocker.enableBlockingInSession(this.session);
        this.active = true;
        this.log('adblock: on');
      }
    } else if (this.active && this.blocker) {
      try {
        this.blocker.disableBlockingInSession(this.session);
      } catch (e) {
        this.log(`adblock: off failed (${e.message})`);
      }
      this.active = false;
      this.log('adblock: off');
    }
  }
}
