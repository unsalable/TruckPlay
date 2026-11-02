// The HUD's script: from the planned drive (maps/route.ts — its turns come from the game's road
// graph) and the truck's position, what the HUD over the road says right now, sent to the host
// ten times a second when it changes. It also speaks up, if the driver wants: a soft chime at the
// turn, and a voice on the way to it ("400 metre sonra sağdan çıkın, ardından sola dönün"; the
// voice itself is state/voice.ts).

import { createStore } from './store';
import { host } from './bridge';
import { connection, telemetry } from './telemetry';
import { settings } from './ui';
import { gamePaused } from './gamePause';
import { language, t, type StringKey } from './i18n';
import { distance, kmh } from './format';
import { locateOnDrive, route } from '../maps/route';
import { cityTable } from '../maps/places';
import type { Maneuver } from '../maps/nav';
import { NO_FRAME, NO_WIND, type GlyphSpec, type HudFrame, type WindFrame } from '../hud/types';
import { hudAudio, speak, startVoice } from './voice';

/** The frame the HUD shows now (also handy for the cab screen and for tests). */
export const hudFrame = createStore<HudFrame>(NO_FRAME);
/** And the windshield HUD's. */
export const windFrame = createStore<WindFrame>(NO_WIND);

const glyphOf = (m: Maneuver): GlyphSpec => ({ type: m.type, side: m.side, angle: m.angle, exit: m.exit, leftHand: m.leftHand });

let ports: Record<string, string> = {};
const portName = (token = '') => ports[token] ?? token.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** What to do, in words: "Sağdan çıkın", "Dönel kavşakta 2. çıkış". */
export function instruction(m: Maneuver, lang = language.get()): string {
  const side = m.side || 'right';
  switch (m.type) {
    case 'roundabout':
      // A ring we could not count the exits of: just which way out.
      if (!m.exit) return t('hud.roundabout.any', lang);
      return t('hud.roundabout', lang).replace('{n}', lang === 'tr' ? `${m.exit}.` : ordinal(m.exit));
    case 'ferry':
    case 'train':
      return t(`hud.${m.type}` as StringKey, lang).replace('{to}', portName(m.to));
    case 'arrive':
      return t('hud.arrive', lang);
    case 'uturn':
      return t('hud.uturn', lang);
    default:
      return t(`hud.${m.type}.${side}` as StringKey, lang);
  }
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

/* ---- speaking up --------------------------------------------------------------------------- */

/** Two soft notes, a fourth apart: the turn is here. */
function chime(volume: number) {
  try {
    const audio = hudAudio();
    const now = audio.currentTime;
    for (const [i, f] of [659.25, 880].entries()) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const at = now + i * 0.13;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.22 * volume, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
      o.connect(g).connect(audio.destination);
      o.start(at);
      o.stop(at + 0.45);
    }
  } catch {
    // no audio output: the HUD still shows the turn
  }
}

/** The voice's phrase for a manoeuvre (see shared/voice.json). */
function phraseOf(m: Maneuver): string {
  switch (m.type) {
    case 'roundabout':
      return m.exit && m.exit <= 8 ? `roundabout.${m.exit}` : 'roundabout.any';
    case 'uturn':
    case 'ferry':
    case 'train':
    case 'arrive':
      return m.type;
    default:
      return `${m.type}.${m.side || 'right'}`;
  }
}

/* ---- the frame ----------------------------------------------------------------------------- */

export function startHud() {
  void cityTable().then(table => {
    ports = Object.fromEntries(Object.entries(table).map(([k, c]) => [k, c[language.get()] || c.name]));
  });
  startVoice();

  let sent = '';
  let windSent = '';
  // Which prompts each manoeuvre has had: "far", "near", "now".
  const told = new Map<number, Set<string>>();
  let arrivedAt = 0;
  let driveKey: unknown = null;

  const tick = () => {
    const s = settings.get();
    const r = route.get();
    const tel = telemetry.get();
    const state = connection.get().state;
    const lang = language.get();
    let frame: HudFrame = NO_FRAME;

    if (r.nav !== driveKey) {
      // A new drive: start the prompts afresh.
      driveKey = r.nav;
      told.clear();
      arrivedAt = 0;
    }
    const running = state === 'live' || state === 'demo';
    const imperialUnits = s.units === 'imperial';
    const unitSpeed = (ms: number) => (imperialUnits ? Math.round(kmh(ms) * 0.621371) : kmh(ms));
    const speedNow = Math.abs(tel.truck.speed);
    const limitNow = tel.truck.nav.limit;
    let wind: WindFrame = NO_WIND;
    // The windshield HUD shows whenever the truck is powered, like a real one; the turn joins it
    // while a drive is planned.
    if (s.hudWindshield && running && (state === 'demo' || tel.truck.electric) && (tel.truck.pos.x || tel.truck.pos.z)) {
      wind = {
        on: true,
        lang,
        speed: unitSpeed(speedNow),
        speedUnit: imperialUnits ? 'mph' : 'km/h',
        limit: limitNow > 0.5 ? unitSpeed(limitNow) : 0,
        over: limitNow > 0.5 && speedNow > limitNow + 1.4,
        cruise: tel.truck.cruise > 0.5 ? unitSpeed(tel.truck.cruise) : 0,
        nav: null,
      };
    }
    if ((s.hud || s.hudWindshield) && r.nav && running && !gamePaused.get() && (tel.truck.pos.x || tel.truck.pos.z)) {
      const at = locateOnDrive(r.nav, tel.truck.pos.x, tel.truck.pos.z, r.progress);
      const ms = r.nav.maneuvers;
      // The manoeuvre still ahead, or being made (a junction takes a few metres to cross).
      const i = ms.findIndex(m => m.at > at.along - 18);
      const speed = Math.abs(tel.truck.speed);
      const imperial = s.units === 'imperial';
      const toUnit = (ms: number) => (imperial ? Math.round(kmh(ms) * 0.621371) : kmh(ms));
      if (i >= 0) {
        const m = ms[i];
        const left = Math.max(0, m.at - at.along);
        const fast = speed > 16.7 || (m.onto >= 0 && m.onto <= 1);
        // The last stretch: long enough to read at speed, short enough to mean "soon".
        const stretch = fast ? 600 : 250;
        const now = left < Math.max(30, speed * 2.2);
        const arrived = m.type === 'arrive' && left < 30;
        if (arrived && !arrivedAt) arrivedAt = performance.now();
        const next = ms[i + 1];
        const d = distance(left, lang);
        frame = {
          show: !(arrivedAt && performance.now() - arrivedAt > 6000),
          theme: s.appearance === 'light' ? 'light' : 'dark',
          lang,
          key: i,
          glyph: glyphOf(m),
          dist: now ? null : left >= 1000 ? d : { value: String(Math.max(10, Math.round(left / 10) * 10)), unit: 'm' },
          now,
          nowLabel: arrived ? t('hud.arrived', lang) : t('hud.now', lang),
          text: instruction(m, lang),
          progress: Math.max(0, Math.min(1, 1 - left / stretch)),
          then: next && next.at - m.at < 350 && left < stretch ? { glyph: glyphOf(next), label: t('hud.then', lang) } : null,
          speed: toUnit(speed),
          limit: tel.truck.nav.limit > 0.5 ? toUnit(tel.truck.nav.limit) : 0,
          speedUnit: imperial ? 'mph' : 'km/h',
          over: tel.truck.nav.limit > 0.5 && speed > tel.truck.nav.limit + 1.4,
          arrived,
        };
        if (wind.on) {
          wind.nav = { key: i, glyph: frame.glyph, dist: frame.dist, now, nowLabel: frame.nowLabel, progress: frame.progress };
        }
        // The card only for the driver who has it on (the windshield HUD may be guiding alone).
        if (!s.hud) frame = NO_FRAME;

        // Speaking up: far, near and at the turn, each once per manoeuvre. A turn coming right
        // after this one is told along with it, as Google Maps does ("…, ardından sola dönün").
        const said = told.get(i) ?? new Set<string>();
        told.set(i, said);
        const volume = s.volume;
        const gender = s.hudVoiceGender;
        const follow = next && next.at - m.at < 350 && next.type !== 'arrive' ? [`then.${phraseOf(next)}`] : [];
        const prompts: Array<[string, number]> = fast ? [['far', 1000], ['near', 400]] : [['near', 250]];
        for (const [name, metres] of prompts) {
          if (!said.has(name) && left <= metres && left > metres - 180) {
            said.add(name);
            if (s.hudVoice) void speak([`${phraseOf(m)}@${metres}`, ...(name === 'near' ? follow : [])], lang, gender, volume);
          }
        }
        // At the turn (at a destination: once there).
        if (now && !said.has('now') && (m.type !== 'arrive' || arrived)) {
          said.add('now');
          if (s.hudChime) chime(volume);
          if (s.hudVoice) void speak(arrived ? ['arrived'] : [phraseOf(m), ...follow], lang, gender, volume, s.hudChime ? 0.35 : 0);
          for (const k of ['far', 'near']) said.add(k);
        }
      }
    }
    hudFrame.set(frame);
    const json = JSON.stringify(frame);
    if (json !== sent) {
      sent = json;
      void host?.invoke('hud:frame', frame).catch(() => {});
    }
    windFrame.set(wind);
    const windJson = JSON.stringify(wind);
    if (windJson !== windSent) {
      windSent = windJson;
      void host?.invoke('wind:frame', wind).catch(() => {});
    }
  };
  window.setInterval(tick, 100);

  // Where the HUDs sit and how big they are: the host sizes their windows, the plugin places
  // them (and keeps the route advisor's panel on or clear).
  const layoutOf = () => {
    const s = settings.get();
    return { pos: s.hudPos, size: s.hudSize, wind: s.hudWindshield, windHeight: s.hudWindHeight, advisor: s.advisorScreen };
  };
  const sendLayout = () => void host?.invoke('hud:layout', layoutOf()).catch(() => {});
  sendLayout();
  let layout = JSON.stringify(layoutOf());
  settings.subscribe(() => {
    const now = JSON.stringify(layoutOf());
    if (now !== layout) {
      layout = now;
      sendLayout();
    }
  });
}
