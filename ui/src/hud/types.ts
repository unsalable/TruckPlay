// What the HUD draws, worked out by the main UI (state/hud.ts) and sent through the host to the
// HUD's own window, which only lays it out and animates it.

export interface GlyphSpec {
  type: 'turn' | 'slight' | 'sharp' | 'uturn' | 'keep' | 'exit' | 'roundabout' | 'ferry' | 'train' | 'arrive' | 'straight';
  side: 'left' | 'right' | '';
  /** The junction's turn in degrees, + right. */
  angle: number;
  exit?: number;
  /** Great Britain: roundabouts run clockwise. */
  leftHand?: boolean;
}

export interface HudFrame {
  /** Guidance to show (a drive is planned and the game is running). */
  show: boolean;
  theme: 'dark' | 'light';
  lang: 'tr' | 'en';
  /** Changes when the manoeuvre does: the card's content turns over. */
  key: number;
  glyph: GlyphSpec;
  /** Distance to the manoeuvre, formatted; null at the manoeuvre itself ("now"). */
  dist: { value: string; unit: string } | null;
  now: boolean;
  nowLabel: string;
  /** "Sağdan çıkın", "Dönel kavşakta 2. çıkış" … */
  text: string;
  /** 0 far away … 1 at the manoeuvre, over the last few hundred metres. */
  progress: number;
  /** The manoeuvre right after this one, when it comes soon after. */
  then: { glyph: GlyphSpec; label: string } | null;
  /** km/h or mph, rounded; the limit is 0 when there is none. */
  speed: number;
  limit: number;
  speedUnit: string;
  over: boolean;
  /** Reached the destination: the card says so briefly, then leaves. */
  arrived: boolean;
}

/**
 * The windshield HUD: what a real truck's head-up display projects — the speed, the limit, the
 * cruise control, and the next turn while a drive is planned. The plugin places it in the
 * windshield and shows it in the cab view only.
 */
export interface WindFrame {
  /** Shown: the driver has it on, and the truck is powered. */
  on: boolean;
  lang: 'tr' | 'en';
  speed: number;
  speedUnit: string;
  /** 0 when there is none. */
  limit: number;
  over: boolean;
  /** The cruise control's speed, 0 when it is off. */
  cruise: number;
  nav: {
    key: number;
    glyph: GlyphSpec;
    dist: { value: string; unit: string } | null;
    now: boolean;
    nowLabel: string;
    progress: number;
  } | null;
}

export const NO_WIND: WindFrame = { on: false, lang: 'tr', speed: 0, speedUnit: 'km/h', limit: 0, over: false, cruise: 0, nav: null };

export const NO_FRAME: HudFrame = {
  show: false,
  theme: 'dark',
  lang: 'tr',
  key: -1,
  glyph: { type: 'straight', side: '', angle: 0 },
  dist: null,
  now: false,
  nowLabel: '',
  text: '',
  progress: 0,
  then: null,
  speed: 0,
  limit: 0,
  speedUnit: 'km/h',
  over: false,
  arrived: false,
};
