// Bridge between the UI and the host: window.tirplay (see ui/src/state/bridge.ts).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tirplay', {
  on(channel, cb) {
    const handler = (_event, msg) => cb(msg);
    ipcRenderer.on(`tp:${channel}`, handler);
    return () => ipcRenderer.removeListener(`tp:${channel}`, handler);
  },
  send(msg) {
    ipcRenderer.send('tp:send', msg);
  },
  invoke(channel, ...args) {
    return ipcRenderer.invoke('tp:invoke', channel, ...args);
  },
  /** Where a pointer event goes while a web page is on screen (see host/src/input.js). */
  route(msg) {
    ipcRenderer.send('tp:route', msg);
  },
  info: {
    version: '1.2.0',
    mode: process.argv.includes('--tp-window') ? 'window' : 'osr',
    demo: process.argv.includes('--tp-demo'),
  },
});
