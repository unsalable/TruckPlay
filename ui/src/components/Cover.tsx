// Album artwork, or a generated cover when a source has none: a soft two-tone field derived from
// the track so the same song always gets the same cover.

import { useSvgId } from '../icons/appIcons';
import { MusicNote } from '../icons/glyphs';

export function Cover({ src, hue, size, radius }: { src: string | null; hue: number; size: number | string; radius: number | string }) {
  const id = useSvgId();
  if (src) {
    return <img className="cover" src={src} alt="" style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover' }} />;
  }
  return (
    <span className="cover" style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', display: 'block' }}>
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={`hsl(${hue} 80% 62%)`} />
            <stop offset="1" stopColor={`hsl(${(hue + 48) % 360} 70% 36%)`} />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill={`url(#${id})`} />
        <circle cx="78" cy="22" r="44" fill="#fff" opacity="0.1" />
        <MusicNote x={30} y={30} size={40} style={{ color: 'rgb(255 255 255 / .85)' }} />
      </svg>
    </span>
  );
}
