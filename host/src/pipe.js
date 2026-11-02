// Client side of \\.\pipe\tirplay (the plugin is the server). Reconnects until the game runs.

import net from 'node:net';
import { EventEmitter } from 'node:events';

export class PluginLink extends EventEmitter {
  // TRUCKPLAY_PIPE: the test cab's plugin listens under its own name.
  constructor(name = `\\\\.\\pipe\\${process.env.TRUCKPLAY_PIPE || 'tirplay'}`) {
    super();
    this.name = name;
    this.socket = null;
    this.connected = false;
    this.inbox = '';
    this.closed = false;
    this.connect();
  }

  connect() {
    if (this.closed) return;
    const s = net.connect(this.name);
    s.setEncoding('utf8');
    s.on('connect', () => {
      this.socket = s;
      this.connected = true;
      this.inbox = '';
      this.emit('connected');
      this.send({ t: 'hello', host: '1.2.0' });
    });
    s.on('data', chunk => {
      this.inbox += chunk;
      let nl;
      while ((nl = this.inbox.indexOf('\n')) >= 0) {
        const line = this.inbox.slice(0, nl);
        this.inbox = this.inbox.slice(nl + 1);
        if (!line) continue;
        try {
          this.emit('message', JSON.parse(line));
        } catch {
          // a torn line from a restarting plugin; skip it
        }
      }
    });
    const retry = () => {
      if (this.connected) this.emit('disconnected');
      this.connected = false;
      this.socket = null;
      s.destroy();
      setTimeout(() => this.connect(), 1000);
    };
    s.on('error', retry);
    s.on('close', () => {
      if (this.socket === s) retry();
    });
  }

  send(msg) {
    if (this.connected && this.socket) this.socket.write(`${JSON.stringify(msg)}\n`);
  }

  close() {
    this.closed = true;
    this.socket?.destroy();
  }
}
