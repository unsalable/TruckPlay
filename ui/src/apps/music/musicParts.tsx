// Small pieces of Apple Music's motion vocabulary, shared by Now Playing, Music and the Dashboard.

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './musicParts.css';

/** The "now playing" bars: four bars bouncing out of phase while audio plays. */
export function Equalizer({ className = '' }: { className?: string }) {
  return (
    <span className={`eq ${className}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/** A title too long for its line glides across after a pause, then returns — like Music's. */
export function Marquee({ children, className = '' }: { children: ReactNode; className?: string }) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const o = outer.current;
      const i = inner.current;
      if (!o || !i) return;
      const over = i.scrollWidth - o.clientWidth;
      setShift(over > 4 ? over + 24 : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outer.current) ro.observe(outer.current);
    return () => ro.disconnect();
  }, [children]);
  return (
    <span ref={outer} className={`marquee ${shift ? 'marquee--on' : ''} ${className}`}>
      <span ref={inner} className="marquee__text" style={{ '--shift': `${-shift}px`, '--dur': `${Math.max(6, shift / 28)}s` } as CSSProperties}>
        {children}
      </span>
    </span>
  );
}
