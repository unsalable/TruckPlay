// What plays elsewhere on the PC — Spotify, Apple Music, a browser tab — through truckplay-media.exe
// (Windows media sessions, plugin/media/media.cpp). Keeps the latest state so a reloaded UI can
// catch up, and passes the UI's commands back.

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';

export class MediaSessions extends EventEmitter {
  constructor(exe, log) {
    super();
    this.exe = exe;
    this.log = log;
    this.proc = null;
    this.closed = false;
    this.state = { t: 'sessions', current: '', list: [] };
    this.art = new Map(); // session id → art message
    this.apps = new Map(); // app id → app message
    this.launches = []; // resolvers waiting for the helper's {"t":"launched"}
    this.start();
  }

  start() {
    if (this.closed) return;
    if (!fs.existsSync(this.exe)) {
      this.log(`media: ${this.exe} missing (scripts\\build-plugin.cmd builds it)`);
      return;
    }
    const proc = spawn(this.exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    this.proc = proc;
    setTimeout(() => this.sendVolume(), 200); // a restarted helper gets the level again
    let inbox = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', chunk => {
      inbox += chunk;
      let nl;
      while ((nl = inbox.indexOf('\n')) >= 0) {
        const line = inbox.slice(0, nl).trim();
        inbox = inbox.slice(nl + 1);
        if (!line) continue;
        try {
          this.take(JSON.parse(line));
        } catch {
          // a torn line from a dying helper
        }
      }
    });
    proc.on('error', e => this.log(`media: ${e.message}`));
    proc.on('exit', code => {
      if (this.proc === proc) this.proc = null;
      if (!this.closed) {
        this.log(`media: helper exited (${code}), restarting`);
        setTimeout(() => this.start(), 3000);
      }
    });
  }

  take(msg) {
    if (msg.t === 'launched') {
      this.log(`media: ${msg.app} ${msg.ok ? `started (${msg.how})` : 'not found'}`);
      for (const done of this.launches.splice(0)) done(msg);
      return;
    }
    if (msg.t === 'volumes') {
      this.log(`media: audio sessions ${JSON.stringify(msg.list)}`);
      return;
    }
    if (msg.t === 'sessions') {
      this.state = msg;
      const alive = new Set(msg.list.map(s => s.id));
      for (const id of this.art.keys()) if (!alive.has(id)) this.art.delete(id);
    } else if (msg.t === 'art') {
      this.art.set(msg.id, msg);
    } else if (msg.t === 'app') {
      this.apps.set(msg.app, msg);
    }
    this.emit('message', msg);
  }

  /** Everything a fresh UI needs, in the order the helper would have sent it. */
  snapshot() {
    return [...this.apps.values(), this.state, ...this.art.values()];
  }

  /**
   * One volume for everything TruckPlay plays (its own processes) and for the music apps it
   * controls (Spotify…): the Windows mixer levels of their audio sessions.
   */
  volume(level, apps = []) {
    this.wantVolume = { level: Math.max(0, Math.min(1, Number(level) || 0)), apps: apps.map(String) };
    this.sendVolume();
  }

  sendVolume() {
    if (!this.wantVolume || !this.proc?.stdin.writable) return;
    const { level, apps } = this.wantVolume;
    this.proc.stdin.write(`${JSON.stringify({ t: 'volume', level, pids: [process.pid], apps })}\n`);
  }

  /** Logs every audio session with its process and level (diagnostics). */
  reportVolumes() {
    if (this.proc?.stdin.writable) this.proc.stdin.write('{"t":"volumes"}\n');
  }

  command(id, cmd, v = 0) {
    if (!this.proc?.stdin.writable) return;
    this.proc.stdin.write(`${JSON.stringify({ t: 'cmd', id: String(id), cmd: String(cmd), v: Number(v) || 0 })}\n`);
  }

  /**
   * Starts a music app (only 'spotify' so far) minimized, so nothing comes in front of the game,
   * and has it play on. Resolves with the helper's answer: {ok, how}.
   */
  launch(app) {
    if (!this.proc?.stdin.writable) return Promise.resolve({ ok: false, how: 'none' });
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.launches = this.launches.filter(r => r !== done);
        resolve({ ok: false, how: 'none' });
      }, 8000);
      const done = msg => {
        clearTimeout(timer);
        resolve({ ok: !!msg.ok, how: String(msg.how ?? '') });
      };
      this.launches.push(done);
      this.proc.stdin.write(`${JSON.stringify({ t: 'launch', app: String(app) })}\n`);
    });
  }

  close() {
    this.closed = true;
    try {
      this.proc?.stdin.end();
      this.proc?.kill();
    } catch {
      // already gone
    }
  }
}
