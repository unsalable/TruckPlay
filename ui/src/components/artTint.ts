// The dominant colour of a piece of artwork, for backgrounds tinted by the cover (Apple Music's
// Now Playing). Measured once per image on a tiny canvas, saturated pixels weighing more.

import { useEffect, useState } from 'react';

const cache = new Map<string, number>();

function measure(src: string): Promise<number | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 24;
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(img, 0, 0, 24, 24);
        const d = g.getImageData(0, 0, 24, 24).data;
        let x = 0;
        let y = 0;
        let weight = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i] / 255;
          const gr = d[i + 1] / 255;
          const b = d[i + 2] / 255;
          const max = Math.max(r, gr, b);
          const min = Math.min(r, gr, b);
          const sat = max - min;
          if (max < 0.12 || sat < 0.08) continue;
          let h = 0;
          if (max === r) h = ((gr - b) / sat) % 6;
          else if (max === gr) h = (b - r) / sat + 2;
          else h = (r - gr) / sat + 4;
          const a = (h * Math.PI) / 3;
          const w = sat * sat;
          x += Math.cos(a) * w;
          y += Math.sin(a) * w;
          weight += w;
        }
        resolve(weight > 0.4 ? ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 : null);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Hue (0–360) of the artwork, or `fallback` while measuring or when it is grey. */
export function useArtHue(src: string | null, fallback: number): number {
  const [hue, setHue] = useState<number>(() => (src && cache.has(src) ? cache.get(src)! : fallback));
  useEffect(() => {
    if (!src) {
      setHue(fallback);
      return;
    }
    if (cache.has(src)) {
      setHue(cache.get(src)!);
      return;
    }
    let live = true;
    void measure(src).then(h => {
      const v = h ?? fallback;
      cache.set(src, v);
      if (live) setHue(v);
    });
    return () => {
      live = false;
    };
  }, [src, fallback]);
  return hue;
}
