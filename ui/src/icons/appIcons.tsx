// App icons in the iOS 26 manner: superellipse tile, glass sheen and rim, white glyph on colour
// in light appearance, coloured glyph on charcoal in dark. All artwork is original.

import { useId, type ReactNode } from 'react';

/** useId() may contain characters that break url(#…) references. */
export function useSvgId(): string {
  return 'i' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
}
import * as G from './glyphs';
import type { Glyph } from './glyphs';

export type AppIconId =
  | 'maps'
  | 'music'
  | 'nowplaying'
  | 'radio'
  | 'youtube'
  | 'browser'
  | 'truck'
  | 'job'
  | 'settings'
  | 'messages'
  | 'split';

// iOS icon outline: a superellipse (nâ‰ˆ5) on a 120 grid.
const SQUIRCLE = (() => {
  const n = 5;
  const r = 60;
  const pts: string[] = [];
  for (let i = 0; i < 128; i++) {
    const t = (i / 128) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = 60 + Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * r;
    const y = 60 + Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * r;
    pts.push(`${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `${pts.join('')}Z`;
})();

interface Palette {
  bg: [string, string];
  accent: [string, string];
}

const palettes: Record<Exclude<AppIconId, 'maps' | 'nowplaying' | 'browser'>, Palette & { glyph: Glyph; scale?: number }> = {
  music: { bg: ['#ff6b86', '#f2204a'], accent: ['#ff7a92', '#ff2d55'], glyph: G.MusicNote },
  radio: { bg: ['#f562b0', '#a63de0'], accent: ['#ff6fb8', '#b44df0'], glyph: G.Antenna },
  youtube: { bg: ['#ff5252', '#d81c1c'], accent: ['#ff6161', '#ff2b2b'], glyph: G.PlayRect, scale: 0.6 },
  truck: { bg: ['#ffbb4d', '#f2731a'], accent: ['#ffc65c', '#ff8a1f'], glyph: G.Truck, scale: 0.6 },
  job: { bg: ['#d6a66b', '#9a6a36'], accent: ['#e8b77a', '#c48a49'], glyph: G.Box, scale: 0.54 },
  settings: { bg: ['#c3c8d0', '#7d838e'], accent: ['#d5d9df', '#9aa0aa'], glyph: G.Gear, scale: 0.64 },
  messages: { bg: ['#6bef7b', '#21c043'], accent: ['#7af58a', '#30d158'], glyph: G.Message, scale: 0.58 },
  split: { bg: ['#8a87ff', '#4f4ae6'], accent: ['#9a97ff', '#5e5ce6'], glyph: G.SplitScreen, scale: 0.62 },
};

function Frame({ dark, children, id }: { dark: boolean; children: ReactNode; id: string }) {
  return (
    <svg viewBox="0 0 120 120" width="100%" height="100%" aria-hidden="true" style={{ overflow: 'visible' }}>
      <defs>
        <clipPath id={`${id}-clip`}>
          <path d={SQUIRCLE} />
        </clipPath>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={dark ? 0.16 : 0.34} />
          <stop offset="0.48" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={dark ? 0.42 : 0.7} />
          <stop offset="0.4" stopColor="#fff" stopOpacity={dark ? 0.08 : 0.16} />
          <stop offset="0.75" stopColor="#fff" stopOpacity="0.02" />
          <stop offset="1" stopColor="#fff" stopOpacity={dark ? 0.2 : 0.4} />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        {children}
        <rect width="120" height="62" fill={`url(#${id}-sheen)`} />
      </g>
      <path d={SQUIRCLE} fill="none" stroke={`url(#${id}-rim)`} strokeWidth="2.2" />
    </svg>
  );
}

function DarkTile({ id }: { id: string }) {
  return (
    <>
      <linearGradient id={`${id}-dbg`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#3a3a3e" />
        <stop offset="1" stopColor="#1b1b1e" />
      </linearGradient>
      <rect width="120" height="120" fill={`url(#${id}-dbg)`} />
    </>
  );
}

function GlyphIcon({ app, dark }: { app: keyof typeof palettes; dark: boolean }) {
  const id = useSvgId();
  const p = palettes[app];
  const size = 120 * (p.scale ?? 0.56);
  const off = (120 - size) / 2;
  const GlyphC = p.glyph;
  return (
    <Frame dark={dark} id={id}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.bg[0]} />
          <stop offset="1" stopColor={p.bg[1]} />
        </linearGradient>
        <linearGradient id={`${id}-acc`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.accent[0]} />
          <stop offset="1" stopColor={p.accent[1]} />
        </linearGradient>
        <mask id={`${id}-mask`}>
          <g style={{ color: '#fff' }}>
            <GlyphC x={off} y={off} size={size} />
          </g>
        </mask>
        <filter id={`${id}-drop`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#000" floodOpacity={dark ? 0.35 : 0.18} />
        </filter>
      </defs>
      {dark ? <DarkTile id={id} /> : <rect width="120" height="120" fill={`url(#${id}-bg)`} />}
      <g filter={`url(#${id}-drop)`}>
        <rect width="120" height="120" fill={dark ? `url(#${id}-acc)` : '#fff'} mask={`url(#${id}-mask)`} />
      </g>
    </Frame>
  );
}

function MapsIcon({ dark }: { dark: boolean }) {
  const id = useSvgId();
  const land = dark ? '#2b3036' : '#eef1e8';
  const park = dark ? '#2f4a36' : '#b3e09a';
  const water = dark ? '#1f3a57' : '#8fd0f6';
  const road = dark ? '#5a6068' : '#ffffff';
  const casing = dark ? '#1d2126' : '#d9dccf';
  return (
    <Frame dark={dark} id={id}>
      <rect width="120" height="120" fill={land} />
      <path d="M0 74c18-6 30 4 46 0s22-18 38-16 26 10 36 6v56H0z" fill={park} />
      <path d="M80 0h40v44c-14 2-24-6-30-16S80 10 80 0z" fill={water} />
      <g fill="none" strokeLinecap="round">
        <path d="M-6 40 126 92" stroke={casing} strokeWidth="15" />
        <path d="M-6 40 126 92" stroke={road} strokeWidth="11" />
        <path d="M38 126 70 -6" stroke={casing} strokeWidth="13" />
        <path d="M38 126 70 -6" stroke={road} strokeWidth="9" />
        <path d="M20 118c10-26 26-38 44-44s30-18 34-40" stroke="#1d6bf0" strokeWidth="9" />
        <path d="M20 118c10-26 26-38 44-44s30-18 34-40" stroke="#3d8bff" strokeWidth="5" />
      </g>
      <circle cx="98" cy="34" r="17" fill="#fff" />
      <circle cx="98" cy="34" r="17" fill="none" stroke="rgb(0 0 0 / .08)" strokeWidth="1" />
      <G.NavArrow x={86} y={21} size={24} style={{ color: '#1b78ff' }} />
    </Frame>
  );
}

function NowPlayingIcon({ dark }: { dark: boolean }) {
  const id = useSvgId();
  return (
    <Frame dark={dark} id={id}>
      <defs>
        <linearGradient id={`${id}-wave`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ff2d78" />
          <stop offset="1" stopColor="#ff8a3d" />
        </linearGradient>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#ececf0" />
        </linearGradient>
      </defs>
      {dark ? <DarkTile id={id} /> : <rect width="120" height="120" fill={`url(#${id}-tile)`} />}
      <g fill={`url(#${id}-wave)`}>
        {[24, 40, 58, 34, 50, 20].map((h, i) => (
          <rect key={i} x={26 + i * 12.5} y={60 - h / 2} width="7" height={h} rx="3.5" />
        ))}
      </g>
    </Frame>
  );
}

function BrowserIcon({ dark }: { dark: boolean }) {
  const id = useSvgId();
  const ticks: ReactNode[] = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const long = i % 4 === 0;
    const r1 = long ? 34 : 37;
    ticks.push(
      <line
        key={i}
        x1={60 + Math.cos(a) * r1}
        y1={60 + Math.sin(a) * r1}
        x2={60 + Math.cos(a) * 41}
        y2={60 + Math.sin(a) * 41}
        stroke={dark ? '#6bb8ff' : '#fff'}
        strokeOpacity={long ? 0.9 : 0.55}
        strokeWidth={long ? 1.8 : 1.1}
      />,
    );
  }
  return (
    <Frame dark={dark} id={id}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5ccaff" />
          <stop offset="1" stopColor="#1168f2" />
        </linearGradient>
      </defs>
      {dark ? <DarkTile id={id} /> : <rect width="120" height="120" fill={`url(#${id}-bg)`} />}
      <circle cx="60" cy="60" r="44" fill={dark ? 'rgb(30 120 255 / .14)' : 'rgb(255 255 255 / .12)'} />
      {ticks}
      <g transform="rotate(45 60 60)">
        <path d="M60 24 67 60H53z" fill="#ff3b30" />
        <path d="M60 96 53 60h14z" fill={dark ? '#e8eef8' : '#fff'} />
      </g>
      <circle cx="60" cy="60" r="3.2" fill={dark ? '#1b1b1e' : '#1168f2'} />
    </Frame>
  );
}

export function AppIcon({ app, dark }: { app: AppIconId; dark: boolean }) {
  switch (app) {
    case 'maps':
      return <MapsIcon dark={dark} />;
    case 'nowplaying':
      return <NowPlayingIcon dark={dark} />;
    case 'browser':
      return <BrowserIcon dark={dark} />;
    default:
      return <GlyphIcon app={app} dark={dark} />;
  }
}
