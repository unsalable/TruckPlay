// Makes the voice packs the HUD speaks with (ui/src/state/voice.ts): every phrase in
// shared/voice.json, read by a natural voice of a text-to-speech service, one MP3 each, under
// voices/<lang>-<gender>/. Made once, with your own key; the packs then ship with TruckPlay
// (scripts/paket.mjs) and play offline for everyone who installs it. A pack is a few thousand
// characters, far inside the free monthly allowance of both services.
//
//   node scripts/voices.mjs --provider google --key <API key> [--langs tr,en] [--genders female,male]
//   node scripts/voices.mjs --provider azure --key <key> --region westeurope [...]
//
//   --voice tr-female=<name>   that voice instead of the default (repeatable)
//   --force                    reads every phrase again (otherwise only the missing ones)
//
// Google Cloud Text-to-Speech: an API key of a project with the Text-to-Speech API enabled. It
// takes the most natural voices it has for the language (Chirp 3 HD, then Neural2, WaveNet…).
// Azure AI Speech: a Speech resource's key and region; Emel/Ahmet (tr) and Ava/Andrew (en).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORDS = JSON.parse(fs.readFileSync(path.join(root, 'shared', 'voice.json'), 'utf8'));
const LOCALES = { tr: 'tr-TR', en: 'en-US' };

const argv = process.argv.slice(2);
const opt = name => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const provider = opt('provider');
const key = opt('key');
const region = opt('region');
const langs = (opt('langs') ?? 'tr,en').split(',');
const genders = (opt('genders') ?? 'female,male').split(',');
const force = argv.includes('--force');
const chosen = {};
argv.forEach((a, i) => {
  if (a === '--voice') {
    const [pack, name] = String(argv[i + 1] ?? '').split('=');
    if (pack && name) chosen[pack] = name;
  }
});
if (!['google', 'azure'].includes(provider) || !key || (provider === 'azure' && !region)) {
  console.error('usage: node scripts/voices.mjs --provider google --key <API key>\n       node scripts/voices.mjs --provider azure --key <key> --region <region>');
  process.exit(1);
}

/* ---- the phrases (the same sentences as ui/src/state/voice.ts phraseText) -------------------- */

function phraseKeys(lang) {
  const w = WORDS[lang];
  const keys = ['arrived'];
  for (const i of Object.keys(w.instructions)) {
    if (i !== 'arrive') keys.push(i);
    for (const d of Object.keys(w.distances)) keys.push(`${i}@${d}`);
    keys.push(`then.${i}`);
  }
  return keys;
}

function phraseText(k, lang) {
  const w = WORDS[lang];
  const cap = s => s.charAt(0).toLocaleUpperCase(lang) + s.slice(1);
  if (k === 'arrived') return w.arrived;
  if (k.startsWith('then.')) return cap(w.then.replace('{i}', w.instructions[k.slice(5)] ?? ''));
  const [what, metres] = k.split('@');
  const instruction = w.instructions[what] ?? '';
  if (!metres) return cap(instruction);
  return cap(w.ahead.replace('{d}', w.distances[metres]).replace('{i}', instruction));
}

/* ---- the services -------------------------------------------------------------------------- */

const sleep = ms => new Promise(r => setTimeout(r, ms));
const escapeXml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** A request, again after a pause when the service says "too many" (free tiers are rate limited). */
async function call(url, init) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < 8) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** Math.min(attempt, 4);
      await sleep(wait);
      continue;
    }
    throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

const google = {
  async voice(lang, gender) {
    const res = await call(`https://texttospeech.googleapis.com/v1/voices?languageCode=${LOCALES[lang]}&key=${encodeURIComponent(key)}`);
    const { voices = [] } = await res.json();
    const family = n => ['Chirp3-HD', 'Chirp-HD', 'Neural2', 'Wavenet', 'Standard'].findIndex(f => n.includes(`-${f}-`));
    const liked = gender === 'female' ? ['Aoede', 'Kore', 'Leda', 'Zephyr'] : ['Charon', 'Puck', 'Fenrir', 'Orus'];
    const rank = n => {
      const f = family(n);
      const l = liked.findIndex(x => n.endsWith(`-${x}`));
      return (f < 0 ? 9 : f) * 10 + (l < 0 ? 9 : l);
    };
    const fit = voices
      .filter(v => v.languageCodes?.includes(LOCALES[lang]) && v.ssmlGender === gender.toUpperCase())
      .map(v => v.name)
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    if (!fit.length) throw new Error(`no ${gender} ${LOCALES[lang]} voice`);
    return fit[0];
  },
  async speak(text, lang, voice) {
    const res = await call(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text }, voice: { languageCode: LOCALES[lang], name: voice }, audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000 } }),
    });
    return Buffer.from((await res.json()).audioContent, 'base64');
  },
};

const azure = {
  async voice(lang, gender) {
    return { tr: { female: 'tr-TR-EmelNeural', male: 'tr-TR-AhmetNeural' }, en: { female: 'en-US-AvaNeural', male: 'en-US-AndrewNeural' } }[lang][gender];
  },
  async speak(text, lang, voice) {
    const res = await call(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'TruckPlay',
      },
      body: `<speak version='1.0' xml:lang='${LOCALES[lang]}'><voice name='${voice}'>${escapeXml(text)}</voice></speak>`,
    });
    return Buffer.from(await res.arrayBuffer());
  },
};

/* ---- making the packs ---------------------------------------------------------------------- */

const service = provider === 'google' ? google : azure;
for (const lang of langs) {
  for (const gender of genders) {
    const pack = `${lang}-${gender}`;
    const dir = path.join(root, 'voices', pack);
    fs.mkdirSync(dir, { recursive: true });
    const voice = chosen[pack] ?? (await service.voice(lang, gender));
    // Another voice than the pack had: every phrase again, so the pack speaks with one voice.
    let old = null;
    try {
      old = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));
    } catch {
      // a new pack
    }
    const fresh = force || !old || old.voice !== voice;
    const keys = phraseKeys(lang);
    let made = 0;
    for (const k of keys) {
      const file = path.join(dir, `${k}.mp3`);
      if (!fresh && fs.existsSync(file)) continue;
      fs.writeFileSync(file, await service.speak(phraseText(k, lang), lang, voice));
      made++;
      process.stdout.write(`\r${pack} ${voice}: ${made} phrases`);
    }
    fs.writeFileSync(path.join(dir, 'pack.json'), `${JSON.stringify({ lang, gender, voice, provider, phrases: keys.length, made: new Date().toISOString() }, null, 2)}\n`);
    console.log(`\r${pack} ${voice}: ${keys.length} phrases (${made} new)`);
  }
}
