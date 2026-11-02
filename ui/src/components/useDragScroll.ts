import { useEffect, type RefObject } from 'react';
import { gesture } from '../shell/stage';

// The in-cab screen is driven by a mouse standing in for a finger, so lists scroll by dragging,
// with momentum and iOS-like deceleration. The wheel keeps working as usual.

export function useDragScroll(ref: RefObject<HTMLElement | null>, axis: 'y' | 'x' = 'y') {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startPos = 0;
    let startScroll = 0;
    let lastPos = 0;
    let lastT = 0;
    let velocity = 0;
    let dragging = false;
    let moved = false;
    let raf = 0;

    const pos = (e: PointerEvent) => (axis === 'y' ? e.clientY : e.clientX);
    const getScroll = () => (axis === 'y' ? el.scrollTop : el.scrollLeft);
    const setScroll = (v: number) => {
      if (axis === 'y') el.scrollTop = v;
      else el.scrollLeft = v;
    };

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      cancelAnimationFrame(raf);
      dragging = true;
      moved = false;
      startPos = lastPos = pos(e);
      startScroll = getScroll();
      lastT = performance.now();
      velocity = 0;
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const p = pos(e);
      if (!moved && Math.abs(p - startPos) > 6) {
        moved = true;
        gesture.dragging = true;
      }
      if (!moved) return;
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      velocity = 0.8 * ((lastPos - p) / dt) + 0.2 * velocity;
      lastPos = p;
      lastT = now;
      setScroll(startScroll - (p - startPos));
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) return;
      gesture.dragging = false;
      gesture.lastDragEnd = performance.now();
      let v = velocity * 16; // px per frame
      const step = () => {
        v *= 0.95;
        if (Math.abs(v) < 0.3) return;
        setScroll(getScroll() + v);
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };

    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [ref, axis]);
}
