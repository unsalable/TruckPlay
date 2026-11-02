// iPadOS-style pointer. The mouse is the only input in the cab, so the pointer is part of the
// design, following iPadOS's three effects:
//   • highlight — over a small button the disc morphs into a soft plate around it;
//   • hover     — over large targets (cards, rows) the disc stays and the target brightens;
//   • lift      — over app icons the disc hands off to the icon, which rises to meet it.
// In the game the plugin draws the disc and plate itself, on the very frame the mouse moved; the
// UI then only keeps the targets' own reactions (hover, lift) and tells the plugin where they are.
// Without the plugin (desktop window, browser) the UI draws it, sitting exactly on the mouse.

import { motion, useMotionValue, useSpring } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { pointer } from '../state/ui';
import { spring } from '../design/motion';
import { startPointerTargets } from './pointerTargets';
import './pointer.css';

export function Pointer() {
  const visible = useStore(pointer, p => p.visible);
  const native = useStore(pointer, p => p.native);
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const w = useMotionValue(0);
  const h = useMotionValue(0);
  const r = useMotionValue(0);
  const o = useMotionValue(1);
  const sx = useSpring(x, spring.pointer);
  const sy = useSpring(y, spring.pointer);
  const sw = useSpring(w, spring.pointer);
  const sh = useSpring(h, spring.pointer);
  const sr = useSpring(r, spring.pointer);
  const so = useSpring(o, spring.snappy);
  const press = useSpring(1, spring.snappy);
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => (native ? startPointerTargets() : undefined), [native]);

  useEffect(() => {
    let rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 1;
    let last = { x: -100, y: -100 };
    let lifted: HTMLElement | null = null;
    let hovered: HTMLElement | null = null;
    // After leaving a plate the disc springs back for a moment; otherwise it is glued to the mouse.
    let morphUntil = 0;

    const setClass = (prev: HTMLElement | null, next: HTMLElement | null, cls: string) => {
      if (prev === next) return next;
      prev?.classList.remove(cls);
      next?.classList.add(cls);
      return next;
    };

    const place = (vx: number, vy: number, vw: number, vh: number, vr: number, animate: boolean) => {
      x.set(vx);
      y.set(vy);
      w.set(vw);
      h.set(vh);
      r.set(vr);
      if (!animate) {
        sx.jump(vx);
        sy.jump(vy);
        sw.jump(vw);
        sh.jump(vh);
        sr.jump(vr);
      }
    };

    const disc = (cx: number, cy: number) => {
      const d = 19 * rem;
      place(cx - d / 2, cy - d / 2, d, d, d / 2, performance.now() < morphUntil);
    };

    let onPlate = false;
    const ring = (on: boolean) => el.current?.classList.toggle('pointer--ring', on);
    // An app icon counts as hovered over its artwork (plus a little), not its whole button with the
    // label: the same area the plugin's focus ring answers to.
    const overArt = (el: HTMLElement, x: number, y: number) => {
      const a = (el.querySelector('.app-icon__art') ?? el).getBoundingClientRect();
      const m = 4 * rem;
      return x >= a.left - m && x <= a.right + m && y >= a.top - m && y <= a.bottom + m;
    };
    const update = () => {
      const { x: cx, y: cy } = last;
      let target = (document.elementFromPoint(cx, cy) as HTMLElement | null)?.closest<HTMLElement>('[data-pointer]') ?? null;
      if (target?.dataset.pointer === 'lift' && !overArt(target, cx, cy)) target = null;
      const kind = target?.dataset.pointer;
      const b = target?.getBoundingClientRect();
      const small = b && b.width <= 140 * rem && b.height <= 90 * rem;
      if (target && kind === 'lift') {
        // App icon: a focus ring hugs the artwork while the icon lifts toward the pointer.
        const art = target.querySelector('.app-icon__art')?.getBoundingClientRect() ?? b!;
        const pad = 3 * rem;
        place(art.left - pad, art.top - pad, art.width + pad * 2, art.height + pad * 2, art.width * 0.225 + pad, true);
        onPlate = true;
        ring(true);
        o.set(1);
        lifted = setClass(lifted, target, 'is-lifted');
        hovered = setClass(hovered, null, 'is-hovered');
      } else if (target && b && kind === 'highlight' && small) {
        ring(false);
        const pad = 5 * rem;
        const radius = parseFloat(getComputedStyle(target).borderRadius) || 10 * rem;
        const lean = 0.12; // magnetism: the plate leans toward the pointer
        place(
          b.left - pad + (cx - (b.left + b.width / 2)) * lean,
          b.top - pad + (cy - (b.top + b.height / 2)) * lean,
          b.width + pad * 2,
          b.height + pad * 2,
          Math.min(radius + pad, (b.height + pad * 2) / 2),
          true,
        );
        onPlate = true;
        o.set(1);
        lifted = setClass(lifted, null, 'is-lifted');
        hovered = setClass(hovered, null, 'is-hovered');
      } else {
        if (onPlate) morphUntil = performance.now() + 220;
        onPlate = false;
        ring(false);
        lifted = setClass(lifted, null, 'is-lifted');
        hovered = setClass(hovered, target && kind === 'highlight' ? target : null, 'is-hovered');
        o.set(1);
        disc(cx, cy);
      }
    };

    const move = (e: PointerEvent) => {
      if (!pointer.get().visible) pointer.patch({ visible: true });
      last = { x: e.clientX, y: e.clientY };
      update();
    };
    const down = () => {
      press.set(0.86);
      pointer.patch({ down: true });
    };
    const up = () => {
      press.set(1);
      pointer.patch({ down: false });
      // What is under the pointer usually changes after a tap (an app opens, a sheet slides in).
      window.setTimeout(update, 80);
      window.setTimeout(update, 520);
    };
    const leave = () => {
      lifted = setClass(lifted, null, 'is-lifted');
      hovered = setClass(hovered, null, 'is-hovered');
      pointer.patch({ visible: false });
    };
    const rescale = () => {
      rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 1;
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('tp-frame', rescale);
    document.documentElement.addEventListener('pointerleave', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('tp-frame', rescale);
      document.documentElement.removeEventListener('pointerleave', leave);
      setClass(lifted, null, 'is-lifted');
      setClass(hovered, null, 'is-hovered');
    };
  }, [x, y, w, h, r, o, press, sx, sy, sw, sh, sr]);

  if (native) return null;
  return (
    <motion.div
      ref={el}
      className="pointer"
      aria-hidden="true"
      style={{
        x: sx,
        y: sy,
        width: sw,
        height: sh,
        borderRadius: sr,
        opacity: visible ? so : 0,
        scale: press,
      }}
    />
  );
}
