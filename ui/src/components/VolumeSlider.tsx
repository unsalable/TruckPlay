// The volume slider, as iOS draws it: a capsule that fills with white, grows a little while it is
// held, and answers the mouse wheel. Horizontal in Now Playing, vertical in the rail's popover.

import { motion } from 'motion/react';
import { useRef, useState } from 'react';
import { Speaker } from '../icons/glyphs';
import { useStore } from '../state/store';
import { settings } from '../state/ui';
import { setVolume } from '../state/volume';
import { spring } from '../design/motion';
import './volumeSlider.css';

/** `onHold` hears when the slider is grabbed and let go; the vertical one leaves growing to the
 *  glass around it (a growing capsule would poke out of its own glass). */
export function VolumeSlider({ vertical = false, onUse, onHold }: { vertical?: boolean; onUse?(): void; onHold?(held: boolean): void }) {
  const level = useStore(settings, s => s.volume);
  const track = useRef<HTMLDivElement>(null);
  const [held, setHeldState] = useState(false);
  const setHeld = (h: boolean) => {
    setHeldState(h);
    onHold?.(h);
  };

  const at = (e: { clientX: number; clientY: number }) => {
    const r = track.current!.getBoundingClientRect();
    return vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
  };

  return (
    <motion.div
      className={`vol${vertical ? ' vol--v' : ''}`}
      data-pointer="highlight"
      animate={held && !vertical ? { scaleY: 1.4 } : { scaleY: 1 }}
      transition={spring.snappy}
      onWheel={e => {
        e.stopPropagation();
        setVolume(level + (e.deltaY < 0 ? 0.05 : -0.05));
        onUse?.();
      }}
    >
      {!vertical && <Speaker className="vol__low" />}
      <div
        ref={track}
        className="vol__track"
        onPointerDown={e => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setHeld(true);
          setVolume(at(e));
          onUse?.();
        }}
        onPointerMove={e => {
          if (!held) return;
          setVolume(at(e));
          onUse?.();
        }}
        onPointerUp={() => setHeld(false)}
        onPointerCancel={() => setHeld(false)}
        onLostPointerCapture={() => setHeld(false)}
      >
        <motion.div
          className="vol__fill"
          animate={vertical ? { height: `${level * 100}%` } : { width: `${level * 100}%` }}
          transition={held ? { duration: 0 } : spring.snappy}
        />
        {vertical && (
          <span className={`vol__glyph${level < 0.2 ? ' vol__glyph--low' : ''}`}>
            <Speaker />
          </span>
        )}
      </div>
      {!vertical && <Speaker className="vol__high" />}
    </motion.div>
  );
}
