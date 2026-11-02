// Wallpapers in the spirit of CarPlay's, all original artwork with light and dark variants:
//   • sweeps   — large calm colour fields with a soft sweeping edge and a fine grain;
//   • scenes   — Anatolian ridges, a highway at dusk, a sunset over the sea;
//   • dynamic  — aurora, liquid glass and a slow bloom that keep moving, gently;
//   • photos   — the driver's own ETS2 screenshots or pictures (served by the host).

import { useSvgId } from '../icons/appIcons';
import './wallpaper.css';

type Pair = [string, string];
interface SweepPalette {
  base: Pair;
  sweep: Pair;
  disc: Pair;
  line: string;
}

export type WallpaperKind = 'sweep' | 'aurora' | 'liquid' | 'bloom' | 'anatolia' | 'road' | 'sunset' | 'mono';

export interface WallpaperDef {
  id: string;
  name: { tr: string; en: string };
  kind: WallpaperKind;
  dynamic?: boolean;
  dark?: SweepPalette;
  light?: SweepPalette;
}

export const wallpapers: WallpaperDef[] = [
  { id: 'aurora', name: { tr: 'Kuzey Işıkları', en: 'Aurora' }, kind: 'aurora', dynamic: true },
  { id: 'liquid', name: { tr: 'Sıvı Cam', en: 'Liquid Glass' }, kind: 'liquid', dynamic: true },
  { id: 'bloom', name: { tr: 'Işıltı', en: 'Bloom' }, kind: 'bloom', dynamic: true },
  {
    id: 'ocean',
    name: { tr: 'Okyanus', en: 'Ocean' },
    kind: 'sweep',
    dark: { base: ['#041543', '#0b3aa3'], sweep: ['#0c7f9b', '#0a4fa8'], disc: ['#1d55c4', '#0b2f86'], line: '#46c6ff' },
    light: { base: ['#bcd3ff', '#e7f0ff'], sweep: ['#a6ece8', '#c7dcff'], disc: ['#a9c3ff', '#d4e1ff'], line: '#ffffff' },
  },
  { id: 'anatolia', name: { tr: 'Anadolu', en: 'Anatolia' }, kind: 'anatolia' },
  { id: 'road', name: { tr: 'Akşam Yolu', en: 'Evening Road' }, kind: 'road' },
  { id: 'sunset', name: { tr: 'Gün Batımı', en: 'Sunset' }, kind: 'sunset' },
  {
    id: 'dusk',
    name: { tr: 'Alacakaranlık', en: 'Dusk' },
    kind: 'sweep',
    dark: { base: ['#1a0b2e', '#4a1a5c'], sweep: ['#c2416b', '#6b2477'], disc: ['#e0743f', '#8f2f5a'], line: '#ffb38a' },
    light: { base: ['#ffd9c8', '#ffeef0'], sweep: ['#ffb8c9', '#ffd6e0'], disc: ['#ffc9a1', '#ffe2cf'], line: '#ffffff' },
  },
  {
    id: 'forest',
    name: { tr: 'Orman', en: 'Forest' },
    kind: 'sweep',
    dark: { base: ['#03150f', '#0b3b2a'], sweep: ['#1f7a55', '#0d4a37'], disc: ['#2f8f6a', '#0f3d2e'], line: '#7cf0bf' },
    light: { base: ['#cdebd9', '#eef8f1'], sweep: ['#b5e6cf', '#d9f1e4'], disc: ['#bde8cf', '#e0f3e8'], line: '#ffffff' },
  },
  {
    id: 'lavender',
    name: { tr: 'Lavanta', en: 'Lavender' },
    kind: 'sweep',
    dark: { base: ['#120c2e', '#2e1d6b'], sweep: ['#6a4fd6', '#3b2a8f'], disc: ['#8a6cf0', '#3a2a86'], line: '#c9b8ff' },
    light: { base: ['#e4dcff', '#f5f1ff'], sweep: ['#d4c6ff', '#ece5ff'], disc: ['#cfc0ff', '#ebe3ff'], line: '#ffffff' },
  },
  {
    id: 'amber',
    name: { tr: 'Kehribar', en: 'Amber' },
    kind: 'sweep',
    dark: { base: ['#1f0d02', '#5a2a05'], sweep: ['#d9781a', '#7a3a0a'], disc: ['#f0a13a', '#8a4a10'], line: '#ffd08a' },
    light: { base: ['#ffe6c4', '#fff6ea'], sweep: ['#ffd29a', '#ffe8c8'], disc: ['#ffcf8e', '#ffe6c2'], line: '#ffffff' },
  },
  {
    id: 'graphite',
    name: { tr: 'Grafit', en: 'Graphite' },
    kind: 'sweep',
    dark: { base: ['#0b0c0f', '#22252b'], sweep: ['#3a3f48', '#1d2026'], disc: ['#4a505b', '#24272d'], line: '#a7b0bd' },
    light: { base: ['#dfe2e7', '#f4f5f7'], sweep: ['#c9cdd4', '#e6e8ec'], disc: ['#d3d7dd', '#eceef1'], line: '#ffffff' },
  },
  { id: 'mono', name: { tr: 'Gece Siyahı', en: 'Midnight' }, kind: 'mono' },
];

export const isPhoto = (id: string) => id.startsWith('photo:');
export const photoUrl = (id: string, thumb = false) => `tpwall://${thumb ? 'thumb' : 'photo'}/${id.slice(6)}`;

/** `still`: no motion (thumbnails, reduced motion). */
export function WallpaperArt({ id, dark, still = false }: { id: string; dark: boolean; still?: boolean }) {
  if (isPhoto(id)) return <PhotoWallpaper id={id} dark={dark} thumb={still} />;
  const def = wallpapers.find(w => w.id === id) ?? wallpapers.find(w => w.id === 'ocean')!;
  switch (def.kind) {
    case 'aurora':
      return <Aurora dark={dark} still={still} />;
    case 'liquid':
      return <Liquid dark={dark} still={still} />;
    case 'bloom':
      return <Bloom dark={dark} still={still} />;
    case 'anatolia':
      return <Anatolia dark={dark} />;
    case 'road':
      return <Road dark={dark} />;
    case 'sunset':
      return <Sunset dark={dark} />;
    case 'mono':
      return <div className={`wp wp-mono ${dark ? 'is-dark' : 'is-light'}`} />;
    default:
      return <Sweep palette={(dark ? def.dark : def.light)!} dark={dark} />;
  }
}

function PhotoWallpaper({ id, dark, thumb }: { id: string; dark: boolean; thumb: boolean }) {
  return (
    <div className={`wp wp-photo ${dark ? 'is-dark' : 'is-light'}`}>
      <img src={photoUrl(id, thumb)} alt="" draggable={false} />
    </div>
  );
}

function Grain({ dark, id }: { dark: boolean; id: string }) {
  return (
    <>
      <filter id={`${id}g`} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
        <feColorMatrix in="n" type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncA type="linear" slope={dark ? 0.09 : 0.06} />
        </feComponentTransfer>
      </filter>
    </>
  );
}

function Sweep({ palette: c, dark }: { palette: SweepPalette; dark: boolean }) {
  const k = useSvgId();
  return (
    <svg className="wp" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id={`${k}b`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={c.base[0]} />
          <stop offset="1" stopColor={c.base[1]} />
        </linearGradient>
        <linearGradient id={`${k}s`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c.sweep[0]} />
          <stop offset="1" stopColor={c.sweep[1]} stopOpacity="0.7" />
        </linearGradient>
        <radialGradient id={`${k}d`} cx="0.42" cy="0.32" r="0.8">
          <stop offset="0" stopColor={c.disc[0]} />
          <stop offset="1" stopColor={c.disc[1]} />
        </radialGradient>
        <Grain dark={dark} id={k} />
        <filter id={`${k}soft`}>
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
      </defs>
      <rect width="1600" height="900" fill={`url(#${k}b)`} />
      <path d="M-40 980C140 560 360 120 760 -40h900v220C1230 260 860 560 640 980z" fill={`url(#${k}s)`} opacity="0.92" />
      <path d="M-40 980C140 560 360 120 760 -40" fill="none" stroke={c.line} strokeOpacity={dark ? 0.55 : 0.9} strokeWidth="2.4" filter={`url(#${k}soft)`} />
      <circle cx="1240" cy="830" r="560" fill={`url(#${k}d)`} />
      <circle cx="1240" cy="830" r="560" fill="none" stroke={c.line} strokeOpacity={dark ? 0.18 : 0.6} strokeWidth="2" />
      <rect width="1600" height="900" filter={`url(#${k}g)`} />
    </svg>
  );
}

// ---------------- dynamic ----------------

function Aurora({ dark, still }: { dark: boolean; still: boolean }) {
  return (
    <div className={`wp wp-aurora ${dark ? 'is-dark' : 'is-light'} ${still ? 'is-still' : ''}`}>
      {dark && <Stars />}
      <span className="wp-aurora__band wp-aurora__band--a" />
      <span className="wp-aurora__band wp-aurora__band--b" />
      <span className="wp-aurora__band wp-aurora__band--c" />
      <span className="wp-aurora__floor" />
    </div>
  );
}

function Liquid({ dark, still }: { dark: boolean; still: boolean }) {
  return (
    <div className={`wp wp-liquid ${dark ? 'is-dark' : 'is-light'} ${still ? 'is-still' : ''}`}>
      <span className="wp-liquid__blob wp-liquid__blob--a" />
      <span className="wp-liquid__blob wp-liquid__blob--b" />
      <span className="wp-liquid__blob wp-liquid__blob--c" />
      <span className="wp-liquid__blob wp-liquid__blob--d" />
      <span className="wp-liquid__sheen" />
    </div>
  );
}

function Bloom({ dark, still }: { dark: boolean; still: boolean }) {
  return (
    <div className={`wp wp-bloom ${dark ? 'is-dark' : 'is-light'} ${still ? 'is-still' : ''}`}>
      <span className="wp-bloom__petal wp-bloom__petal--a" />
      <span className="wp-bloom__petal wp-bloom__petal--b" />
      <span className="wp-bloom__petal wp-bloom__petal--c" />
    </div>
  );
}

// Fixed star field (deterministic, so it never jumps between renders).
const STARS = (() => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 90 }, () => ({ x: rnd() * 1600, y: rnd() * 560, r: 0.6 + rnd() * 1.6, o: 0.25 + rnd() * 0.7 }));
})();

function Stars() {
  return (
    <svg className="wp-stars" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true">
      {STARS.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={s.o} />
      ))}
    </svg>
  );
}

// ---------------- scenes ----------------

// Ridge lines: a few sines summed, so each layer is a believable, repeatable mountain outline.
function ridge(baseY: number, amp: number, seed: number, w = 1600, h = 900): string {
  const pts: string[] = [];
  for (let x = 0; x <= w; x += 20) {
    const t = x / w;
    const y =
      baseY -
      amp *
        (0.55 * Math.sin(t * 6.1 + seed) + 0.3 * Math.sin(t * 13.7 + seed * 2.3) + 0.15 * Math.sin(t * 29.3 + seed * 4.1) + 0.2 * Math.cos(t * 3.1 + seed));
    pts.push(`${x} ${y.toFixed(1)}`);
  }
  return `M0 ${h}L${pts.join('L')}L${w} ${h}Z`;
}

const RIDGES = [ridge(560, 70, 1.3), ridge(615, 80, 2.9), ridge(690, 95, 4.4), ridge(790, 110, 6.2)];

function Anatolia({ dark }: { dark: boolean }) {
  const k = useSvgId();
  const sky: Pair = dark ? ['#040816', '#1c2a55'] : ['#8cb6ec', '#f7d9c4'];
  const layers = dark ? ['#25325a', '#1a2546', '#111a33', '#0a1022'] : ['#9db3d6', '#7f97bf', '#5f789f', '#3f5579'];
  return (
    <svg className="wp" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id={`${k}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky[0]} />
          <stop offset="0.75" stopColor={sky[1]} />
        </linearGradient>
        <radialGradient id={`${k}glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={dark ? '#fff8e0' : '#fff3d6'} stopOpacity={dark ? 0.55 : 0.9} />
          <stop offset="1" stopColor={dark ? '#fff8e0' : '#ffd9a0'} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${k}haze`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky[1]} stopOpacity="0" />
          <stop offset="1" stopColor={sky[1]} stopOpacity={dark ? 0.35 : 0.55} />
        </linearGradient>
        <Grain dark={dark} id={k} />
      </defs>
      <rect width="1600" height="900" fill={`url(#${k}sky)`} />
      {dark && STARS.map((s, i) => <circle key={i} cx={s.x} cy={s.y * 0.8} r={s.r * 0.9} fill="#fff" opacity={s.o * 0.8} />)}
      <circle cx={dark ? 1180 : 1040} cy={dark ? 220 : 520} r="260" fill={`url(#${k}glow)`} />
      <circle cx={dark ? 1180 : 1040} cy={dark ? 220 : 520} r={dark ? 46 : 62} fill={dark ? '#f4f1e6' : '#fff6e2'} opacity={dark ? 0.95 : 0.9} />
      {RIDGES.map((d, i) => (
        <g key={i}>
          <path d={d} fill={layers[i]} />
          {i < 3 && <path d={d} fill={`url(#${k}haze)`} />}
        </g>
      ))}
      <rect width="1600" height="900" filter={`url(#${k}g)`} />
    </svg>
  );
}

// Centre-line dashes in perspective: each one nearer is longer and wider.
function CENTRE_DASHES(vx: number, vy: number): string {
  let d = '';
  for (let i = 0; i < 18; i++) {
    const z0 = 1 + i * 1.25;
    const z1 = z0 + 0.6;
    const y0 = vy + 430 / z0;
    const y1 = vy + 430 / z1;
    const w0 = 9 / z0;
    const w1 = 9 / z1;
    d += `M${vx - w0} ${y0}L${vx + w0} ${y0}L${vx + w1} ${y1}L${vx - w1} ${y1}Z`;
  }
  return d;
}

function Road({ dark }: { dark: boolean }) {
  const k = useSvgId();
  const vx = 800;
  const vy = 470;
  const lamps = Array.from({ length: 9 }, (_, i) => {
    const t = Math.pow(i / 8, 1.8);
    return { x: vx + (1180 - vx) * t + 30, y: vy - 18 - 210 * t, r: 2 + 9 * t };
  });
  return (
    <svg className="wp" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id={`${k}sky`} x1="0" y1="0" x2="0" y2="1">
          {dark ? (
            <>
              <stop offset="0" stopColor="#0b0f2b" />
              <stop offset="0.45" stopColor="#3b2a63" />
              <stop offset="0.52" stopColor="#c7576a" />
              <stop offset="0.56" stopColor="#f39a5b" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#5d9bea" />
              <stop offset="0.5" stopColor="#b9d8f7" />
              <stop offset="0.56" stopColor="#eaf2fb" />
            </>
          )}
        </linearGradient>
        <linearGradient id={`${k}land`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={dark ? '#1a1530' : '#a7c98a'} />
          <stop offset="1" stopColor={dark ? '#08070f' : '#5e8a4a'} />
        </linearGradient>
        <linearGradient id={`${k}road`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={dark ? '#2b2840' : '#8d8f96'} />
          <stop offset="1" stopColor={dark ? '#0e0d16' : '#55575e'} />
        </linearGradient>
        <radialGradient id={`${k}lamp`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffd9a1" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffb860" stopOpacity="0" />
        </radialGradient>
        <Grain dark={dark} id={k} />
      </defs>
      <rect width="1600" height="900" fill={`url(#${k}sky)`} />
      {/* distant city */}
      <path
        d="M380 470v-26h18v-14h14v22h22v-40h16v40h20v-18h26v18h14v-58h20v58h30v-28h22v28h40v-12h30v-30h18v42h26v-22h24v22h60v-36h18v36h40v-16h28v16h30v-44h22v44h40v-20h30v20h60v-10h80v10z"
        fill={dark ? '#120e22' : '#9fb4cc'}
        opacity={dark ? 1 : 0.7}
      />
      <rect y="470" width="1600" height="430" fill={`url(#${k}land)`} />
      <path d={`M${vx - 6} ${vy}L${vx + 6} ${vy}L1400 900L200 900Z`} fill={`url(#${k}road)`} />
      <path d={CENTRE_DASHES(vx, vy)} fill={dark ? '#f4c86a' : '#ffffff'} opacity="0.85" />
      <path d={`M${vx - 4} ${vy}L230 900M${vx + 4} ${vy}L1370 900`} stroke={dark ? '#6c6690' : '#e9ecef'} strokeWidth="5" opacity="0.7" />
      {dark &&
        lamps.map((l, i) => (
          <g key={i}>
            <circle cx={l.x} cy={l.y} r={l.r * 5} fill={`url(#${k}lamp)`} />
            <circle cx={l.x} cy={l.y} r={l.r * 0.7} fill="#fff4dc" />
          </g>
        ))}
      <rect width="1600" height="900" filter={`url(#${k}g)`} />
    </svg>
  );
}

function Sunset({ dark }: { dark: boolean }) {
  const k = useSvgId();
  const horizon = 560;
  return (
    <svg className="wp" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id={`${k}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={dark ? '#0d0b2a' : '#ffd6e2'} />
          <stop offset="0.55" stopColor={dark ? '#7a2a6e' : '#ffc3a8'} />
          <stop offset="0.62" stopColor={dark ? '#f2735a' : '#ffe7c4'} />
        </linearGradient>
        <linearGradient id={`${k}sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={dark ? '#ffd27a' : '#fff1c9'} />
          <stop offset="1" stopColor={dark ? '#ff6a6a' : '#ffb38f'} />
        </linearGradient>
        <linearGradient id={`${k}sea`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={dark ? '#3a1d4f' : '#c9b8e8'} />
          <stop offset="1" stopColor={dark ? '#0a0818' : '#8fa1d9'} />
        </linearGradient>
        <mask id={`${k}cuts`}>
          <rect width="1600" height="900" fill="#fff" />
          {Array.from({ length: 6 }, (_, i) => (
            <rect key={i} y={horizon - 130 + i * 24} width="1600" height={2 + i * 2.2} fill="#000" />
          ))}
        </mask>
        <Grain dark={dark} id={k} />
      </defs>
      <rect width="1600" height="900" fill={`url(#${k}sky)`} />
      <circle cx="800" cy={horizon} r="250" fill={`url(#${k}sun)`} mask={`url(#${k}cuts)`} />
      <rect y={horizon} width="1600" height={900 - horizon} fill={`url(#${k}sea)`} />
      {Array.from({ length: 12 }, (_, i) => {
        const y = horizon + 14 + i * i * 2.6;
        const w = 260 - i * 14;
        return <rect key={i} x={800 - w} y={y} width={w * 2} height={2.5 + i * 0.4} rx="2" fill={dark ? '#ffb07a' : '#fff4e0'} opacity={0.6 - i * 0.04} />;
      })}
      <rect width="1600" height="900" filter={`url(#${k}g)`} />
    </svg>
  );
}
