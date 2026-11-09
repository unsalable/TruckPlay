// Lyrics as Apple Music shows them while the song plays: the line being sung large and lit word
// by word as it is sung, the next lines waiting dimmed and softly out of focus, the sung ones
// fading back, the column gliding up on a spring as the song moves on. Before the first line and in
// a long pause between lines, three dots breathe. A line tapped takes the song there.
//
// The words light up from the song's position read every frame — no re-render per frame: the
// sung line's words are painted straight through their style.

import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { wordTimes, type LyricLine } from '../../state/lyrics';
import './lyrics.css';

interface Props {
  lines: LyricLine[];
  /** The song's position now, in seconds. */
  position(): number;
  playing: boolean;
  onSeek?(seconds: number): void;
}

// Lines light a touch early: the eye reads ahead of the voice.
const LEAD = 0.18;
// A gap this long between lines (or before the first) shows the breathing dots.
const PAUSE = 6;

/**
 * Which line is sung: its index; -1 before the first line; -2 - i in a long pause after line i.
 */
function lineAt(lines: LyricLine[], ends: number[], pos: number): number {
  let i = -1;
  for (let k = 0; k < lines.length && lines[k].t <= pos; k++) i = k;
  if (i >= 0 && lines[i + 1] && pos > ends[i] + 1.2 && lines[i + 1].t - ends[i] > PAUSE) return -2 - i;
  return i;
}

export function LyricsView({ lines, position, playing, onSeek }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() => lineAt(lines, [], position() + LEAD));
  const y = useMotionValue(0);
  const words = useMemo(() => lines.map((l, i) => wordTimes(l, lines[i + 1]?.t ?? null)), [lines]);
  // Where each line ends being sung (its last word), for the pauses.
  const ends = useMemo(() => words.map((w, i) => w.at(-1)?.to ?? lines[i].t), [words, lines]);

  // Every frame: which line is sung, and how far into its words.
  useEffect(() => {
    let raf = 0;
    let shown = Number.NaN;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const pos = position() + LEAD;
      const now = lineAt(lines, ends, pos);
      if (now !== shown) {
        shown = now;
        setActive(now);
        // Words lit by an earlier pass (a line sung, then sought back to) go dark again.
        track.current?.querySelectorAll<HTMLElement>('.lyrics__word[data-p]').forEach(w => {
          if (w.closest('[data-line]')?.getAttribute('data-line') === String(now)) return;
          w.style.removeProperty('--p');
          delete w.dataset.p;
        });
      }
      if (now < 0) return;
      const spans = track.current?.querySelector(`[data-line="${now}"]`)?.querySelectorAll<HTMLElement>('.lyrics__word');
      if (!spans) return;
      words[now].forEach((w, k) => {
        const p = Math.max(0, Math.min(1, (pos - w.from) / Math.max(0.05, w.to - w.from))).toFixed(3);
        const span = spans[k];
        if (span && span.dataset.p !== p) {
          span.dataset.p = p;
          span.style.setProperty('--p', p);
        }
      });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [lines, words, ends, position]);

  // The sung line (or a pause's dots) sits a third of the way down; the column glides there.
  const focus = active >= 0 ? active : active <= -2 ? -2 - active : -1;
  useLayoutEffect(() => {
    const b = box.current;
    if (!b) return;
    const el = focus >= 0 ? track.current?.querySelector<HTMLElement>(`[data-line="${focus}"]`) : null;
    const target = el ? b.clientHeight * 0.3 - el.offsetTop - (active <= -2 ? el.offsetHeight : 0) : b.clientHeight * 0.3;
    const a = animate(y, target, { type: 'spring', visualDuration: 0.75, bounce: 0.1 });
    return () => a.stop();
  }, [focus, active, y]);

  const intro = active === -1 && (lines[0]?.t ?? 0) > PAUSE / 2;
  return (
    <div ref={box} className={`lyrics${playing ? '' : ' lyrics--paused'}`}>
      <motion.div ref={track} className="lyrics__track" style={{ y }}>
        <AnimatePresence>{intro && <Dots key="intro" />}</AnimatePresence>
        {lines.map((line, i) => {
          const state = i === active ? 'now' : i <= focus ? 'past' : 'next';
          return (
            <div key={`${i}-${line.t}`} data-line={i}>
              <div
                className={`lyrics__line lyrics__line--${state}`}
                style={{ '--far': Math.min(4, Math.abs(i - Math.max(0, focus))) } as React.CSSProperties}
                data-pointer={onSeek ? 'highlight' : undefined}
                onClick={() => onSeek?.(Math.max(0, line.t - 0.05))}
              >
                {line.text ? (
                  words[i].map((w, k) => (
                    <span key={k} className="lyrics__word">
                      {w.text}{' '}
                    </span>
                  ))
                ) : (
                  <span className="lyrics__word">♪</span>
                )}
              </div>
              <AnimatePresence>{active === -2 - i && <Dots key="pause" />}</AnimatePresence>
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}

function Dots() {
  return (
    <motion.div
      className="lyrics__pause"
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', visualDuration: 0.5, bounce: 0.3 }}
    >
      <i />
      <i />
      <i />
    </motion.div>
  );
}

/** Lyrics without times: the whole text, scrolling gently with the song. */
export function PlainLyrics({ text, position, duration }: { text: string; position(): number; duration: number }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const b = box.current;
      const el = inner.current;
      if (!b || !el || !duration) return;
      const room = Math.max(0, el.scrollHeight - b.clientHeight * 0.6);
      const f = Math.max(0, Math.min(1, (position() - 8) / Math.max(1, duration - 20)));
      el.style.transform = `translateY(${(-room * f).toFixed(1)}px)`;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [position, duration]);
  return (
    <div ref={box} className="lyrics lyrics--plain">
      <div ref={inner} className="lyrics__plain">
        {text.split('\n').map((l, i) => (
          <p key={i}>{l || ' '}</p>
        ))}
      </div>
    </div>
  );
}
