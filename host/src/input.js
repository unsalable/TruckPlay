// Turns the plugin's pointer and key messages into real input for the offscreen UI, so every
// button, drag and scroll behaves as if the screen were touched. Typing goes to the page that
// asked for the keyboard: TruckPlay's own UI, or a web page (YouTube's search, a site's form)
// inside the browser, whose text field reports itself through the webview preload.
//
// Pages in <webview>s are web contents of their own, and an offscreen window does not pass the
// mouse on to them. While one is on screen the UI hit-tests each pointer event (it knows what is
// on top: the page, or a bar or sheet over it) and `routed` delivers it to the page directly, in
// the page's own coordinates.

import { webContents } from 'electron';

const VK_KEYS = {
  0x08: 'Backspace',
  0x09: 'Tab',
  0x0d: 'Enter',
  0x1b: 'Escape',
  0x2e: 'Delete',
  0x25: 'Left',
  0x26: 'Up',
  0x27: 'Right',
  0x28: 'Down',
  0x24: 'Home',
  0x23: 'End',
};

export class InputInjector {
  /** getArea(): the part of the texture the UI occupies ({x,y,w,h}); the plugin's 0–1 pointer spans it.
   *  getScale(): how many window pixels the UI draws per texture pixel (the page is zoomed by as
   *  much, so its CSS pixels are texture pixels while events arrive in window pixels). */
  constructor(getContents, getArea, getScale = () => 1) {
    this.getContents = getContents;
    this.getArea = getArea;
    this.getScale = getScale;
    this.buttons = { left: false, right: false };
    this.last = { x: 0, y: 0 };
    this.lastClick = { t: 0, x: 0, y: 0, count: 0 };
    this.keyTarget = null; // a web page's contents while one of its text fields has the focus
    this.guest = null; // the web page under the pointer, while routing
    this.focused = null; // which contents last took a click (the UI's or a page's)
  }

  /** A page inside a webview gained (on) or lost the focus of a text field. */
  setKeyTarget(contents, on) {
    if (on) this.keyTarget = contents;
    else if (this.keyTarget === contents) this.keyTarget = null;
  }

  point(msg) {
    const a = this.getArea();
    const nx = Math.max(0, Math.min(1, msg.x ?? 0.5));
    const ny = Math.max(0, Math.min(1, msg.y ?? 0.5));
    return { x: Math.round(a.x + nx * (a.w - 1)), y: Math.round(a.y + ny * (a.h - 1)) };
  }

  /** Texture pixels to the window's (event) pixels. */
  win(p) {
    const s = this.getScale();
    return { x: Math.round(p.x * s), y: Math.round(p.y * s) };
  }

  modifiers() {
    const m = [];
    if (this.buttons.left) m.push('leftButtonDown');
    if (this.buttons.right) m.push('rightButtonDown');
    return m;
  }

  pointer(msg) {
    const wc = this.getContents();
    if (!wc || wc.isDestroyed()) return;
    const at = this.point(msg);
    this.last = at;
    const p = this.win(at);
    const button = msg.b === 2 ? 'right' : 'left';
    switch (msg.act) {
      case 'enter':
        wc.sendInputEvent({ type: 'mouseEnter', ...p });
        wc.sendInputEvent({ type: 'mouseMove', ...p });
        break;
      case 'move':
        wc.sendInputEvent({ type: 'mouseMove', ...p, modifiers: this.modifiers() });
        break;
      case 'down': {
        if (this.focused && this.focused !== wc) {
          wc.focus(); // a click on TruckPlay itself after one in a page
          this.focused = wc;
        }
        const now = Date.now();
        const near = Math.hypot(at.x - this.lastClick.x, at.y - this.lastClick.y) < 12;
        const count = now - this.lastClick.t < 400 && near ? this.lastClick.count + 1 : 1;
        this.lastClick = { t: now, ...at, count };
        this.buttons[button] = true;
        wc.sendInputEvent({ type: 'mouseDown', ...p, button, clickCount: count, modifiers: this.modifiers() });
        break;
      }
      case 'up':
        this.buttons[button] = false;
        wc.sendInputEvent({ type: 'mouseUp', ...p, button, clickCount: this.lastClick.count || 1, modifiers: this.modifiers() });
        break;
      case 'wheel':
        // Windows wheel: +120 per notch away from the user, which scrolls content up.
        wc.sendInputEvent({ type: 'mouseWheel', ...p, deltaX: 0, deltaY: msg.dy ?? 0, canScroll: true });
        break;
      case 'leave':
        if (this.buttons.left) wc.sendInputEvent({ type: 'mouseUp', ...p, button: 'left', clickCount: 1 });
        if (this.buttons.right) wc.sendInputEvent({ type: 'mouseUp', ...p, button: 'right', clickCount: 1 });
        this.buttons = { left: false, right: false };
        wc.sendInputEvent({ type: 'mouseLeave', ...p });
        break;
      default:
        break;
    }
  }

  /** A pointer event the UI routed: target 'ui', or a page's web contents id with its offset. */
  routed(msg) {
    const guest = typeof msg.target === 'number' ? webContents.fromId(msg.target) : null;
    if (!guest || guest.isDestroyed()) {
      this.leaveGuest(msg);
      this.pointer(msg);
      return;
    }
    const p = this.point(msg);
    const at = this.win({ x: p.x - (msg.ox ?? 0), y: p.y - (msg.oy ?? 0) });
    this.last = p;
    if (this.guest !== guest) {
      this.leaveGuest(msg);
      const ui = this.getContents();
      if (ui && !ui.isDestroyed()) ui.sendInputEvent({ type: 'mouseLeave', ...this.win(p) });
      this.guest = guest;
      guest.sendInputEvent({ type: 'mouseEnter', ...at });
    }
    const button = msg.b === 2 ? 'right' : 'left';
    switch (msg.act) {
      case 'enter':
      case 'move':
        guest.sendInputEvent({ type: 'mouseMove', ...at, modifiers: this.modifiers() });
        break;
      case 'down': {
        if (this.focused !== guest) {
          guest.focus();
          this.focused = guest;
        }
        const now = Date.now();
        const near = Math.hypot(p.x - this.lastClick.x, p.y - this.lastClick.y) < 12;
        const count = now - this.lastClick.t < 400 && near ? this.lastClick.count + 1 : 1;
        this.lastClick = { t: now, ...p, count };
        this.buttons[button] = true;
        guest.sendInputEvent({ type: 'mouseDown', ...at, button, clickCount: count, modifiers: this.modifiers() });
        break;
      }
      case 'up':
        this.buttons[button] = false;
        guest.sendInputEvent({ type: 'mouseUp', ...at, button, clickCount: this.lastClick.count || 1, modifiers: this.modifiers() });
        break;
      case 'wheel':
        guest.sendInputEvent({ type: 'mouseWheel', ...at, deltaX: 0, deltaY: msg.dy ?? 0, canScroll: true });
        break;
      case 'leave':
        this.leaveGuest(msg);
        break;
      default:
        break;
    }
  }

  /** The pointer left the page it was over (onto TruckPlay's own UI, or off the screen). */
  leaveGuest(msg = null) {
    const g = this.guest;
    this.guest = null;
    if (!g || g.isDestroyed()) return;
    const p = this.win(msg ? this.point(msg) : this.last);
    if (this.buttons.left) g.sendInputEvent({ type: 'mouseUp', x: 0, y: 0, button: 'left', clickCount: 1 });
    if (this.buttons.right) g.sendInputEvent({ type: 'mouseUp', x: 0, y: 0, button: 'right', clickCount: 1 });
    this.buttons = { left: false, right: false };
    g.sendInputEvent({ type: 'mouseLeave', x: p.x, y: p.y });
  }

  key(msg) {
    const target = this.keyTarget && !this.keyTarget.isDestroyed() ? this.keyTarget : this.getContents();
    if (!target || target.isDestroyed()) return;
    if (msg.act === 'char' && msg.ch) {
      target.sendInputEvent({ type: 'char', keyCode: msg.ch });
    } else if (msg.act === 'down') {
      const keyCode = VK_KEYS[msg.vk];
      if (!keyCode) return;
      target.sendInputEvent({ type: 'keyDown', keyCode });
      // Enter also needs its character for forms to submit (a search box, for one).
      if (keyCode === 'Enter') target.sendInputEvent({ type: 'char', keyCode: '\r' });
      target.sendInputEvent({ type: 'keyUp', keyCode });
    }
  }
}
