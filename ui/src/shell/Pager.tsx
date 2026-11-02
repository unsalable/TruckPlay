// Home screen paging with momentum: the release velocity projects where the page would coast,
// that picks the target (one page per swipe), and the spring starts with the finger's velocity.
// The mouse wheel pages too, one page per notch, with a rubber-band nudge at either end.
// The page indicator is iOS 26's: the current page is a short capsule that slides between dots.

import { animate, motion, useMotionValue, type AnimationPlaybackControls } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { goToPage, nav } from '../state/ui';
import { spring } from '../design/motion';
import { gesture, useStage } from './stage';
import './pager.css';

/** `hideDotsOn`: a page that fills the stage edge to edge (the Dashboard) shows no page dots, as in CarPlay. */
export function Pager({ pages, hideDotsOn = -1 }: { pages: ReactNode[]; hideDotsOn?: number }) {
  const { width } = useStage();
  const page = useStore(nav, n => n.page);
  const count = pages.length;
  const x = useMotionValue(-page * width);
  const anim = useRef<AnimationPlaybackControls | null>(null);
  const handoff = useRef(0);
  const shownPage = useRef(page);
  const wheel = useRef({ sum: 0, until: 0 });

  const onWheel = (e: React.WheelEvent) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const now = performance.now();
    const w = wheel.current;
    if (now < w.until) return; // one page per notch, even from a free-spinning wheel
    w.sum += d;
    if (Math.abs(w.sum) < 40) return;
    const dir = w.sum > 0 ? 1 : -1;
    w.sum = 0;
    w.until = now + 360;
    const target = page + dir;
    if (target >= 0 && target < count) {
      goToPage(target);
      return;
    }
    // Nothing further that way: lean a little and spring back.
    anim.current?.stop();
    anim.current = animate(x, [x.get(), -page * width - dir * width * 0.04, -page * width], {
      duration: 0.42,
      times: [0, 0.35, 1],
      ease: ['easeOut', [0.2, 0.9, 0.25, 1]],
    });
  };

  useEffect(() => {
    anim.current?.stop();
    if (page === shownPage.current && !handoff.current) {
      // Only the stage's width changed (the rail coming back after full-screen video): stay put.
      x.set(-page * width);
      return;
    }
    shownPage.current = page;
    anim.current = animate(x, -page * width, { ...spring.page, velocity: handoff.current });
    handoff.current = 0;
  }, [page, width, x]);

  useEffect(() => {
    if (nav.get().pageCount !== count) nav.patch({ pageCount: count });
  }, [count]);

  return (
    <div className="pager" onWheel={onWheel}>
      <motion.div
        className="pager__track"
        style={{ x, width: width * count }}
        drag="x"
        dragConstraints={{ left: -(count - 1) * width, right: 0 }}
        dragElastic={0.14}
        dragMomentum={false}
        onDragStart={() => {
          gesture.dragging = true;
          anim.current?.stop();
        }}
        onDragEnd={(_, info) => {
          gesture.dragging = false;
          gesture.lastDragEnd = performance.now();
          const projected = x.get() + info.velocity.x * 0.22;
          const raw = Math.round(-projected / width);
          const target = Math.max(page - 1, Math.min(page + 1, Math.max(0, Math.min(count - 1, raw))));
          handoff.current = info.velocity.x;
          if (target === page) {
            anim.current = animate(x, -page * width, { ...spring.page, velocity: info.velocity.x });
            handoff.current = 0;
          } else {
            goToPage(target);
          }
        }}
      >
        {pages.map((p, i) => (
          <div className="pager__page" key={i} style={{ width }}>
            {p}
          </div>
        ))}
      </motion.div>
      <motion.div
        className="pager__dots glass-clear"
        aria-hidden="true"
        animate={{ opacity: page === hideDotsOn ? 0 : 1, y: page === hideDotsOn ? 8 : 0, scale: page === hideDotsOn ? 0.9 : 1 }}
        transition={spring.smooth}
      >
        {pages.map((_, i) => (
          <span key={i} className="pager__slot">
            <motion.span className="pager__dot" animate={{ opacity: i === page ? 0 : 0.4, scale: i === page ? 0.6 : 1 }} transition={spring.snappy} />
            {i === page && <motion.span layoutId="pager-current" className="pager__current" transition={spring.bouncy} />}
          </span>
        ))}
      </motion.div>
    </div>
  );
}
