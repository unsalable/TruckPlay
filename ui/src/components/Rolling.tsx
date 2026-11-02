// Numbers that roll to their new value digit by digit, like SwiftUI's numericText transition:
// each digit is a little reel that springs to its place; other characters stay put.

import type { CSSProperties } from 'react';
import './rolling.css';

const DIGITS = '0123456789';

export function Rolling({ value, className = '' }: { value: string | number; className?: string }) {
  const text = String(value);
  // Reels are keyed from the right so a growing number keeps its existing digits in place.
  const chars = [...text];
  return (
    <span className={`rolling tabular ${className}`} aria-label={text}>
      {chars.map((ch, i) => {
        const key = chars.length - i;
        const d = DIGITS.indexOf(ch);
        if (d < 0) {
          return (
            <span key={`c${key}`} className="rolling__char" aria-hidden="true">
              {ch}
            </span>
          );
        }
        return (
          <span key={`d${key}`} className="rolling__reel" aria-hidden="true">
            <span className="rolling__strip" style={{ '--d': d } as CSSProperties}>
              {DIGITS.split('').map(n => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
