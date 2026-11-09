// TruckPlay keeps itself up to date from its GitHub releases (release.js). The newest release's
// installer comes down in the background, gently while the game runs so the drive (or a convoy)
// keeps the line, is held to the SHA-256 GitHub lists for it, and runs hidden (-Update) when this
// host leaves after the game has closed. The installer puts the new app, plugin and mod in place and
// keeps the settings and map data. Only an installed TruckPlay updates itself: a developer build
// (electron .) never does, unless the test cab points it at a local feed.
//
// Its folder (%LOCALAPPDATA%\TruckPlay-updates): state.json (this host's), the downloaded installer,
// and the installer's update.log and result.json (installer/, run with -Update).

import { net } from 'electron';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { LATEST, compareVersions, pickRelease } from './release.js';

const MINUTE = 60_000;
const EVERY = 6 * 60 * MINUTE; // a host running that long looks again
const RETRY = 30 * MINUTE; // after a look or download that failed
// While the game runs about 10 Mbit/s: a download never crowds the drive or a convoy out.
const GENTLE = 1.25 * 1024 * 1024;
const BURST = 256 * 1024;
const TRIES = 3; // installs of one version before TruckPlay waits for the next release

const sleep = ms => new Promise(r => setTimeout(r, ms));
const mb = n => `${(n / 1048576).toFixed(1)} MB`;
const failure = (kind, message) => Object.assign(new Error(message), { kind });

function gameRunning() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq eurotrucks2.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    return /eurotrucks2\.exe/i.test(out);
  } catch {
    return false;
  }
}

async function hashInto(file, hash) {
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) hash.update(chunk);
}

export class Updater extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.dir          downloads, state and the installer's log
   * @param {string} o.version      this TruckPlay's version
   * @param {boolean} o.enabled     whether this host updates itself at all
   * @param {boolean} o.window      the trial window (an update goes in when it closes, not the game)
   * @param {string} [o.feed]       the releases answer to read (the test cab's local feed); GitHub's otherwise
   * @param {string} [o.installDir] the installed TruckPlay's folder, for the installer to update in place
   * @param {number} o.firstLook    ms after start before the first look (the game is still loading)
   * @param {() => boolean} o.gameBusy  the game is running: downloads stay gentle
   * @param {(...a: string[]) => void} o.log
   */
  constructor(o) {
    super();
    this.o = o;
    this.testing = Boolean(o.feed);
    this.saved = { auto: true, etag: '', release: null, tries: {}, gameDir: '', ...this.read('state.json') };
    if (!this.saved.tries || typeof this.saved.tries !== 'object') this.saved.tries = {};
    this.status = { state: o.enabled ? 'idle' : 'off', current: o.version };
    this.ready = null; // {version, file}: a verified installer on disk
    this.manual = false; // the driver asked (Settings > Check): honoured with automatic updates off too
    this.busy = null; // the look (and download) under way
    this.cancel = false; // the host is leaving: a download under way stops
    this.timer = null;
  }

  file(name) {
    return path.join(this.o.dir, name);
  }

  read(name) {
    try {
      return JSON.parse(fs.readFileSync(this.file(name), 'utf8').replace(/^﻿/, ''));
    } catch {
      return null;
    }
  }

  save() {
    try {
      fs.mkdirSync(this.o.dir, { recursive: true });
      fs.writeFileSync(this.file('state.json'), JSON.stringify(this.saved, null, 1));
    } catch (e) {
      this.o.log(`update: ${e.message}`);
    }
  }

  set(patch) {
    this.status = { ...this.status, ...patch };
    this.emit('state', this.snapshot());
  }

  /** For the UI (Settings > Updates). */
  snapshot() {
    return { ...this.status, auto: this.saved.auto, when: this.o.window ? 'window' : 'game' };
  }

  wanted() {
    return this.saved.auto || this.manual;
  }

  start() {
    if (!this.o.enabled) return;
    try {
      fs.mkdirSync(this.o.dir, { recursive: true });
    } catch (e) {
      this.o.log(`update: ${e.message}`);
    }
    this.lookBack();
    this.schedule(this.o.firstLook);
  }

  schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(false), ms);
  }

  /** What the last update did (the installer's result.json). */
  lookBack() {
    const r = this.read('result.json');
    if (!r?.version) return;
    if (r.ok && compareVersions(r.version, this.o.version) === 0) {
      if (r.shown) return;
      try {
        fs.writeFileSync(this.file('result.json'), JSON.stringify({ ...r, shown: true }));
      } catch {
        // said again next start, no harm
      }
      this.o.log(`updated to ${r.version}`);
      this.emit('updated', r.version);
      this.tidy([]);
    } else if (!r.ok && compareVersions(r.version, this.o.version) >= 0) {
      if (r.note === 'game running') {
        // The game was started again before the update could begin: that was no try.
        this.saved.tries[r.version] = Math.max(0, (this.saved.tries[r.version] ?? 1) - 1);
        this.save();
        this.o.log(`update to ${r.version} waited for the game`);
        return;
      }
      this.o.log(`update to ${r.version} did not finish: ${r.note ?? 'no reason given'}`);
      this.set({ state: 'error', error: 'install', latest: r.version });
    }
  }

  setGameDir(dir) {
    if (typeof dir !== 'string' || !dir || dir === this.saved.gameDir) return;
    this.saved.gameDir = dir;
    this.save();
  }

  setAuto(on) {
    if (!this.o.enabled || this.saved.auto === on) return;
    this.saved.auto = on;
    this.save();
    this.o.log(`automatic updates ${on ? 'on' : 'off'}`);
    if (on) {
      this.schedule(5000);
    } else {
      // Off: a download under way stops (what came down stays for later) and nothing installs,
      // until the driver presses Check.
      this.manual = false;
    }
    this.set({});
  }

  /** Looks for a newer release and fetches it. `manual`: the driver pressed Check. */
  check(manual = false) {
    if (!this.o.enabled) return Promise.resolve();
    if (manual) this.manual = true;
    if (this.busy) return this.busy;
    if (!this.wanted()) {
      this.schedule(EVERY);
      return Promise.resolve();
    }
    this.busy = this.look().finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  async look() {
    clearTimeout(this.timer);
    const was = this.status.state;
    if (was !== 'ready' && was !== 'downloading') this.set({ state: 'checking' });
    let release;
    try {
      release = await this.latest();
    } catch (e) {
      this.o.log(`update check: ${e.message}`);
      // An installer already here still goes in; only say so when there is none.
      if (this.ready) this.set({ state: 'ready' });
      else this.set({ state: 'error', error: 'network', checkedAt: Date.now() });
      this.schedule(RETRY);
      return;
    }
    if (!release || compareVersions(release.version, this.o.version) <= 0) {
      if (was !== 'current') this.o.log(`update check: up to date (newest release ${release?.version ?? 'none'})`);
      this.ready = null;
      this.set({ state: 'current', latest: release?.version, error: undefined, checkedAt: Date.now() });
      this.tidy([]);
      this.schedule(EVERY);
      return;
    }
    this.set({ latest: release.version, checkedAt: Date.now() });
    if ((this.saved.tries[release.version] ?? 0) >= TRIES) {
      this.o.log(`update ${release.version}: tried ${TRIES} times, waiting for the next release`);
      this.set({ state: 'error', error: 'stuck' });
      this.schedule(EVERY);
      return;
    }
    try {
      await this.fetchInstaller(release);
      this.schedule(EVERY);
    } catch (e) {
      if (e.kind === 'cancel') {
        this.o.log(`update ${release.version}: download stopped`);
        this.ready = null;
        this.set({ state: 'idle', progress: undefined });
        return;
      }
      this.o.log(`update ${release.version}: ${e.message}`);
      if (this.ready) this.set({ state: 'ready', latest: this.ready.version, progress: 1 });
      else this.set({ state: 'error', error: e.kind === 'verify' ? 'verify' : 'network' });
      this.schedule(RETRY);
    }
  }

  /** The newest release, from GitHub (a 304 answers from what the last look kept). */
  async latest() {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': `TruckPlay/${this.o.version}` };
    if (this.saved.etag && this.saved.release) headers['If-None-Match'] = this.saved.etag;
    const res = await net.fetch(this.o.feed || LATEST, { headers, cache: 'no-store' });
    if (res.status === 304 && this.saved.release) return this.saved.release;
    if (res.status === 404) return null; // no release yet
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const release = pickRelease(json, url => this.testing && /^http:\/\/127\.0\.0\.1:\d+\//.test(url));
    if (!release) this.o.log(`update check: release ${json?.tag_name ?? '?'} offers no installer TruckPlay can take`);
    this.saved.etag = res.headers.get('etag') ?? '';
    this.saved.release = release;
    this.save();
    return release;
  }

  /** Downloads (or resumes, or finds on disk) the release's installer and checks it. */
  async fetchInstaller(rel) {
    const final = this.file(`TruckPlay-Kurulum-${rel.version}.exe`);
    const part = `${final}.part`;
    // An older installer that is ready stays until this one is: it still goes in meanwhile.
    this.tidy([final, part, this.ready?.file]);
    if (!this.wanted()) throw failure('cancel', 'not wanted');
    if (fs.existsSync(final)) {
      const hash = crypto.createHash('sha256');
      if (fs.statSync(final).size === rel.size) await hashInto(final, hash);
      if (hash.digest('hex') === rel.sha256) return this.isReady(rel, final);
      fs.rmSync(final, { force: true });
    }

    let have = 0;
    try {
      have = fs.statSync(part).size;
    } catch {
      // nothing yet
    }
    if (have >= rel.size) {
      fs.rmSync(part, { force: true });
      have = 0;
    }
    let hash = crypto.createHash('sha256');
    if (have > 0) await hashInto(part, hash);
    const headers = { 'User-Agent': `TruckPlay/${this.o.version}` };
    if (have > 0) headers.Range = `bytes=${have}-`;
    const res = await net.fetch(rel.url, { headers, cache: 'no-store' });
    if (res.status === 200 && have > 0) {
      // The server would not resume: from the start.
      have = 0;
      hash = crypto.createHash('sha256');
    } else if (res.status !== 200 && res.status !== 206) {
      throw failure('network', `download: HTTP ${res.status}`);
    }
    this.o.log(`update ${rel.version}: downloading ${mb(rel.size)}${have ? `, from ${mb(have)}` : ''}`);
    this.set({ state: 'downloading', progress: have / rel.size, error: undefined });

    const out = await fs.promises.open(part, have > 0 ? 'a' : 'w');
    const reader = res.body.getReader();
    let got = have;
    let shown = 0;
    let tokens = BURST;
    let last = Date.now();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        await out.write(value);
        got += value.length;
        if (got > rel.size) throw failure('verify', 'more bytes than the release lists');
        if (this.cancel || !this.wanted()) throw failure('cancel', 'stopped');
        const now = Date.now();
        if (now - shown > 400) {
          shown = now;
          this.set({ progress: got / rel.size });
        }
        if (this.o.gameBusy()) {
          tokens = Math.min(BURST, tokens + ((now - last) / 1000) * GENTLE) - value.length;
          last = now;
          if (tokens < 0) await sleep((-tokens / GENTLE) * 1000);
        } else {
          tokens = BURST;
          last = now;
        }
      }
    } catch (e) {
      reader.cancel().catch(() => {});
      throw e.kind ? e : failure('network', `download: ${e.message}`);
    } finally {
      await out.close();
    }
    if (got !== rel.size) throw failure('network', `download stopped at ${mb(got)} of ${mb(rel.size)}`);
    const sum = hash.digest('hex');
    if (sum !== rel.sha256) {
      fs.rmSync(part, { force: true });
      throw failure('verify', `SHA-256 ${sum} is not the release's ${rel.sha256}`);
    }
    fs.renameSync(part, final);
    return this.isReady(rel, final);
  }

  isReady(rel, file) {
    const fresh = this.ready?.version !== rel.version;
    this.ready = { version: rel.version, file };
    this.tidy([file]);
    this.set({ state: 'ready', latest: rel.version, progress: 1, error: undefined });
    if (fresh) {
      this.o.log(`update ${rel.version}: ready, checked against its SHA-256`);
      this.emit('event', { id: 'truckplay.update.ready', a: { version: rel.version, when: this.o.window ? 'window' : 'game' } });
    }
  }

  /** Lets a download under way finish (the game has closed: full speed now), for at most `ms`. */
  async settle(ms) {
    if (!this.busy) return;
    this.o.log('update: finishing the download first');
    await Promise.race([this.busy, sleep(ms)]);
  }

  /** As this host leaves: runs the ready installer, hidden. True when it started. */
  installNow(reason) {
    const r = this.ready;
    if (!this.o.enabled || !r || !this.wanted() || !fs.existsSync(r.file)) return false;
    if (gameRunning()) {
      this.o.log(`update ${r.version}: the game is running, next time`);
      return false;
    }
    const tries = (this.saved.tries[r.version] ?? 0) + 1;
    if (tries > TRIES) return false;
    this.saved.tries[r.version] = tries;
    this.save();
    const args = ['-Update', this.o.dir];
    if (this.o.installDir) args.push('-InstallDir', this.o.installDir);
    if (this.saved.gameDir) args.push('-GameDir', this.saved.gameDir);
    try {
      // Detached: it outlives this host, which it is about to replace.
      const child = spawn(r.file, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', e => this.o.log(`update ${r.version}: ${e.message}`));
      child.unref();
      this.o.log(`update ${r.version}: installing (${reason}, try ${tries} of ${TRIES})`);
      return true;
    } catch (e) {
      this.o.log(`update ${r.version}: the installer did not start: ${e.message}`);
      return false;
    }
  }

  /** Removes downloaded installers (and partial downloads) other than those in `keep`. */
  tidy(keep) {
    let names = [];
    try {
      names = fs.readdirSync(this.o.dir);
    } catch {
      return;
    }
    for (const n of names) {
      if (!/^TruckPlay-Kurulum-[\d.]+\.exe(\.part)?$/.test(n)) continue;
      const f = this.file(n);
      if (keep.includes(f)) continue;
      try {
        fs.rmSync(f, { force: true });
      } catch {
        // still in use: next time
      }
    }
  }

  close() {
    clearTimeout(this.timer);
    this.cancel = true;
  }
}
