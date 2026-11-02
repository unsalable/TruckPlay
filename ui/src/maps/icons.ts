// Map images drawn on demand: Apple Maps–style POI badges (a coloured disc with a white glyph)
// and road shields in each country's colours, both rendered once per id into the map's sprite.

import type { Map as MapLibre } from 'maplibre-gl';
import { MAP_FONT } from './mapFonts';

const RATIO = 2;

// 24×24 glyph paths, the same drawing language as icons/glyphs.tsx.
const GLYPHS: Record<string, string> = {
  fuel: 'M5.3 2.8h7.4c1 0 1.8.8 1.8 1.8v6.6h.6c1.2 0 2.1.9 2.1 2.1v4.5c0 .5.4.9.9.9s.9-.4.9-.9V9.9l-2-2c-.3-.3-.3-.8 0-1.1.3-.3.8-.3 1.1 0l2.3 2.3c.3.3.5.7.5 1.1v7.6a2.4 2.4 0 0 1-4.8 0v-4.5c0-.4-.3-.6-.6-.6h-.6v7.6c.5.1.8.5.8 1v.3H2.7v-.3c0-.5.4-.9.8-1V4.6c0-1 .8-1.8 1.8-1.8zm.9 2.1c-.4 0-.7.3-.7.7v3.6c0 .4.3.7.7.7h5.6c.4 0 .7-.3.7-.7V5.6c0-.4-.3-.7-.7-.7H6.2z',
  service: 'M15.2 2.4c1.6-.2 3.1.3 4.2 1.3.3.3.2.7-.1.9l-2.9 2.1.4 2.2 2.2.4 2.1-2.9c.2-.3.7-.4.9-.1a5.6 5.6 0 0 1-6.4 8.8l-6.8 7a2.6 2.6 0 0 1-3.8-3.7l6.9-6.9a5.6 5.6 0 0 1 3.3-9.1z',
  garage: 'M10.8 3.3c.7-.6 1.7-.6 2.4 0l7.4 6.3c.4.4.7.9.7 1.5v8.3c0 1.1-.9 2-2 2h-4.1c-.6 0-1-.4-1-1v-4.6c0-.6-.4-1-1-1h-2.4c-.6 0-1 .4-1 1v4.6c0 .6-.4 1-1 1H4.7c-1.1 0-2-.9-2-2v-8.3c0-.6.3-1.1.7-1.5l7.4-6.3z',
  dealer: 'M2.6 5.2h10.8c.7 0 1.2.5 1.2 1.2v9.1H1.4V6.4c0-.7.5-1.2 1.2-1.2zm13.2 2.9h3.4c.5 0 .9.2 1.1.6l2.1 3.5c.1.2.2.4.2.7v3.1c0 .5-.4.9-.9.9h-.5a2.7 2.7 0 0 0-5.3 0h-.1V8.1zm1.6 1.6v3h3.6l-1.7-2.7c-.1-.2-.3-.3-.5-.3h-1.4zM1.4 16.6h2.3a2.7 2.7 0 0 1 5.3 0h4.4v.9H9a2.7 2.7 0 0 1-5.3 0H1.4v-.9zm5 3.1a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zm12.1 0a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z',
  ferry: 'M9 3.4h6c.6 0 1 .4 1 1v1.8h1.7c.7 0 1.3.6 1.3 1.3v3.8l1.5.5c.6.2.9.8.7 1.4l-1.5 4.6c-.9-.1-1.8-.5-2.5-1.1-.4-.3-.9-.3-1.3 0a4 4 0 0 1-5.7 0c-.4-.3-.9-.3-1.3 0-.7.6-1.6 1-2.5 1.1l-1.5-4.6c-.2-.6.1-1.2.7-1.4l1.5-.5V7.5c0-.7.6-1.3 1.3-1.3H8V4.4c0-.6.4-1 1-1zm-1.9 4.9v2.8L12 9.5l4.9 1.6V8.3H7.1zm-4 11c1.3 0 2.5-.4 3.6-1.2a5.9 5.9 0 0 0 7 0c1 .8 2.3 1.2 3.6 1.2.5 0 .9.4.9.9s-.4.9-.9.9c-1.4 0-2.7-.4-3.8-1.1a7.7 7.7 0 0 1-7.4 0c-1.1.7-2.4 1.1-3.8 1.1-.5 0-.9-.4-.9-.9s.4-.9.9-.9z',
  train: 'M8.2 2.6h7.6c2.1 0 3.8 1.7 3.8 3.8v8.8c0 1.7-1.2 3.2-2.8 3.6l1.6 2.2c.3.4.2.9-.2 1.2-.4.3-.9.2-1.2-.2l-2.1-2.9H9.1L7 21.4c-.3.4-.8.5-1.2.2-.4-.3-.5-.8-.2-1.2l1.6-2.2a3.8 3.8 0 0 1-2.8-3.6V6.4c0-2.1 1.7-3.8 3.8-3.8zm-1.6 4v4.3h10.8V6.6c0-.9-.7-1.6-1.6-1.6H8.2c-.9 0-1.6.7-1.6 1.6zm1.8 6.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zm7.2 0a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z',
  weigh: 'M12 2.6a3.3 3.3 0 0 1 3.1 4.5h2.2c1 0 1.9.7 2.1 1.7l2.2 10.6c.3 1.3-.7 2.6-2.1 2.6H4.5c-1.4 0-2.4-1.3-2.1-2.6L4.6 8.8c.2-1 1.1-1.7 2.1-1.7h2.2A3.3 3.3 0 0 1 12 2.6zm0 2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z',
  company: 'M12 2.3c.3 0 .5.1.8.2l7.6 4.1c.2.1.3.2.4.4L12 11.5 3.2 7c.1-.2.2-.3.4-.4l7.6-4.1c.3-.1.5-.2.8-.2zm-9.1 6.2 8.3 4.3V22c-.2 0-.3-.1-.4-.1l-7.2-3.9c-.5-.3-.8-.8-.8-1.4V8.6l.1-.1zm18.2 0 .1.1v8c0 .6-.3 1.1-.8 1.4l-7.2 3.9c-.1 0-.2.1-.4.1v-9.2l8.3-4.3z',
  recruit: 'M9.4 3.2h5.2c1 0 1.8.8 1.8 1.8v1.4h3.2c1.1 0 2 .9 2 2v3.3H2.4V8.4c0-1.1.9-2 2-2h3.2V5c0-1 .8-1.8 1.8-1.8zm.2 2v1.2h4.8V5.2H9.6zM2.4 13.7h8.1v1.1c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1.1h8.1v4.9c0 1.1-.9 2-2 2H4.4c-1.1 0-2-.9-2-2v-4.9z',
  photo: 'M9.3 3.8h5.4c.6 0 1.1.3 1.4.8l1 1.6h2.3c1.4 0 2.6 1.2 2.6 2.6v9.2c0 1.4-1.2 2.6-2.6 2.6H4.6A2.6 2.6 0 0 1 2 18V8.8c0-1.4 1.2-2.6 2.6-2.6h2.3l1-1.6c.3-.5.8-.8 1.4-.8zM12 8.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8zm0 2a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8z',
  view: 'M12 5c4.6 0 8.4 3.3 9.8 6.3.2.4.2.9 0 1.4C20.4 15.7 16.6 19 12 19s-8.4-3.3-9.8-6.3c-.2-.5-.2-1 0-1.4C3.6 8.3 7.4 5 12 5zm0 2.8a4.2 4.2 0 1 0 0 8.4 4.2 4.2 0 0 0 0-8.4zm0 2.2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  border: 'M5 2.6c.6 0 1 .4 1 1v.6c1.9-1 3.9-1 6 .1 1.8.9 3.6.9 5.6-.2.7-.4 1.5.1 1.5.9v8.6c0 .4-.2.7-.5.9-2.4 1.4-4.8 1.5-7.1.3-1.6-.8-3.3-.8-5.5.3v6.3c0 .6-.4 1-1 1s-1-.4-1-1V3.6c0-.6.4-1 1-1z',
};

const BADGE: Record<string, { color: string; glyph?: string; text?: string; square?: boolean; star?: boolean }> = {
  fuel: { color: '#2f7cf6', glyph: 'fuel' },
  parking: { color: '#3a82f7', text: 'P', square: true },
  // What a trucker looks for on the road stands out: repair (F7 tows you there), fuel, rest.
  service: { color: '#e8562a', glyph: 'service' },
  garage: { color: '#5e5ce6', glyph: 'garage' },
  'garage-owned': { color: '#e3a400', glyph: 'garage', star: true },
  dealer: { color: '#ff9500', glyph: 'dealer' },
  recruit: { color: '#34c759', glyph: 'recruit' },
  weigh: { color: '#8e8e93', glyph: 'weigh' },
  toll: { color: '#ff9f0a', text: '€' },
  border: { color: '#af52de', glyph: 'border' },
  photo: { color: '#ff2d55', glyph: 'photo' },
  view: { color: '#30b0c7', glyph: 'view' },
  ferry: { color: '#0a84ff', glyph: 'ferry' },
  train: { color: '#5856d6', glyph: 'train' },
  company: { color: '#a2845e', glyph: 'company' },
};

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  return [c, c.getContext('2d')!] as const;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function badge(kind: string, u: number): ImageData | null {
  const b = BADGE[kind];
  if (!b) return null;
  const d = 21 * u * RATIO; // disc diameter
  const pad = 2 * u * RATIO; // room for the shadow
  const [c, ctx] = canvas(d + pad * 2, d + pad * 2);
  const cx = pad + d / 2;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
  ctx.shadowBlur = 1.6 * u * RATIO;
  ctx.shadowOffsetY = 0.5 * u * RATIO;
  ctx.fillStyle = '#ffffff';
  if (b.square) roundRect(ctx, pad, pad, d, d, d * 0.26);
  else {
    ctx.beginPath();
    ctx.arc(cx, cx, d / 2, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.shadowColor = 'transparent';
  const ring = 1.5 * u * RATIO;
  ctx.fillStyle = b.color;
  if (b.square) roundRect(ctx, pad + ring, pad + ring, d - ring * 2, d - ring * 2, (d - ring * 2) * 0.24);
  else {
    ctx.beginPath();
    ctx.arc(cx, cx, d / 2 - ring, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  if (b.glyph) {
    const g = d * 0.56;
    ctx.save();
    ctx.translate(cx - g / 2, cx - g / 2);
    ctx.scale(g / 24, g / 24);
    ctx.fill(new Path2D(GLYPHS[b.glyph]));
    ctx.restore();
  } else if (b.text) {
    ctx.font = `700 ${d * 0.62}px "${MAP_FONT.bold}", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.text, cx, cx + d * 0.03);
  }
  if (b.star) {
    // Yours: a small white star on the badge's shoulder.
    const r = d * 0.2;
    const sx = cx + d * 0.3;
    const sy = cx - d * 0.3;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.lineWidth = 1.4 * u * RATIO;
    ctx.strokeStyle = b.color;
    ctx.stroke();
    ctx.fill();
  }
  return ctx.getImageData(0, 0, c.width, c.height);
}

// Shield colours: [background, text, border]. Matched by "<country>_<prefix>" first, then prefix.
const BLUE: [string, string, string] = ['#1d5bbf', '#ffffff', '#ffffff'];
const GREEN: [string, string, string] = ['#127a3e', '#ffffff', '#ffffff'];
const RED: [string, string, string] = ['#c9252c', '#ffffff', '#ffffff'];
const YELLOW: [string, string, string] = ['#f6c400', '#1d1d1f', '#1d1d1f'];
const WHITE: [string, string, string] = ['#ffffff', '#1d1d1f', '#9a9aa0'];
const SHIELDS: Record<string, [string, string, string]> = {
  e: GREEN,
  fr_a: RED,
  fr_n: RED,
  it_a: GREEN,
  ch_: RED,
  nl_a: RED,
  nl_n: YELLOW,
  pl_a: RED,
  pl_s: RED,
  pl_: RED,
  cz_: BLUE,
  sk_d: RED,
  hu_m: BLUE,
  uk_a: ['#0f6b3b', '#ffd200', '#ffffff'],
  uk_m: BLUE,
  tr_o: GREEN,
  tr_d: BLUE,
  a: BLUE,
  ap: BLUE,
  m: BLUE,
  d: WHITE,
};

export function shieldLabel(sprite: string): { country: string; code: string; label: string } {
  const i = sprite.indexOf('_');
  const country = i > 0 ? sprite.slice(0, i) : '';
  const code = (i > 0 ? sprite.slice(i + 1) : sprite).toUpperCase();
  const m = /^([A-Z]*)(\d.*)?$/.exec(code);
  const letters = m?.[1] ?? '';
  const rest = m?.[2] ?? '';
  const hyphen = (country === 'es' || (country === 'tr' && letters === 'O')) && letters && rest;
  return { country, code, label: hyphen ? `${letters}-${rest}` : `${letters}${rest}` };
}

function shieldColors(sprite: string): [string, string, string] {
  const { country, code } = shieldLabel(sprite);
  const prefix = /^[A-Z]*/.exec(code)?.[0].toLowerCase() ?? '';
  if (prefix === 'e' && /^E\d/.test(code)) return SHIELDS.e;
  return SHIELDS[`${country}_${prefix}`] ?? SHIELDS[`${country}_`] ?? SHIELDS[prefix] ?? WHITE;
}

function shield(sprite: string, u: number): ImageData | null {
  const { label } = shieldLabel(sprite);
  if (!label) return null;
  const [bg, fg, edge] = shieldColors(sprite);
  const h = 15 * u * RATIO;
  const font = `700 ${10.5 * u * RATIO}px "${MAP_FONT.bold}", sans-serif`;
  const [, measure] = canvas(1, 1);
  measure.font = font;
  const tw = measure.measureText(label).width;
  const w = Math.max(h * 1.25, tw + 9 * u * RATIO);
  const pad = 1.5 * u * RATIO;
  const [c, ctx] = canvas(w + pad * 2, h + pad * 2);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 1.2 * u * RATIO;
  ctx.shadowOffsetY = 0.4 * u * RATIO;
  ctx.fillStyle = bg;
  roundRect(ctx, pad, pad, w, h, 3.2 * u * RATIO);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 0.9 * u * RATIO;
  ctx.strokeStyle = edge;
  roundRect(ctx, pad + 1.4 * u * RATIO, pad + 1.4 * u * RATIO, w - 2.8 * u * RATIO, h - 2.8 * u * RATIO, 2 * u * RATIO);
  if (bg !== WHITE[0]) ctx.stroke();
  else {
    ctx.strokeStyle = edge;
    roundRect(ctx, pad, pad, w, h, 3.2 * u * RATIO);
    ctx.stroke();
  }
  ctx.font = font;
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, pad + w / 2, pad + h / 2 + 0.5 * u * RATIO);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** Supplies POI badges and shields to `map` as the style asks for them. */
export function provideMapImages(map: MapLibre, u: () => number, ready: Promise<unknown>) {
  map.setMissingStyleImageResolver(async id => {
    await ready; // shields and the P / € badges are lettered in Inter
    if (map.hasImage(id)) return;
    let img: ImageData | null = null;
    if (id.startsWith('poi:')) img = badge(id.slice(4), u());
    else if (id.startsWith('shield:')) img = shield(id.slice(7), u());
    if (img) map.addImage(id, img, { pixelRatio: RATIO });
  });
}
