// Turkish stations (plus TruckersFM) whose public streams answered when TruckPlay was built
// (tools/check-streams.mjs re-checks them). Station names only; no logos are used.

export interface Station {
  id: string;
  name: string;
  genre: string;
  url: string;
  hls?: boolean;
  hue: number;
}

export const STATIONS: Station[] = [
  { id: 'trtfm', name: 'TRT FM', genre: 'Pop', url: 'https://radio-trtfm.live.trt.com.tr/master.m3u8', hls: true, hue: 210 },
  { id: 'powerturk', name: 'Power Türk', genre: 'Türkçe Pop', url: 'https://listen.powerapp.com.tr/powerturk/mpeg/icecast.audio', hue: 345 },
  { id: 'powerfm', name: 'Power FM', genre: 'Hit', url: 'https://listen.powerapp.com.tr/powerfm/mpeg/icecast.audio', hue: 0 },
  { id: 'kralpop', name: 'Kral Pop', genre: 'Türkçe Pop', url: 'https://dygedge.radyotvonline.net/kralpop/playlist.m3u8', hls: true, hue: 280 },
  { id: 'kralfm', name: 'Kral FM', genre: 'Arabesk', url: 'https://dygedge.radyotvonline.net/kralfm/playlist.m3u8', hls: true, hue: 25 },
  { id: 'joyturk', name: 'Joy Türk', genre: 'Slow', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/JOY_TURK.mp3', hue: 320 },
  { id: 'slowturk', name: 'Slow Türk', genre: 'Slow', url: 'https://radyo.duhnet.tv/slowturk', hue: 260 },
  { id: 'superfm', name: 'Süper FM', genre: 'Türkçe Pop', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/SUPER_FM.mp3', hue: 195 },
  { id: 'metrofm', name: 'Metro FM', genre: 'Yabancı Hit', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/METRO_FM.mp3', hue: 160 },
  { id: 'virgin', name: 'Virgin Radio', genre: 'Hit', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/VIRGIN_RADIO.mp3', hue: 355 },
  { id: 'joyfm', name: 'Joy FM', genre: 'Slow', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/JOY_FM.mp3', hue: 300 },
  { id: 'trtturku', name: 'TRT Türkü', genre: 'Türkü', url: 'https://radio-trtturku.live.trt.com.tr/master.m3u8', hls: true, hue: 35 },
  { id: 'trtradyo1', name: 'TRT Radyo 1', genre: 'Haber', url: 'https://radio-trtradyo1.live.trt.com.tr/master.m3u8', hls: true, hue: 220 },
  { id: 'radyo7', name: 'Radyo 7', genre: 'Türkçe', url: 'https://moondigitaledge.radyotvonline.net/radyo7/playlist.m3u8', hls: true, hue: 140 },
  { id: 'truckersfm', name: 'TruckersFM', genre: 'Trucker', url: 'https://live.truckers.fm/', hue: 45 },
];
