#!/usr/bin/env node
// Checks which radio stream URLs answer with audio. usage: node tools/check-streams.mjs
const candidates = [
  ['Power FM', 'https://listen.powerapp.com.tr/powerfm/mpeg/icecast.audio'],
  ['Power Türk', 'https://listen.powerapp.com.tr/powerturk/mpeg/icecast.audio'],
  ['Radyo Fenomen', 'https://listen.radyofenomen.com/fenomen/128/icecast.audio'],
  ['Fenomen Türk', 'https://listen.radyofenomen.com/fenomenturk/128/icecast.audio'],
  ['Virgin Radio', 'https://playerservices.streamtheworld.com/api/livestream-redirect/VIRGIN_RADIO.mp3'],
  ['Joy Türk', 'https://playerservices.streamtheworld.com/api/livestream-redirect/JOY_TURK.mp3'],
  ['Joy FM', 'https://playerservices.streamtheworld.com/api/livestream-redirect/JOY_FM.mp3'],
  ['Metro FM', 'https://playerservices.streamtheworld.com/api/livestream-redirect/METRO_FM.mp3'],
  ['Süper FM', 'https://playerservices.streamtheworld.com/api/livestream-redirect/SUPER_FM.mp3'],
  ['Radyo D', 'https://playerservices.streamtheworld.com/api/livestream-redirect/RADYO_D.mp3'],
  ['Kafa Radyo', 'https://playerservices.streamtheworld.com/api/livestream-redirect/KAFA_RADYO.mp3'],
  ['Radyo Eksen', 'https://playerservices.streamtheworld.com/api/livestream-redirect/RADYO_EKSEN.mp3'],
  ['Number1 FM', 'https://n10101m.mediatriple.net/numberone'],
  ['TRT FM', 'https://radio-trtfm.live.trt.com.tr/master_128.m3u8'],
  ['TRT Türkü', 'https://radio-trtturku.live.trt.com.tr/master_128.m3u8'],
  ['TRT Nağme', 'https://radio-trtnagme.live.trt.com.tr/master_128.m3u8'],
  ['TruckersFM', 'https://live.truckers.fm/'],
  ['Kral Pop', 'https://dygedge.radyotvonline.net/kralpop/playlist.m3u8'],
  ['Slow Türk', 'https://radyo.duhnet.tv/slowturk'],
  ['Radyo 7', 'https://moondigitaledge.radyotvonline.net/radyo7/playlist.m3u8'],
];

async function check([name, url]) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 TruckPlay' } });
    const type = res.headers.get('content-type') ?? '';
    const reader = res.body?.getReader();
    const chunk = reader ? await reader.read() : { value: new Uint8Array() };
    ac.abort();
    const bytes = chunk.value?.length ?? 0;
    const ok = res.ok && (/audio|mpegurl|octet|aac|ogg/i.test(type) || bytes > 0);
    return `${ok ? 'OK  ' : 'BAD '} ${name.padEnd(14)} ${res.status} ${type.slice(0, 40).padEnd(40)} ${bytes}B  ${res.url}`;
  } catch (e) {
    return `FAIL ${name.padEnd(14)} ${e.name === 'AbortError' ? 'timeout' : e.message}`;
  } finally {
    clearTimeout(timer);
  }
}

const results = await Promise.all(candidates.map(check));
console.log(results.join('\n'));
