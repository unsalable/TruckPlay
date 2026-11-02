// The HUD's voice. Its words come from shared/voice.json. A voice pack — one MP3 per phrase, read
// once by a natural voice (scripts/voices.mjs) and installed with TruckPlay under
// voices/<lang>-<gender>/ — speaks them, through Web Audio, so a follow-up ("ardından sola dönün")
// comes right after the first phrase, the way Google Maps chains them. Without a pack for the
// language and voice chosen, a Windows voice reads the same words.

import phrases from '../../../shared/voice.json';
import { host } from './bridge';

export type VoiceLang = 'tr' | 'en';
export type VoiceGender = 'female' | 'male';

interface Words {
  instructions: Record<string, string>;
  distances: Record<string, string>;
  ahead: string;
  then: string;
  arrived: string;
}
const WORDS = phrases as unknown as Record<VoiceLang, Words>;

/**
 * A phrase's words. Keys: an instruction at the turn ("turn.left"), ahead of it ("turn.left@400"),
 * as a follow-up ("then.turn.left"), or "arrived". scripts/voices.mjs builds the same sentences.
 */
export function phraseText(key: string, lang: VoiceLang): string {
  const w = WORDS[lang] ?? WORDS.en;
  const cap = (s: string) => s.charAt(0).toLocaleUpperCase(lang) + s.slice(1);
  if (key === 'arrived') return w.arrived;
  if (key.startsWith('then.')) return cap(w.then.replace('{i}', w.instructions[key.slice(5)] ?? ''));
  const [what, metres] = key.split('@');
  const instruction = w.instructions[what] ?? '';
  if (!metres) return cap(instruction);
  return cap(w.ahead.replace('{d}', w.distances[metres] ?? `${metres} m`).replace('{i}', instruction));
}

/** The phrase distances a pack has: prompts are announced at these. */
export const SPOKEN_DISTANCES = [1000, 400, 250] as const;

/* ---- the packs ------------------------------------------------------------------------------ */

export interface VoicePack {
  /** The service's name for the voice ("tr-TR-Chirp3-HD-Aoede"…). */
  voice: string;
  provider: string;
}

let packs: Record<string, VoicePack> | null = null;
let packsAsked: Promise<Record<string, VoicePack>> | null = null;

/** The installed packs by id ("tr-female"…). */
export function voicePacks(): Promise<Record<string, VoicePack>> {
  packsAsked ??= (host?.invoke('voice:packs') ?? Promise.resolve({}))
    .then((p: Record<string, VoicePack> | null) => (packs = p ?? {}))
    .catch(() => (packs = {}));
  return packsAsked;
}

let audio: AudioContext | null = null;
/** One audio context for the HUD's sounds (chime and voice). */
export function hudAudio(): AudioContext {
  audio ??= new AudioContext();
  return audio;
}

const clips = new Map<string, Promise<AudioBuffer | null>>();
function clip(pack: string, key: string): Promise<AudioBuffer | null> {
  const id = `${pack}/${key}`;
  let c = clips.get(id);
  if (!c) {
    c = (host?.invoke('voice:clip', pack, key) ?? Promise.resolve(null))
      .then((bytes: Uint8Array | null) => {
        if (!bytes?.length) return null;
        const copy = bytes.slice().buffer; // decodeAudioData takes (and detaches) its buffer
        return hudAudio().decodeAudioData(copy);
      })
      .catch(() => null);
    clips.set(id, c);
  }
  return c;
}

let turn = 0;
let sources: AudioBufferSourceNode[] = [];

function stop() {
  turn++;
  for (const s of sources) {
    try {
      s.stop();
    } catch {
      // not started yet or already over
    }
  }
  sources = [];
  window.speechSynthesis?.cancel();
}

/** Says the phrases, one after another (a newer call cuts an older one short), after `delay`
 *  seconds (to let the chime ring first). */
export async function speak(keys: string[], lang: VoiceLang, gender: VoiceGender, volume: number, delay = 0) {
  stop();
  const my = turn;
  const pack = `${lang}-${gender}`;
  const level = Math.max(0.1, Math.min(1, volume));
  if ((packs ?? (await voicePacks()))[pack]) {
    const buffers = await Promise.all(keys.map(k => clip(pack, k)));
    if (my !== turn) return;
    if (buffers.every(Boolean)) {
      const a = hudAudio();
      if (a.state === 'suspended') await a.resume().catch(() => {});
      const gain = a.createGain();
      gain.gain.value = level;
      gain.connect(a.destination);
      let at = a.currentTime + 0.03 + delay;
      for (const b of buffers as AudioBuffer[]) {
        const s = a.createBufferSource();
        s.buffer = b;
        s.connect(gain);
        s.start(at);
        sources.push(s);
        at += b.duration + 0.06;
      }
      return;
    }
  }
  const text = keys.map(k => phraseText(k, lang)).join(', ');
  if (delay > 0) window.setTimeout(() => my === turn && sayWithWindows(text, lang, gender, level), delay * 1000);
  else sayWithWindows(text, lang, gender, level);
}

// Windows' own voices carry no gender; these are the ones it ships with.
const FEMALE = /zira|hazel|susan|eva|aria|jenny|emel|seda|filiz|catherine|linda/i;
const MALE = /david|mark|george|tolga|ahmet|james|richard|ravi/i;

function sayWithWindows(text: string, lang: VoiceLang, gender: VoiceGender, volume: number) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const voices = synth.getVoices().filter(v => v.lang.toLowerCase().startsWith(lang));
  const voice = voices.find(v => (gender === 'female' ? FEMALE : MALE).test(v.name)) ?? voices[0];
  if (!voice) return; // no voice for this language on this PC: the chime has to do
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.volume = volume;
  u.rate = lang === 'tr' ? 1.02 : 1;
  synth.speak(u);
}

/** Wakes what the voice needs early: the pack list, and Chromium's late-loading voice list. */
export function startVoice() {
  void voicePacks();
  window.speechSynthesis?.getVoices();
}
