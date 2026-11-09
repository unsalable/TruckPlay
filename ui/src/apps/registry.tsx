import type { ComponentType } from 'react';
import type { StringKey } from '../state/i18n';
import type { AppId } from '../state/ui';
import { TruckApp } from './truck/TruckApp';
import { JobApp } from './job/JobApp';
import { SettingsApp } from './settings/SettingsApp';
import { NowPlayingApp } from './music/NowPlayingApp';
import { MusicApp } from './music/MusicApp';
import { RadioApp } from './music/RadioApp';
import { MapsApp } from './maps/MapsApp';
import { BrowserApp } from './browser/BrowserApp';
import { YouTubeApp } from './browser/YouTubeApp';
import { MessagesApp } from './messages/MessagesApp';

export interface AppDef {
  id: AppId;
  label: StringKey;
  component: ComponentType;
}

export const APPS: AppDef[] = [
  { id: 'maps', label: 'app.maps', component: MapsApp },
  { id: 'music', label: 'app.music', component: MusicApp },
  { id: 'youtube', label: 'app.youtube', component: YouTubeApp },
  { id: 'browser', label: 'app.browser', component: BrowserApp },
  { id: 'nowplaying', label: 'app.nowplaying', component: NowPlayingApp },
  { id: 'radio', label: 'app.radio', component: RadioApp },
  { id: 'truck', label: 'app.truck', component: TruckApp },
  { id: 'job', label: 'app.job', component: JobApp },
  { id: 'messages', label: 'app.messages', component: MessagesApp },
  // Not an app of its own: its icon turns split screen on and off (state/split.ts).
  { id: 'split', label: 'app.split', component: () => null },
  { id: 'settings', label: 'app.settings', component: SettingsApp },
];

export const appLabel = (id: AppId): StringKey => APPS.find(a => a.id === id)?.label ?? 'app.settings';
export const appComponent = (id: AppId) => APPS.find(a => a.id === id)?.component;
