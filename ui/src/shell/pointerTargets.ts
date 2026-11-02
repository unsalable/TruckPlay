// When the game plugin draws the pointer, it needs to know what is under it without asking us
// (asking would bring the UI's frame delay back). While the pointer is out, we keep it supplied
// with the targets on screen: highlight buttons (the disc morphs into a plate), lift icons (the
// icon takes over) and text fields (I-beam). Rects are page pixels, which are texture pixels.

import { sendToPlugin } from '../state/bridge';
import { pointer } from '../state/ui';

const KIND = { plate: 1, lift: 2, text: 3 } as const;
const TEXT = 'input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, [contenteditable="true"]';

export function startPointerTargets(): () => void {
  let rem = 1;
  const measure = () => {
    rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 1;
  };
  measure();
  window.addEventListener('tp-frame', measure);

  const radii = new WeakMap<Element, number>();
  const radius = (el: HTMLElement) => {
    let r = radii.get(el);
    if (r === undefined) {
      r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 10 * rem;
      radii.set(el, r);
    }
    return r;
  };

  let raf = 0;
  let layout = '';
  let sent = '';
  let sentAt = 0;
  let checkedAt = 0;

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (!pointer.get().visible) {
      layout = '';
      return;
    }
    const els = document.querySelectorAll<HTMLElement>(`[data-pointer], ${TEXT}`);
    const found: Array<{ el: HTMLElement; r: DOMRect; kind: number; radius?: number }> = [];
    let key = '';
    for (const el of els) {
      // An app icon's focus ring hugs the artwork, not the label under it.
      const art = el.dataset.pointer === 'lift' ? el.querySelector<HTMLElement>('.app-icon__art') : null;
      const r = (art ?? el).getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
      const kind = el.matches(TEXT)
        ? KIND.text
        : el.dataset.pointer === 'lift'
          ? KIND.lift
          : el.dataset.pointer === 'highlight' && r.width <= 140 * rem && r.height <= 90 * rem
            ? KIND.plate
            : 0;
      if (!kind) continue;
      // The plugin lets an icon's hover area reach a little past the artwork (as Pointer.tsx's overArt).
      found.push({ el, r, kind, radius: art ? r.width * 0.225 : undefined });
      key += `${kind}:${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)};`;
    }
    // Hit-testing every target is the costly part: only when the layout moved, at most 30 times a
    // second while it keeps moving, and once a second regardless (a plugin that just restarted).
    const moved = key !== layout;
    if (!moved && now - sentAt < 1000) return;
    if (moved && now - checkedAt < 33) return;
    layout = key;
    checkedAt = now;

    const list: number[] = [];
    for (const { el, r, kind, radius: fixed } of found) {
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!top || !(top === el || el.contains(top))) continue; // covered by an app, a sheet, a banner
      const q = (v: number) => Math.round(v * 2) / 2;
      list.push(q(r.left), q(r.top), q(r.width), q(r.height), q(Math.min(fixed ?? radius(el), r.height / 2)), kind);
    }
    const msg = list.join(',');
    if (msg === sent && now - sentAt < 1000) return;
    sent = msg;
    sentAt = now;
    sendToPlugin({ t: 'targets', d: 19 * rem, pad: 5 * rem, lean: 0.12, list });
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('tp-frame', measure);
  };
}
